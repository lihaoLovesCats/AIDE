import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveClaudeBinary } from './claude.js'
import * as store from './db.js'
import { broadcast } from './events.js'
import { GitOpError, runTests, type CommitOptions, type CommitResult, type TestResult } from './gitops.js'
import { applyToolchainEnv } from './settings.js'
import { svnCommit, svnDiff, svnInfo, svnStatus } from './svn.js'
import type { ProjectRecord, SessionRecord } from './types.js'

const execFileAsync = promisify(execFile)

function cleanMessage(raw: string): string {
  const line =
    raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('```') && !/^(warning|error|note)\b/i.test(l)) ?? ''
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim()
}

async function generateMessage(cwd: string, files: { status: string; path: string }[]): Promise<string> {
  let diff = ''
  try {
    diff = await svnDiff(cwd)
  } catch {
    /* ignore */
  }
  const prompt = [
    '你是 SVN 提交信息生成器。根据改动生成一条 Conventional Commits 提交信息。',
    '要求：中文描述；类型用 feat/fix/refactor/docs/test/chore/perf 之一；最多 60 字；只输出一行；不要引号、不要解释、不要代码块。',
    '',
    '改动文件：',
    files.map((f) => `${f.status} ${f.path}`).join('\n').slice(0, 2000),
    '',
    'diff 片段：',
    diff.slice(0, 7000),
  ].join('\n')
  try {
    const { stdout } = await execFileAsync(
      resolveClaudeBinary(),
      ['-p', prompt, '--output-format', 'text', '--permission-mode', 'bypassPermissions'],
      { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: applyToolchainEnv() },
    )
    const msg = cleanMessage(stdout)
    if (msg) return msg
  } catch {
    /* fallback */
  }
  return `chore: 更新 ${files.length} 个文件`
}

export async function commitSvnSession(
  project: ProjectRecord,
  session: SessionRecord,
  opts: CommitOptions,
): Promise<CommitResult> {
  const cwd = project.path
  const files = await svnStatus(cwd)
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
    payload: { stage: 'commit', message: `SVN 提交：${message}` },
  })

  let revision = '0'
  let branch = (await svnInfo(cwd)).relativeUrl ?? 'svn'
  try {
    const result = await svnCommit(cwd, message)
    revision = result.revision
    branch = result.info.relativeUrl ?? branch
  } catch (err: any) {
    throw new GitOpError('SVN 提交失败：' + String(err?.message ?? err).slice(0, 1500), 409, { stage: 'commit' })
  }

  const sha = `r${revision}`
  store.addAudit(
    'commit',
    { sha, branch, message, pushed: true, vcs: 'svn', forced: Boolean(opts.force) },
    project.id,
    session.id,
  )
  if (opts.force) {
    store.addAudit('force_commit', { sha, branch, message, testStatus: test.status, vcs: 'svn' }, project.id, session.id)
  }

  broadcast({
    type: 'git.done',
    sessionId: session.id,
    projectId: project.id,
    payload: { sha, shortSha: sha, branch, pushed: true, message, vcs: 'svn' },
  })

  return {
    sha,
    shortSha: sha,
    message,
    branch,
    test,
    pushed: true,
    remote: 'svn',
  }
}
