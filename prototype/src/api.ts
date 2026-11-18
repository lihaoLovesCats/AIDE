const ENV_API_BASE = (import.meta.env.VITE_AIDE_API as string | undefined)?.replace(/\/$/, '')

function sameOriginBase(): string | null {
  if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) return null
  // Vite 开发服务器（5180）需要单独指向 API；其他情况同源（支持自定义 AIDE_PORT）
  if (window.location.port === '5180') return null
  return window.location.origin
}

export const API_BASE = ENV_API_BASE ?? sameOriginBase() ?? 'http://127.0.0.1:7800'

export interface ApiProject {
  id: string
  name: string
  path: string
  mainBranch: string
  testCommand: string | null
  runCommand: string | null
  isGit?: number
  vcs?: 'git' | 'svn' | 'none'
  createdAt: number
  lastOpenedAt: number | null
  stack?: string
  sessionCount?: number
}

export interface ApiAppSettings {
  javaHome: string | null
  mavenHome: string | null
  pythonPath: string | null
  nodePath: string | null
  usageDisplay: 'both' | 'cost' | 'tokens'
}

export interface ApiToolchain {
  javaHome: string | null
  mavenHome: string | null
  pythonPath: string | null
  nodePath: string | null
  javaVersion: string | null
  mavenVersion: string | null
  pythonVersion: string | null
  nodeVersion: string | null
}

export interface ApiUser {
  name: string
  email: string | null
  host: string
}

export interface ApiToolCandidate {
  path: string
  version: string | null
  source: string
}

export interface ApiDirEntry {
  name: string
  path: string
}

export interface ApiBrowse {
  path: string
  parent: string | null
  entries: ApiDirEntry[]
  roots: ApiDirEntry[]
  home: string
}

export interface ApiSettingsBundle {
  settings: ApiAppSettings
  toolchain: ApiToolchain
  user: ApiUser
}

export interface ApiInstallerState {
  running: boolean
  stage: 'idle' | 'starting' | 'running' | 'done' | 'error'
  startedAt: number | null
  finishedAt: number | null
  log: string[]
  error: string | null
  result: { javaHome: string | null; mavenHome: string | null } | null
  pid: number | null
}

export interface ApiRuntime {
  alive: boolean
  turnActive: boolean
  queued: number
}

export interface ApiSession {
  id: string
  projectId: string
  claudeSessionId: string
  title: string
  role: string
  model: string | null
  status: 'starting' | 'running' | 'idle' | 'error' | 'stopped'
  cwd: string
  branch: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  turns: number
  lastActivity: string | null
  lastError: string | null
  started: number
  createdAt: number
  updatedAt: number
  isManager?: boolean
  runtime: ApiRuntime
}

export interface ApiMessage {
  id: string
  sessionId: string
  seq: number
  role: 'user' | 'assistant' | 'system'
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'block' | 'dispatch' | 'peer'
  payload: any
  createdAt: number
}

export interface ApiTreeEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  status: 'M' | 'A' | 'D' | 'R' | 'U' | null
}

export interface ApiGitFile {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U'
  staged: boolean
  add: number
  del: number
}

export interface ApiGitStatus {
  branch: string
  files: ApiGitFile[]
  clean: boolean
  vcs?: 'git' | 'svn' | 'none'
}

export interface KnowledgeSource {
  path: string
  kind: 'claude' | 'agent' | 'rules'
  size: number
}

export interface KnowledgeDoc {
  name: string
  path: string
  size: number
  updatedAt: number | null
  preview: string
}

export interface KnowledgeJob {
  running: boolean
  stage: 'idle' | 'running' | 'done' | 'error'
  startedAt: number | null
  finishedAt: number | null
  log: string[]
  error: string | null
}

export interface ApiKnowledge {
  dir: string
  sources: KnowledgeSource[]
  docs: KnowledgeDoc[]
  generatedAt: number | null
  job: KnowledgeJob | null
}

export interface ApiCommit {
  sha: string
  parents: string[]
  subject: string
  author: string
  time: number
  refs: string[]
}

export interface ApiBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  sha: string
}

export interface ApiSessionGitStatus {
  branch: string
  files: ApiGitFile[]
  clean: boolean
}

export interface ApiTestResult {
  status: 'passed' | 'failed' | 'skipped'
  label: string
  output: string
  durationMs: number
  reason?: string
}

export interface ApiCommitResult {
  sha: string
  shortSha: string
  message: string
  branch: string
  test: ApiTestResult
  pushed: boolean
  remote: string | null
  pushError?: string
}

export interface ApiRun {
  id: string
  sessionId: string
  projectId: string
  title: string
  branch: string
  cwd: string
  command: string
  port: number
  pid: number | null
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error'
  url: string
  startedAt: number
  readyAt: number | null
  error: string | null
  logs: string[]
}

export interface ApiSystem {
  totalMb: number
  freeMb: number
  usedMb: number
  usedPct: number
  limitPct: number
  perRunMb: number
  perRunPct: number
  cores: number
  load: number
  ports: { min: number; max: number }
  runs: number
  active: number
  portsUsed: number[]
}

export interface ServerEvent {
  type:
    | 'hello'
    | 'session.status'
    | 'session.message'
    | 'session.result'
    | 'session.updated'
    | 'dispatch.status'
    | 'project.deleted'
    | 'git.progress'
    | 'git.done'
    | 'run.status'
    | 'run.log'
  sessionId?: string
  projectId?: string
  payload?: any
  at: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  Object.assign(headers, (init?.headers ?? {}) as Record<string, string>)
  const res = await fetch(API_BASE + path, { ...init, headers })
  const text = await res.text()
  let data: any = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data?.error ? data.error : `${res.status} ${res.statusText}`
    const err = new Error(message) as Error & { data?: any; status?: number }
    err.data = data
    err.status = res.status
    throw err
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const api = {
  health: () =>
    request<{
      ok: boolean
      version: string
      claude: { bin: string; version: string | null; available: boolean }
      db: string
    }>('/api/health'),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  projects: () => request<ApiProject[]>('/api/projects'),
  project: (id: string) => request<ApiProject>(`/api/projects/${id}`),
  registerProject: (body: { name?: string; path: string }) =>
    request<ApiProject>('/api/projects', json(body)),

  tree: (id: string, path = '') =>
    request<{ path: string; entries: ApiTreeEntry[] }>(`/api/projects/${id}/tree?path=${encodeURIComponent(path)}`),
  file: (id: string, path: string) =>
    request<{ path: string; content: string; size: number; mtime: number }>(
      `/api/projects/${id}/file?path=${encodeURIComponent(path)}`,
    ),

  gitStatus: (id: string) => request<ApiGitStatus>(`/api/projects/${id}/git/status`),
  knowledge: (id: string) => request<ApiKnowledge>(`/api/projects/${id}/knowledge`),
  generateKnowledge: (id: string) =>
    request<KnowledgeJob>(`/api/projects/${id}/knowledge/generate`, { method: 'POST' }),
  knowledgeStatus: (id: string) => request<{ job: KnowledgeJob | null }>(`/api/projects/${id}/knowledge/status`),
  cancelKnowledge: (id: string) =>
    request<{ job: KnowledgeJob | null }>(`/api/projects/${id}/knowledge/cancel`, { method: 'POST' }),
  addNote: (id: string, body: { title: string; content: string; sessionId?: string }) =>
    request<{ ok: boolean; path: string }>(`/api/projects/${id}/notes`, json(body)),
  gitLog: (id: string, limit = 30) => request<{ commits: ApiCommit[] }>(`/api/projects/${id}/git/log?limit=${limit}`),
  gitBranches: (id: string) => request<{ branches: ApiBranch[] }>(`/api/projects/${id}/git/branches`),
  gitDiff: (id: string, path: string) =>
    request<{ path: string; diff: string }>(`/api/projects/${id}/git/diff?path=${encodeURIComponent(path)}`),
  mergeBranch: (id: string, branch: string) =>
    request<{ sha: string; message: string }>(`/api/projects/${id}/git/merge`, json({ branch })),
  setTestCommand: (id: string, testCommand: string | null) =>
    request<ApiProject>(`/api/projects/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ testCommand }),
    }),
  updateSettings: (id: string, body: { testCommand?: string | null; runCommand?: string | null }) =>
    request<ApiProject>(`/api/projects/${id}/settings`, { method: 'PATCH', body: JSON.stringify(body) }),
  pruneProject: (id: string) =>
    request<{ worktrees: string[]; branches: string[] }>(`/api/projects/${id}/git/prune`, {
      method: 'POST',
    }),

  appSettings: () => request<ApiSettingsBundle>('/api/settings'),
  saveAppSettings: (body: {
    javaHome?: string | null
    mavenHome?: string | null
    pythonPath?: string | null
    nodePath?: string | null
    usageDisplay?: string
  }) => request<ApiSettingsBundle>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  detectToolchain: () =>
    request<{
      java: ApiToolCandidate[]
      maven: ApiToolCandidate[]
      python: ApiToolCandidate[]
      node: ApiToolCandidate[]
    }>('/api/settings/detect', {
      method: 'POST',
      body: '{}',
    }),
  fsList: (path?: string) =>
    request<ApiBrowse>(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  installerStatus: () => request<ApiInstallerState>('/api/settings/install/status'),
  startInstaller: () => request<ApiInstallerState>('/api/settings/install', { method: 'POST', body: '{}' }),
  cancelInstaller: () =>
    request<ApiInstallerState>('/api/settings/install/cancel', { method: 'POST', body: '{}' }),

  sessionGitStatus: (sid: string) => request<ApiSessionGitStatus>(`/api/sessions/${sid}/git/status`),
  commitSession: (sid: string, body: { message?: string; force?: boolean; skipTests?: boolean }) =>
    request<ApiCommitResult>(`/api/sessions/${sid}/git/commit`, json(body)),

  system: () => request<ApiSystem>('/api/system'),
  projectRuns: (projectId: string) => request<{ runs: ApiRun[] }>(`/api/projects/${projectId}/runs`),
  startRun: (sid: string, body: { port?: number; command?: string }) =>
    request<ApiRun>(`/api/sessions/${sid}/run`, json(body)),
  stopRun: (sid: string) => request<ApiRun>(`/api/sessions/${sid}/run/stop`, { method: 'POST' }),
  runLog: (rid: string, tail = 300) => request<{ id: string; logs: string[] }>(`/api/runs/${rid}/log?tail=${tail}`),
  revokeDispatch: (id: string) =>
    request<{ ok: boolean; status: string }>(`/api/dispatches/${id}/revoke`, { method: 'POST' }),

  sessions: (projectId: string) => request<{ sessions: ApiSession[] }>(`/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, body: { title?: string; role?: string; model?: string }) =>
    request<ApiSession>(`/api/projects/${projectId}/sessions`, json(body)),
  session: (sid: string) => request<ApiSession>(`/api/sessions/${sid}`),
  messages: (sid: string, limit = 500) =>
    request<{ messages: ApiMessage[] }>(`/api/sessions/${sid}/messages?limit=${limit}`),
  send: (sid: string, text: string) =>
    request<{ queued: boolean }>(`/api/sessions/${sid}/messages`, json({ text })),
  stop: (sid: string) => request<{ ok: boolean }>(`/api/sessions/${sid}/stop`, { method: 'POST' }),
  remove: (sid: string) => request<{ ok: boolean }>(`/api/sessions/${sid}`, { method: 'DELETE' }),
}

export function subscribeEvents(
  onEvent: (ev: ServerEvent) => void,
  onState?: (state: 'open' | 'error') => void,
): () => void {
  const es = new EventSource(`${API_BASE}/api/events`)
  es.onopen = () => onState?.('open')
  es.onerror = () => onState?.('error')
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as ServerEvent)
    } catch {
      /* ignore malformed */
    }
  }
  return () => es.close()
}
