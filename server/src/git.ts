import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitCommit, GitFileStatus } from './types.js'

const exec = promisify(execFile)

async function run(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await run(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

export async function currentBranch(cwd: string): Promise<string> {
  try {
    return (await run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main'
  } catch {
    return 'main'
  }
}

export async function statusFiles(cwd: string): Promise<GitFileStatus[]> {
  const out = await run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const tokens = out.split('\0')
  const result: GitFileStatus[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token || token.length < 4) continue
    const x = token[0] ?? ' '
    const y = token[1] ?? ' '
    const path = token.slice(3)
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i += 1 // 跳过 rename 的原始路径

    const status: GitFileStatus['status'] =
      x === '?' || y === '?'
        ? 'U'
        : x === 'A' || y === 'A'
          ? 'A'
          : x === 'D' || y === 'D'
            ? 'D'
            : x === 'R' || y === 'R'
              ? 'R'
              : 'M'

    result.push({ path: path.replace(/\\/g, '/'), status, staged: x !== ' ' && x !== '?' })
  }
  return result
}

export async function log(cwd: string, limit = 30): Promise<GitCommit[]> {
  const out = await run(cwd, [
    'log',
    '--pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%at%x1f%D',
    '-n',
    String(Math.max(1, Math.min(200, limit))),
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, parents, subject, author, at, refs] = line.split('\x1f')
      return {
        sha: sha ?? '',
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        subject: subject ?? '',
        author: author ?? '',
        time: Number(at ?? 0) * 1000,
        refs: refs
          ? refs
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      }
    })
}

export interface BranchInfo {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  sha: string
}

export async function branches(cwd: string): Promise<BranchInfo[]> {
  const out = await run(cwd, [
    'for-each-ref',
    '--format=%(refname:short)%1f%(objectname:short)%1f%(upstream:short)%1f%(HEAD)',
    'refs/heads',
  ])
  const rows: BranchInfo[] = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, sha, upstream, head] = line.split('\x1f')
      return {
        name: name ?? '',
        sha: sha ?? '',
        upstream: upstream || null,
        current: head?.trim() === '*',
        ahead: 0,
        behind: 0,
      }
    })

  await Promise.all(
    rows.map(async (b) => {
      if (!b.upstream) return
      try {
        const c = (await run(cwd, ['rev-list', '--left-right', '--count', `${b.name}...${b.upstream}`])).trim().split(/\s+/)
        b.ahead = Number(c[0] ?? 0)
        b.behind = Number(c[1] ?? 0)
      } catch {
        /* upstream 不存在时忽略 */
      }
    }),
  )
  return rows
}

export async function diff(cwd: string, path: string): Promise<string> {
  return run(cwd, ['diff', '--no-color', '--', path])
}

export async function numstat(cwd: string): Promise<Map<string, { add: number; del: number }>> {
  const map = new Map<string, { add: number; del: number }>()
  for (const args of [['diff', '--numstat'], ['diff', '--cached', '--numstat']]) {
    try {
      const out = await run(cwd, args)
      for (const line of out.split('\n')) {
        if (!line.trim()) continue
        const [a, d, p] = line.split('\t')
        if (!p) continue
        const cur = map.get(p) ?? { add: 0, del: 0 }
        cur.add += Number(a) || 0
        cur.del += Number(d) || 0
        map.set(p.replace(/\\/g, '/'), cur)
      }
    } catch {
      /* ignore */
    }
  }
  return map
}

/** numstat + 未跟踪文件的行数（git diff 不包含 untracked） */
export async function numstatWithUntracked(cwd: string): Promise<Map<string, { add: number; del: number }>> {
  const map = await numstat(cwd)
  try {
    const files = await statusFiles(cwd)
    for (const f of files) {
      if (f.status !== 'U' || map.has(f.path)) continue
      try {
        const st = await stat(join(cwd, f.path))
        if (!st.isFile() || st.size > 512 * 1024) continue
        const buf = await readFile(join(cwd, f.path))
        if (buf.includes(0)) continue
        const text = buf.toString('utf8').replace(/\n$/, '')
        map.set(f.path, { add: text ? text.split('\n').length : 0, del: 0 })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return map
}
