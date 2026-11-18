export type SessionStatus = 'starting' | 'running' | 'idle' | 'error' | 'stopped'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  mainBranch: string
  testCommand: string | null
  runCommand: string | null
  isGit: number
  vcs: 'git' | 'svn' | 'none'
  createdAt: number
  lastOpenedAt: number | null
}

export interface SessionRecord {
  id: string
  projectId: string
  claudeSessionId: string
  title: string
  role: string
  model: string | null
  status: SessionStatus
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
}

export interface MessageRecord {
  id: string
  sessionId: string
  seq: number
  role: string
  kind: string
  payload: unknown
  createdAt: number
}

export interface GitFileStatus {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U'
  staged: boolean
}

export interface GitCommit {
  sha: string
  parents: string[]
  subject: string
  author: string
  time: number
  refs: string[]
}
