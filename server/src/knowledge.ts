import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { resolveClaudeBinary } from './claude.js'
import { broadcast } from './events.js'
import { applyToolchainEnv } from './settings.js'
import type { ProjectRecord } from './types.js'

const execFileAsync = promisify(execFile)
const isWin = process.platform === 'win32'

const SOURCE_CANDIDATES: { path: string; kind: 'claude' | 'agent' | 'rules' }[] = [
  { path: 'CLAUDE.md', kind: 'claude' },
  { path: 'CLAUDE.local.md', kind: 'claude' },
  { path: '.claude/CLAUDE.md', kind: 'claude' },
  { path: '.claude/settings.json', kind: 'claude' },
  { path: '.claude/settings.local.json', kind: 'claude' },
  { path: 'AGENTS.md', kind: 'agent' },
  { path: '.cursorrules', kind: 'rules' },
]

const DOC_NAMES = ['PROJECT.md', 'KNOWLEDGE.md', 'HISTORY.md']

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

export interface KnowledgeJobState {
  running: boolean
  stage: 'idle' | 'running' | 'done' | 'error'
  startedAt: number | null
  finishedAt: number | null
  log: string[]
  error: string | null
}

export interface KnowledgeState {
  dir: string
  sources: KnowledgeSource[]
  docs: KnowledgeDoc[]
  generatedAt: number | null
  job: KnowledgeJobState | null
}

const jobs = new Map<string, KnowledgeJobState>()
const children = new Map<string, ChildProcess>()
const timers = new Map<string, NodeJS.Timeout>()

export function knowledgeDir(projectPath: string): string {
  return join(projectPath, '.aide')
}

function fileInfo(projectPath: string, rel: string): { size: number; updatedAt: number } | null {
  try {
    const s = statSync(join(projectPath, rel))
    return { size: s.size, updatedAt: s.mtimeMs }
  } catch {
    return null
  }
}

/** 创建 .aide 目录，并确保 Git 忽略它（SVN 在状态里过滤） */
export function prepareKnowledge(projectPath: string): void {
  try {
    const dir = knowledgeDir(projectPath)
    mkdirSync(dir, { recursive: true })
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      [
        '# AIDE 项目知识目录',
        '',
        '此目录由 AIDE 维护，默认不纳入版本控制：',
        '',
        '- `PROJECT.md`：项目概览、技术栈、启动/测试命令、目录结构与约定',
        '- `KNOWLEDGE.md`：架构决策、踩坑点、注意事项（Agent 可通过 `aide_note` 追加）',
        '- `HISTORY.md`：项目历史快照（来自版本库日志与知识整理）',
        '',
        '在 AIDE 的项目设置里可以一键生成/更新这些文档。',
      ].join('\n'),
      'utf8',
    )
  }
  const gitExclude = join(projectPath, '.git', 'info', 'exclude')
  try {
    if (existsSync(join(projectPath, '.git')) && existsSync(gitExclude)) {
      const cur = readFileSync(gitExclude, 'utf8')
      const has = cur.split(/\r?\n/).some((l) => l.trim() === '.aide/' || l.trim() === '.aide')
      if (!has) appendFileSync(gitExclude, `${cur.endsWith('\n') ? '' : '\n'}.aide/\n`, 'utf8')
    }
  } catch {
    /* ignore */
  }
  } catch {
    /* 只读目录等场景不影响项目注册 */
  }
}

export function listSources(projectPath: string): KnowledgeSource[] {
  const out: KnowledgeSource[] = []
  for (const c of SOURCE_CANDIDATES) {
    const info = fileInfo(projectPath, c.path)
    if (info) out.push({ path: c.path, kind: c.kind, size: info.size })
  }
  return out
}

export function listDocs(projectPath: string): KnowledgeDoc[] {
  const out: KnowledgeDoc[] = []
  for (const name of DOC_NAMES) {
    const rel = `.aide/${name}`
    const info = fileInfo(projectPath, rel)
    if (!info) continue
    let preview = ''
    try {
      preview = readFileSync(join(projectPath, rel), 'utf8').slice(0, 600)
    } catch {
      /* ignore */
    }
    out.push({
      name,
      path: rel,
      size: info.size,
      updatedAt: info.updatedAt,
      preview,
    })
  }
  return out
}

export function getKnowledge(project: ProjectRecord): KnowledgeState {
  return {
    dir: knowledgeDir(project.path),
    sources: listSources(project.path),
    docs: listDocs(project.path),
    generatedAt: fileInfo(project.path, '.aide/PROJECT.md')?.updatedAt ?? null,
    job: jobs.get(project.id) ?? null,
  }
}

export function getKnowledgeJob(projectId: string): KnowledgeJobState | null {
  return jobs.get(projectId) ?? null
}

function pushLog(state: KnowledgeJobState, line: string): void {
  const text = String(line ?? '').trim()
  if (!text) return
  for (const l of text.split('\n')) {
    state.log.push(l.slice(0, 2000))
    if (state.log.length > 300) state.log.shift()
  }
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  return String(o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.query ?? '').slice(0, 160)
}

function buildPrompt(project: ProjectRecord, sources: KnowledgeSource[]): string {
  return [
    `你是 AIDE 的项目知识整理 Agent。项目根目录：${project.path}`,
    '只允许创建/更新 .aide 下的文档，不要修改任何源码，不要执行提交。',
    '',
    '任务：阅读项目结构、README、构建/依赖文件、关键源码；如果存在 CLAUDE.md、.claude/CLAUDE.md、AGENTS.md、.cursorrules，' ,
    '把它们和实际代码一起作为知识来源（不要照抄无关内容）。',
    '在 .aide/ 下创建或更新以下文档（中文、简洁、可执行）：',
    '- PROJECT.md：项目概览、技术栈、目录结构、启动/测试命令、关键约定、外部依赖；',
    '- KNOWLEDGE.md：架构决策、踩坑点、注意事项、容易改错的地方；保留已有内容，用「## 时间 · 标题」合并；',
    '- HISTORY.md：从版本库日志（git log / svn log）提取最近 10 条提交，记录当前整理时间与本次整理范围；',
    '没有依据的内容标注「待确认」，不要编造。',
    '',
    sources.length
      ? `已检测到的知识来源：\n${sources.map((s) => `- ${s.path} (${s.size} bytes)`).join('\n')}`
      : '未检测到 CLAUDE.md 等现成文档，请从代码与版本库日志中整理。',
    '',
    '完成后用一句话总结写了哪些文件。',
  ].join('\n')
}

function killTree(pid?: number): void {
  if (!pid) return
  if (isWin) {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

export function startKnowledgeJob(project: ProjectRecord): KnowledgeJobState {
  if (jobs.get(project.id)?.running) throw new Error('知识整理任务已在运行')
  prepareKnowledge(project.path)
  const sources = listSources(project.path)
  const state: KnowledgeJobState = {
    running: true,
    stage: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    log: [],
    error: null,
  }
  jobs.set(project.id, state)
  pushLog(state, '已启动项目知识整理 Agent')

  const proc = spawn(
    resolveClaudeBinary(),
    [
      '-p',
      buildPrompt(project, sources),
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--add-dir',
      project.path,
    ],
    {
      cwd: project.path,
      env: { ...applyToolchainEnv(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  children.set(project.id, proc)

  const rl = createInterface({ input: proc.stdout! })
  rl.on('line', (line) => {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    if (ev.type === 'assistant') {
      for (const b of ev.message?.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) pushLog(state, b.text.trim())
        else if (b.type === 'tool_use') pushLog(state, `$ ${b.name} ${summarize(b.input)}`)
      }
    } else if (ev.type === 'result' && ev.is_error) {
      pushLog(state, 'Agent 报告失败：' + String(ev.result ?? '').slice(0, 600))
    }
  })
  proc.stderr?.on('data', (buf: Buffer) => {
    const t = buf.toString('utf8').trim()
    if (t) pushLog(state, '[stderr] ' + t.slice(-300))
  })

  proc.on('error', (err) => {
    state.error = err.message
    pushLog(state, '启动失败：' + err.message)
  })
  proc.on('exit', (code) => {
    if (timers.has(project.id)) {
      clearTimeout(timers.get(project.id)!)
      timers.delete(project.id)
    }
    children.delete(project.id)
    state.running = false
    state.finishedAt = Date.now()
    if (!existsSync(join(project.path, '.aide', 'PROJECT.md'))) {
      state.stage = 'error'
      state.error = state.error ?? `知识整理未生成 .aide/PROJECT.md（claude 退出码 ${code ?? 'null'}）`
    } else {
      state.stage = 'done'
      state.error = null
      pushLog(state, '已生成/更新 .aide/PROJECT.md、KNOWLEDGE.md、HISTORY.md')
      broadcast({ type: 'knowledge.updated', projectId: project.id, payload: { projectId: project.id } })
    }
  })

  const timer = setTimeout(() => {
    pushLog(state, '知识整理超时（10 分钟），已终止')
    killTree(proc.pid)
  }, 10 * 60 * 1000)
  timer.unref?.()
  timers.set(project.id, timer)

  return state
}

export function cancelKnowledgeJob(projectId: string): KnowledgeJobState | null {
  const state = jobs.get(projectId)
  const proc = children.get(projectId)
  if (state && proc) {
    pushLog(state, '用户取消知识整理')
    killTree(proc.pid)
  }
  return state ?? null
}

export function appendNote(
  project: ProjectRecord,
  input: { title: string; content: string; sessionTitle?: string },
): { path: string } {
  prepareKnowledge(project.path)
  const file = join(knowledgeDir(project.path), 'KNOWLEDGE.md')
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
  const header = `\n## ${stamp} · ${input.title.trim() || '记录'}\n`
  const source = input.sessionTitle ? `> 来源：${input.sessionTitle}\n\n` : '\n'
  appendFileSync(file, `${header}${source}${input.content.trim()}\n`, 'utf8')
  broadcast({ type: 'knowledge.updated', projectId: project.id, payload: { projectId: project.id } })
  return { path: '.aide/KNOWLEDGE.md' }
}

/** 给 Agent 的系统提示：项目既有知识 */
export function knowledgePrompt(projectPath: string, maxChars = 6000): string {
  const parts: string[] = []
  let remaining = maxChars
  for (const name of DOC_NAMES) {
    if (remaining <= 0) break
    const file = join(projectPath, '.aide', name)
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      const body = text.slice(0, Math.min(remaining, name === 'PROJECT.md' ? 3000 : 2000))
      parts.push(`--- .aide/${name} ---\n${body}`)
      remaining -= body.length
    } catch {
      /* ignore */
    }
  }
  const sources = listSources(projectPath)
  const lines = ['项目知识（来自 .aide/，如与代码冲突以代码为准；完整内容见 .aide/）：']
  if (sources.length) {
    lines.push(`现成文档来源：${sources.map((s) => s.path).join('、')}（整理时可参考）`)
  }
  if (parts.length) lines.push(parts.join('\n\n'))
  else lines.push('尚未生成 .aide 文档。需要记录踩坑/决策时，用 aide_note 追加到 KNOWLEDGE.md。')
  lines.push('学到稳定的项目知识/踩坑点时，用 aide_note 记录，方便后续 Agent 复用。')
  return lines.join('\n')
}
