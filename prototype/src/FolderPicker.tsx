import { ArrowUp, Folder, HardDrive, Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type ApiBrowse } from './api'
import { Modal, ModalHeader, cn } from './ui'

export function FolderPicker({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean
  initialPath?: string
  onClose: () => void
  onSelect: (path: string) => void
}) {
  const [data, setData] = useState<ApiBrowse | null>(null)
  const [manual, setManual] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const d = await api.fsList(path)
      setData(d)
      setManual(d.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPath])

  return createPortal(
    <Modal open={open} onClose={onClose} width={680}>
      <ModalHeader
        title="选择项目文件夹"
        subtitle="浏览本机目录，支持任意文件夹（Git 可选）"
        icon={<Folder size={15} />}
        onClose={onClose}
      />

      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
        <button
          type="button"
          onClick={() => data?.parent && void load(data.parent)}
          disabled={!data?.parent || loading}
          className="flex h-7 w-7 items-center justify-center rounded border border-line2 text-dim hover:bg-soft disabled:opacity-40"
          title="上一级"
        >
          <ArrowUp size={12} />
        </button>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(manual)
          }}
          className="h-7 min-w-0 flex-1 rounded border border-line2 bg-sunken px-2 font-mono text-[10.5px] text-ink focus:border-accent/40"
          placeholder="输入路径后回车"
        />
        <button
          type="button"
          onClick={() => void load(manual)}
          disabled={loading}
          className="flex h-7 w-7 items-center justify-center rounded border border-line2 text-dim hover:bg-soft disabled:opacity-40"
          title="刷新"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5 no-scrollbar">
        {(data?.roots ?? []).map((r) => (
          <button
            key={r.path}
            type="button"
            onClick={() => void load(r.path)}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1 rounded border px-2 text-[10px]',
              data?.path === r.path
                ? 'border-accent/45 bg-accent/[0.08] text-ink'
                : 'border-line text-dim hover:bg-soft',
            )}
          >
            <HardDrive size={10} />
            {r.name}
          </button>
        ))}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">{data?.entries.length ?? 0} 个文件夹</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="m-3 rounded border border-warn/30 bg-warn/[0.06] px-3 py-2 text-[10.5px] text-warn">
            {error}
          </div>
        ) : loading && !data ? (
          <div className="flex items-center gap-2 px-4 py-6 text-[11px] text-faint">
            <Loader2 size={12} className="animate-spin" /> 正在读取目录…
          </div>
        ) : (
          <div className="py-1">
            {data?.entries.length === 0 && (
              <div className="px-4 py-6 text-center text-[10.5px] text-faint">这个目录下没有子文件夹</div>
            )}
            {data?.entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => void load(e.path)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-soft"
              >
                <Folder size={13} className="shrink-0 text-accent2/80" />
                <span className="truncate text-[11.5px] text-ink/90">{e.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-faint" title={data?.path}>
          {data?.path ?? '—'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-line2 px-3 text-[11px] text-dim hover:bg-soft"
        >
          取消
        </button>
        <button
          type="button"
          disabled={!data}
          onClick={() => {
            if (data) onSelect(data.path)
            onClose()
          }}
          className="h-7 rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent2 disabled:opacity-50"
        >
          选择此文件夹
        </button>
      </div>
    </Modal>,
    document.body,
  )
}
