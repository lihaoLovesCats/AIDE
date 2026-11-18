import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { GitFileStatus } from './types.js'

const IGNORED = new Set([
  '.git',
  '.svn',
  'node_modules',
  'target',
  'build',
  'dist',
  '.idea',
  '.gradle',
  '.aide',
  'out',
  'coverage',
  '.next',
  '.cache',
  '.mvn',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.hypothesis',
  '.venv',
  'venv',
  '.tox',
  '.eggs',
  'htmlcov',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
])

export function safeResolve(root: string, rel = '.'): string {
  const base = resolve(root)
  const abs = resolve(base, rel || '.')
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error('路径越界')
  return abs
}

export interface TreeEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  status: GitFileStatus['status'] | null
}

export async function listTree(
  root: string,
  rel = '',
  statuses: Map<string, GitFileStatus['status']> = new Map(),
): Promise<TreeEntry[]> {
  const abs = safeResolve(root, rel)
  const entries = await readdir(abs, { withFileTypes: true })
  const out: TreeEntry[] = []

  for (const e of entries) {
    if (IGNORED.has(e.name) || e.isSymbolicLink()) continue
    const full = join(abs, e.name)
    const relPath = relative(root, full).split(sep).join('/')
    if (e.isDirectory()) {
      out.push({ name: e.name, path: relPath, type: 'dir', size: 0, status: null })
    } else if (e.isFile()) {
      const st = await stat(full)
      out.push({ name: e.name, path: relPath, type: 'file', size: st.size, status: statuses.get(relPath) ?? null })
    }
  }

  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return out
}

export async function readText(
  root: string,
  rel: string,
): Promise<{ content: string; size: number; mtime: number }> {
  const abs = safeResolve(root, rel)
  const st = await stat(abs)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，未加载')
  const buf = await readFile(abs)
  if (buf.includes(0)) throw new Error('二进制文件，无法预览')
  return { content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs }
}
