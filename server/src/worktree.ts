import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { currentBranch } from './git.js'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return base || 'agent'
}

/** 把 .aide/ 写进 .git/info/exclude，避免 worktree 目录污染主工作区状态 */
function ensureExclude(projectPath: string): void {
  try {
    const infoDir = join(projectPath, '.git', 'info')
    if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true })
    const exclude = join(infoDir, 'exclude')
    const cur = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (!cur.split(/\r?\n/).includes('.aide/')) {
      appendFileSync(exclude, (cur && !cur.endsWith('\n') ? '\n' : '') + '.aide/\n')
    }
  } catch {
    /* 忽略：不影响主流程 */
  }
}

export interface WorktreeInfo {
  path: string
  branch: string
}

export async function addSessionWorktree(
  projectPath: string,
  sessionId: string,
  title: string,
): Promise<WorktreeInfo | null> {
  try {
    ensureExclude(projectPath)
    const slug = `${slugify(title)}-${sessionId.slice(0, 6)}`
    const branch = `aide/${slug}`
    const wtPath = join(projectPath, '.aide', 'worktrees', slug)
    mkdirSync(dirname(wtPath), { recursive: true })
    const base = await currentBranch(projectPath)
    await git(projectPath, ['worktree', 'add', '-b', branch, wtPath, base])
    return { path: wtPath, branch }
  } catch (err) {
    console.warn('[worktree] create failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function removeSessionWorktree(projectPath: string, wtPath: string): Promise<void> {
  try {
    await git(projectPath, ['worktree', 'remove', '--force', wtPath])
  } catch {
    /* 已不存在时忽略 */
  }
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  bare: boolean
}

export async function listWorktrees(projectPath: string): Promise<WorktreeEntry[]> {
  try {
    const out = await git(projectPath, ['worktree', 'list', '--porcelain'])
    const entries: WorktreeEntry[] = []
    let cur: Partial<WorktreeEntry> = {}
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? null, bare: cur.bare ?? false })
        cur = { path: line.slice('worktree '.length).trim() }
      } else if (line.startsWith('branch ')) {
        cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      } else if (line.startsWith('HEAD ')) {
        cur.head = line.slice('HEAD '.length).trim()
      } else if (line.trim() === 'bare') {
        cur.bare = true
      }
    }
    if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? null, head: cur.head ?? null, bare: cur.bare ?? false })
    return entries
  } catch {
    return []
  }
}
