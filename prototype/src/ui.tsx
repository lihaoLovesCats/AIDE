import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import type { Status } from './types'

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export const statusStyle: Record<Status, { dot: string; text: string; chip: string; label: string }> = {
  starting: { dot: 'bg-run', text: 'text-run', chip: 'bg-run/12 text-run border-run/25', label: '启动中' },
  running: { dot: 'bg-run', text: 'text-run', chip: 'bg-run/12 text-run border-run/25', label: '运行中' },
  thinking: { dot: 'bg-violet', text: 'text-violet', chip: 'bg-violet/12 text-violet border-violet/25', label: '思考中' },
  idle: { dot: 'bg-faint', text: 'text-dim', chip: 'bg-soft text-dim border-line2', label: '空闲' },
  queued: { dot: 'bg-warn', text: 'text-warn', chip: 'bg-warn/10 text-warn border-warn/25', label: '排队中' },
  error: { dot: 'bg-err', text: 'text-err', chip: 'bg-err/10 text-err border-err/25', label: '异常' },
  stopped: { dot: 'bg-faint', text: 'text-faint', chip: 'bg-soft text-faint border-line2', label: '已停止' },
  waiting_user: { dot: 'bg-warn', text: 'text-warn', chip: 'bg-warn/12 text-warn border-warn/30', label: '等待确认' },
  waiting_permission: { dot: 'bg-pink', text: 'text-pink', chip: 'bg-pink/12 text-pink border-pink/30', label: '等待授权' },
}

export function StatusDot({ status, size = 7, pulse = true }: { status: Status; size?: number; pulse?: boolean }) {
  const s = statusStyle[status]
  const animated = pulse && (status === 'running' || status === 'thinking' || status === 'starting')
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size + 4, height: size + 4 }}>
      <span
        className={cn('rounded-full', s.dot, animated && 'pulse-dot')}
        style={{ width: size, height: size }}
      />
    </span>
  )
}

export function StatusPill({ status, queuePos }: { status: Status; queuePos?: number }) {
  const s = statusStyle[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] font-medium', s.chip)}>
      <span className={cn('h-1 w-1 rounded-full', s.dot)} />
      {s.label}
      {status === 'queued' && queuePos ? ` ${queuePos}` : ''}
    </span>
  )
}

export function Chip({
  children,
  tone = 'dim',
  className,
}: {
  children: ReactNode
  tone?: 'dim' | 'accent' | 'ok' | 'warn' | 'err' | 'violet' | 'run' | 'pink'
  className?: string
}) {
  const tones: Record<string, string> = {
    dim: 'border-line2 bg-soft text-dim',
    accent: 'border-accent/25 bg-accent/10 text-accent2',
    ok: 'border-ok/25 bg-ok/10 text-ok',
    warn: 'border-warn/25 bg-warn/10 text-warn',
    err: 'border-err/25 bg-err/10 text-err',
    violet: 'border-violet/25 bg-violet/10 text-violet',
    run: 'border-run/25 bg-run/10 text-run',
    pink: 'border-pink/25 bg-pink/10 text-pink',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[10px] leading-4', tones[tone], className)}>
      {children}
    </span>
  )
}

export function IconButton({
  children,
  onClick,
  title,
  active,
  className,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  active?: boolean
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-dim transition-colors',
        'hover:bg-hover hover:text-ink',
        active && 'bg-hover text-ink',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Modal({
  open,
  onClose,
  children,
  width = 720,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="pop-in relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-line2 bg-panel2 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.9)]"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  )
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  onClose: () => void
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 py-4">
      {icon && <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-soft text-accent2">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 text-[11px] text-faint">{subtitle}</div>}
      </div>
      <IconButton onClick={onClose} title="关闭">
        <X size={15} />
      </IconButton>
    </div>
  )
}

export function Avatar({
  label,
  from,
  to,
  size = 32,
  star,
}: {
  label: string
  from: string
  to: string
  size?: number
  star?: boolean
}) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-lg font-semibold text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        letterSpacing: '-0.02em',
      }}
    >
      {label}
      {star && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-panel2 bg-warn text-[8px] text-black">
          ★
        </span>
      )}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border border-line2 bg-soft px-1 font-sans text-[10px] text-faint">
      {children}
    </kbd>
  )
}

export function SectionHeader({
  icon,
  title,
  count,
  open,
  onToggle,
  actions,
  actionsVisible,
}: {
  icon: ReactNode
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  actionsVisible?: boolean
}) {
  return (
    <div className="group flex h-8 items-center gap-1.5 px-2">
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={cn('shrink-0 text-faint transition-transform', !open && '-rotate-90')}
        >
          <path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className="text-faint">{icon}</span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-dim">{title}</span>
        {typeof count === 'number' && (
          <span className="rounded bg-hover px-1 text-[10px] leading-4 text-faint">{count}</span>
        )}
      </button>
      {actions && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition-opacity',
            actionsVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
