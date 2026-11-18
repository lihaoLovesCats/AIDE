import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { DB_PATH } from './config.js'
import type { MessageRecord, ProjectRecord, SessionRecord, SessionStatus } from './types.js'

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    main_branch TEXT NOT NULL,
    test_command TEXT,
    run_command TEXT,
    is_git INTEGER NOT NULL DEFAULT 1,
    vcs TEXT NOT NULL DEFAULT 'none',
    created_at INTEGER NOT NULL,
    last_opened_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    claude_session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    model TEXT,
    status TEXT NOT NULL,
    cwd TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT '',
    cost_usd REAL NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    turns INTEGER NOT NULL DEFAULT 0,
    last_activity TEXT,
    last_error TEXT,
    started INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, created_at);

  CREATE TABLE IF NOT EXISTS audit (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    session_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    message_id TEXT,
    from_session_id TEXT NOT NULL,
    to_session_id TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_dispatches_target ON dispatches(to_session_id, status);
`)

// 兼容旧数据：没有 dispatchId 的历史派发卡片不再永久显示“执行中”
try {
  const legacy = db
    .prepare("SELECT id, payload FROM messages WHERE kind = 'dispatch'")
    .all() as Array<{ id: string; payload: string }>
  for (const r of legacy) {
    try {
      const payload = JSON.parse(r.payload)
      if (!payload.dispatchId && (!payload.status || payload.status === 'working')) {
        payload.status = 'done'
        db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(payload), r.id)
      }
    } catch {
      /* ignore */
    }
  }
} catch {
  /* ignore */
}

type Row = Record<string, unknown>
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v ?? d))
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v))

function mapProject(r: Row): ProjectRecord {
  return {
    id: str(r.id),
    name: str(r.name),
    path: str(r.path),
    mainBranch: str(r.main_branch, 'main'),
    testCommand: r.test_command == null ? null : str(r.test_command),
    runCommand: r.run_command == null ? null : str(r.run_command),
    isGit: r.is_git == null ? 1 : num(r.is_git),
    vcs: (str(r.vcs, 'none') as ProjectRecord['vcs']) || 'none',
    createdAt: num(r.created_at),
    lastOpenedAt: r.last_opened_at == null ? null : num(r.last_opened_at),
  }
}

function mapSession(r: Row): SessionRecord {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    claudeSessionId: str(r.claude_session_id),
    title: str(r.title),
    role: str(r.role),
    model: r.model == null ? null : str(r.model),
    status: str(r.status, 'idle') as SessionStatus,
    cwd: str(r.cwd),
    branch: str(r.branch),
    costUsd: num(r.cost_usd),
    tokensIn: num(r.tokens_in),
    tokensOut: num(r.tokens_out),
    turns: num(r.turns),
    lastActivity: r.last_activity == null ? null : str(r.last_activity),
    lastError: r.last_error == null ? null : str(r.last_error),
    started: num(r.started),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  }
}

// 兼容已有数据库：补 branch 列并回填
{
  const cols = db.prepare('PRAGMA table_info(sessions)').all() as Row[]
  if (!cols.some((c) => c.name === 'branch')) {
    db.exec("ALTER TABLE sessions ADD COLUMN branch TEXT NOT NULL DEFAULT ''")
  }
  db.exec(
    `UPDATE sessions
        SET branch = COALESCE((SELECT p.main_branch FROM projects p WHERE p.id = sessions.project_id), 'main')
      WHERE branch = ''`,
  )
  const pcols = db.prepare('PRAGMA table_info(projects)').all() as Row[]
  if (!pcols.some((c) => c.name === 'test_command')) {
    db.exec('ALTER TABLE projects ADD COLUMN test_command TEXT')
  }
  if (!pcols.some((c) => c.name === 'run_command')) {
    db.exec('ALTER TABLE projects ADD COLUMN run_command TEXT')
  }
  if (!pcols.some((c) => c.name === 'is_git')) {
    db.exec('ALTER TABLE projects ADD COLUMN is_git INTEGER NOT NULL DEFAULT 1')
  }
  if (!pcols.some((c) => c.name === 'vcs')) {
    db.exec("ALTER TABLE projects ADD COLUMN vcs TEXT NOT NULL DEFAULT 'none'")
  }
  db.exec(
    "UPDATE projects SET vcs = CASE WHEN is_git = 1 THEN 'git' ELSE 'none' END WHERE vcs = 'none' OR vcs = ''",
  )
}

/* ----------------------------- projects ----------------------------- */

export function insertProject(p: ProjectRecord): ProjectRecord {
  db.prepare(
    `INSERT INTO projects (id, name, path, main_branch, test_command, run_command, is_git, vcs, created_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.name,
    p.path,
    p.mainBranch,
    p.testCommand,
    p.runCommand,
    p.isGit,
    p.vcs,
    p.createdAt,
    p.lastOpenedAt,
  )
  return p
}

export function getProject(id: string): ProjectRecord | null {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  return r ? mapProject(r) : null
}

export function findProjectByPath(path: string): ProjectRecord | null {
  const r = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Row | undefined
  return r ? mapProject(r) : null
}

export function listProjects(): ProjectRecord[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as Row[]
  return rows.map(mapProject)
}

export function touchProject(id: string): void {
  db.prepare('UPDATE projects SET last_opened_at = ? WHERE id = ?').run(Date.now(), id)
}

export function setProjectTestCommand(id: string, testCommand: string | null): void {
  db.prepare('UPDATE projects SET test_command = ? WHERE id = ?').run(testCommand, id)
}

export function setProjectRunCommand(id: string, runCommand: string | null): void {
  db.prepare('UPDATE projects SET run_command = ? WHERE id = ?').run(runCommand, id)
}

/* ------------------------------- audit ------------------------------- */

export function addAudit(kind: string, detail: unknown, projectId?: string, sessionId?: string): void {
  db.prepare('INSERT INTO audit (id, project_id, session_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    projectId ?? null,
    sessionId ?? null,
    kind,
    JSON.stringify(detail ?? null),
    Date.now(),
  )
}

/* ------------------------------ settings ------------------------------ */

export function getSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Row[]
  const out: Record<string, string> = {}
  for (const r of rows) out[str(r.key)] = str(r.value)
  return out
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now())
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/* ----------------------------- dispatches ----------------------------- */

export interface DispatchRecord {
  id: string
  projectId: string
  messageId: string | null
  fromSessionId: string
  toSessionId: string
  task: string
  status: 'working' | 'done' | 'failed' | 'revoked'
  createdAt: number
  updatedAt: number
}

function mapDispatch(r: Row): DispatchRecord {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    messageId: r.message_id == null ? null : str(r.message_id),
    fromSessionId: str(r.from_session_id),
    toSessionId: str(r.to_session_id),
    task: str(r.task),
    status: str(r.status, 'working') as DispatchRecord['status'],
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  }
}

export function insertDispatch(d: DispatchRecord): void {
  db.prepare(
    `INSERT INTO dispatches (id, project_id, message_id, from_session_id, to_session_id, task, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    d.id,
    d.projectId,
    d.messageId,
    d.fromSessionId,
    d.toSessionId,
    d.task,
    d.status,
    d.createdAt,
    d.updatedAt,
  )
}

export function getDispatch(id: string): DispatchRecord | null {
  const r = db.prepare('SELECT * FROM dispatches WHERE id = ?').get(id) as Row | undefined
  return r ? mapDispatch(r) : null
}

export function setDispatchStatus(id: string, status: DispatchRecord['status']): void {
  db.prepare('UPDATE dispatches SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
}

export function revokeDispatchRecord(id: string): DispatchRecord | null {
  const d = getDispatch(id)
  if (!d) return null
  // 只有执行中的派发可以撤销；已完成/失败的结果不应被改写
  if (d.status !== 'working') return d
  setDispatchStatus(id, 'revoked')
  if (d.messageId) {
    const msg = db.prepare('SELECT payload FROM messages WHERE id = ?').get(d.messageId) as Row | undefined
    if (msg) {
      try {
        const payload = JSON.parse(str(msg.payload))
        payload.status = 'revoked'
        db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(payload), d.messageId)
      } catch {
        /* ignore */
      }
    }
  }
  return getDispatch(id)
}

/** 目标会话完成一轮后，把最早一条 working 派发标记为完成/失败 */
export function completeDispatch(
  toSessionId: string,
  ok: boolean,
): { dispatch: DispatchRecord; messageId: string | null } | null {
  const row = db
    .prepare(
      "SELECT * FROM dispatches WHERE to_session_id = ? AND status = 'working' ORDER BY created_at ASC LIMIT 1",
    )
    .get(toSessionId) as Row | undefined
  if (!row) return null
  const dispatch = mapDispatch(row)
  const status: DispatchRecord['status'] = ok ? 'done' : 'failed'
  setDispatchStatus(dispatch.id, status)
  dispatch.status = status
  if (dispatch.messageId) {
    const msg = db.prepare('SELECT payload FROM messages WHERE id = ?').get(dispatch.messageId) as Row | undefined
    if (msg) {
      try {
        const payload = JSON.parse(str(msg.payload))
        payload.status = status
        db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(payload), dispatch.messageId)
      } catch {
        /* ignore */
      }
    }
  }
  return { dispatch, messageId: dispatch.messageId }
}

/* ----------------------------- sessions ----------------------------- */

export function insertSession(s: SessionRecord): SessionRecord {
  db.prepare(
    `INSERT INTO sessions
      (id, project_id, claude_session_id, title, role, model, status, cwd, branch,
       cost_usd, tokens_in, tokens_out, turns, last_activity, last_error, started, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.projectId,
    s.claudeSessionId,
    s.title,
    s.role,
    s.model,
    s.status,
    s.cwd,
    s.branch,
    s.costUsd,
    s.tokensIn,
    s.tokensOut,
    s.turns,
    s.lastActivity,
    s.lastError,
    s.started,
    s.createdAt,
    s.updatedAt,
  )
  return s
}

export function getSession(id: string): SessionRecord | null {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined
  return r ? mapSession(r) : null
}

export function listSessions(projectId: string): SessionRecord[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as Row[]
  return rows.map(mapSession)
}

const SESSION_COLUMNS = new Set([
  'title',
  'role',
  'model',
  'status',
  'cwd',
  'branch',
  'cost_usd',
  'tokens_in',
  'tokens_out',
  'turns',
  'last_activity',
  'last_error',
  'started',
  'updated_at',
])

export function updateSession(id: string, patch: Record<string, unknown>): void {
  const sets: string[] = []
  const values: unknown[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (!SESSION_COLUMNS.has(k)) continue
    sets.push(`${k} = ?`)
    values.push(v)
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)
  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...(values as never[]))
}

export function deleteSessionRow(id: string): void {
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/** 删除项目及其会话/消息/派发记录（不删除磁盘文件与分支） */
export function deleteProjectRow(id: string): void {
  const sessions = db.prepare('SELECT id FROM sessions WHERE project_id = ?').all(id) as Row[]
  const delMessages = db.prepare('DELETE FROM messages WHERE session_id = ?')
  db.exec('BEGIN')
  try {
    for (const s of sessions) delMessages.run(str(s.id))
    db.prepare('DELETE FROM dispatches WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM audit WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/* ----------------------------- messages ----------------------------- */

export function appendMessage(
  sessionId: string,
  role: string,
  kind: string,
  payload: unknown,
): MessageRecord {
  const max = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages WHERE session_id = ?').get(sessionId) as Row
  const seq = num(max?.m) + 1
  const rec: MessageRecord = {
    id: randomUUID(),
    sessionId,
    seq,
    role,
    kind,
    payload,
    createdAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO messages (id, session_id, seq, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(rec.id, rec.sessionId, rec.seq, rec.role, rec.kind, JSON.stringify(payload ?? null), rec.createdAt)
  return rec
}

export function listMessages(sessionId: string, limit = 500): MessageRecord[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
    .all(sessionId, limit) as Row[]
  return rows.reverse().map((r) => ({
    id: str(r.id),
    sessionId: str(r.session_id),
    seq: num(r.seq),
    role: str(r.role),
    kind: str(r.kind),
    payload: safeParse(str(r.payload)),
    createdAt: num(r.created_at),
  }))
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** 服务启动时把上一轮遗留的"运行中/启动中"状态复位（进程已随上次退出而消失） */
export function resetOrphanSessions(): number {
  const r = db
    .prepare("UPDATE sessions SET status = 'idle', last_activity = '服务重启，等待恢复' WHERE status IN ('running','starting','thinking')")
    .run()
  return Number(r.changes ?? 0)
}
