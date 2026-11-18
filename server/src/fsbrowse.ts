import { readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface DirEntry {
  name: string
  path: string
}

export interface BrowseResult {
  path: string
  parent: string | null
  entries: DirEntry[]
  roots: DirEntry[]
  home: string
}

function roots(): DirEntry[] {
  if (process.platform === 'win32') {
    const out: DirEntry[] = []
    for (let c = 65; c <= 90; c += 1) {
      const letter = String.fromCharCode(c)
      const p = `${letter}:\\`
      try {
        if (statSync(p).isDirectory()) out.push({ name: `${letter}:`, path: p })
      } catch {
        /* 不存在的盘符 */
      }
    }
    return out
  }
  return [{ name: '/', path: '/' }]
}

export function browseDirs(input?: string): BrowseResult {
  const home = os.homedir()
  const target = input?.trim() ? resolve(input.trim()) : home
  let st
  try {
    st = statSync(target)
  } catch {
    throw new Error(`目录不存在：${target}`)
  }
  if (!st.isDirectory()) throw new Error('不是目录')

  const entries: DirEntry[] = []
  for (const e of readdirSync(target, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') {
      continue
    }
    entries.push({ name: e.name, path: join(target, e.name) })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))

  return {
    path: target,
    parent: dirname(target) === target ? null : dirname(target),
    entries: entries.slice(0, 800),
    roots: roots(),
    home,
  }
}
