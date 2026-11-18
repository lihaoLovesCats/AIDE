import { ExternalLink, GitBranch, Square, Terminal, X } from 'lucide-react'
import { useState } from 'react'
import type { ApiRun, ApiSystem } from './api'
import type { Session } from './types'
import { Chip, IconButton, cn } from './ui'

const ACTIVE = new Set(['starting', 'ready', 'running'])

const RUN_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  starting: { label: '启动中', cls: 'text-run', dot: 'bg-run' },
  ready: { label: '已就绪', cls: 'text-ok', dot: 'bg-ok' },
  running: { label: '运行中', cls: 'text-warn', dot: 'bg-warn' },
  error: { label: '错误', cls: 'text-err', dot: 'bg-err' },
  stopped: { label: '已停止', cls: 'text-faint', dot: 'bg-faint' },
}

export default function RuntimePanel({
  projectPath,
  sessions,
  runs,
  system,
  onStart,
  onStop,
  onNotify,
  onClose,
}: {
  projectPath: string
  sessions: Session[]
  runs: ApiRun[]
  system: ApiSystem | null
  onStart: (sessionId: string, port?: number) => Promise<void> | void
  onStop: (sessionId: string) => Promise<void> | void
  onNotify: (s: string) => void
  onClose: () => void
}) {
  const [ports, setPorts] = useState<Record<string, string>>({})
  const [openLog, setOpenLog] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const portMin = system?.ports.min ?? 18080
  const portMax = system?.ports.max ?? 18120
  const usedPct = system?.usedPct ?? 0
  const limitPct = system?.limitPct ?? 90
  const perRunPct = system?.perRunPct ?? 2
  const tight = Boolean(system) && usedPct + perRunPct > limitPct
  const activeCount = runs.filter((r) => ACTIVE.has(r.status)).length

  const latest = new Map<string, ApiRun>()
  for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) latest.set(run.sessionId, run)

  const start = async (sid: string) => {
    const raw = ports[sid]?.trim()
    const port = raw ? Number(raw) : undefined
    if (raw && (!Number.isInteger(port) || port! < portMin || port! > portMax)) {
      onNotify(`端口需在 ${portMin}–${portMax} 之间`)
      return
    }
    setBusy(sid)
    try {
      await onStart(sid, port)
    } finally {
      setBusy(null)
    }
  }

  const stop = async (sid: string) => {
    setBusy(sid)
    try {
      await onStop(sid)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-[280px] shrink-0 flex-col border-t border-line bg-base">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <Terminal size={12} className="text-accent2" />
        <span className="text-[11px] font-medium text-ink">运行与预览</span>
        <Chip tone="dim">
          端口 {portMin}–{portMax}
        </Chip>
        <Chip tone={activeCount ? 'ok' : 'dim'}>{activeCount ? `${activeCount} 个实例` : '未运行'}</Chip>

        <div className="ml-auto flex items-center gap-2 text-[9.5px]">
          <span className={tight ? 'text-warn' : 'text-faint'}>
            内存 {usedPct}%
          </span>
          <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-soft">
            <div
              className={cn('h-full rounded-full', tight ? 'bg-err' : usedPct > limitPct - 10 ? 'bg-warn' : 'bg-ok')}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
            <div
              className="absolute top-0 h-full w-px bg-ink/50"
              style={{ left: `${Math.min(100, limitPct)}%` }}
              title={`上限 ${limitPct}%`}
            />
          </div>
          <span className="text-faint">上限 {limitPct}%</span>
        </div>

        <IconButton title="关闭面板" onClick={onClose}>
          <X size={12} />
        </IconButton>
      </div>

      {tight && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warn/25 bg-warn/[0.06] px-3 py-1.5 text-[10.5px] text-warn">
          <span className="h-1.5 w-1.5 rounded-full bg-warn" />
          内存紧张：当前 {usedPct}%，再启动一个实例预计 {usedPct + perRunPct}%，超过 {limitPct}% 上限，已拒绝新实例。
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-[11px] text-faint">没有可运行的会话</div>
        )}
        {sessions.map((s) => {
          const run = latest.get(s.id)
          const active = Boolean(run && ACTIVE.has(run.status))
          const st = run ? RUN_STATUS[run.status] : null
          const isMain = s.worktree === projectPath
          return (
            <div key={s.id} data-session={s.id} className="border-b border-line/60">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-[150px] shrink-0 truncate text-[11px] text-ink" title={s.name}>
                  {s.name}
                </span>
                <span className="flex w-[120px] shrink-0 items-center gap-1 truncate font-mono text-[9px] text-faint">
                  <GitBranch size={9} />
                  {s.branch}
                </span>
                <span className="w-8 shrink-0 text-[9px] text-faint">{isMain ? '主' : 'WT'}</span>

                {active ? (
                  <span className="w-14 shrink-0 font-mono text-[10.5px] text-ink">{run!.port}</span>
                ) : (
                  <input
                    value={ports[s.id] ?? ''}
                    onChange={(e) => setPorts((p) => ({ ...p, [s.id]: e.target.value }))}
                    placeholder="自动"
                    inputMode="numeric"
                    className="h-6 w-14 rounded border border-line2 bg-sunken px-1.5 font-mono text-[10px] text-ink placeholder:text-faint/60 focus:border-accent/40"
                    title={`留空自动分配（${portMin}–${portMax}）`}
                  />
                )}

                <span className="flex w-16 shrink-0 items-center gap-1 text-[10px]">
                  {st ? (
                    <>
                      <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                      <span className={st.cls}>{st.label}</span>
                    </>
                  ) : (
                    <span className="text-faint">未启动</span>
                  )}
                </span>

                <span className="hidden min-w-0 flex-1 truncate font-mono text-[9px] text-faint lg:block" title={run?.command}>
                  {run?.command ?? '—'}
                </span>

                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {active ? (
                    <>
                      <button
                        type="button"
                        onClick={() => window.open(run!.url, '_blank', 'noopener')}
                        className="flex h-6 items-center gap-1 rounded border border-accent/35 bg-accent/10 px-2 text-[10px] text-accent2 hover:bg-accent/20"
                      >
                        <ExternalLink size={10} /> 预览
                      </button>
                      <button
                        type="button"
                        disabled={busy === s.id}
                        onClick={() => void stop(s.id)}
                        className="flex h-6 items-center gap-1 rounded border border-line2 px-2 text-[10px] text-dim hover:bg-soft disabled:opacity-50"
                      >
                        <Square size={9} /> 停止
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={tight || busy === s.id}
                      onClick={() => void start(s.id)}
                      className={cn(
                        'flex h-6 items-center gap-1 rounded px-2 text-[10px]',
                        tight
                          ? 'cursor-not-allowed border border-line bg-soft text-faint'
                          : 'bg-accent text-white hover:bg-accent2',
                      )}
                    >
                      {busy === s.id ? '启动中…' : '启动'}
                    </button>
                  )}
                  {run && (
                    <button
                      type="button"
                      onClick={() => setOpenLog(openLog === run.id ? null : run.id)}
                      className="h-6 rounded border border-line2 px-2 text-[10px] text-dim hover:bg-soft"
                    >
                      日志
                    </button>
                  )}
                </span>
              </div>

              {run?.error && (
                <div className="px-3 pb-1 text-[9.5px] text-err" title={run.error}>
                  {run.error}
                </div>
              )}

              {run && openLog === run.id && (
                <div className="max-h-[110px] overflow-auto border-t border-line/60 bg-sunken px-3 py-1.5 font-mono text-[9.5px] leading-[1.55] text-ink/70">
                  {run.logs.length === 0 ? (
                    <div className="text-faint">（暂无日志）</div>
                  ) : (
                    run.logs.slice(-80).map((line, i) => <div key={i}>{line}</div>)
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
