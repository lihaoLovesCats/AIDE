import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitMerge,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Commit, FileNode, Project, Session } from './types'
import { Avatar, Chip, IconButton, Modal, ModalHeader, SectionHeader, StatusDot, StatusPill, cn } from './ui'

/* ------------------------------------------------------------------ */

export function initials(name: string) {
  const parts = name.split(/[-_.]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function fmtDur(sec: number) {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/* ------------------------------------------------------------------ */

function ProjectRail({
  projects,
  activeId,
  onSelect,
  onAdd,
  onOpenAppSettings,
  onDelete,
}: {
  projects: Project[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onOpenAppSettings: () => void
  onDelete: (p: Project) => void
}) {
  const [menu, setMenu] = useState<{ p: Project; x: number; y: number } | null>(null)
  return (
    <div className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3">
      <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg border border-line2 bg-soft text-faint">
        <SquareTerminal size={15} />
      </div>
      <div className="mb-1 h-px w-6 bg-line" />
      {projects.map((p) => {
        const running = p.sessions.filter((s) => s.status === 'running' || s.status === 'thinking').length
        const active = p.id === activeId
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onSelect(p.id)
              setMenu({
                p,
                x: Math.min(e.clientX, window.innerWidth - 176),
                y: Math.min(e.clientY, window.innerHeight - 72),
              })
            }}
            className={cn(
              'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-transform',
              'hover:scale-[1.04] active:scale-[0.98]',
              active && 'ring-2 ring-accent/70 ring-offset-2 ring-offset-panel',
            )}
          >
            <span
              className={cn('absolute inset-0 rounded-xl opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]', !active && 'opacity-70 group-hover:opacity-90')}
              style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color2})` }}
            />
            <span className="relative z-10 text-[13px] font-bold tracking-wide text-white">{initials(p.name)}</span>
            {running > 0 && (
              <span className="absolute -right-1 -top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-panel bg-run px-1 text-[9px] font-bold text-black">
                {running}
              </span>
            )}
            {p.dirty && <span className="absolute -bottom-0.5 -right-0.5 z-20 h-2.5 w-2.5 rounded-full bg-warn ring-2 ring-panel" />}
            {active && <span className="absolute -left-[11px] h-6 w-[3px] rounded-r bg-accent" />}
            <span className="pointer-events-none absolute left-[54px] z-50 whitespace-nowrap rounded-md border border-line2 bg-panel2 px-2 py-1 text-[11px] text-ink opacity-0 shadow-2xl transition-opacity delay-500 group-hover:opacity-100">
              {p.name}
              <span className="ml-1.5 text-faint">{p.sessions.length} Agent</span>
            </span>
          </button>
        )
      })}

      <button
        type="button"
        onClick={onAdd}
        className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl border border-dashed border-line2 text-faint transition-colors hover:border-accent/40 hover:text-accent2"
        title="注册本地项目"
      >
        <Plus size={16} />
      </button>

      <div className="mt-auto flex flex-col items-center gap-1">
        <IconButton title="设置" onClick={onOpenAppSettings}>
          <Settings size={15} />
        </IconButton>
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-[70] w-40 overflow-hidden rounded-lg border border-line2 bg-panel2 py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <div className="truncate px-2 py-1 text-[9px] text-faint">{menu.p.name}</div>
            <button
              type="button"
              onClick={() => {
                onDelete(menu.p)
                setMenu(null)
              }}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] text-err hover:bg-err/10"
            >
              <Trash2 size={11} /> 删除项目
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function hasChanged(n: FileNode): boolean {
  return n.type === 'file' ? Boolean(n.status) : (n.children ?? []).some(hasChanged)
}

function collectDefaultExpanded(nodes: FileNode[], parent = '', depth = 0, acc = new Set<string>()) {
  for (const n of nodes) {
    const key = parent ? `${parent}/${n.name}` : n.name
    if (n.type === 'dir') {
      // 展开前三层（跳过隐藏目录与 test），并自动展开含改动文件的分支
      const auto = depth <= 3 && !n.name.startsWith('.') && n.name !== 'test'
      if (auto || hasChanged(n)) acc.add(key)
      if (n.children) collectDefaultExpanded(n.children, key, depth + 1, acc)
    }
  }
  return acc
}

const extColor: Record<string, string> = {
  java: '#e3b341',
  xml: '#8fb0ff',
  yml: '#3fb950',
  yaml: '#3fb950',
  md: '#8c98a5',
  properties: '#3fb950',
  html: '#f97316',
  css: '#58a6ff',
  js: '#e3b341',
}

function fileIcon(name: string) {
  const ext = name.split('.').pop() || ''
  const color = extColor[ext] ?? '#8c98a5'
  if (ext === 'java' || ext === 'xml' || ext === 'json') return <FileCode2 size={13} style={{ color }} />
  return <FileText size={13} style={{ color: extColor[ext] ?? '#7d8894' }} />
}

const statusLetter: Record<string, { ch: string; cls: string }> = {
  M: { ch: 'M', cls: 'text-warn' },
  A: { ch: 'A', cls: 'text-ok' },
  D: { ch: 'D', cls: 'text-err' },
  U: { ch: 'U', cls: 'text-run' },
}

function TreeRow({
  node,
  path,
  depth,
  expanded,
  toggle,
  onOpenFile,
}: {
  node: FileNode
  path: string
  depth: number
  expanded: Set<string>
  toggle: (p: string) => void
  onOpenFile: (p: string) => void
}) {
  const isDir = node.type === 'dir'
  const open = expanded.has(path)
  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? toggle(path) : onOpenFile(path))}
        className={cn(
          'group flex h-[22px] w-full items-center gap-1 pr-2 text-left text-[12px] transition-colors hover:bg-hover',
          !isDir && 'text-ink/90',
        )}
        style={{ paddingLeft: 6 + depth * 13 }}
        title={path}
      >
        {isDir ? (
          <>
            <ChevronRight size={11} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
            {open ? <FolderOpen size={13} className="shrink-0 text-accent/80" /> : <Folder size={13} className="shrink-0 text-faint" />}
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" />
            {fileIcon(node.name)}
          </>
        )}
        <span className={cn('truncate', node.status && 'text-ink')}>{node.name}</span>
        {node.status && (
          <span className={cn('ml-auto shrink-0 font-mono text-[10px] font-semibold', statusLetter[node.status]?.cls)}>
            {statusLetter[node.status]?.ch}
          </span>
        )}
      </button>
      {isDir && open && node.children?.map((c) => (
        <TreeRow
          key={c.name}
          node={c}
          path={`${path}/${c.name}`}
          depth={depth + 1}
          expanded={expanded}
          toggle={toggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  )
}

const FILE_EXT = /\.(java|xml|yml|yaml|properties|md|json|html|css|js|ts|txt)$/i

/** 目录名里的包路径（com.acme.order）在打开文件时还原成真实路径 */
function normalizePath(p: string) {
  return p
    .split('/')
    .map((seg) => (seg.includes('.') && !FILE_EXT.test(seg) ? seg.split('.').join('/') : seg))
    .join('/')
}

function FileTree({
  nodes,
  onOpenFile,
  projectId,
}: {
  nodes: FileNode[]
  onOpenFile: (p: string) => void
  projectId: string
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => collectDefaultExpanded(nodes))
  useEffect(() => {
    setExpanded(collectDefaultExpanded(nodes))
  }, [projectId, nodes])

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })

  return (
    <div className="fade-bottom min-h-0 flex-1 overflow-auto pb-1">
      {nodes.map((n) => (
        <TreeRow
          key={n.name}
          node={n}
          path={n.name}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          onOpenFile={(p) => onOpenFile(normalizePath(p))}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function SessionRow({
  s,
  active,
  onSelect,
  onStop,
}: {
  s: Session
  active: boolean
  onSelect: () => void
  onStop: () => void
}) {
  const running = s.status === 'running' || s.status === 'thinking'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={cn(
        'group relative mx-1.5 mb-px cursor-pointer rounded-md border border-transparent px-2 py-[2px] transition-colors',
        active ? 'border-line2 bg-hover' : 'hover:bg-soft',
      )}
    >
      {active && <span className="absolute -left-0.5 top-2 bottom-2 w-[2px] rounded bg-accent" />}
      <div className="flex items-center gap-1.5">
        <StatusDot status={s.status} />
        <span className={cn('truncate text-[12px] font-medium', active ? 'text-ink' : 'text-ink/85')}>{s.name}</span>
        <Chip tone="dim" className="shrink-0">
          {s.role}
        </Chip>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-faint">
          {s.status === 'queued' ? `#${s.queuePos ?? '–'}` : fmtDur(s.elapsed)}
        </span>
        {running && (
          <button
            type="button"
            title="停止会话"
            onClick={(e) => {
              e.stopPropagation()
              onStop()
            }}
            className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-faint hover:bg-err/15 hover:text-err group-hover:flex"
          >
            <Square size={9} />
          </button>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-[15px]">
        <span
          className={cn(
            'truncate text-[10.5px]',
            s.status === 'error' ? 'text-err/90' : s.status === 'queued' ? 'text-warn/80' : 'text-faint',
          )}
          title={s.activity}
        >
          {s.activity}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-faint/75">
          <span className="flex items-center gap-0.5">
            <GitBranch size={8} />
            {s.branch}
          </span>
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function CommitRow({ c }: { c: Commit }) {
  const toneColor: Record<string, string> = {
    accent: '#5b8cff',
    ok: '#3fb950',
    warn: '#e3b341',
    err: '#ff6b6b',
    violet: '#a78bfa',
    run: '#58a6ff',
    dim: '#5c6874',
    pink: '#f472b6',
  }
  const color = toneColor[c.tone] ?? '#5c6874'
  return (
    <div className="group relative flex gap-2 px-2 py-[5px] hover:bg-soft">
      <div className="relative w-5 shrink-0 self-stretch">
        <span className="absolute bottom-0 left-[7px] top-0 w-px bg-line" />
        <span
          className="absolute left-[3px] top-[5px] h-[9px] w-[9px] rounded-full border-2 bg-panel"
          style={{ borderColor: color }}
        />
        {c.merge && <span className="absolute left-[11px] top-[9px] h-px w-2" style={{ background: color }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11.5px] text-ink/90">{c.msg}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-faint">
          <span className="font-mono">{c.sha}</span>
          <span>·</span>
          <span>{c.meta}</span>
          <span className="ml-auto shrink-0">{c.time}</span>
        </div>
        {c.refs && (
          <div className="mt-1 flex flex-wrap gap-1">
            {c.refs.map((r) => (
              <span
                key={r}
                className="rounded border px-1 py-px font-mono text-[9px]"
                style={{ borderColor: `${color}55`, color, background: `${color}14` }}
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Splitter({
  onDown,
  onMove,
  onUp,
  onReset,
}: {
  onDown: (e: RPointerEvent<HTMLDivElement>) => void
  onMove: (e: RPointerEvent<HTMLDivElement>) => void
  onUp: (e: RPointerEvent<HTMLDivElement>) => void
  onReset: () => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onReset}
      title="拖拽调整高度，双击复位"
      className="group relative z-10 h-[6px] shrink-0 cursor-row-resize touch-none select-none"
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line transition-colors group-hover:bg-accent/60" />
      <div className="absolute left-1/2 top-1/2 h-[2px] w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line2 opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}

/* ------------------------------------------------------------------ */

export default function SidePanel({
  project,
  projects,
  activeSessionId,
  onSelectProject,
  onSelectSession,
  onOpenFile,
  onNewAgent,
  onCommit,
  onStopSession,
  onAddProject,
  onOpenBranches,
  onNotify,
  commitChanges,
  commitBranch,
  onRefresh,
  onOpenSettings,
  onOpenAppSettings,
  onDeleteProject,
}: {
  project: Project
  projects: Project[]
  activeSessionId: string
  onSelectProject: (id: string) => void
  onSelectSession: (id: string) => void
  onOpenFile: (p: string) => void
  onNewAgent: () => void
  onCommit: () => void
  onStopSession: (id: string) => void
  onAddProject: () => void
  onOpenBranches: () => void
  onNotify: (text: string) => void
  commitChanges: number
  commitBranch: string
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenAppSettings: () => void
  onDeleteProject: (id: string) => Promise<void>
}) {
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openFiles, setOpenFiles] = useState(true)
  const [openSessions, setOpenSessions] = useState(true)
  const [openGit, setOpenGit] = useState(true)

  const [sizes, setSizes] = useState<number[]>([0.3, 0.42, 0.28])
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ index: number; startY: number; startSizes: number[] } | null>(null)

  const startDrag = (index: number) => (e: RPointerEvent<HTMLDivElement>) => {
    const open = [openFiles, openSessions, openGit]
    if (!open[index] || !open[index + 1]) return
    e.preventDefault()
    dragRef.current = { index, startY: e.clientY, startSizes: [...sizes] }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: RPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const h = bodyRef.current?.clientHeight ?? 1
    const delta = (e.clientY - d.startY) / h
    const a = d.startSizes[d.index]
    const b = d.startSizes[d.index + 1]
    const total = a + b
    const min = 0.14
    const nextA = Math.min(Math.max(a + delta, min), total - min)
    setSizes((prev) => {
      const next = [...prev]
      next[d.index] = nextA
      next[d.index + 1] = total - nextA
      return next
    })
  }

  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const rows = [
    openFiles ? `${sizes[0]}fr` : 'auto',
    '6px',
    openSessions ? `${sizes[1]}fr` : 'auto',
    '6px',
    openGit ? `${sizes[2]}fr` : 'auto',
  ].join(' ')

  const manager = project.sessions.find((s) => s.isManager)
  const workers = project.sessions.filter((s) => !s.isManager)
  const totalAdd = project.changes.reduce((a, c) => a + c.add, 0)
  const totalDel = project.changes.reduce((a, c) => a + c.del, 0)
  const running = project.sessions.filter((s) => s.status === 'running' || s.status === 'thinking').length
  const isGit = project.vcs === 'git'
  const isSvn = project.vcs === 'svn'
  const hasVcs = project.vcs !== 'none'

  const fileCount = useMemo(() => {
    const walk = (ns: FileNode[]): number => ns.reduce((a, n) => a + (n.type === 'file' ? 1 : walk(n.children ?? [])), 0)
    return walk(project.tree)
  }, [project.tree])

  return (
    <div className="flex h-full min-h-0 shrink-0">
      <ProjectRail
        projects={projects}
        activeId={project.id}
        onSelect={onSelectProject}
        onAdd={onAddProject}
        onOpenAppSettings={onOpenAppSettings}
        onDelete={(p) => setDeleteTarget(p)}
      />

      <div className="flex w-[326px] shrink-0 flex-col border-r border-line bg-panel">
        {/* 项目头 */}
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
          <Avatar label={initials(project.name)} from={project.color} to={project.color2} size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-semibold text-ink">{project.name}</span>
              <span className="rounded border border-line2 bg-soft px-1 text-[9px] text-faint" title={project.stack}>
                {project.stack.split(' · ')[0]}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-faint" title={project.path}>
              <GitBranch size={9} />
              <span className="font-mono">{project.branch}</span>
              <span className="flex items-center gap-0.5 text-ok">
                <ArrowUp size={8} />
                {project.ahead}
              </span>
              {project.behind > 0 && (
                <span className="flex items-center gap-0.5 text-warn">
                  <ArrowDown size={8} />
                  {project.behind}
                </span>
              )}
              {running > 0 && (
                <span className="ml-auto flex items-center gap-1 text-run">
                  <span className="h-1 w-1 rounded-full bg-run pulse-dot" />
                  {running} 运行
                </span>
              )}
            </div>
          </div>
          <IconButton title="项目知识" onClick={onOpenSettings}>
            <BookOpen size={13} />
          </IconButton>
          <IconButton title="项目设置" onClick={onOpenSettings}>
            <Settings2 size={13} />
          </IconButton>
          <IconButton title="刷新项目" onClick={onRefresh}>
            <RefreshCw size={13} />
          </IconButton>
        </div>

        <div
          ref={bodyRef}
          className={cn('grid min-h-0 flex-1 overflow-hidden', dragging && 'cursor-row-resize select-none')}
          style={{ gridTemplateRows: rows }}
        >
          {/* 文件 */}
          <section className="flex min-h-0 flex-col overflow-hidden">
            <SectionHeader
              icon={<Folder size={12} />}
              title="文件"
              count={fileCount}
              open={openFiles}
              onToggle={() => setOpenFiles((v) => !v)}
              actions={<IconButton title="全部折叠" onClick={() => onNotify('已折叠全部目录')}><ChevronRight size={12} /></IconButton>}
            />
            {openFiles && <FileTree nodes={project.tree} onOpenFile={onOpenFile} projectId={project.id} />}
          </section>

          <Splitter
            onDown={startDrag(0)}
            onMove={moveDrag}
            onUp={endDrag}
            onReset={() => setSizes([0.3, 0.42, 0.28])}
          />

          {/* 会话 */}
          <section className="flex min-h-0 flex-col overflow-hidden">
            <SectionHeader
              icon={<Sparkles size={12} />}
              title="AGENT 会话"
              count={project.sessions.length}
              open={openSessions}
              onToggle={() => setOpenSessions((v) => !v)}
              actionsVisible
              actions={
                <button
                  type="button"
                  onClick={onNewAgent}
                  className="flex h-6 items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 text-[10.5px] text-accent2 transition-colors hover:bg-accent/20"
                >
                  <Plus size={11} /> 新建
                </button>
              }
            />
            {openSessions && (
              <>
                <div className="fade-bottom min-h-0 flex-1 overflow-auto">
                  {manager && (
                    <button
                      type="button"
                      onClick={() => onSelectSession(manager.id)}
                      className={cn(
                        'group mx-1.5 mb-0.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors',
                        activeSessionId === manager.id
                          ? 'border-accent/40 bg-accent/[0.09]'
                          : 'border-line2/70 bg-gradient-to-r from-accent/[0.06] to-transparent hover:border-accent/30',
                      )}
                    >
                      <Avatar label="PM" from="#5b8cff" to="#7c5cff" size={24} star />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-semibold text-ink">{manager.name}</span>
                          <span className="rounded border border-accent/30 bg-accent/10 px-1 text-[9px] text-accent2">AI 路由</span>
                          <span className="ml-auto">
                            <StatusPill status={manager.status} />
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-faint">{manager.activity}</div>
                      </div>
                    </button>
                  )}
                  <div className="mt-0.5 border-t border-line/50 pt-0.5">
                    {workers.map((s) => (
                      <SessionRow
                        key={s.id}
                        s={s}
                        active={activeSessionId === s.id}
                        onSelect={() => onSelectSession(s.id)}
                        onStop={() => onStopSession(s.id)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>

          <Splitter
            onDown={startDrag(1)}
            onMove={moveDrag}
            onUp={endDrag}
            onReset={() => setSizes([0.3, 0.42, 0.28])}
          />

          {/* VCS */}
          <section className="flex min-h-0 flex-col overflow-hidden">
            <SectionHeader
              icon={<GitBranch size={12} />}
              title={isSvn ? 'SVN' : 'GIT'}
              open={openGit}
              onToggle={() => setOpenGit((v) => !v)}
              actionsVisible
              actions={
                isGit ? (
                  <>
                    <button
                      type="button"
                      onClick={onOpenBranches}
                      className="flex h-6 items-center gap-1 rounded border border-line2 px-1.5 text-[10px] text-dim transition-colors hover:border-accent/30 hover:text-accent2"
                    >
                      <GitMerge size={10} /> 分支 {project.branches.length}
                    </button>
                    <IconButton title="刷新 Git" onClick={onRefresh}>
                      <RefreshCw size={11} />
                    </IconButton>
                  </>
                ) : isSvn ? (
                  <>
                    <span className="rounded border border-line2 bg-soft px-1.5 text-[9px] text-faint">SVN</span>
                    <IconButton title="刷新 SVN" onClick={onRefresh}>
                      <RefreshCw size={11} />
                    </IconButton>
                  </>
                ) : (
                  <span className="text-[9.5px] text-faint">无版本控制</span>
                )
              }
            />
            {openGit && (
              <>
                <div className="shrink-0 px-1.5">
                  <button
                    type="button"
                    onClick={isGit ? onOpenBranches : undefined}
                    disabled={!isGit}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border border-line bg-panel2/60 px-2 py-1.5 text-left transition-colors',
                      isGit ? 'hover:border-line2' : 'cursor-default',
                    )}
                    title={isGit ? '打开分支与合并面板' : isSvn ? 'SVN 工作副本（分支由服务端路径管理）' : '无版本控制'}
                  >
                    <GitBranch size={12} className={hasVcs ? 'text-accent2' : 'text-faint'} />
                    <span className="truncate font-mono text-[11px] text-ink">
                      {hasVcs ? project.branch || (isSvn ? 'svn' : 'main') : '无版本控制'}
                    </span>
                    {isGit && (
                      <>
                        <span className="flex items-center gap-0.5 text-[10px] text-ok">
                          <ArrowUp size={9} />
                          {project.ahead}
                        </span>
                        <span className="ml-auto font-mono text-[10px]">
                          <span className="text-ok">+{totalAdd}</span> <span className="text-err">−{totalDel}</span>
                        </span>
                      </>
                    )}
                    {isSvn && (
                      <span className="ml-auto rounded bg-soft px-1 text-[9px] text-faint">working copy</span>
                    )}
                    {isGit && <ChevronRight size={10} className="ml-auto text-faint" />}
                  </button>
                  <button
                    type="button"
                    onClick={hasVcs ? onCommit : undefined}
                    disabled={!hasVcs}
                    className={cn(
                      'mt-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left',
                      hasVcs ? 'hover:bg-soft' : 'cursor-default',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        !hasVcs ? 'bg-faint' : commitChanges ? 'bg-warn' : 'bg-ok',
                      )}
                    />
                    <span className="truncate text-[10.5px] text-dim">
                      {hasVcs
                        ? commitChanges
                          ? `${commitChanges} 个未提交更改`
                          : '工作区干净'
                        : '不支持提交'}
                      <span className="ml-1 font-mono text-[9px] text-faint">{hasVcs ? commitBranch : ''}</span>
                    </span>
                    {hasVcs && <ChevronRight size={10} className="ml-auto text-faint" />}
                  </button>
                </div>

                <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line/70">
                  <div className="fade-bottom min-h-0 flex-1 overflow-auto">
                    {hasVcs &&
                      project.commits.map((c) => <CommitRow key={c.sha} c={c} />)}
                  </div>
                </div>

                <div className="shrink-0 border-t border-line p-2">
                  <button
                    type="button"
                    onClick={onCommit}
                    disabled={!hasVcs || commitChanges === 0}
                    className={cn(
                      'flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[12px] font-medium transition-all',
                      hasVcs && commitChanges
                        ? 'bg-accent text-white shadow-[0_2px_12px_-2px_rgba(91,140,255,0.7)] hover:bg-accent2 hover:text-white'
                        : 'cursor-not-allowed bg-soft text-faint',
                    )}
                  >
                    <GitCommit size={13} />
                    {isSvn ? '提交到 SVN' : isGit ? '一键提交并推送' : '无版本控制'}
                    {hasVcs && commitChanges > 0 && (
                      <span className="rounded bg-sunken px-1 font-mono text-[10px]">{commitChanges}</span>
                    )}
                  </button>
                  <div className="mt-1 text-center text-[9.5px] text-faint">
                    {isSvn
                      ? '共享工作副本 · Agent 生成描述 · 自动运行测试门禁'
                      : isGit
                        ? '当前 Agent 工作区 · Git Agent 生成描述 · 自动运行测试门禁'
                        : '非版本控制项目：Agent 在主目录运行，不支持提交与分支'}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} width={460}>
        <ModalHeader
          title="删除项目"
          subtitle="只删除 AIDE 中的记录，不会删除磁盘目录"
          icon={<Trash2 size={15} />}
          onClose={() => setDeleteTarget(null)}
        />
        <div className="px-5 py-4 text-[11.5px] leading-relaxed text-dim">
          确定删除「<span className="text-ink">{deleteTarget?.name}</span>」？
          <div className="mt-2 rounded-lg border border-line bg-soft/50 px-3 py-2 text-[10px] text-faint">
            会停止该项目的所有 Agent、删除会话与消息、清理 worktree；磁盘上的项目文件与未合并分支会保留。
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
          >
            取消
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={async () => {
              if (!deleteTarget) return
              setDeleting(true)
              try {
                await onDeleteProject(deleteTarget.id)
                setDeleteTarget(null)
              } finally {
                setDeleting(false)
              }
            }}
            className="h-7 rounded-md bg-err px-3 text-[11.5px] font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {deleting ? '删除中…' : '删除项目'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

