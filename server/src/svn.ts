import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const IGNORED = new Set([
  '.svn',
  '.git',
  '.aide',
  'node_modules',
  'target',
  'build',
  'dist',
  'out',
  'coverage',
  '.next',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.venv',
  'venv',
  '.tox',
  '.idea',
  '.gradle',
  '.mvn',
])

export interface SvnInfo {
  url: string | null
  relativeUrl: string | null
  revision: string | null
}

export interface SvnChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U'
  staged: boolean
  add: number
  del: number
}

export function isSvnRepo(cwd: string): boolean {
  return existsSync(join(cwd, '.svn'))
}

let availableCache: boolean | null = null

export async function svnAvailable(): Promise<boolean> {
  if (availableCache === true) return true
  try {
    await execFileAsync('svn', ['--version', '--quiet'], { windowsHide: true, timeout: 15000 })
    availableCache = true
  } catch {
    availableCache = false
  }
  return availableCache
}

async function svn(cwd: string, args: string[], timeout = 60000): Promise<string> {
  if (!(await svnAvailable())) {
    throw new Error('未安装 SVN 命令行客户端（svn），请先安装 SlikSVN/TortoiseSVN 命令行工具')
  }
  try {
    const { stdout } = await execFileAsync('svn', ['--non-interactive', ...args], {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    })
    return stdout
  } catch (err: any) {
    const detail = String(err?.stderr ?? err?.message ?? err).trim()
    throw new Error(`svn ${args[0]} 失败：${detail.slice(0, 1500)}`)
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function ignored(path: string): boolean {
  return path
    .split(/[\\/]/)
    .filter(Boolean)
    .some((part) => IGNORED.has(part))
}

export async function svnInfo(cwd: string): Promise<SvnInfo> {
  if (!isSvnRepo(cwd)) return { url: null, relativeUrl: null, revision: null }
  if (!(await svnAvailable())) return { url: null, relativeUrl: 'svn', revision: null }
  try {
    const xml = await svn(cwd, ['info', '--xml'])
    const url = decodeXml(/<url>([\s\S]*?)<\/url>/.exec(xml)?.[1]?.trim() ?? '')
    const relative = decodeXml(/<relative-url>([\s\S]*?)<\/relative-url>/.exec(xml)?.[1]?.trim() ?? '')
    const revision = /<entry[^>]*revision="(\d+)"/.exec(xml)?.[1] ?? /<revision>(\d+)<\/revision>/.exec(xml)?.[1] ?? null
    return { url: url || null, relativeUrl: relative || null, revision }
  } catch {
    return { url: null, relativeUrl: 'svn', revision: null }
  }
}

export async function svnStatus(cwd: string): Promise<SvnChange[]> {
  if (!isSvnRepo(cwd)) return []
  if (!(await svnAvailable())) throw new Error('未安装 SVN 命令行客户端（svn）')
  const xml = await svn(cwd, ['status', '--xml'])
  const changes: SvnChange[] = []
  const re = /<entry\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const path = decodeXml(m[1])
    if (ignored(path)) continue
    const item = /<wc-status[^>]*\bitem="([^"]+)"/.exec(m[2])?.[1] ?? ''
    let status: SvnChange['status'] | null = null
    if (item === 'modified' || item === 'replaced') status = 'M'
    else if (item === 'added') status = 'A'
    else if (item === 'deleted' || item === 'missing') status = 'D'
    else if (item === 'conflicted') status = 'U'
    else if (item === 'unversioned') status = 'A'
    if (!status) continue
    changes.push({ path: path.replace(/\\/g, '/'), status, staged: false, add: 0, del: 0 })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

export async function svnLog(
  cwd: string,
  limit = 30,
): Promise<{ sha: string; parents: string[]; subject: string; author: string; time: number; refs: string[] }[]> {
  if (!isSvnRepo(cwd)) return []
  if (!(await svnAvailable())) throw new Error('未安装 SVN 命令行客户端（svn）')
  // 用 HEAD:1 而不是工作副本 BASE：SVN 工作副本可能是混合版本/根目录未更新
  const info = await svnInfo(cwd)
  const target = info.url ?? '.'
  const xml = await svn(cwd, ['log', '--xml', '-l', String(Math.max(1, Math.min(limit, 200))), '-r', 'HEAD:1', target])
  const out: { sha: string; parents: string[]; subject: string; author: string; time: number; refs: string[] }[] = []
  const re = /<logentry\s+revision="(\d+)"[^>]*>([\s\S]*?)<\/logentry>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const rev = m[1]
    const block = m[2]
    const author = decodeXml(/<author>([\s\S]*?)<\/author>/.exec(block)?.[1]?.trim() ?? 'svn')
    const date = /<date>([\s\S]*?)<\/date>/.exec(block)?.[1]?.trim() ?? ''
    const msg = decodeXml(/<msg>([\s\S]*?)<\/msg>/.exec(block)?.[1] ?? '').trim()
    out.push({
      sha: `r${rev}`,
      parents: [],
      subject: msg.split('\n')[0] || `r${rev}`,
      author,
      time: date ? Date.parse(date) || 0 : 0,
      refs: [],
    })
  }
  return out
}

export async function svnDiff(cwd: string, path?: string): Promise<string> {
  const args = ['diff']
  if (path) args.push(path)
  return svn(cwd, args)
}

/** 把未版本控制的新文件加入 SVN，然后提交整个工作副本 */
export async function svnCommit(cwd: string, message: string): Promise<{ revision: string; info: SvnInfo }> {
  const changes = await svnStatus(cwd)
  for (const change of changes.filter((c) => c.status === 'A')) {
    try {
      await svn(cwd, ['add', '--parents', '--force', change.path])
    } catch {
      /* 已加入或忽略 */
    }
  }
  const out = await svn(cwd, ['commit', '-m', message], 180000)
  const info = await svnInfo(cwd)
  const revision =
    /Committed revision (\d+)/i.exec(out)?.[1] ?? (await headRevision(cwd)) ?? info.revision ?? '0'
  return { revision, info }
}

export async function svnUpdate(cwd: string): Promise<string> {
  return svn(cwd, ['update', '--accept', 'postpone'], 180000)
}

async function headRevision(cwd: string): Promise<string | null> {
  try {
    const info = await svnInfo(cwd)
    const xml = await svn(cwd, ['log', '--xml', '-l', '1', '-r', 'HEAD:1', info.url ?? '.'])
    return /<logentry[^>]*revision="(\d+)"/.exec(xml)?.[1] ?? null
  } catch {
    return null
  }
}
