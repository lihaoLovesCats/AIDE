import { api, type ApiBranch, type ApiCommit, type ApiGitStatus, type ApiMessage, type ApiProject, type ApiSession } from './api'
import type { Change, Commit, FileNode, Message, Project, Session, Status } from './types'

const COLORS: [string, string][] = [
  ['#5b8cff', '#7c5cff'],
  ['#22c55e', '#0ea5a5'],
  ['#f59e0b', '#f97316'],
  ['#ec4899', '#a855f7'],
  ['#06b6d4', '#3b82f6'],
]

const STATUS_MAP: Record<ApiSession['status'], Status> = {
  starting: 'starting',
  running: 'running',
  idle: 'idle',
  error: 'error',
  stopped: 'stopped',
}

export function mapFileLetter(s: string): 'M' | 'A' | 'D' | 'U' {
  if (s === 'A') return 'A'
  if (s === 'D') return 'D'
  if (s === 'U') return 'U'
  return 'M'
}

export function timeOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  if (Object.keys(obj).length === 0) return ''
  const v =
    obj.command ??
    obj.file_path ??
    obj.path ??
    obj.pattern ??
    obj.query ??
    obj.url ??
    obj.task ??
    obj.description ??
    obj.session
  if (v) return String(v).slice(0, 120)
  try {
    return JSON.stringify(input).slice(0, 120)
  } catch {
    return ''
  }
}

const TOOL_LABELS: Record<string, string> = {
  aide_list_sessions: '查看 Agent 会话',
  aide_dispatch: '派发任务',
  aide_create_session: '新建 Agent',
  aide_git_status: '查看 Git 状态',
  aide_commit_push: '提交并推送',
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object') {
          const o = c as Record<string, unknown>
          return typeof o.text === 'string' ? o.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return content ? JSON.stringify(content).slice(0, 4000) : ''
}

export function adaptMessages(msgs: ApiMessage[]): Message[] {
  const out: Message[] = []
  const toolIndex = new Map<string, number>()

  for (const m of msgs) {
    const p = m.payload ?? {}
    const time = timeOf(m.createdAt)

    if (m.role === 'user' && m.kind === 'text') {
      out.push({ id: m.id, role: 'user', kind: 'text', text: String(p.text ?? ''), time })
      continue
    }

    if (m.role === 'assistant' && m.kind === 'thinking') {
      out.push({
        id: m.id,
        role: 'assistant',
        kind: 'thinking',
        text: String(p.block?.thinking ?? ''),
        seconds: 0,
        time,
      })
      continue
    }

    if (m.role === 'assistant' && m.kind === 'text') {
      out.push({ id: m.id, role: 'assistant', kind: 'text', text: String(p.block?.text ?? ''), time })
      continue
    }

    if (m.role === 'assistant' && m.kind === 'tool_use') {
      const block = p.block ?? {}
      toolIndex.set(String(block.id ?? m.id), out.length)
      const rawName = String(block.name ?? 'Tool')
      const short = rawName.replace(/^mcp__aide__/, '')
      out.push({
        id: m.id,
        role: 'assistant',
        kind: 'tool',
        tool: {
          name: TOOL_LABELS[short] ?? rawName,
          input: summarizeInput(block.input),
          status: 'ok',
          duration: '',
        },
        time,
      })
      continue
    }

    if (m.role === 'assistant' && m.kind === 'peer') {
      out.push({
        id: m.id,
        role: 'assistant',
        kind: 'peer',
        toTitle: String(p.toTitle ?? 'Agent'),
        text: String(p.text ?? ''),
        time,
      })
      continue
    }

    if (m.role === 'assistant' && m.kind === 'dispatch') {
      const rawConf = Number(p.confidence ?? 0.9)
      const rawStatus = String(p.status ?? 'working')
      const status: 'sent' | 'working' | 'done' | 'failed' | 'revoked' =
        rawStatus === 'done' || rawStatus === 'failed' || rawStatus === 'revoked' || rawStatus === 'sent'
          ? rawStatus
          : 'working'
      out.push({
        id: m.id,
        role: 'assistant',
        kind: 'dispatch',
        entries: [
          {
            toSessionId: String(p.sessionId ?? ''),
            toName: String(p.title ?? 'Agent'),
            task: String(p.task ?? ''),
            reason: String(p.reason ?? ''),
            confidence: rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf),
            status,
          },
        ],
        time,
      })
      continue
    }

    if (m.role === 'user' && m.kind === 'tool_result') {
      const block = p.block ?? {}
      const idx = toolIndex.get(String(block.tool_use_id ?? ''))
      if (idx !== undefined) {
        const target = out[idx]
        if (target && target.kind === 'tool') {
          out[idx] = {
            ...target,
            tool: {
              ...target.tool,
              output: contentToText(block.content),
              status: block.is_error ? 'fail' : 'ok',
            },
          }
        }
      }
      continue
    }

    if (m.role === 'assistant' && m.kind === 'result') {
      const usage = p.usage ?? {}
      out.push({
        id: m.id,
        role: 'assistant',
        kind: 'result',
        tokens: Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0),
        cost: Number(p.costUsd ?? 0),
        duration: p.durationMs ? `${Math.max(1, Math.round(Number(p.durationMs) / 1000))}s` : '',
        time,
      })
    }
  }

  return out
}

export function adaptSession(s: ApiSession, messages: Message[], branch: string): Session {
  return {
    id: s.id,
    projectId: s.projectId,
    name: s.title,
    role: s.role,
    status: STATUS_MAP[s.status] ?? 'idle',
    branch: s.branch || branch,
    worktree: s.cwd,
    model: s.model ?? '默认',
    elapsed: Math.max(0, Math.round((s.updatedAt - s.createdAt) / 1000)),
    cost: s.costUsd,
    tokens: s.tokensIn + s.tokensOut,
    turns: s.turns,
    activity: s.lastActivity ?? (s.runtime?.turnActive ? '处理中…' : '空闲'),
    isManager: Boolean(s.isManager ?? s.title === '项目经理'),
    queuePos: s.runtime?.queued ? 1 : undefined,
    messages,
  }
}

export function adaptProject(
  p: ApiProject,
  sessions: Session[],
  tree: FileNode[],
  git: ApiGitStatus | null,
  commits: ApiCommit[],
  branches: ApiBranch[],
  index = 0,
): Project {
  const [c1, c2] = COLORS[index % COLORS.length]
  const current = branches.find((b) => b.current)
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    color: c1,
    color2: c2,
    branch: git?.branch ?? (p.mainBranch || '—'),
    ahead: current?.ahead ?? 0,
    behind: current?.behind ?? 0,
    dirty: (git?.files.length ?? 0) > 0,
    isGit: p.isGit !== 0,
    vcs: p.vcs ?? (p.isGit !== 0 ? 'git' : 'none'),
    sessions,
    tree,
    commits: commits.map((c) => ({
      sha: c.sha.slice(0, 7),
      msg: c.subject,
      meta: c.author,
      time: relativeTime(c.time),
      lane: c.parents.length > 1 ? 1 : 0,
      tone: c.refs.some((r) => r.startsWith('tag:')) ? 'violet' : 'accent',
      refs: Array.from(
        new Set(
          c.refs.map((r) => r.replace(/^HEAD -> /, '').replace(/^tag: /, '').replace(/^origin\//, '')),
        ),
      ),
      merge: c.parents.length > 1,
    })) satisfies Commit[],
    branches: branches.map((b) => ({
      name: b.name,
      ahead: b.ahead,
      behind: b.behind,
      tone: b.current ? 'accent' : 'violet',
      main: b.name === p.mainBranch,
      time: b.upstream ?? '本地分支',
      status: 'clean',
    })),
    changes: (git?.files ?? []).map((f) => ({
      path: f.path,
      status: mapFileLetter(f.status),
      add: f.add,
      del: f.del,
    })) satisfies Change[],
    runPort: 0,
    runStatus: 'stopped',
    stack: p.stack ?? '未知',
  }
}

export async function loadTree(projectId: string, maxNodes = 800, maxDepth = 8): Promise<FileNode[]> {
  let count = 0

  const walk = async (path: string, depth: number): Promise<FileNode[]> => {
    if (depth > maxDepth || count >= maxNodes) return []
    const { entries } = await api.tree(projectId, path)
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (count >= maxNodes) break
      count += 1
      if (e.type === 'dir') {
        let children = depth < maxDepth ? await walk(e.path, depth + 1) : []
        let name = e.name
        // 包路径压缩：src/main/java 下的单链包合并成 com.acme.demo 这种形式
        if (/\/java\/./.test(e.path)) {
          while (children.length === 1 && children[0].type === 'dir') {
            name = `${name}.${children[0].name}`
            children = children[0].children ?? []
          }
        }
        nodes.push({ name, type: 'dir', children })
      } else {
        nodes.push({ name: e.name, type: 'file', status: e.status ? mapFileLetter(e.status) : undefined })
      }
    }
    return nodes
  }

  return walk('', 0)
}
