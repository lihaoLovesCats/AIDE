import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { broadcast } from './events.js'
import { applyToolchainEnv } from './settings.js'
import { detectRunCommand } from './stacks.js'
import type { ProjectRecord, SessionRecord } from './types.js'

export const PORT_MIN = 18080
export const PORT_MAX = 18120
export const MEM_LIMIT = Math.max(1, Math.min(99, Number(process.env.AIDE_MEM_LIMIT ?? 90)))
export const PER_RUN_MB = Math.max(32, Number(process.env.AIDE_RUN_MEM_MB ?? 320))
const MAX_LOGS = 400

export class RunError extends Error {
  statusCode: number
  data: Record<string, unknown>

  constructor(message: string, statusCode = 400, data: Record<string, unknown> = {}) {
    super(message)
    this.statusCode = statusCode
    this.data = data
  }
}

export type RunStatus = 'starting' | 'ready' | 'running' | 'stopped' | 'error'

export interface RunInstance {
  id: string
  sessionId: string
  projectId: string
  title: string
  branch: string
  cwd: string
  command: string
  port: number
  pid: number | null
  status: RunStatus
  url: string
  startedAt: number
  readyAt: number | null
  error: string | null
  logs: string[]
  child?: ChildProcess
  timer?: NodeJS.Timeout
}

const runs = new Map<string, RunInstance>()

const mb = (n: number) => Math.round(n / 1024 / 1024)

export function systemInfo() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  return {
    totalMb: mb(total),
    freeMb: mb(free),
    usedMb: mb(used),
    usedPct: Math.round((used / total) * 100),
    limitPct: MEM_LIMIT,
    perRunMb: PER_RUN_MB,
    perRunPct: Math.max(1, Math.ceil((PER_RUN_MB / mb(total)) * 100)),
    cores: os.cpus().length,
    load: Number(os.loadavg()[0].toFixed(2)),
    ports: { min: PORT_MIN, max: PORT_MAX },
  }
}

type PublicRun = Omit<RunInstance, 'child' | 'timer'>

function publicRun(run: RunInstance): PublicRun & { logs: string[] } {
  const { child: _child, timer: _timer, ...rest } = run
  return { ...rest, logs: run.logs.slice(-120) }
}

export function listRuns(filter?: { projectId?: string }): (PublicRun & { logs: string[] })[] {
  return [...runs.values()]
    .filter((r) => (filter?.projectId ? r.projectId === filter.projectId : true))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(publicRun)
}

export function getRunLogs(runId: string, tail = 300): { id: string; logs: string[] } {
  const run = runs.get(runId)
  if (!run) throw new RunError('实例不存在', 404)
  return { id: runId, logs: run.logs.slice(-Math.max(1, Math.min(1000, tail))) }
}

function portUsed(port: number): boolean {
  return [...runs.values()].some(
    (r) => r.port === port && r.status !== 'stopped' && r.status !== 'error',
  )
}

function allocatePort(requested?: number): number {
  if (requested != null) {
    if (!Number.isInteger(requested) || requested < PORT_MIN || requested > PORT_MAX) {
      throw new RunError(`端口需在 ${PORT_MIN}–${PORT_MAX} 之间`, 400)
    }
    if (portUsed(requested)) throw new RunError(`端口 ${requested} 已被其他实例占用`, 409)
    return requested
  }
  for (let p = PORT_MIN; p <= PORT_MAX; p += 1) {
    if (!portUsed(p)) return p
  }
  throw new RunError(`端口池已满（${PORT_MIN}–${PORT_MAX}）`, 409)
}

function checkAdmission() {
  const info = systemInfo()
  const projected = info.usedPct + info.perRunPct
  if (projected > MEM_LIMIT) {
    throw new RunError(
      `内存不足：当前 ${info.usedPct}%，再启动一个实例预计 ${projected}%，超过 ${MEM_LIMIT}% 上限`,
      409,
      { stats: info },
    )
  }
}

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true }, (err) =>
        err ? reject(err) : resolve(),
      )
    })
    return true
  } catch {
    return false
  }
}

async function resolveRunCommand(project: ProjectRecord, cwd: string): Promise<string> {
  const command = detectRunCommand(cwd, project)
  if (!command) {
    throw new RunError(
      '未识别到启动命令：支持 Maven/Gradle、Python（FastAPI/Flask/Django）、Node（dev/start）、Go、Rust 与静态页面；也可在项目设置里填写 runCommand',
      400,
    )
  }
  return command
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(v)
    }
    socket.setTimeout(600)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function appendLog(run: RunInstance, line: string) {
  const text = line.replace(/\r$/, '')
  if (!text) return
  for (const l of text.split('\n')) {
    run.logs.push(l)
    if (run.logs.length > MAX_LOGS) run.logs.shift()
  }
  broadcast({
    type: 'run.log',
    sessionId: run.sessionId,
    projectId: run.projectId,
    payload: { runId: run.id, lines: text.split('\n').slice(-40) },
  })
}

function broadcastRun(run: RunInstance) {
  broadcast({
    type: 'run.status',
    sessionId: run.sessionId,
    projectId: run.projectId,
    payload: { run: publicRun(run) },
  })
}

function killTree(pid?: number | null): Promise<void> {
  if (!pid) return Promise.resolve()
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    })
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* ignore */
  }
  return Promise.resolve()
}

export async function startRun(
  project: ProjectRecord,
  session: SessionRecord,
  opts: { port?: number; command?: string } = {},
): Promise<PublicRun & { logs: string[] }> {
  const active = [...runs.values()].find(
    (r) => r.sessionId === session.id && (r.status === 'starting' || r.status === 'ready' || r.status === 'running'),
  )
  if (active) throw new RunError(`该会话已有实例运行在端口 ${active.port}`, 409)

  const command = opts.command?.trim() || (await resolveRunCommand(project, session.cwd))
  checkAdmission()
  const port = allocatePort(opts.port)

  const run: RunInstance = {
    id: randomUUID(),
    sessionId: session.id,
    projectId: project.id,
    title: session.title,
    branch: session.branch,
    cwd: session.cwd,
    command,
    port,
    pid: null,
    status: 'starting',
    url: `http://127.0.0.1:${port}`,
    startedAt: Date.now(),
    readyAt: null,
    error: null,
    logs: [],
  }
  runs.set(run.id, run)
  appendLog(run, `$ ${command}   (PORT=${port})`)
  broadcastRun(run)

  const isWin = process.platform === 'win32'
  const child = spawn(
    isWin ? 'cmd.exe' : 'sh',
    isWin ? ['/d', '/s', '/c', command] : ['-c', command],
    {
      cwd: session.cwd,
      env: {
        ...applyToolchainEnv(),
        PORT: String(port),
        SERVER_PORT: String(port),
        VITE_PORT: String(port),
        HOST: '127.0.0.1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  run.child = child
  run.pid = child.pid ?? null

  let stdoutBuf = ''
  let stderrBuf = ''
  const onData = (which: 'out' | 'err') => (buf: Buffer) => {
    const text = buf.toString('utf8')
    if (which === 'out') {
      stdoutBuf += text
      const parts = stdoutBuf.split('\n')
      stdoutBuf = parts.pop() ?? ''
      parts.forEach((p) => appendLog(run, p))
    } else {
      stderrBuf += text
      const parts = stderrBuf.split('\n')
      stderrBuf = parts.pop() ?? ''
      parts.forEach((p) => appendLog(run, p))
    }
  }
  child.stdout?.on('data', onData('out'))
  child.stderr?.on('data', onData('err'))

  child.on('error', (err) => {
    run.status = 'error'
    run.error = `无法启动：${err.message}`
    appendLog(run, run.error)
    broadcastRun(run)
  })

  child.on('exit', (code, signal) => {
    if (run.timer) clearInterval(run.timer)
    if (run.status === 'stopped') return
    run.status = code === 0 ? 'stopped' : 'error'
    run.pid = null
    if (code !== 0) run.error = `进程退出 code=${code ?? 'null'} signal=${signal ?? ''}`
    appendLog(run, `进程已退出（code=${code ?? 'null'}）`)
    broadcastRun(run)
  })

  const startedAt = Date.now()
  run.timer = setInterval(() => {
    void (async () => {
      if (!runs.has(run.id) || run.status === 'stopped' || run.status === 'error') {
        if (run.timer) clearInterval(run.timer)
        return
      }
      if (run.status === 'starting') {
        if (await portOpen(port)) {
          run.status = 'ready'
          run.readyAt = Date.now()
          appendLog(run, `✓ 端口 ${port} 已就绪：${run.url}`)
          broadcastRun(run)
        } else if (Date.now() - startedAt > 120000) {
          run.status = 'running'
          appendLog(run, '⚠ 端口 120s 内未监听，进程仍在运行（检查命令或日志）')
          broadcastRun(run)
        }
      }
    })()
  }, 1000)
  run.timer.unref?.()

  return publicRun(run)
}

export async function stopRun(runId: string): Promise<PublicRun & { logs: string[] }> {
  const run = runs.get(runId)
  if (!run) throw new RunError('实例不存在', 404)
  if (run.timer) clearInterval(run.timer)
  await killTree(run.pid)
  run.status = 'stopped'
  run.pid = null
  run.error = null
  appendLog(run, '已停止实例')
  broadcastRun(run)
  return publicRun(run)
}

export async function stopSessionRun(sessionId: string): Promise<PublicRun & { logs: string[] } | null> {
  const run = [...runs.values()].find(
    (r) => r.sessionId === sessionId && r.status !== 'stopped' && r.status !== 'error',
  )
  if (!run) return null
  return stopRun(run.id)
}

export async function stopAllRuns(): Promise<void> {
  await Promise.all(
    [...runs.values()].map(async (r) => {
      if (r.timer) clearInterval(r.timer)
      await killTree(r.pid)
      r.status = 'stopped'
      r.pid = null
    }),
  )
}
