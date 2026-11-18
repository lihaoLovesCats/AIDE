#!/usr/bin/env node
/**
 * AIDE MCP 工具桥（stdio）。
 * 由项目经理会话通过 --mcp-config 启动，工具调用回落到 AIDE 本地 HTTP API。
 *
 * 环境变量：
 *   AIDE_API      AIDE 服务地址（默认 http://127.0.0.1:7800）
 *   AIDE_PROJECT  当前项目 id
 *   AIDE_SESSION  当前（经理）会话 id
 */
import { createInterface } from 'node:readline'

const API = (process.env.AIDE_API ?? 'http://127.0.0.1:7800').replace(/\/$/, '')
const PROJECT = process.env.AIDE_PROJECT ?? ''
const SELF = process.env.AIDE_SESSION ?? ''

const TOOLS = [
  {
    name: 'aide_list_sessions',
    description:
      '列出当前项目的所有 Agent 会话：标题、id、状态、分支、花费、最近活动。派发前先用它了解谁在忙、谁空闲。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'aide_dispatch',
    description:
      '把任务派发给已有 Agent 会话（用 id、完整标题或标题片段）。目标正在执行时任务会排队，本轮结束后自动开始。',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '目标会话 id 或标题' },
        task: { type: 'string', description: '完整、可独立执行的任务说明，包含验收标准' },
        reason: { type: 'string', description: '为什么派给这个 Agent（会展示给用户）' },
        confidence: { type: 'number', description: '0–1，你对该派发的把握' },
      },
      required: ['session', 'task'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_create_session',
    description:
      '新建一个模块负责人（自动创建独立 worktree 与 aide/* 分支），标题用模块名，可选择立即下发任务。不同模块可以并行；同一模块不要重复创建。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '会话标题，例如「前端-列表页」' },
        role: { type: 'string', description: '角色，例如「Java 后端」「前端工程师」' },
        task: { type: 'string', description: '可选：创建后立即下发的任务' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_rename_session',
    description: '把某个 Agent 的会话标题改成它负责的模块名（例如「订单模块」），便于按模块管理。',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id 或现有标题' },
        title: { type: 'string', description: '新的模块名，例如「订单模块」' },
      },
      required: ['session', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_message_agent',
    description:
      '给某个 Agent 发协作消息（异步），用于模块间对齐接口/传递信息；对方回复会作为新消息出现。目标用 id 或标题指定。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '目标 Agent 的 id 或标题' },
        message: { type: 'string', description: '要对方配合/回答的内容' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_read_agent',
    description: '读取某个 Agent 最近的文本/结论（只读，最多 10 条），用于跨模块同步信息。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: '目标 Agent 的 id 或标题' },
        limit: { type: 'number', description: '读取最近多少条消息，默认 20，最大 50' },
      },
      required: ['agent'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_git_status',
    description: '查看某个会话工作区（worktree）的分支与未提交变更；不传 session 时查看经理所在的主工作区。',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: '可选：会话 id 或标题' } },
      additionalProperties: false,
    },
  },
  {
    name: 'aide_run_app',
    description:
      '启动某个会话工作区的应用实例（端口池 18080–18120），返回预览 URL。受内存准入限制，内存紧张时会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id 或标题；不传则用经理主工作区' },
        port: { type: 'number', description: '可选：指定端口（18080–18120），留空自动分配' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aide_stop_app',
    description: '停止某个会话正在运行的应用实例。',
    inputSchema: {
      type: 'object',
      properties: { session: { type: 'string', description: '会话 id 或标题；不传则用经理主工作区' } },
      additionalProperties: false,
    },
  },
  {
    name: 'aide_commit_push',
    description:
      '提交某个会话工作区的改动（Git 提交并推送 / SVN 提交）。提交前会运行测试门禁；失败会返回错误与输出，不要自行绕过，除非用户明确要求强制提交。',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id 或标题；不传则用经理主工作区' },
        message: { type: 'string', description: '可选提交信息；留空由 AIDE 生成' },
        force: { type: 'boolean', description: '仅在用户明确要求时使用：跳过测试门禁强制提交' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aide_note',
    description:
      '把稳定的项目知识、踩坑点或架构决策追加到项目 .aide/KNOWLEDGE.md。后续 Agent 会在系统提示中自动读到，不需要重复解释。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '简短标题，例如「SVN 提交流程」' },
        content: { type: 'string', description: '具体内容：现象、原因、结论、做法' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  },
]

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }
  if (!msg || msg.id === undefined || msg.id === null) return
  void dispatch(msg)
})

async function dispatch(msg) {
  try {
    if (msg.method === 'initialize') {
      send(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aide-mcp', version: '0.1.0' },
      })
      return
    }
    if (msg.method === 'ping') {
      send(msg.id, {})
      return
    }
    if (msg.method === 'tools/list') {
      send(msg.id, { tools: TOOLS })
      return
    }
    if (msg.method === 'tools/call') {
      const name = msg.params?.name
      const args = msg.params?.arguments ?? {}
      try {
        const text = await callTool(name, args)
        send(msg.id, { content: [{ type: 'text', text }] })
      } catch (err) {
        send(msg.id, {
          content: [{ type: 'text', text: `错误：${err?.message ?? err}` }],
          isError: true,
        })
      }
      return
    }
    sendError(msg.id, -32601, `Unknown method: ${msg.method}`)
  } catch (err) {
    sendError(msg.id, -32603, String(err?.message ?? err))
  }
}

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

async function api(path, init) {
  const res = await fetch(API + path, init)
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) {
    const err = new Error(data?.error ?? `${res.status} ${res.statusText}`)
    err.data = data
    throw err
  }
  return data
}

const jsonInit = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function listSessions() {
  const data = await api(`/api/projects/${PROJECT}/sessions`)
  return data.sessions
}

async function resolveSession(ref, fallbackSelf = false) {
  const sessions = await listSessions()
  const t = (ref ?? '').trim()
  if (!t) {
    if (!fallbackSelf) throw new Error('缺少 session')
    const self = sessions.find((s) => s.id === SELF)
    if (!self) throw new Error('找不到当前经理会话')
    return self
  }
  const found =
    sessions.find((s) => s.id === t) ||
    sessions.find((s) => s.title === t) ||
    sessions.find((s) => s.title.includes(t)) ||
    sessions.find((s) => t.includes(s.title))
  if (!found) {
    throw new Error(`找不到会话「${ref}」。可用会话：${sessions.map((s) => s.title).join('、')}`)
  }
  return found
}

async function callTool(name, args) {
  if (!PROJECT) throw new Error('AIDE_PROJECT 未设置')

  if (name === 'aide_list_sessions') {
    const sessions = await listSessions()
    if (!sessions.length) return '当前项目还没有会话。'
    return [
      `项目会话（${sessions.length}）：`,
      ...sessions.map(
        (s) =>
          `- ${s.title} [${s.id}] 状态=${s.status} 分支=${s.branch} 花费=$${(s.costUsd ?? 0).toFixed(3)} 最近=${s.lastActivity ?? '—'}`,
      ),
    ].join('\n')
  }

  if (name === 'aide_dispatch') {
    const target = await resolveSession(args.session)
    const r = await api(
      `/api/projects/${PROJECT}/dispatch`,
      jsonInit({
        sessionId: target.id,
        task: String(args.task ?? ''),
        reason: String(args.reason ?? ''),
        confidence: typeof args.confidence === 'number' ? args.confidence : 0.9,
        fromSessionId: SELF,
      }),
    )
    return `已派发给「${target.title}」(${target.id})，${r.queued ? '它当前在忙，任务已排队' : '任务已开始执行'}。分支：${target.branch}。`
  }

  if (name === 'aide_create_session') {
    const title = String(args.title ?? '').trim()
    if (!title) throw new Error('缺少 title')
    const created = await api(
      `/api/projects/${PROJECT}/sessions`,
      jsonInit({ title, role: args.role ? String(args.role) : undefined }),
    )
    let extra = ''
    if (args.task && String(args.task).trim()) {
      await api(`/api/sessions/${created.id}/messages`, jsonInit({ text: String(args.task) }))
      extra = '，任务已下发'
    }
    return `已创建「${created.title}」[${created.id}]，分支 ${created.branch}，工作区 ${created.cwd}${extra}。`
  }

  if (name === 'aide_rename_session') {
    const target = await resolveSession(args.session)
    const title = String(args.title ?? '').trim()
    if (!title) throw new Error('缺少 title')
    const updated = await api(
      `/api/sessions/${target.id}`,
      jsonInit({ title }),
    ).catch((err) => {
      throw err
    })
    return `已将「${target.title}」的标题改为「${updated.title}」。`
  }

  if (name === 'aide_message_agent') {
    const target = await resolveSession(args.to)
    if (target.id === SELF) throw new Error('不能给自己发消息')
    const message = String(args.message ?? '').trim()
    if (!message) throw new Error('缺少 message')
    const res = await api(
      `/api/projects/${PROJECT}/peer`,
      jsonInit({ fromSessionId: SELF, toSessionId: target.id, text: message }),
    )
    return `已发送给「${target.title}」（当前${target.status}${res.queued ? '，排队中' : ''}）。对方回复会出现在你的会话里。`
  }

  if (name === 'aide_read_agent') {
    const target = await resolveSession(args.agent)
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 50))
    const data = await api(`/api/sessions/${target.id}/messages?limit=${limit}`)
    const msgs = (data.messages ?? []).filter(
      (m) => (m.kind === 'text' && m.role !== 'system') || m.kind === 'result',
    )
    const tail = msgs.slice(-10)
    if (!tail.length) return `「${target.title}」暂无文本消息。`
    return (
      `「${target.title}」最近 ${tail.length} 条：\n` +
      tail
        .map((m) => {
          const body = String(m.payload?.text ?? m.payload?.result ?? '').trim()
          return `${m.role === 'user' ? '用户' : 'Agent'}：${body.slice(0, 1200)}`
        })
        .join('\n---\n')
    )
  }

  if (name === 'aide_git_status') {
    if (args.session) {
      const target = await resolveSession(args.session)
      const st = await api(`/api/sessions/${target.id}/git/status`)
      const files = st.files.length ? st.files.map((f) => `  ${f.status} ${f.path} (+${f.add}/-${f.del})`).join('\n') : '  （干净）'
      return `会话「${target.title}」分支 ${st.branch}\n${files}`
    }
    const st = await api(`/api/projects/${PROJECT}/git/status`)
    const files = st.files.length ? st.files.map((f) => `  ${f.status} ${f.path} (+${f.add}/-${f.del})`).join('\n') : '  （干净）'
    return `主工作区分支 ${st.branch}\n${files}`
  }

  if (name === 'aide_run_app') {
    const target = args.session ? await resolveSession(args.session) : await resolveSession('', true)
    const run = await api(
      `/api/sessions/${target.id}/run`,
      jsonInit({ port: args.port != null ? Number(args.port) : undefined }),
    )
    return `已在端口 ${run.port} 启动「${target.title}」的实例：${run.url}（状态 ${run.status}）`
  }

  if (name === 'aide_stop_app') {
    const target = args.session ? await resolveSession(args.session) : await resolveSession('', true)
    const run = await api(`/api/sessions/${target.id}/run/stop`, { method: 'POST' })
    return `已停止「${target.title}」的实例（端口 ${run.port}）。`
  }

  if (name === 'aide_commit_push') {
    const target = args.session ? await resolveSession(args.session) : await resolveSession('', true)
    try {
      const r = await api(
        `/api/sessions/${target.id}/git/commit`,
        jsonInit({
          message: args.message ? String(args.message) : undefined,
          force: Boolean(args.force),
        }),
      )
      return [
        `已提交 ${r.shortSha}（${r.branch}）：${r.message}`,
        `测试门禁：${r.test.status}${r.test.reason ? `（${r.test.reason}）` : ''}`,
        r.pushed ? `已推送到 ${r.remote}` : `未推送${r.remote ? '：' + (r.pushError ?? '') : '（未配置远程仓库）'}`,
      ].join('\n')
    } catch (err) {
      const d = err?.data ?? {}
      if (d.stage === 'test' && d.test) {
        throw new Error(
          `测试未通过，提交已阻止（${d.test.label}）。输出：\n${String(d.test.output ?? '').slice(-1500)}`,
        )
      }
      throw err
    }
  }

  if (name === 'aide_note') {
    const title = String(args.title ?? '').trim()
    const content = String(args.content ?? '').trim()
    if (!title || !content) throw new Error('缺少 title 或 content')
    const data = await api(
      `/api/projects/${PROJECT}/notes`,
      jsonInit({ title, content, sessionId: SELF }),
    )
    return `已记录到 ${data.path}（后续 Agent 会自动读取）。`
  }

  throw new Error(`未知工具：${name}`)
}
