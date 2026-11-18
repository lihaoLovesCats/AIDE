import {
  AlertTriangle,
  Bell,
  Bot,
  Check,
  ChevronRight,
  Command,
  GitBranch,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Terminal,
  Type,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatView from './Chat'
import SidePanel from './SidePanel'
import { Inspector, StatusBar } from './Panels'
import { AddProjectDialog, BranchDialog, NewAgentDialog } from './Dialogs'
import { CommitDialog } from './CommitDialog'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import RuntimePanel from './RuntimePanel'
import { SettingsDialog } from './SettingsDialog'
import {
  API_BASE,
  api,
  subscribeEvents,
  type ApiBranch,
  type ApiCommit,
  type ApiGitStatus,
  type ApiMessage,
  type ApiProject,
  type ApiRun,
  type ApiSession,
  type ApiSessionGitStatus,
  type ApiSettingsBundle,
  type ApiSystem,
  type ApiToolchain,
  type ApiUser,
  type ApiAppSettings,
} from './api'
import { adaptMessages, adaptProject, adaptSession, loadTree } from './adapt'
import type { FileNode } from './types'
import { IconButton, Kbd, cn } from './ui'

type ThemeMode = 'dark' | 'light'
type ZoomMode = 'compact' | 'normal' | 'comfort'

interface Toast {
  id: number
  text: string
}

function mergeMessages(a: ApiMessage[], b: ApiMessage[]): ApiMessage[] {
  const map = new Map<string, ApiMessage>()
  for (const m of a) map.set(m.id, m)
  for (const m of b) map.set(m.id, m)
  return [...map.values()].sort((x, y) => x.seq - y.seq)
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function App() {
  const [projects, setProjects] = useState<ApiProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ApiMessage[]>>({})
  const [tree, setTree] = useState<FileNode[]>([])
  const [gitStatus, setGitStatus] = useState<ApiGitStatus | null>(null)
  const [commits, setCommits] = useState<ApiCommit[]>([])
  const [branches, setBranches] = useState<ApiBranch[]>([])

  const [tabs, setTabs] = useState<string[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [inspector, setInspector] = useState<string | null>(null)
  const [sessionGit, setSessionGit] = useState<ApiSessionGitStatus | null>(null)
  const [runs, setRuns] = useState<ApiRun[]>([])
  const [system, setSystem] = useState<ApiSystem | null>(null)

  const [newAgentOpen, setNewAgentOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [appSettings, setAppSettings] = useState<ApiAppSettings | null>(null)
  const [user, setUser] = useState<ApiUser | null>(null)
  const [toolchain, setToolchain] = useState<ApiToolchain | null>(null)
  const [runtimeOpen, setRuntimeOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [health, setHealth] = useState<{
    claude: { bin?: string; version: string | null; available?: boolean }
  } | null>(null)
  const [searchFocus, setSearchFocus] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return localStorage.getItem('aide.theme') === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  const [zoom, setZoom] = useState<ZoomMode>(() => {
    try {
      const v = localStorage.getItem('aide.zoom')
      return v === 'compact' || v === 'comfort' ? v : 'normal'
    } catch {
      return 'normal'
    }
  })

  const timers = useRef<Set<number>>(new Set())
  const messagesRef = useRef(messagesBySession)
  messagesRef.current = messagesBySession
  const sessionsRef = useRef<ApiSession[]>([])
  sessionsRef.current = sessions
  const searchRef = useRef<HTMLInputElement>(null)

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text }])
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 3200)
    timers.current.add(timer)
  }, [])

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light')
    try {
      localStorage.setItem('aide.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  useEffect(() => {
    const scale = zoom === 'compact' ? 0.92 : zoom === 'comfort' ? 1.06 : 1
    document.documentElement.style.zoom = String(scale)
    try {
      localStorage.setItem('aide.zoom', zoom)
    } catch {
      /* ignore */
    }
  }, [zoom])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* --------------------------- bootstrap --------------------------- */

  const loadProjects = useCallback(async () => {
    setBootError(null)
    try {
      const list = await api.projects()
      setProjects(list)
      setActiveProjectId((cur) => cur ?? list[0]?.id ?? null)
      api.health().then(setHealth).catch(() => {})
      api
        .appSettings()
        .then((b) => {
          setAppSettings(b.settings)
          setUser(b.user)
          setToolchain(b.toolchain)
        })
        .catch(() => {})
    } catch (e) {
      setBootError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  /* ------------------------------ SSE ------------------------------ */

  useEffect(() => {
    const unsubscribe = subscribeEvents(
      (ev) => {
        if (ev.type === 'session.status') {
          const { status, activity, error } = ev.payload ?? {}
          const prev = sessionsRef.current.find((s) => s.id === ev.sessionId)
          if (prev && status === 'idle' && prev.status === 'running') {
            notify(`「${prev.title}」本轮完成`)
          } else if (prev && status === 'error' && prev.status !== 'error') {
            notify(`「${prev.title}」出错${error ? '：' + String(error).slice(0, 60) : ''}`)
          }
          setSessions((list) =>
            list.map((s) =>
              s.id === ev.sessionId
                ? {
                    ...s,
                    status: status ?? s.status,
                    lastActivity: activity ?? s.lastActivity,
                    lastError: error ?? s.lastError,
                    updatedAt: Date.now(),
                  }
                : s,
            ),
          )
        } else if (ev.type === 'session.message') {
          const msg = ev.payload?.message as ApiMessage | undefined
          if (!msg?.sessionId) return
          setMessagesBySession((m) => ({
            ...m,
            [msg.sessionId]: mergeMessages(m[msg.sessionId] ?? [], [msg]),
          }))
        } else if (ev.type === 'session.result') {
          const sid = ev.sessionId
          if (!sid) return
          const resultMsg = ev.payload?.message as ApiMessage | undefined
          if (resultMsg) {
            setMessagesBySession((m) => ({ ...m, [sid]: mergeMessages(m[sid] ?? [], [resultMsg]) }))
          }
          void api
            .session(sid)
            .then((s) => setSessions((list) => list.map((x) => (x.id === sid ? { ...x, ...s } : x))))
            .catch(() => {})
        } else if (ev.type === 'session.updated') {
          const s = ev.payload?.session as ApiSession | undefined
          if (!s) return
          setSessions((list) => list.map((x) => (x.id === s.id ? { ...x, ...s } : x)))
        } else if (ev.type === 'dispatch.status') {
          const messageId = ev.payload?.messageId as string | undefined
          const status = ev.payload?.status as string | undefined
          if (!messageId || !status) return
          setMessagesBySession((m) => {
            const next: Record<string, ApiMessage[]> = {}
            for (const [sid, list] of Object.entries(m)) {
              next[sid] = list.map((msg) =>
                msg.id === messageId ? { ...msg, payload: { ...msg.payload, status } } : msg,
              )
            }
            return next
          })
        } else if (ev.type === 'project.deleted') {
          const pid = ev.payload?.projectId as string | undefined
          if (!pid) return
          setProjects((list) => list.filter((p) => p.id !== pid))
          setActiveProjectId((cur) => {
            if (cur !== pid) return cur
            setActiveSessionId('')
            setTabs([])
            return ''
          })
        } else if (ev.type === 'run.status') {
          const run = ev.payload?.run as ApiRun | undefined
          if (!run) return
          setRuns((list) => {
            const exists = list.some((r) => r.id === run.id)
            return exists ? list.map((r) => (r.id === run.id ? { ...r, ...run } : r)) : [...list, run]
          })
        } else if (ev.type === 'run.log') {
          const runId = ev.payload?.runId as string | undefined
          const lines = ev.payload?.lines as string[] | undefined
          if (!runId || !Array.isArray(lines)) return
          setRuns((list) =>
            list.map((r) => (r.id === runId ? { ...r, logs: [...r.logs, ...lines].slice(-200) } : r)),
          )
        }
      },
      (state) => setConnected(state === 'open'),
    )
    return unsubscribe
  }, [])

  /* -------------------------- project load ------------------------- */

  useEffect(() => {
    if (!activeProjectId) return
    let alive = true
    setSessions([])
    setTree([])
    setGitStatus(null)
    setCommits([])
    setBranches([])
    setTabs([])
    setActiveSessionId(null)

    void (async () => {
      try {
        const [ses, nodes] = await Promise.all([api.sessions(activeProjectId), loadTree(activeProjectId)])
        if (!alive) return
        setSessions(ses.sessions)
        setTree(nodes)
        const manager = ses.sessions.find((s) => s.isManager) ?? ses.sessions[0]
        if (manager) {
          setActiveSessionId(manager.id)
          setTabs([manager.id])
        }
      } catch (e) {
        if (alive) notify('加载会话失败：' + errText(e))
      }
      try {
        const [status, log, br] = await Promise.all([
          api.gitStatus(activeProjectId),
          api.gitLog(activeProjectId, 30),
          api.gitBranches(activeProjectId),
        ])
        if (!alive) return
        setGitStatus(status)
        setCommits(log.commits)
        setBranches(br.branches)
      } catch (e) {
        if (alive) notify('加载 Git 失败：' + errText(e))
      }
    })()

    return () => {
      alive = false
    }
  }, [activeProjectId, reloadKey, notify])

  /* ------------------------- messages load ------------------------- */

  useEffect(() => {
    if (!activeSessionId) return
    if (messagesRef.current[activeSessionId]) return
    let alive = true
    api
      .messages(activeSessionId)
      .then((r) => {
        if (!alive) return
        setMessagesBySession((m) => ({ ...m, [activeSessionId]: mergeMessages(m[activeSessionId] ?? [], r.messages) }))
      })
      .catch((e) => {
        if (alive) notify('加载消息失败：' + errText(e))
      })
    return () => {
      alive = false
    }
  }, [activeSessionId, notify])

  /* ---------------------------- derived ---------------------------- */

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const uiSessions = useMemo(
    () =>
      sessions.map((s) =>
        adaptSession(s, adaptMessages(messagesBySession[s.id] ?? []), gitStatus?.branch ?? activeProject?.mainBranch ?? 'main'),
      ),
    [sessions, messagesBySession, gitStatus?.branch, activeProject?.mainBranch],
  )

  const uiProject = useMemo(
    () =>
      activeProject
        ? adaptProject(activeProject, uiSessions, tree, gitStatus, commits, branches, projects.indexOf(activeProject))
        : null,
    [activeProject, uiSessions, tree, gitStatus, commits, branches, projects],
  )

  const uiProjects = useMemo(
    () =>
      projects.map((p, i) =>
        p.id === activeProjectId && uiProject ? uiProject : adaptProject(p, [], [], null, [], [], i),
      ),
    [projects, activeProjectId, uiProject],
  )

  const activeSession = useMemo(
    () => uiSessions.find((s) => s.id === activeSessionId) ?? uiSessions[0] ?? null,
    [uiSessions, activeSessionId],
  )

  const tabIds = tabs.filter((id) => uiSessions.some((s) => s.id === id))
  const totalCost = uiSessions.reduce((a, s) => a + s.cost, 0)
  const totalTokens = uiSessions.reduce((a, s) => a + s.tokens, 0)
  const usageDisplay = appSettings?.usageDisplay ?? 'both'
  const avatarText = (user?.name ?? 'AIDE').trim().slice(0, 2).toUpperCase() || 'AI'
  const activeRuns = runs.filter((r) => r.status === 'starting' || r.status === 'ready' || r.status === 'running').length

  /* 运行实例与资源状态轮询（3s），用于面板与顶栏徽标 */
  useEffect(() => {
    if (!activeProjectId) {
      setRuns([])
      return
    }
    let alive = true
    const load = async () => {
      try {
        const [sys, r] = await Promise.all([api.system(), api.projectRuns(activeProjectId)])
        if (!alive) return
        setSystem(sys)
        setRuns(r.runs)
      } catch {
        /* 忽略瞬时失败 */
      }
    }
    void load()
    const timer = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [activeProjectId])

  /* 当前会话工作区的 Git 状态（提交按钮据此启用/计数） */
  useEffect(() => {
    const sid = activeSession?.id
    if (!sid) {
      setSessionGit(null)
      return
    }
    let alive = true
    const load = () =>
      api
        .sessionGitStatus(sid)
        .then((s) => {
          if (alive) setSessionGit(s)
        })
        .catch(() => {
          if (alive) setSessionGit(null)
        })
    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [activeSession?.id])

  /* ---------------------------- actions ---------------------------- */

  const selectProject = (id: string) => {
    if (id === activeProjectId) return
    setActiveProjectId(id)
    setInspector(null)
  }

  const selectSession = (id: string) => {
    setActiveSessionId(id)
    setTabs((t) => (t.includes(id) ? t : [...t, id]))
  }

  const closeTab = (id: string) => {
    const rest = tabs.filter((x) => x !== id)
    setTabs(rest)
    if (activeSessionId === id) setActiveSessionId(rest[rest.length - 1] ?? null)
  }

  const refreshMessages = async (sid: string) => {
    const r = await api.messages(sid)
    setMessagesBySession((m) => ({ ...m, [sid]: mergeMessages(m[sid] ?? [], r.messages) }))
  }

  const sendMessage = async (text: string) => {
    if (!activeSession) return
    if (health && health.claude.available === false) {
      notify('未检测到 Claude Code CLI，无法发送消息')
      return
    }
    try {
      await api.send(activeSession.id, text)
      await refreshMessages(activeSession.id)
    } catch (e) {
      notify('发送失败：' + errText(e))
    }
  }

  const stopSession = async (sid: string) => {
    try {
      await api.stop(sid)
      notify('已停止会话')
    } catch (e) {
      notify('停止失败：' + errText(e))
    }
  }

  const dispatchTarget = (msgId: string): { sessionId: string; task: string; dispatchId: string | null } | null => {
    if (!activeSession) return null
    const msg = (messagesBySession[activeSession.id] ?? []).find((m) => m.id === msgId)
    const p = msg?.payload ?? {}
    if (!p.sessionId) return null
    return {
      sessionId: String(p.sessionId),
      task: String(p.task ?? ''),
      dispatchId: p.dispatchId ? String(p.dispatchId) : null,
    }
  }

  const revokeDispatch = async (msgId: string) => {
    const t = dispatchTarget(msgId)
    if (!t) {
      notify('找不到派发目标')
      return
    }
    try {
      if (t.dispatchId) await api.revokeDispatch(t.dispatchId)
      await api.send(t.sessionId, '任务已撤销：请立即停止当前工作，回滚未完成的改动，并用一句话说明已回滚哪些内容。')
      notify('已撤销，并通知目标 Agent 回滚')
    } catch (e) {
      notify('撤销失败：' + errText(e))
    }
  }

  const reassignDispatch = async (msgId: string, _index: number, toId: string) => {
    const t = dispatchTarget(msgId)
    if (!t) {
      notify('找不到派发任务')
      return
    }
    try {
      await api.send(toId, `（改派）${t.task}`)
      notify('已改派给新的 Agent')
    } catch (e) {
      notify('改派失败：' + errText(e))
    }
  }

  const startSessionRun = async (sid: string, port?: number) => {
    try {
      const run = await api.startRun(sid, port ? { port } : {})
      setRuns((list) => [...list.filter((r) => r.id !== run.id), run])
      notify(`已在端口 ${run.port} 启动实例`)
    } catch (e) {
      notify('启动失败：' + errText(e))
    }
  }

  const stopSessionRun = async (sid: string) => {
    try {
      const run = await api.stopRun(sid)
      setRuns((list) => list.map((r) => (r.id === run.id ? run : r)))
      notify('已停止实例')
    } catch (e) {
      notify('停止失败：' + errText(e))
    }
  }

  const createAgent = async ({ task }: { task: string }) => {
    if (!activeProjectId) return
    if (health && health.claude.available === false) {
      notify('未检测到 Claude Code CLI，无法创建 Agent')
      return
    }
    const text = task.trim()
    if (!text) {
      notify('请先说明这个 Agent 负责的模块或任务')
      return
    }
    try {
      const s = await api.createSession(activeProjectId, { title: '待命名模块', role: '模块负责人' })
      setSessions((list) => [...list, s])
      setActiveSessionId(s.id)
      setTabs((t) => [...t, s.id])
      await api.send(s.id, text)
      await refreshMessages(s.id)
      notify('已创建模块 Agent，它会按模块自动命名')
    } catch (e) {
      notify('创建会话失败：' + errText(e))
    }
  }

  const addProject = async (name: string, path: string) => {
    try {
      const p = await api.registerProject({ name, path })
      setProjects((list) => [...list, p])
      setActiveProjectId(p.id)
      notify(`已注册项目 ${p.name}`)
    } catch (e) {
      notify('注册失败：' + errText(e))
    }
  }

  const deleteProject = async (id: string) => {
    try {
      await api.deleteProject(id)
      const remaining = projects.filter((p) => p.id !== id)
      setProjects(remaining)
      if (activeProjectId === id) {
        setActiveProjectId(remaining[0]?.id ?? '')
        setActiveSessionId('')
        setTabs([])
      }
      notify('项目已删除（磁盘文件与未合并分支保留）')
    } catch (e) {
      notify('删除失败：' + errText(e))
      throw e
    }
  }

  const refreshGit = async () => {
    if (!activeProjectId) return
    try {
      const [status, log, br] = await Promise.all([
        api.gitStatus(activeProjectId),
        api.gitLog(activeProjectId, 30),
        api.gitBranches(activeProjectId),
      ])
      setGitStatus(status)
      setCommits(log.commits)
      setBranches(br.branches)
    } catch (e) {
      notify('刷新 Git 失败：' + errText(e))
    }
  }

  /* ----------------------------- render ----------------------------- */

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-base text-dim">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line2 border-t-accent" />
        <div className="text-[12px]">正在连接 AIDE 后端…</div>
        <div className="font-mono text-[10px] text-faint">{API_BASE}</div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-base text-dim">
        <div className="text-[13px] text-err">无法连接后端</div>
        <div className="max-w-[520px] text-center font-mono text-[11px] text-faint">{bootError}</div>
        <div className="font-mono text-[10px] text-faint">
          请在 server 目录执行 <span className="text-ink">pnpm dev</span>（{API_BASE}）
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true)
            void loadProjects()
          }}
          className="mt-2 flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-white hover:bg-accent2"
        >
          <RefreshCw size={12} /> 重试
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base text-ink">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet shadow-[0_0_16px_-2px_rgba(91,140,255,0.6)]">
            <Sparkles size={13} className="text-white" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight">AIDE</span>
          <span className="rounded border border-line2 bg-soft px-1 text-[9px] text-faint">alpha</span>
        </div>

        <div className="mx-1 h-4 w-px bg-line" />

        <div className="flex min-w-0 items-center gap-1 text-[11px] text-faint">
          <span className="truncate">workspace</span>
          <ChevronRight size={11} />
          <span className="truncate font-medium text-ink">{uiProject?.name ?? '未选择项目'}</span>
          {uiProject && (
            <>
              <ChevronRight size={11} />
              <span className="flex items-center gap-1 truncate">
                <GitBranch size={10} />
                {uiProject.branch}
              </span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-[280px] items-center gap-2 rounded-md border bg-sunken px-2 transition-colors',
              searchFocus ? 'border-accent/40' : 'border-line2',
            )}
          >
            <Search size={12} className="text-faint" />
            <input
              ref={searchRef}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setSearchFocus(false)}
              placeholder="搜索文件、会话、提交…"
              className="w-full bg-transparent text-[11px] placeholder:text-faint/80"
            />
            <Kbd>
              <Command size={9} />K
            </Kbd>
          </div>

          <button
            type="button"
            onClick={() => setRuntimeOpen((v) => !v)}
            className="flex h-7 items-center gap-1.5 rounded-md border border-line2 px-2 text-[11px] text-dim hover:bg-soft"
            title="运行与预览"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', activeRuns ? 'bg-ok' : 'bg-faint')} />
            {activeRuns ? `运行中 · ${activeRuns}` : '未运行'}
          </button>

          <IconButton title="终端 / 运行面板" active={runtimeOpen} onClick={() => setRuntimeOpen((v) => !v)}>
            <Terminal size={14} />
          </IconButton>
          <IconButton title="通知" onClick={() => notify('暂无新通知')}>
            <Bell size={14} />
          </IconButton>

          <div className="relative">
            <IconButton title="外观与字号" active={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
              <Settings size={14} />
            </IconButton>
            {settingsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
                <div className="pop-in absolute right-0 top-9 z-50 w-[268px] overflow-hidden rounded-xl border border-line2 bg-panel2 p-3 shadow-2xl">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-faint">
                    <Sun size={11} /> 主题
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        ['dark', '深空', Moon],
                        ['light', '浅色', Sun],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setTheme(id)
                          notify(`已切换为「${label}」主题`)
                        }}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] transition-colors',
                          theme === id ? 'border-accent/50 bg-accent/[0.08] text-ink' : 'border-line text-dim hover:border-line2',
                        )}
                      >
                        <Icon size={13} />
                        {label}
                        {theme === id && <Check size={11} className="ml-auto text-accent2" />}
                      </button>
                    ))}
                  </div>

                  <div className="mb-2 mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-faint">
                    <Type size={11} /> 界面缩放
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ['compact', '紧凑'],
                        ['normal', '标准'],
                        ['comfort', '舒适'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setZoom(id)}
                        className={cn(
                          'rounded-lg border py-1.5 text-[11px] transition-colors',
                          zoom === id ? 'border-accent/50 bg-accent/[0.08] text-ink' : 'border-line text-dim hover:border-line2',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-line pt-2 text-[9.5px] leading-relaxed text-faint">
                    主题与缩放会记住你的选择。
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setAvatarOpen((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-[10px] font-bold text-black"
              title={user ? `${user.name}${user.email ? ' · ' + user.email : ''}` : '本地用户'}
            >
              {avatarText}
            </button>
            {avatarOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAvatarOpen(false)} />
                <div className="pop-in absolute right-0 top-8 z-50 w-[236px] overflow-hidden rounded-xl border border-line2 bg-panel2 shadow-2xl">
                  <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-[11px] font-bold text-black">
                      {avatarText}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[11.5px] text-ink">{user?.name ?? '本地用户'}</div>
                      <div className="truncate font-mono text-[9px] text-faint">
                        {user?.email ?? user?.host ?? '未获取 git 用户信息'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsDialogOpen(true)
                      setAvatarOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-dim hover:bg-soft"
                  >
                    <Settings size={12} /> 设置（工具链 / 用量 / 外观）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(theme === 'dark' ? 'light' : 'dark')
                      setAvatarOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-dim hover:bg-soft"
                  >
                    {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
                    切换到{theme === 'dark' ? '浅色' : '深空'}主题
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectSettingsOpen(true)
                      setAvatarOpen(false)
                    }}
                    disabled={!uiProject}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-dim hover:bg-soft disabled:opacity-40"
                  >
                    <GitBranch size={12} /> 当前项目设置
                  </button>
                  <div className="border-t border-line px-3 py-2 font-mono text-[8.5px] text-faint">
                    AIDE 0.3.0 · {health?.claude.version ?? 'claude 未检测'}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {health && health.claude.available === false && (
        <div className="flex shrink-0 items-center gap-2 border-b border-err/30 bg-err/[0.08] px-3 py-2 text-[11px] text-err">
          <AlertTriangle size={13} className="shrink-0" />
          <span>未检测到 Claude Code CLI，Agent 无法启动。安装并登录后点击重试。</span>
          <a
            href="https://docs.anthropic.com/en/docs/claude-code"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-ink"
          >
            安装说明
          </a>
          <button
            type="button"
            onClick={() => void api.health().then(setHealth).catch(() => {})}
            className="ml-auto h-6 shrink-0 rounded border border-err/40 px-2 text-[10px] hover:bg-err/10"
          >
            重试检测
          </button>
        </div>
      )}

      {uiProject ? (
        <div className="flex min-h-0 flex-1">
          <SidePanel
            project={uiProject}
            projects={uiProjects}
            activeSessionId={activeSession?.id ?? ''}
            onSelectProject={selectProject}
            onSelectSession={selectSession}
            onDeleteProject={deleteProject}
            onOpenFile={(p) => setInspector(p)}
            onNewAgent={() => setNewAgentOpen(true)}
            onCommit={() => {
              if (uiProject.vcs === 'none') {
                notify('项目未使用版本控制：不支持提交')
                return
              }
              setCommitOpen(true)
            }}
            onStopSession={(sid) => void stopSession(sid)}
            onAddProject={() => setAddProjectOpen(true)}
            onOpenBranches={() => {
              if (uiProject.vcs !== 'git') {
                notify('仅 Git 项目支持分支与合并')
                return
              }
              setBranchesOpen(true)
            }}
            onNotify={notify}
            commitChanges={sessionGit?.files.length ?? 0}
            commitBranch={sessionGit?.branch ?? activeSession?.branch ?? uiProject.branch}
            onRefresh={() => setReloadKey((k) => k + 1)}
            onOpenSettings={() => setProjectSettingsOpen(true)}
            onOpenAppSettings={() => setSettingsDialogOpen(true)}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {activeSession ? (
              <ChatView
                project={uiProject}
                session={activeSession}
                tabs={tabIds}
                onSelectTab={selectSession}
                onCloseTab={closeTab}
                onSend={(text) => void sendMessage(text)}
                onStop={() => void stopSession(activeSession.id)}
                onJump={selectSession}
                onOpenFile={(p) => setInspector(p)}
                onToggleRuntime={() => setRuntimeOpen((v) => !v)}
                runtimeOpen={runtimeOpen}
                onRetry={() => notify('再发一条消息即可恢复会话（--resume）')}
                onReassign={(msgId, index, toId) => void reassignDispatch(msgId, index, toId)}
                onRevoke={(msgId) => void revokeDispatch(msgId)}
                onResolve={() => notify('批准/确认流程在 P4 接入')}
                usageDisplay={usageDisplay}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Bot size={28} className="text-faint" />
                <div className="text-[13px] text-ink">这个项目还没有 Agent 会话</div>
                <button
                  type="button"
                  onClick={() => setNewAgentOpen(true)}
                  className="mt-1 flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-white hover:bg-accent2"
                >
                  <Plus size={12} /> 新建 Agent
                </button>
              </div>
            )}

            {runtimeOpen && (
              <RuntimePanel
                projectPath={uiProject.path}
                sessions={uiSessions}
                runs={runs}
                system={system}
                onStart={startSessionRun}
                onStop={stopSessionRun}
                onNotify={notify}
                onClose={() => setRuntimeOpen(false)}
              />
            )}
          </div>

          {inspector && (
            <Inspector projectId={uiProject.id} file={inspector} onClose={() => setInspector(null)} onNotify={notify} />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Sparkles size={26} className="text-accent2" />
          <div className="text-[14px] text-ink">还没有注册项目</div>
          <div className="max-w-[380px] text-center text-[11px] leading-relaxed text-faint">
            选择一个本地文件夹即可（Git / SVN 可选，Java / Python / Node 等项目都支持）。AIDE 会扫描文件树与项目类型，并为它创建项目经理会话。
          </div>
          <button
            type="button"
            onClick={() => setAddProjectOpen(true)}
            className="mt-1 flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[11.5px] font-medium text-white hover:bg-accent2"
          >
            <Plus size={12} /> 注册项目
          </button>
        </div>
      )}

      <StatusBar
        project={uiProject}
        cost={totalCost}
        tokens={totalTokens}
        usageDisplay={usageDisplay}
        connected={connected}
        claude={health?.claude.version ?? null}
      />

      <NewAgentDialog
        open={newAgentOpen}
        project={uiProject ?? { id: '', name: '', path: '', color: '', color2: '', branch: 'main', ahead: 0, behind: 0, dirty: false, isGit: false, vcs: 'none', sessions: [], tree: [], commits: [], branches: [], changes: [], runPort: 0, runStatus: 'stopped', stack: '' }}
        onClose={() => setNewAgentOpen(false)}
        onCreate={(data) => void createAgent(data)}
      />
      <AddProjectDialog open={addProjectOpen} onClose={() => setAddProjectOpen(false)} onCreate={(n, p) => void addProject(n, p)} />
      <CommitDialog
        open={commitOpen}
        session={activeSession}
        vcs={uiProject?.vcs}
        onClose={() => setCommitOpen(false)}
        onNotify={notify}
        onDone={() => void refreshGit()}
      />
      {uiProject && (
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          project={uiProject}
          onClose={() => setProjectSettingsOpen(false)}
          onSaved={(p) =>
            setProjects((list) => list.map((x) => (x.id === p.id ? { ...x, ...p } : x)))
          }
          onNotify={notify}
        />
      )}
      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        onNotify={notify}
        onSaved={(b: ApiSettingsBundle) => {
          setAppSettings(b.settings)
          setUser(b.user)
          setToolchain(b.toolchain)
        }}
        theme={theme}
        zoom={zoom}
        onTheme={setTheme}
        onZoom={setZoom}
        claudeVersion={health?.claude.version ?? null}
      />
      {uiProject && (
        <BranchDialog
          open={branchesOpen}
          project={uiProject}
          onClose={() => setBranchesOpen(false)}
          onMerged={() => void refreshGit()}
          onJumpSession={(id) => {
            if (!uiSessions.some((s) => s.id === id)) return
            selectSession(id)
            setBranchesOpen(false)
          }}
        />
      )}

      <div className="pointer-events-none fixed bottom-7 right-4 z-40 flex flex-col items-end gap-1.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="slide-in-right pointer-events-auto flex items-center gap-2 rounded-lg border border-line2 bg-panel2/95 px-3 py-2 text-[11px] text-ink shadow-2xl backdrop-blur"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
