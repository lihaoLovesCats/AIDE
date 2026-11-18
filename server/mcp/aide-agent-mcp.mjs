#!/usr/bin/env node
/**
 * AIDE 轻量 Agent MCP（stdio）。
 * 每个 Worker 会话通过 --mcp-config 启动，用于：
 *   - aide_set_title       设置自己负责的模块标题
 *   - aide_list_agents     查看项目内其他 Agent（互相可见）
 *   - aide_message_agent   给其他模块 Agent 发协作消息
 *   - aide_read_agent      读取其他 Agent 最近的结论/对话
 *
 * 环境变量：AIDE_API / AIDE_PROJECT / AIDE_SESSION
 */
import { createInterface } from 'node:readline'

const API = (process.env.AIDE_API ?? 'http://127.0.0.1:7800').replace(/\/$/, '')
const PROJECT = process.env.AIDE_PROJECT ?? ''
const SELF = process.env.AIDE_SESSION ?? ''

const TOOLS = [
  {
    name: 'aide_set_title',
    description:
      '把当前会话标题改为你负责的功能模块或任务名（例如「订单模块」「支付 + 对账」）。开始任务时调用一次，模块范围变化时再更新。标题不超过 40 字。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '简洁的模块名或任务名，例如「订单模块」' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_list_agents',
    description:
      '列出当前项目所有 Agent 的标题、角色、状态与分支。需要其他模块的信息或配合时，先用它找到对应模块负责人。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'aide_message_agent',
    description:
      '给另一个 Agent 发协作消息（异步）：对方会在当前回合结束后收到并处理，回复会作为新消息出现在你的会话里。用 id 或标题指定目标。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '目标 Agent 的 id、完整标题或标题片段，例如「订单模块」' },
        message: { type: 'string', description: '要对方配合/回答的内容，写清背景、接口或验收点' },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'aide_read_agent',
    description:
      '读取另一个 Agent 最近的文本/结论（最多 10 条），用于复用它的调研结果或接口约定。只读，不会打扰对方。',
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
    name: 'aide_note',
    description:
      '把稳定的项目知识、踩坑点或架构决策追加到项目 .aide/KNOWLEDGE.md，后续 Agent 会自动读到。只写知识库，不改源码。',
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
  void handle(msg)
})

async function handle(msg) {
  try {
    if (msg.method === 'initialize') {
      send(msg.id, {
        protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'aide-agent-mcp', version: '0.2.0' },
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
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data
}

async function listAgents() {
  const data = await api(`/api/projects/${PROJECT}/sessions`)
  return data.sessions ?? []
}

async function resolveAgent(ref) {
  const list = await listAgents()
  const t = String(ref ?? '').trim()
  if (!t) throw new Error('缺少目标 Agent')
  const found =
    list.find((s) => s.id === t) ||
    list.find((s) => s.title === t) ||
    list.find((s) => s.title.includes(t)) ||
    list.find((s) => t.includes(s.title))
  if (!found) throw new Error(`找不到 Agent「${ref}」。可用：${list.map((s) => s.title).join('、')}`)
  return found
}

async function callTool(name, args) {
  if (!PROJECT) throw new Error('AIDE_PROJECT 未设置')

  if (name === 'aide_set_title') {
    const title = String(args.title ?? '').trim()
    if (!title) throw new Error('缺少 title')
    if (!SELF) throw new Error('AIDE_SESSION 未设置')
    const data = await api(`/api/sessions/${SELF}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    return `会话标题已更新为「${data.title}」。`
  }

  if (name === 'aide_list_agents') {
    const list = await listAgents()
    if (!list.length) return '当前项目还没有其他 Agent。'
    return list
      .map(
        (s) =>
          `- ${s.title}（${s.role || '通用'}）· ${s.status}${s.id === SELF ? ' · 我' : ''}${
            s.branch ? ` · ${s.branch}` : ''
          } · ${s.id}`,
      )
      .join('\n')
  }

  if (name === 'aide_message_agent') {
    const target = await resolveAgent(args.to)
    if (target.id === SELF) throw new Error('不能给自己发消息')
    const message = String(args.message ?? '').trim()
    if (!message) throw new Error('缺少 message')
    const res = await api(`/api/projects/${PROJECT}/peer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromSessionId: SELF, toSessionId: target.id, text: message }),
    })
    return `已发送给「${target.title}」（当前${target.status}${res.queued ? '，任务排队中' : ''}）。对方回复会作为新消息出现在你的会话中。`
  }

  if (name === 'aide_read_agent') {
    const target = await resolveAgent(args.agent)
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

  if (name === 'aide_note') {
    const title = String(args.title ?? '').trim()
    const content = String(args.content ?? '').trim()
    if (!title || !content) throw new Error('缺少 title 或 content')
    const data = await api(`/api/projects/${PROJECT}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, content, sessionId: SELF }),
    })
    return `已记录到 ${data.path}（后续 Agent 会在系统提示中读到）。`
  }

  throw new Error(`未知工具：${name}`)
}
