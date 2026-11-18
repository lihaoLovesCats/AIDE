import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  CornerDownRight,
  FileText,
  GitBranch,
  HelpCircle,
  Loader2,
  MessagesSquare,
  Search,
  Send,
  Shield,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { quickPrompts } from './data'
import Markdown from './Markdown'
import type { DiffFile, DispatchRef, Message, Project, Session, ToolCall } from './types'
import { Avatar, Chip, IconButton, Kbd, StatusDot, StatusPill, cn, statusStyle } from './ui'

/* ---------------------------- 富文本 ---------------------------- */

type UsageDisplay = 'both' | 'cost' | 'tokens'

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/* ---------------------------- 消息块 ---------------------------- */

function ToolIcon({ name }: { name: string }) {
  if (name === 'Bash') return <Terminal size={12} className="text-ok" />
  if (name === 'Grep' || name === 'Glob') return <Search size={12} className="text-violet" />
  return <FileText size={12} className="text-accent2" />
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel2/70">
      <button
        type="button"
        onClick={() => tool.output && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-soft"
      >
        {tool.output ? (
          <ChevronRight size={10} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        ) : (
          <span className="w-[10px] shrink-0" />
        )}
        <ToolIcon name={tool.name} />
        <span className="shrink-0 font-mono text-[10.5px] font-medium text-ink/85">{tool.name}</span>
        <span className="truncate font-mono text-[10.5px] text-faint">{tool.input}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9.5px] text-faint">
          {tool.status === 'running' && <Loader2 size={10} className="animate-spin text-run" />}
          {tool.status === 'ok' && <Check size={10} className="text-ok" />}
          {tool.status === 'fail' && <X size={10} className="text-err" />}
          {tool.duration}
        </span>
      </button>
      {open && tool.output && (
        <pre className="max-h-52 overflow-auto border-t border-line bg-sunken px-3 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
          {tool.output}
        </pre>
      )}
    </div>
  )
}

function DispatchCard({
  msgId,
  entries,
  sessions,
  onJump,
  onReassign,
  onRevoke,
}: {
  msgId: string
  entries: DispatchRef[]
  sessions: Session[]
  onJump: (id: string) => void
  onReassign: (msgId: string, index: number, toId: string) => void
  onRevoke: (msgId: string, index: number) => void
}) {
  const [menu, setMenu] = useState<number | null>(null)

  return (
    <div className="overflow-hidden rounded-lg border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-transparent">
      <div className="flex items-center gap-2 border-b border-accent/15 px-2.5 py-1.5">
        <CornerDownRight size={12} className="text-accent2" />
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-accent2">派发任务</span>
        <span className="ml-auto text-[10px] text-faint">{entries.length} 个 Agent</span>
      </div>

      {entries.map((e, idx) => {
        const revoked = e.status === 'revoked'
        const failed = e.status === 'failed'
        return (
          <div key={`${msgId}-${idx}`} className={cn('relative border-b border-line/60 px-2.5 py-2 last:border-0', revoked && 'opacity-60')}>
            <div className="flex items-start gap-2">
              <div
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold',
                  revoked ? 'bg-soft text-faint' : 'bg-accent/15 text-accent2',
                )}
              >
                {e.toName.slice(0, 1)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('text-[11.5px] font-medium', revoked ? 'text-faint line-through' : 'text-ink')}>{e.toName}</span>
                  <span className="font-mono text-[9.5px] text-faint">{e.toSessionId}</span>
                  <span
                    className={cn(
                      'ml-auto flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px]',
                      e.status === 'working' && 'border-run/30 bg-run/10 text-run',
                      e.status === 'sent' && 'border-line2 bg-soft text-dim',
                      e.status === 'done' && 'border-ok/30 bg-ok/10 text-ok',
                      failed && 'border-err/30 bg-err/10 text-err',
                      revoked && 'border-line2 bg-soft text-faint',
                    )}
                  >
                    {e.status === 'working' && <span className="h-1 w-1 rounded-full bg-run pulse-dot" />}
                    {failed && <span className="h-1 w-1 rounded-full bg-err" />}
                    {e.status === 'working'
                      ? '执行中'
                      : e.status === 'sent'
                        ? '已送达'
                        : e.status === 'done'
                          ? '已完成'
                          : failed
                            ? '执行失败'
                            : '已撤销'}
                  </span>
                </div>

                <div className={cn('mt-1 text-[11.5px] leading-[1.65]', revoked ? 'text-faint line-through' : 'text-dim')}>{e.task}</div>

                <div className="mt-1.5 flex items-center gap-1.5 rounded border border-line/70 bg-panel/50 px-1.5 py-1">
                  <Sparkles size={9} className="shrink-0 text-accent2/80" />
                  <span className="truncate text-[10px] text-faint" title={e.reason}>
                    判断依据：{e.reason}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <span className="h-1 w-10 overflow-hidden rounded-full bg-soft">
                      <span className="block h-full rounded-full bg-accent/70" style={{ width: `${e.confidence}%` }} />
                    </span>
                    <span className="font-mono text-[9px] text-dim">{e.confidence}%</span>
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onJump(e.toSessionId)}
                    className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-accent2 hover:bg-accent/10"
                  >
                    跳转 <ArrowRight size={9} />
                  </button>
                  {!revoked && e.status !== 'done' && !failed && (
                    <>
                      <button
                        type="button"
                        onClick={() => setMenu(menu === idx ? null : idx)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-dim hover:bg-soft hover:text-ink"
                      >
                        改派
                      </button>
                      <button
                        type="button"
                        onClick={() => onRevoke(msgId, idx)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-dim hover:bg-err/10 hover:text-err"
                      >
                        撤销
                      </button>
                    </>
                  )}
                  {revoked && <span className="px-1 text-[9.5px] text-faint">已撤销，Agent 已回到空闲</span>}
                  {failed && <span className="px-1 text-[9.5px] text-err/80">本轮执行失败，可跳转查看日志后重新派发</span>}
                </div>
              </div>
            </div>

            {menu === idx && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                <div className="absolute right-2 top-9 z-20 w-64 overflow-hidden rounded-lg border border-line2 bg-panel2 shadow-2xl">
                  <div className="border-b border-line px-2 py-1 text-[9.5px] text-faint">改派给其他 Agent</div>
                  <div className="max-h-48 overflow-auto py-0.5">
                    {sessions
                      .filter((s) => s.id !== e.toSessionId)
                      .map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onReassign(msgId, idx, s.id)
                            setMenu(null)
                          }}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-soft"
                        >
                          <StatusDot status={s.status} size={6} />
                          <span className="truncate text-[11px] text-ink">{s.name}</span>
                          <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">{statusStyle[s.status].label}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DiffCard({ files, note, onOpen }: { files: DiffFile[]; note: string; onOpen: (p: string) => void }) {
  const add = files.reduce((a, f) => a + f.add, 0)
  const del = files.reduce((a, f) => a + f.del, 0)
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel2/70">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <FileText size={12} className="text-warn" />
        <span className="text-[11px] font-medium text-ink">改动 {files.length} 个文件</span>
        <span className="font-mono text-[10px]">
          <span className="text-ok">+{add}</span> <span className="text-err">−{del}</span>
        </span>
        <span className="ml-auto truncate text-[9.5px] text-faint">{note}</span>
      </div>
      {files.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => onOpen(f.path)}
          className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-soft"
        >
          <span className="w-2.5 shrink-0 font-mono text-[9px] font-bold text-warn">{f.status}</span>
          <span className="truncate font-mono text-[10.5px] text-dim">{f.path}</span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px]">
            <span className="text-ok">+{f.add}</span> <span className="text-err">−{f.del}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function MessageItem({
  m,
  session,
  sessions,
  onJump,
  onOpenFile,
  onRetry,
  onReassign,
  onRevoke,
  usageDisplay,
}: {
  m: Message
  session: Session
  sessions: Session[]
  onJump: (id: string) => void
  onOpenFile: (p: string) => void
  onRetry: () => void
  onReassign: (msgId: string, index: number, toId: string) => void
  onRevoke: (msgId: string, index: number) => void
  usageDisplay: UsageDisplay
}) {
  if (m.role === 'system' && m.kind === 'error') {
    return (
      <div className="fade-in overflow-hidden rounded-lg border border-err/30 bg-err/[0.06]">
        <div className="flex items-start gap-2 px-3 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-err" />
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-medium text-err">会话异常终止</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-dim">{m.text}</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded border border-err/30 px-2 py-0.5 text-[10.5px] text-err hover:bg-err/10"
              >
                重试本轮
              </button>
              <button
                type="button"
                className="rounded border border-line2 px-2 py-0.5 text-[10.5px] text-dim hover:bg-soft"
              >
                压缩上下文 /compact
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (m.role === 'system' && m.kind === 'notice') {
    return (
      <div className="fade-in flex items-center gap-2 py-0.5">
        <span className="h-px flex-1 bg-line" />
        <span className="flex items-center gap-1.5 rounded-full border border-line2 bg-soft px-2 py-0.5 text-[9.5px] text-faint">
          <GitBranch size={9} />
          {m.text}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    )
  }

  if (m.role === 'user' && m.kind === 'text') {
    return (
      <div className="fade-in flex justify-end">
        <div className="max-w-[76%] rounded-xl rounded-br-sm border border-line2 bg-hover px-3 py-2">
          <div className="whitespace-pre-wrap text-[12.5px] leading-[1.7] text-ink">{m.text}</div>
          <div className="mt-1 text-right font-mono text-[9px] text-faint">{m.time}</div>
        </div>
      </div>
    )
  }

  if (m.role !== 'assistant') return null

  if (m.kind === 'thinking') {
    return (
      <details className="group fade-in rounded-lg border border-line/70 bg-panel2/40">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] text-violet/80">
          <ChevronRight size={10} className="transition-transform group-open:rotate-90" />
          <Sparkles size={11} />
          {m.seconds > 0 ? `思考了 ${m.seconds} 秒` : '思考过程'}
        </summary>
        <div className="border-t border-line/60 px-3 py-2 text-[11.5px] leading-relaxed text-faint">{m.text}</div>
      </details>
    )
  }

  if (m.kind === 'tool') return <ToolRow tool={m.tool} />
  if (m.kind === 'peer')
    return (
      <div className="rounded-lg border border-violet/30 bg-violet/[0.05] px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-violet">
          <MessagesSquare size={11} />
          跨模块协作 → {m.toTitle}
        </div>
        <div className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-dim">{m.text}</div>
        <div className="mt-1 text-[9px] text-faint">已发送 · 对方回复会作为新消息出现在此会话</div>
      </div>
    )
  if (m.kind === 'dispatch')
    return (
      <DispatchCard
        msgId={m.id}
        entries={m.entries}
        sessions={sessions}
        onJump={onJump}
        onReassign={onReassign}
        onRevoke={onRevoke}
      />
    )
  if (m.kind === 'diff') return <DiffCard files={m.files} note={m.note} onOpen={onOpenFile} />

  if (m.kind === 'result') {
    return (
      <div className="flex items-center gap-2 py-1 pl-1 text-[9.5px] text-faint">
        <Check size={10} className="text-ok/70" />
        <span>本轮完成</span>
        {usageDisplay !== 'cost' && (
          <>
            <span>·</span>
            <span className="font-mono">{fmtTokens(m.tokens)} tokens</span>
          </>
        )}
        {usageDisplay !== 'tokens' && (
          <>
            <span>·</span>
            <span className="font-mono">${m.cost.toFixed(3)}</span>
          </>
        )}
        <span>·</span>
        <span className="font-mono">{m.duration}</span>
        <span>·</span>
        <span className="font-mono">{session.model}</span>
      </div>
    )
  }

  if (m.kind === 'text') {
    return (
      <div className="fade-in flex gap-2.5">
        <div className="mt-0.5 shrink-0">
          {session.isManager ? (
            <Avatar label="PM" from="#5b8cff" to="#7c5cff" size={22} />
          ) : (
            <div className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-line2 bg-soft text-[9px] font-bold text-dim">
              {session.name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[11.5px] font-semibold text-ink/90">{session.name}</span>
            {session.isManager && <Chip tone="accent">项目经理</Chip>}
            <span className="font-mono text-[9px] text-faint">{m.time}</span>
            {m.streaming && (
              <span className="flex items-center gap-1 text-[9.5px] text-run">
                <span className="h-1 w-1 rounded-full bg-run pulse-dot" /> 输出中
              </span>
            )}
          </div>
          <Markdown text={m.text} />
          {m.streaming && <span className="caret" />}
        </div>
      </div>
    )
  }

  return null
}

/* ---------------------------- 输入框 ---------------------------- */

function Composer({
  session,
  onSend,
  disabled,
}: {
  session: Session
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const queued = session.status === 'queued'

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
    setValue('')
    if (ref.current) ref.current.style.height = 'auto'
  }

  return (
    <div className="shrink-0 border-t border-line bg-panel/60 px-4 pb-3 pt-2.5 backdrop-blur">
      <div className="mx-auto max-w-[960px]">
        {session.isManager && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-faint">试试：</span>
            {quickPrompts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setValue(q)
                  ref.current?.focus()
                }}
                className="rounded-full border border-line2 bg-soft px-2 py-0.5 text-[10.5px] text-dim transition-colors hover:border-accent/30 hover:text-accent2"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div
          className={cn(
            'rounded-xl border bg-panel2/90 transition-colors focus-within:border-accent/45',
            queued ? 'border-warn/30' : 'border-line2',
          )}
        >
          <textarea
            ref={ref}
            value={value}
            rows={2}
            placeholder={
              queued
                ? '排队中：当前回合结束后会自动执行…'
                : session.isManager
                  ? '描述需求，项目经理会决定自己做还是派发给合适的 Agent…'
                  : `给「${session.name}」下指令，Enter 换行，⌘↵ 发送`
            }
            onChange={(e) => {
              setValue(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 168)}px`
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-[168px] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-[12.5px] leading-relaxed placeholder:text-faint/80"
          />
          <div className="flex items-center gap-2 px-2.5 pb-2">
            <span className="flex items-center gap-1 rounded border border-line2 bg-soft px-1.5 py-0.5 font-mono text-[9.5px] text-dim">
              <Sparkles size={9} className="text-accent2" />
              {session.model}
            </span>
            <span className="font-mono text-[9.5px] text-faint">~{(session.tokens / 1000).toFixed(1)}k ctx</span>
            <div className="h-1 w-14 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.min(100, (session.tokens / 200000) * 100)}%` }} />
            </div>
            <span className="ml-auto flex items-center gap-1 text-[9.5px] text-faint">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
              发送
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim() || disabled}
              className={cn(
                'flex h-6 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                value.trim() && !disabled ? 'bg-accent text-white hover:bg-accent2 hover:text-white' : 'cursor-not-allowed bg-hover text-faint',
              )}
            >
              <Send size={11} />
              发送
            </button>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[9.5px] text-faint/80">
          <span className="flex items-center gap-1">
            <GitBranch size={9} />
            {session.branch}
          </span>
          <span className="truncate font-mono">{session.worktree}</span>
          {session.port && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-ok">
              <span className="h-1 w-1 rounded-full bg-ok" />
              :{session.port}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------- 主视图 ---------------------------- */

export default function ChatView({
  project,
  session,
  tabs,
  onSelectTab,
  onCloseTab,
  onSend,
  onStop,
  onJump,
  onOpenFile,
  onToggleRuntime,
  runtimeOpen,
  onRetry,
  onReassign,
  onRevoke,
  onResolve,
  usageDisplay,
}: {
  project: Project
  session: Session
  tabs: string[]
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onJump: (id: string) => void
  onOpenFile: (p: string) => void
  onToggleRuntime: () => void
  runtimeOpen: boolean
  onRetry: () => void
  onReassign: (msgId: string, index: number, toId: string) => void
  onRevoke: (msgId: string, index: number) => void
  onResolve: (decision: 'confirm' | 'alt' | 'approve' | 'deny') => void
  usageDisplay: UsageDisplay
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const baseline = useRef<{ sid: string; count: number }>({ sid: '', count: -1 })
  const messages = session.messages
  const lastLen = messages.length
  const streamLen = useMemo(() => {
    const last = messages[messages.length - 1]
    return last && last.kind === 'text' && last.role === 'assistant' ? last.text.length : 0
  }, [messages])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 切换到会话时记录基线并留在顶部；之后有新消息/流式输出才自动跟随
    if (baseline.current.sid !== session.id) {
      baseline.current = { sid: session.id, count: lastLen }
      return
    }
    if (lastLen > baseline.current.count) el.scrollTop = el.scrollHeight
  }, [lastLen, streamLen, session.id])

  const tabSessions = tabs.map((id) => project.sessions.find((s) => s.id === id)).filter(Boolean) as Session[]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-base">
      {/* 标签栏 */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-panel">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar">
          {tabSessions.map((t) => {
            const active = t.id === session.id
            return (
              <div
                key={t.id}
                className={cn(
                  'group relative flex min-w-[130px] max-w-[210px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-2.5',
                  active ? 'bg-base text-ink' : 'bg-panel text-dim hover:bg-soft',
                )}
                onClick={() => onSelectTab(t.id)}
              >
                {active && <span className="absolute left-0 right-0 top-0 h-[2px] bg-accent" />}
                <StatusDot status={t.status} size={6} />
                <span className="truncate text-[11.5px]">{t.name}</span>
                {t.isManager && <span className="text-[9px] text-accent2">PM</span>}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(t.id)
                  }}
                  className="ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded text-faint hover:bg-white/10 hover:text-ink group-hover:flex"
                >
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-line px-2">
          <button
            type="button"
            onClick={onToggleRuntime}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-1.5 text-[10.5px] transition-colors',
              runtimeOpen ? 'bg-hover text-ink' : 'text-faint hover:bg-hover hover:text-dim',
            )}
            title="运行与预览面板"
          >
            <Terminal size={12} />
            运行
            {project.runStatus === 'running' && <span className="h-1 w-1 rounded-full bg-ok" />}
          </button>
        </div>
      </div>

      {/* 会话头 */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-panel/40 px-4 py-2">
        {session.isManager ? (
          <Avatar label="PM" from="#5b8cff" to="#7c5cff" size={28} star />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-line2 bg-soft text-[11px] font-bold text-dim">
            {session.name.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-semibold">{session.name}</span>
            <Chip tone={session.isManager ? 'accent' : 'dim'}>{session.role}</Chip>
            <StatusPill status={session.status} queuePos={session.queuePos} />
            {session.port && (
              <span className="flex items-center gap-1 rounded border border-ok/25 bg-ok/10 px-1.5 py-px font-mono text-[9.5px] text-ok">
                <span className="h-1 w-1 rounded-full bg-ok" /> localhost:{session.port}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-faint">
            <span className="flex items-center gap-0.5">
              <GitBranch size={9} />
              {session.branch || '—'}
            </span>
            <span className="truncate" title={session.worktree}>
              {session.worktree}
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[10px] text-faint">
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {session.status === 'queued' ? '排队中' : `${Math.floor(session.elapsed / 60)}m ${session.elapsed % 60}s`}
          </span>
          <span className={cn('font-medium', statusStyle[session.status].text)}>{statusStyle[session.status].label}</span>
          {usageDisplay !== 'tokens' && <span>${session.cost.toFixed(2)}</span>}
          {usageDisplay !== 'cost' && <span>{fmtTokens(session.tokens)} tok</span>}
          {session.status === 'running' || session.status === 'thinking' ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-6 items-center gap-1 rounded border border-err/30 px-2 text-[10.5px] text-err hover:bg-err/10"
            >
              <Square size={9} /> 停止
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleRuntime}
              className="flex h-6 items-center gap-1 rounded border border-line2 px-2 text-[10.5px] text-dim hover:bg-hover"
            >
              <Terminal size={10} /> 终端
            </button>
          )}
        </div>
      </div>

      {session.isManager && (
        <div className="flex shrink-0 items-center gap-2 border-b border-accent/15 bg-accent/[0.04] px-4 py-1.5 text-[10.5px] text-dim">
          <Sparkles size={12} className="text-accent2" />
          <span>项目经理已连接 MCP 工具：可以查看、新建、派发 Agent，或直接提交代码。派发卡片会展示理由与置信度。</span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[9.5px] text-faint">
            <span className="h-1 w-1 rounded-full bg-ok" />
            MCP 已连接 · 11 个工具
          </span>
        </div>
      )}

      {session.status === 'waiting_user' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warn/25 bg-warn/[0.07] px-4 py-2 text-[11px]">
          <HelpCircle size={13} className="shrink-0 text-warn" />
          <span className="shrink-0 font-medium text-warn">等待你确认</span>
          <span className="min-w-0 flex-1 truncate text-dim">{session.activity}</span>
          <button
            type="button"
            onClick={() => onResolve('confirm')}
            className="shrink-0 rounded border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10.5px] text-accent2 hover:bg-accent/25"
          >
            按页码条继续
          </button>
          <button
            type="button"
            onClick={() => onResolve('alt')}
            className="shrink-0 rounded border border-line2 px-2 py-0.5 text-[10.5px] text-dim hover:bg-soft"
          >
            改为加载更多
          </button>
        </div>
      )}

      {session.status === 'waiting_permission' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-pink/25 bg-pink/[0.06] px-4 py-2 text-[11px]">
          <Shield size={13} className="shrink-0 text-pink" />
          <span className="shrink-0 font-medium text-pink">需要授权</span>
          <code className="min-w-0 truncate rounded border border-pink/20 bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink/80">
            ALTER TABLE orders ADD INDEX idx_orders_created_status (created_at, status)
          </code>
          <span className="ml-auto flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => onResolve('approve')}
              className="rounded border border-pink/40 bg-pink/15 px-2 py-0.5 text-[10.5px] text-pink hover:bg-pink/25"
            >
              批准执行
            </button>
            <button
              type="button"
              onClick={() => onResolve('deny')}
              className="rounded border border-line2 px-2 py-0.5 text-[10.5px] text-dim hover:bg-soft"
            >
              拒绝
            </button>
          </span>
        </div>
      )}

      {/* 消息流 */}
      <div ref={scrollRef} className="stage-glow min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[960px] flex-col gap-3 px-5 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-line2 bg-soft">
                {session.status === 'queued' ? <Clock size={20} className="text-warn" /> : <Sparkles size={20} className="text-accent2" />}
              </div>
              <div className="text-[13px] font-medium text-ink">
                {session.status === 'queued' ? '排队中，当前回合结束后执行' : '还没有对话'}
              </div>
              <div className="mt-1 max-w-[340px] text-[11px] leading-relaxed text-faint">
                {session.status === 'queued'
                  ? '消息已排队，当前回合结束后会自动执行。'
                  : `这是「${session.name}」的独立会话，运行在 ${session.worktree}。`}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              m={m}
              session={session}
              sessions={project.sessions.filter((s) => !s.isManager)}
              onJump={onJump}
              onRetry={onRetry}
              onReassign={onReassign}
              onRevoke={onRevoke}
              usageDisplay={usageDisplay}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      </div>

      <Composer session={session} onSend={onSend} disabled={false} />
    </div>
  )
}
