import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { CLAUDE_TIMEOUT_MS, DATA_DIR, HOST, PORT, SERVER_ROOT } from './config.js'
import { resolveClaudeBinary } from './claude.js'
import { broadcast } from './events.js'
import * as store from './db.js'
import { applyToolchainEnv, toolchainHint } from './settings.js'
import { knowledgePrompt } from './knowledge.js'
import { stackPrompt } from './stacks.js'
import { addSessionWorktree, removeSessionWorktree } from './worktree.js'
import type { ProjectRecord, SessionRecord, SessionStatus } from './types.js'

interface Runtime {
  sessionId: string
  projectId: string
  child: ChildProcessWithoutNullStreams
  turnActive: boolean
  stopping: boolean
  queue: string[]
  stderr: string
  timer: NodeJS.Timeout | null
}

const runtimes = new Map<string, Runtime>()

/* ------------------------------ helpers ------------------------------ */

function setStatus(sessionId: string, projectId: string, status: SessionStatus, activity?: string): void {
  store.updateSession(sessionId, {
    status,
    ...(activity !== undefined ? { last_activity: activity } : {}),
  })
  broadcast({
    type: 'session.status',
    sessionId,
    projectId,
    payload: { status, activity: activity ?? null },
  })
}

export function isRunning(sessionId: string): boolean {
  const rt = runtimes.get(sessionId)
  return Boolean(rt && rt.child.exitCode === null)
}

export function runtimeInfo(sessionId: string): { alive: boolean; turnActive: boolean; queued: number } {
  const rt = runtimes.get(sessionId)
  if (!rt || rt.child.exitCode !== null) return { alive: false, turnActive: false, queued: 0 }
  return { alive: true, turnActive: rt.turnActive, queued: rt.queue.length }
}

function clearTimer(rt: Runtime): void {
  if (rt.timer) {
    clearTimeout(rt.timer)
    rt.timer = null
  }
}

function armTimer(rt: Runtime): void {
  clearTimer(rt)
  rt.timer = setTimeout(() => {
    store.updateSession(rt.sessionId, {
      status: 'error',
      last_error: '回合超时，已终止 claude 进程',
      last_activity: '回合超时',
    })
    broadcast({
      type: 'session.status',
      sessionId: rt.sessionId,
      projectId: rt.projectId,
      payload: { status: 'error', error: '回合超时' },
    })
    rt.stopping = true
    void killTree(rt.child.pid)
  }, CLAUDE_TIMEOUT_MS)
  rt.timer.unref?.()
}

function isManager(session: SessionRecord): boolean {
  return session.title === '项目经理'
}

/** 为经理会话写 MCP 配置（每次 spawn 覆盖，绑定项目与会话 id） */
function writeMcpConfig(session: SessionRecord): string {
  const dir = join(DATA_DIR, 'mcp')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${session.id}.json`)
  const config = {
    mcpServers: {
      aide: {
        command: process.execPath,
        args: [join(SERVER_ROOT, 'mcp', 'aide-mcp.mjs')],
        env: {
          AIDE_API: `http://${HOST}:${PORT}`,
          AIDE_PROJECT: session.projectId,
          AIDE_SESSION: session.id,
        },
      },
    },
  }
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  return file
}

function writeAgentMcpConfig(session: SessionRecord): string {
  const dir = join(DATA_DIR, 'mcp')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `agent-${session.id}.json`)
  const config = {
    mcpServers: {
      aide: {
        command: process.execPath,
        args: [join(SERVER_ROOT, 'mcp', 'aide-agent-mcp.mjs')],
        env: {
          AIDE_API: `http://${HOST}:${PORT}`,
          AIDE_PROJECT: session.projectId,
          AIDE_SESSION: session.id,
        },
      },
    },
  }
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
  return file
}

function systemPrompt(session: SessionRecord): string {
  const project = store.getProject(session.projectId)
  const vcsLine =
    project?.vcs === 'git'
      ? '并行：你可以在自己的 worktree 独立推进；与其他模块并行开发时，先通过消息对齐接口/数据结构，避免冲突。涉及其他模块的改动，先与对方负责人确认，不要单方面大改。'
      : project?.vcs === 'svn'
        ? '并行：SVN 项目所有 Agent 共享同一个工作副本，你的修改会立即影响其他 Agent；并行开发前先对齐接口与文件范围，避免同时改同一文件。涉及其他模块的改动，先与对方负责人确认。'
        : '并行：项目不是 Git/SVN 仓库，所有 Agent 共享项目目录；并行开发前先对齐文件范围，避免互相覆盖。涉及其他模块的改动，先与对方负责人确认。'
  const lines = [
    `你是 AIDE 的「${session.title}」Agent，角色：${session.role || '通用工程师'}。`,
    `会话工作目录是 ${session.cwd}，可以直接读写文件、运行命令。`,
    '完成任务后用简短中文汇报：改了什么、验证结果、下一步建议。',
    '除非遇到不可逆的破坏性操作（删库、强推、批量删除），否则不要停下来询问确认。',
    '',
    toolchainHint(),
    '',
    stackPrompt(session.cwd),
    '',
    knowledgePrompt(store.getProject(session.projectId)?.path ?? session.cwd),
  ]
  if (isManager(session)) {
    lines.push(
      '',
      '你是本项目的**经理（模块调度者）**，只做统筹与汇报，不参与任何开发细节。',
      '',
      '职责：',
      '1. 理解用户需求，判断涉及哪些功能模块；',
      '2. 用 aide_list_sessions 查看现有模块负责人；没有对应负责人时用 aide_create_session 新建（标题=模块名，role=模块负责人）；',
      '3. 用 aide_dispatch 把该模块的任务整体派给负责人；',
      '4. 向用户汇报：谁负责、为什么、当前状态。',
      '',
      '硬性规则：',
      '- 你不写代码、不改文件、不运行命令、不提交；编辑/命令类工具已被禁用，必须交给模块负责人。',
      '- 一个模块只有一个负责人，由它负责该模块的前后端全部改动；禁止把同一模块拆给多个 Agent。',
      '- 任务跨多个模块时，按模块拆分，每个模块派给各自的负责人。',
      '- 已有模块负责人优先复用；模块范围变化时用 aide_rename_session 更新标题。',
      '- 不要亲自完成用户的开发请求；用户要求你改代码时，说明会转交对应模块 Agent。',
      '',
      '协作与并行：',
      '- 模块之间可以并行：互不依赖（或接口已对齐）时，可以同时派发多个模块以缩短时间；同一模块仍只归一个负责人。',
      '- 有依赖时，先让双方用 aide_message_agent 对齐接口/数据结构，再并行；也可以串行推进。',
      '- 跨模块配合或需要别的模块信息时，让 Agent 直接互相通信（它们有 aide_list_agents / aide_message_agent / aide_read_agent），你也可以用这些工具转达或读取对方结论。',
      '- 不要把“并行”本身当目标；只有在模块边界清晰、条件允许时才并行。',
      '',
      '可用工具：aide_list_sessions / aide_create_session / aide_dispatch / aide_rename_session / aide_message_agent / aide_read_agent / aide_git_status / aide_commit_push / aide_run_app / aide_stop_app / aide_note。',
    )
  } else {
    lines.push(
      '',
      '你是**模块负责人**：开始任务时用 aide_set_title 把会话标题改为你负责的模块名（例如「订单模块」；跨模块可用「订单 + 支付」），便于用户和经理识别。',
      '一个模块的前后端改动都由你负责，不要把自己模块的任务再转交他人。',
      '',
      '协作：项目里每个模块都有负责人。需要其他模块的信息或配合时，先用 aide_list_agents 找到对应负责人，再用 aide_message_agent 直接沟通；收到协作消息时正常处理并回复。也可以用 aide_read_agent 读取对方最近的结论。',
      '学习：把稳定的项目知识/踩坑点用 aide_note 追加到 .aide/KNOWLEDGE.md，后续 Agent 会自动读到。',
      vcsLine,
    )
  }
  return lines.join('\n')
}

/* ------------------------------ process ------------------------------ */

function spawnRuntime(session: SessionRecord, mode: 'new' | 'resume'): Runtime {
  const bin = resolveClaudeBinary()
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--add-dir',
    session.cwd,
  ]
  if (session.model) args.push('--model', session.model)
  args.push('--mcp-config', isManager(session) ? writeMcpConfig(session) : writeAgentMcpConfig(session))
  if (mode === 'resume') args.push('--resume', session.claudeSessionId)
  else args.push('--session-id', session.claudeSessionId)
  args.push('--append-system-prompt', systemPrompt(session))
  if (isManager(session)) {
    // 经理只做调度与汇报：只保留只读检索类内置工具，禁用编辑/命令/子代理
    args.push('--tools', 'Read,Glob,Grep')
  }

  const child = spawn(bin, args, {
    cwd: session.cwd,
    env: { ...applyToolchainEnv(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const rt: Runtime = {
    sessionId: session.id,
    projectId: session.projectId,
    child,
    turnActive: false,
    stopping: false,
    queue: [],
    stderr: '',
    timer: null,
  }
  runtimes.set(session.id, rt)
  setStatus(session.id, session.projectId, 'starting', '正在启动 claude 进程…')
  setTimeout(() => {
    const cur = store.getSession(session.id)
    if (cur?.status === 'starting') setStatus(session.id, session.projectId, 'idle', '等待指令')
  }, 2500).unref?.()

  const rl = createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let ev: any
    try {
      ev = JSON.parse(trimmed)
    } catch {
      return
    }
    try {
      handleEvent(rt, ev)
    } catch (err) {
      console.error('[claude] event handler error', err)
    }
  })

  child.stderr.on('data', (buf: Buffer) => {
    rt.stderr = (rt.stderr + buf.toString('utf8')).slice(-8000)
  })

  child.on('error', (err) => {
    store.updateSession(session.id, {
      status: 'error',
      last_error: `无法启动 claude：${err.message}`,
      last_activity: '进程启动失败',
    })
    broadcast({
      type: 'session.status',
      sessionId: session.id,
      projectId: session.projectId,
      payload: { status: 'error', error: err.message },
    })
    runtimes.delete(session.id)
  })

  child.on('exit', (code, signal) => {
    clearTimer(rt)
    runtimes.delete(session.id)
    if (rt.stopping) {
      setStatus(session.id, session.projectId, 'stopped', '已停止')
      return
    }
    const tail = rt.stderr.trim().split('\n').slice(-6).join('\n')
    store.updateSession(session.id, {
      status: 'error',
      last_error: `claude 退出 code=${code ?? 'null'} signal=${signal ?? ''}${tail ? '\n' + tail : ''}`,
      last_activity: '进程已退出',
    })
    broadcast({
      type: 'session.status',
      sessionId: session.id,
      projectId: session.projectId,
      payload: { status: 'error', error: tail || `exit ${code ?? signal}` },
    })
  })

  return rt
}

function writeUser(rt: Runtime, text: string): void {
  rt.child.stdin.write(
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n',
  )
}

function activityOf(content: any[]): string {
  const tool = content.find((b) => b?.type === 'tool_use')
  if (tool) {
    const inp = tool.input ?? {}
    const hint = inp.command ?? inp.file_path ?? inp.path ?? inp.pattern ?? inp.query ?? ''
    return `${tool.name}${hint ? ' · ' + String(hint).slice(0, 60) : ''}`
  }
  const text = content.find((b) => b?.type === 'text')
  if (text?.text) return String(text.text).replace(/\s+/g, ' ').slice(0, 80)
  const thinking = content.find((b) => b?.type === 'thinking')
  if (thinking) return '思考中…'
  return '运行中'
}

function handleEvent(rt: Runtime, ev: any): void {
  switch (ev.type) {
    case 'system': {
      if (ev.subtype === 'init') {
        store.updateSession(rt.sessionId, { started: 1 })
        setStatus(rt.sessionId, rt.projectId, rt.turnActive ? 'running' : 'idle', '会话已就绪')
      }
      break
    }

    case 'assistant': {
      const msg = ev.message
      const blocks: any[] = Array.isArray(msg?.content) ? msg.content : []
      for (const block of blocks) {
        const kind =
          block.type === 'text'
            ? 'text'
            : block.type === 'thinking'
              ? 'thinking'
              : block.type === 'tool_use'
                ? 'tool_use'
                : 'block'
        const rec = store.appendMessage(rt.sessionId, 'assistant', kind, {
          block,
          model: msg?.model ?? null,
          uuid: ev.uuid ?? null,
        })
        broadcast({
          type: 'session.message',
          sessionId: rt.sessionId,
          projectId: rt.projectId,
          payload: { message: rec },
        })
      }
      setStatus(rt.sessionId, rt.projectId, 'running', activityOf(blocks))
      break
    }

    case 'user': {
      const blocks: any[] = Array.isArray(ev.message?.content) ? ev.message.content : []
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue
        const rec = store.appendMessage(rt.sessionId, 'user', 'tool_result', { block })
        broadcast({
          type: 'session.message',
          sessionId: rt.sessionId,
          projectId: rt.projectId,
          payload: { message: rec },
        })
      }
      break
    }

    case 'result': {
      clearTimer(rt)
      rt.turnActive = false

      const cost = Number(ev.total_cost_usd ?? 0)
      const usage = ev.usage ?? {}
      const prev = store.getSession(rt.sessionId)
      if (prev) {
        store.updateSession(rt.sessionId, {
          status: ev.is_error ? 'error' : 'idle',
          cost_usd: prev.costUsd + cost,
          tokens_in: prev.tokensIn + Number(usage.input_tokens ?? 0),
          tokens_out: prev.tokensOut + Number(usage.output_tokens ?? 0),
          turns: prev.turns + Number(ev.num_turns ?? 1),
          last_activity: ev.is_error ? '执行出错' : '空闲，等待指令',
          last_error: ev.is_error ? String(ev.result ?? '执行出错') : null,
        })
      }

      const rec = store.appendMessage(rt.sessionId, 'assistant', 'result', {
        result: ev.result ?? null,
        subtype: ev.subtype ?? null,
        isError: Boolean(ev.is_error),
        costUsd: cost,
        usage,
        durationMs: ev.duration_ms ?? null,
        numTurns: ev.num_turns ?? null,
        model: ev.modelUsage ? Object.keys(ev.modelUsage) : null,
      })

      broadcast({
        type: 'session.result',
        sessionId: rt.sessionId,
        projectId: rt.projectId,
        payload: { message: rec, costUsd: cost, usage, isError: Boolean(ev.is_error) },
      })

      const completed = store.completeDispatch(rt.sessionId, !ev.is_error)
      if (completed) {
        broadcast({
          type: 'dispatch.status',
          sessionId: completed.dispatch.fromSessionId,
          projectId: rt.projectId,
          payload: {
            dispatchId: completed.dispatch.id,
            messageId: completed.messageId,
            status: completed.dispatch.status,
            toSessionId: rt.sessionId,
          },
        })
      }

      if (!ev.is_error) flushQueue(rt)
      break
    }

    default:
      break
  }
}

function flushQueue(rt: Runtime): void {
  if (!rt.queue.length) return
  const next = rt.queue.shift()!
  setTimeout(() => {
    if (!runtimes.has(rt.sessionId)) return
    rt.turnActive = true
    armTimer(rt)
    setStatus(rt.sessionId, rt.projectId, 'running', '处理中…')
    writeUser(rt, next)
  }, 150)
}

function ensureRuntime(session: SessionRecord): Runtime {
  const rt = runtimes.get(session.id)
  if (rt && rt.child.exitCode === null) return rt
  return spawnRuntime(session, session.started ? 'resume' : 'new')
}

/* ------------------------------ public API ------------------------------ */

export async function createSession(
  project: ProjectRecord,
  input: { title?: string; role?: string; model?: string } = {},
  opts: { spawn?: boolean } = {},
): Promise<SessionRecord> {
  const spawn = opts.spawn !== false
  const now = Date.now()
  const id = randomUUID()
  const title = input.title?.trim() || '新 Agent'

  let cwd = project.path
  let branch = project.vcs === 'git' || project.vcs === 'svn' ? project.mainBranch : ''
  if (spawn && project.vcs === 'git') {
    const wt = await addSessionWorktree(project.path, id, title)
    if (wt) {
      cwd = wt.path
      branch = wt.branch
    }
  }

  const rec: SessionRecord = {
    id,
    projectId: project.id,
    claudeSessionId: randomUUID(),
    title,
    role: input.role?.trim() || '通用工程师',
    model: input.model?.trim() || null,
    status: spawn ? 'starting' : 'idle',
    cwd,
    branch,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    lastActivity: spawn ? '启动中…' : '等待第一条指令',
    lastError: null,
    started: 0,
    createdAt: now,
    updatedAt: now,
  }
  store.insertSession(rec)
  if (spawn) spawnRuntime(rec, 'new')
  return rec
}

/** P4 之前：每个项目保留一个"项目经理"会话入口（懒创建，不预先起进程，跑在主工作区） */
export async function ensureManagerSession(project: ProjectRecord): Promise<SessionRecord> {
  const existing = store.listSessions(project.id).find((s) => s.title === '项目经理')
  if (existing) return existing
  return createSession(project, { title: '项目经理', role: '路由 · 编排' }, { spawn: false })
}

export function sendMessage(sessionId: string, text: string): { queued: boolean } {
  const session = store.getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  if (!text.trim()) throw new Error('消息不能为空')

  if (session.status === 'stopped') store.updateSession(sessionId, { status: 'idle' })

  const rec = store.appendMessage(sessionId, 'user', 'text', { text })
  broadcast({
    type: 'session.message',
    sessionId,
    projectId: session.projectId,
    payload: { message: rec },
  })

  const rt = ensureRuntime(session)
  if (rt.turnActive) {
    rt.queue.push(text)
    setStatus(sessionId, session.projectId, 'running', '消息已排队，等待当前回合结束')
    return { queued: true }
  }

  rt.turnActive = true
  armTimer(rt)
  setStatus(sessionId, session.projectId, 'running', '思考中…')
  writeUser(rt, text)
  return { queued: false }
}

export async function stopSession(sessionId: string): Promise<void> {
  const session = store.getSession(sessionId)
  const rt = runtimes.get(sessionId)
  if (rt) {
    rt.stopping = true
    clearTimer(rt)
    await killTree(rt.child.pid)
    runtimes.delete(sessionId)
  }
  store.updateSession(sessionId, { status: 'stopped', last_activity: '已停止' })
  broadcast({
    type: 'session.status',
    sessionId,
    projectId: session?.projectId,
    payload: { status: 'stopped', activity: '已停止' },
  })
}

export async function deleteSession(sessionId: string): Promise<void> {
  const session = store.getSession(sessionId)
  await stopSession(sessionId).catch(() => {})
  if (session) {
    const project = store.getProject(session.projectId)
    if (project && session.cwd !== project.path && session.cwd.includes('.aide')) {
      await removeSessionWorktree(project.path, session.cwd)
    }
  }
  store.deleteSessionRow(sessionId)
}

export async function shutdownAll(): Promise<void> {
  await Promise.all(
    [...runtimes.values()].map(async (rt) => {
      rt.stopping = true
      clearTimer(rt)
      await killTree(rt.child.pid)
    }),
  )
  runtimes.clear()
}

function killTree(pid?: number): Promise<void> {
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
