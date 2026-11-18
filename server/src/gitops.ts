import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveClaudeBinary } from './claude.js'
import * as store from './db.js'
import { broadcast } from './events.js'
import { currentBranch, numstatWithUntracked, statusFiles } from './git.js'
import { applyToolchainEnv } from './settings.js'
import { detectTestCommand } from './stacks.js'
import { listWorktrees } from './worktree.js'
import type { ProjectRecord, SessionRecord } from './types.js'

const execFileAsync = promisify(execFile)

export class GitOpError extends Error {
  statusCode: number
  data: Record<string, unknown>

  constructor(message: string, statusCode = 400, data: Record<string, unknown> = {}) {
    super(message)
    this.statusCode = statusCode
    this.data = data
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

function tail(text: string, max = 4000): string {
  const t = text.trim()
  return t.length > max ? t.slice(-max) : t
}

/* ------------------------------ 测试门禁 ------------------------------ */

export interface TestResult {
  status: 'passed' | 'failed' | 'skipped'
  label: string
  output: string
  durationMs: number
  reason?: string
}

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

export async function runTests(cwd: string, project: ProjectRecord, timeoutMs = 5 * 60 * 1000): Promise<TestResult> {
  const spec = detectTestCommand(cwd, project)
  if (!spec) {
    const hasPom = existsSync(join(cwd, 'pom.xml'))
    return {
      status: 'skipped',
      label: '未执行',
      output: '',
      durationMs: 0,
      reason: hasPom
        ? '未安装 Maven，测试门禁已跳过'
        : '未识别到测试命令；可在项目设置里填写 testCommand',
    }
  }

  const started = Date.now()
  try {
    const isWin = process.platform === 'win32'
    const [file, ...args] = isWin
      ? ['cmd.exe', '/d', '/s', '/c', spec.command]
      : ['sh', '-c', spec.command]
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: applyToolchainEnv(),
    })
    return {
      status: 'passed',
      label: spec.label,
      output: tail(`${stdout}\n${stderr}`),
      durationMs: Date.now() - started,
    }
  } catch (err: any) {
    const out = tail(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}`.trim() || String(err?.message ?? err))
    return { status: 'failed', label: spec.label, output: out, durationMs: Date.now() - started }
  }
}

/* ---------------------------- 提交信息生成 ---------------------------- */

function sanitizeMessage(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(warning|error|note)\b/i.test(l) && !l.startsWith('```'))
  const line = lines[0] ?? ''
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim()
}

async function generateMessage(cwd: string, files: { status: string; path: string }[]): Promise<string> {
  const fileList = files.map((f) => `${f.status} ${f.path}`).join('\n')
  let stat = ''
  let diff = ''
  try {
    stat = await git(cwd, ['diff', '--stat', 'HEAD'])
    diff = await git(cwd, ['diff', 'HEAD'])
  } catch {
    /* 新仓库可能没有 HEAD */
  }

  const prompt = [
    '你是 git 提交信息生成器。根据下面的改动生成一条 Conventional Commits 提交信息。',
    '要求：中文描述；类型用 feat/fix/refactor/docs/test/chore/perf 之一；最多 60 字；只输出一行；不要引号、不要解释、不要代码块。',
    '',
    '改动文件：',
    fileList.slice(0, 2000),
    '',
    'diff 统计：',
    stat.slice(0, 3000),
    '',
    'diff 片段：',
    diff.slice(0, 6000),
  ].join('\n')

  try {
    const { stdout } = await execFileAsync(
      resolveClaudeBinary(),
      ['-p', prompt, '--output-format', 'text', '--permission-mode', 'bypassPermissions'],
      { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: applyToolchainEnv() },
    )
    const msg = sanitizeMessage(stdout)
    if (msg) return msg
  } catch (err) {
    console.warn('[gitops] 生成提交信息失败：', err instanceof Error ? err.message : err)
  }
  const n = files.length
  const first = files[0]?.path ?? ''
  return n > 0 ? `chore: 更新 ${n} 个文件${first ? `（${first}）` : ''}` : 'chore: 提交改动'
}

/* ------------------------------- 提交 -------------------------------- */

export interface CommitOptions {
  message?: string
  force?: boolean
  skipTests?: boolean
}

export interface CommitResult {
  sha: string
  shortSha: string
  message: string
  branch: string
  test: TestResult
  pushed: boolean
  remote: string | null
  pushError?: string
}

export async function commitSession(
  project: ProjectRecord,
  session: SessionRecord,
  opts: CommitOptions,
): Promise<CommitResult> {
  const cwd = session.cwd
  const files = await statusFiles(cwd)
  if (!files.length) throw new GitOpError('工作区没有可提交的改动', 400, { stage: 'check' })

  let test: TestResult
  if (opts.force) {
    test = { status: 'skipped', label: '强制提交', output: '', durationMs: 0, reason: '强制提交，跳过测试门禁' }
  } else if (opts.skipTests) {
    test = { status: 'skipped', label: '已跳过', output: '', durationMs: 0, reason: '手动跳过测试' }
  } else {
    broadcast({
      type: 'git.progress',
      sessionId: session.id,
      projectId: project.id,
      payload: { stage: 'test', message: '运行测试门禁…' },
    })
    test = await runTests(cwd, project)
  }

  if (test.status === 'failed' && !opts.force) {
    throw new GitOpError('测试未通过，提交已阻止', 409, {
      stage: 'test',
      test,
      files: files.map((f) => f.path),
    })
  }

  const message = (opts.message?.trim() || (await generateMessage(cwd, files))).trim()
  broadcast({
    type: 'git.progress',
    sessionId: session.id,
    projectId: project.id,
    payload: { stage: 'commit', message: `提交：${message}` },
  })

  try {
    await git(cwd, ['add', '-A'])
    await git(cwd, ['commit', '-m', message])
  } catch (err: any) {
    throw new GitOpError('提交失败：' + tail(String(err?.stderr ?? err?.message ?? err), 1200), 409, { stage: 'commit' })
  }

  const sha = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  const branch = (await currentBranch(cwd)) || session.branch

  let pushed = false
  let remote: string | null = null
  let pushError: string | undefined
  try {
    const remotes = (await git(cwd, ['remote'])).split('\n').map((s) => s.trim()).filter(Boolean)
    remote = remotes[0] ?? null
    if (remote) {
      await git(cwd, ['push', '-u', remote, branch])
      pushed = true
    }
  } catch (err: any) {
    pushError = tail(String(err?.stderr ?? err?.message ?? err), 1500)
  }

  store.addAudit('commit', { sha, branch, message, pushed, forced: Boolean(opts.force) }, project.id, session.id)
  if (opts.force) {
    store.addAudit('force_commit', { sha, branch, message, testStatus: test.status }, project.id, session.id)
  }

  broadcast({
    type: 'git.done',
    sessionId: session.id,
    projectId: project.id,
    payload: { sha, shortSha: sha.slice(0, 7), branch, pushed, message },
  })

  return { sha, shortSha: sha.slice(0, 7), message, branch, test, pushed, remote, pushError }
}

/* ------------------------------- 合并 -------------------------------- */

export async function mergeBranch(project: ProjectRecord, branch: string): Promise<{ sha: string; message: string }> {
  const cwd = project.path
  const dirty = await statusFiles(cwd)
  if (dirty.length) {
    throw new GitOpError('主工作区有未提交改动，请先处理再合并', 409, {
      stage: 'merge',
      files: dirty.map((f) => f.path),
    })
  }
  const cur = await currentBranch(cwd)
  if (cur !== project.mainBranch) {
    throw new GitOpError(`主工作区当前在 ${cur}，不是 ${project.mainBranch}`, 409, { stage: 'merge' })
  }

  try {
    const out = await git(cwd, ['merge', '--no-ff', branch, '-m', `merge: ${branch} → ${project.mainBranch}`])
    const sha = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
    store.addAudit('merge', { branch, sha }, project.id)
    return { sha, message: out.trim() }
  } catch (err: any) {
    const conflicts = (await git(cwd, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    await git(cwd, ['merge', '--abort']).catch(() => '')
    throw new GitOpError('合并失败，已回滚', 409, {
      stage: 'merge',
      conflicts,
      output: tail(String(err?.stderr ?? err?.message ?? err), 3000),
    })
  }
}

/* ------------------------------ 清理 ------------------------------ */

export async function pruneProject(project: ProjectRecord): Promise<{ worktrees: string[]; branches: string[] }> {
  const cwd = project.path
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const live = new Set(store.listSessions(project.id).map((s) => norm(s.cwd)))
  const removedWorktrees: string[] = []

  const worktrees = await listWorktrees(cwd)
  for (const wt of worktrees) {
    if (norm(wt.path) === norm(cwd)) continue
    if (!norm(wt.path).includes('/.aide/')) continue
    if (live.has(norm(wt.path))) continue
    try {
      await git(cwd, ['worktree', 'remove', '--force', wt.path])
      removedWorktrees.push(wt.path)
    } catch {
      /* 忽略已失效的 worktree */
    }
  }
  await git(cwd, ['worktree', 'prune']).catch(() => '')

  const removedBranches: string[] = []
  try {
    const out = await git(cwd, ['branch', '--merged', project.mainBranch, '--format=%(refname:short)'])
    for (const raw of out.split('\n')) {
      const branch = raw.trim()
      if (!branch || !branch.startsWith('aide/')) continue
      try {
        await git(cwd, ['branch', '-d', branch])
        removedBranches.push(branch)
      } catch {
        /* 仍被 worktree 占用或未完全合并 */
      }
    }
  } catch {
    /* 忽略 */
  }

  store.addAudit('prune', { worktrees: removedWorktrees, branches: removedBranches }, project.id)
  return { worktrees: removedWorktrees, branches: removedBranches }
}

/* ---------------------------- 会话工作区状态 ---------------------------- */

export async function sessionGitStatus(session: SessionRecord): Promise<{
  branch: string
  files: { path: string; status: string; staged: boolean; add: number; del: number }[]
  clean: boolean
}> {
  const [branch, files, stats] = await Promise.all([
    currentBranch(session.cwd).catch(() => session.branch),
    statusFiles(session.cwd),
    numstatWithUntracked(session.cwd),
  ])
  return {
    branch,
    files: files.map((f) => ({ ...f, ...(stats.get(f.path) ?? { add: 0, del: 0 }) })),
    clean: files.length === 0,
  }
}
