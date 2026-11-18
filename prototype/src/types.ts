export type Status =
  | 'starting'
  | 'running'
  | 'thinking'
  | 'idle'
  | 'queued'
  | 'error'
  | 'stopped'
  | 'waiting_user'
  | 'waiting_permission'

export type Tone = 'accent' | 'ok' | 'warn' | 'err' | 'violet' | 'run' | 'dim' | 'pink'

export interface ToolCall {
  name: string
  input: string
  status: 'ok' | 'fail' | 'running'
  duration?: string
  output?: string
}

export interface DiffFile {
  path: string
  add: number
  del: number
  status: 'M' | 'A' | 'D'
}

export interface DispatchRef {
  toSessionId: string
  toName: string
  task: string
  reason: string
  confidence: number
  status: 'sent' | 'working' | 'done' | 'revoked' | 'failed'
}

export type Message =
  | { id: string; role: 'user'; kind: 'text'; text: string; time: string }
  | { id: string; role: 'assistant'; kind: 'text'; text: string; time: string; streaming?: boolean }
  | { id: string; role: 'assistant'; kind: 'thinking'; text: string; seconds: number; time: string }
  | { id: string; role: 'assistant'; kind: 'tool'; tool: ToolCall; time: string }
  | { id: string; role: 'assistant'; kind: 'dispatch'; entries: DispatchRef[]; time: string }
  | { id: string; role: 'assistant'; kind: 'peer'; toTitle: string; text: string; time: string }
  | { id: string; role: 'assistant'; kind: 'diff'; files: DiffFile[]; note: string; time: string }
  | { id: string; role: 'assistant'; kind: 'result'; tokens: number; cost: number; duration: string; time: string }
  | { id: string; role: 'system'; kind: 'error'; text: string; time: string }
  | { id: string; role: 'system'; kind: 'notice'; text: string; time: string }

export interface Session {
  id: string
  projectId: string
  name: string
  role: string
  status: Status
  branch: string
  worktree: string
  model: string
  elapsed: number
  cost: number
  tokens: number
  turns: number
  activity: string
  unread?: number
  isManager?: boolean
  queuePos?: number
  port?: number
  runStatus?: 'running' | 'stopped'
  messages: Message[]
}

export interface FileNode {
  name: string
  type: 'dir' | 'file'
  children?: FileNode[]
  status?: 'M' | 'A' | 'D' | 'U'
  size?: string
}

export interface Commit {
  sha: string
  msg: string
  meta: string
  time: string
  lane: number
  tone: Tone
  refs?: string[]
  merge?: boolean
}

export interface Branch {
  name: string
  sessionId?: string
  ahead: number
  behind?: number
  tone: Tone
  main?: boolean
  lastCommit?: string
  time?: string
  status?: 'clean' | 'changes' | 'conflict'
}

export interface Change {
  path: string
  status: 'M' | 'A' | 'D' | 'U'
  add: number
  del: number
}

export interface Project {
  id: string
  name: string
  path: string
  color: string
  color2: string
  branch: string
  ahead: number
  behind: number
  dirty: boolean
  isGit: boolean
  vcs: 'git' | 'svn' | 'none'
  sessions: Session[]
  tree: FileNode[]
  commits: Commit[]
  branches: Branch[]
  changes: Change[]
  runPort: number
  runStatus: 'running' | 'stopped'
  stack: string
}
