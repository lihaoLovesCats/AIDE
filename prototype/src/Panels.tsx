import { AlertTriangle, CircleDot, Copy, FileDiff, FileText, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Project } from './types'
import { Chip, IconButton, cn } from './ui'

/* ------------------------------------------------------------------ */
/* 右侧检查器：只读文件 / 差异（接真实后端）                            */
/* ------------------------------------------------------------------ */

export function Inspector({
  projectId,
  file,
  onClose,
  onNotify,
}: {
  projectId: string
  file: string
  onClose: () => void
  onNotify: (s: string) => void
}) {
  const [mode, setMode] = useState<'preview' | 'diff'>('preview')
  const [content, setContent] = useState('')
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const name = file.split('/').pop() || file

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setContent('')
    api
      .file(projectId, file)
      .then((r) => {
        if (alive) setContent(r.content)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [projectId, file])

  useEffect(() => {
    setDiff('')
    if (mode !== 'diff') return
    let alive = true
    api
      .gitDiff(projectId, file)
      .then((r) => {
        if (alive) setDiff(r.diff ?? '')
      })
      .catch(() => {
        if (alive) setDiff('')
      })
    return () => {
      alive = false
    }
  }, [mode, projectId, file])

  const lines = content.replace(/\n$/, '').split('\n')
  const eol = content.includes('\r\n') ? 'CRLF' : 'LF'

  return (
    <aside className="slide-in-right flex w-[440px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <FileText size={13} className="text-accent2" />
        <span className="truncate text-[11.5px] font-medium" title={file}>
          {name}
        </span>
        <Chip tone="dim">只读</Chip>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onNotify('路径已复制')}
            className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink"
            title="复制路径"
          >
            <Copy size={11} />
          </button>
          <IconButton onClick={onClose} title="关闭">
            <X size={13} />
          </IconButton>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
        {(
          [
            ['preview', '预览', FileText],
            ['diff', '差异', FileDiff],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              'flex h-6 items-center gap-1 rounded px-2 text-[10.5px] transition-colors',
              mode === id ? 'bg-hover text-ink' : 'text-faint hover:text-dim',
            )}
          >
            <Icon size={11} />
            {label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 font-mono text-[9px] text-faint">
          <span className="max-w-[210px] truncate" title={file}>
            {file}
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-faint">
            <Loader2 size={12} className="animate-spin" /> 加载中…
          </div>
        ) : error ? (
          <div className="m-3 flex items-start gap-2 rounded border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[11px] text-warn">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : mode === 'preview' ? (
          <div className="py-2">
            {lines.map((line, i) => (
              <div key={i} className="flex font-mono text-[11px] leading-[1.7] hover:bg-soft">
                <span className="w-10 shrink-0 select-none pr-3 text-right text-[9.5px] text-faint/60">{i + 1}</span>
                <span className="whitespace-pre pr-3 text-ink/80">{line || ' '}</span>
              </div>
            ))}
          </div>
        ) : diff ? (
          <div className="py-2">
            {diff.split('\n').map((line, i) => {
              const kind = line.startsWith('+++') || line.startsWith('---')
                ? 'meta'
                : line.startsWith('@@')
                  ? 'hunk'
                  : line.startsWith('+')
                    ? 'add'
                    : line.startsWith('-')
                      ? 'del'
                      : 'ctx'
              return (
                <div
                  key={i}
                  className={cn(
                    'flex whitespace-pre px-3 font-mono text-[10.5px] leading-[1.7]',
                    kind === 'add' && 'bg-ok/[0.07] text-ok/90',
                    kind === 'del' && 'bg-err/[0.07] text-err/85',
                    kind === 'hunk' && 'text-violet/80',
                    kind === 'meta' && 'text-faint',
                    kind === 'ctx' && 'text-ink/70',
                  )}
                >
                  {line || ' '}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileDiff size={20} className="mb-2 text-faint" />
            <div className="text-[11.5px] text-dim">没有未提交的差异</div>
            <div className="mt-1 text-[10px] text-faint">该文件与 HEAD 一致，或尚未被 git 跟踪</div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[9.5px] text-faint">
        <span className="flex items-center gap-1">
          <CircleDot size={9} />
          UTF-8
        </span>
        <span>{eol}</span>
        <span className="ml-auto">{mode === 'diff' ? 'git diff' : `${lines.length} 行 · 只读`}</span>
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* 底部状态栏                                                          */
/* ------------------------------------------------------------------ */

export function StatusBar({
  project,
  cost,
  tokens,
  usageDisplay,
  connected,
  claude,
}: {
  project: Project | null
  cost: number
  tokens: number
  usageDisplay: 'both' | 'cost' | 'tokens'
  connected: boolean
  claude: string | null
}) {
  const tok = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  const usage =
    usageDisplay === 'tokens'
      ? `今日 ${tok} tokens`
      : usageDisplay === 'cost'
        ? `今日 $${cost.toFixed(2)}`
        : `今日 $${cost.toFixed(2)} · ${tok} tokens`
  return (
    <div className="flex h-[24px] shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[10px] text-faint">
      <span className="flex items-center gap-1 text-accent2/80">AIDE</span>
      {project && (
        <>
          <span className="flex items-center gap-1">{project.branch}</span>
          <span className="flex items-center gap-1">
            <CircleDot size={9} />
            {project.sessions.length} 会话
          </span>
          <span className="hidden items-center gap-1 md:flex">
            <FileText size={9} />
            {project.changes.length} 变更
          </span>
        </>
      )}
      <span className="ml-auto flex items-center gap-3 font-mono">
        <span>{usage}</span>
        {claude && <span className="hidden lg:inline">{claude.split(' ')[0]}</span>}
        <span className={cn('flex items-center gap-1', connected ? 'text-ok' : 'text-err')}>
          <span className={cn('h-1 w-1 rounded-full', connected ? 'bg-ok' : 'bg-err')} />
          {connected ? '后端已连接' : '后端已断开'}
        </span>
        <span className="hidden xl:inline">Node 24 · SQLite</span>
      </span>
    </div>
  )
}
