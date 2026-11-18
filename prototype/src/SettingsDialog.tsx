import { Check, Cpu, Loader2, Moon, Search, Settings, Sun, Terminal, User, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type ApiInstallerState, type ApiSettingsBundle, type ApiToolCandidate } from './api'
import { Chip, Modal, ModalHeader, cn } from './ui'

type ThemeMode = 'dark' | 'light'
type ZoomMode = 'compact' | 'normal' | 'comfort'

const USAGE_OPTIONS: { value: 'both' | 'cost' | 'tokens'; label: string; hint: string }[] = [
  { value: 'both', label: '费用 + Token', hint: '同时显示金额与 token 数' },
  { value: 'cost', label: '仅费用', hint: '只显示 claude 返回的累计费用' },
  { value: 'tokens', label: '仅 Token', hint: '只显示输入+输出 token 数' },
]

function CandidateRow({
  c,
  active,
  onClick,
}: {
  c: ApiToolCandidate
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors',
        active ? 'border-accent/45 bg-accent/[0.07]' : 'border-line bg-sunken hover:border-line2',
      )}
    >
      <span className="shrink-0 font-mono text-[10px] text-accent2">{c.version ?? '版本未知'}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-dim" title={c.path}>
        {c.path}
      </span>
      <span className="shrink-0 text-[9px] text-faint">{c.source}</span>
      {active && <Check size={11} className="shrink-0 text-ok" />}
    </button>
  )
}

export function SettingsDialog({
  open,
  onClose,
  onNotify,
  onSaved,
  theme,
  zoom,
  onTheme,
  onZoom,
  claudeVersion,
}: {
  open: boolean
  onClose: () => void
  onNotify: (s: string) => void
  onSaved: (bundle: ApiSettingsBundle) => void
  theme: ThemeMode
  zoom: ZoomMode
  onTheme: (t: ThemeMode) => void
  onZoom: (z: ZoomMode) => void
  claudeVersion: string | null
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [javaHome, setJavaHome] = useState('')
  const [mavenHome, setMavenHome] = useState('')
  const [pythonPath, setPythonPath] = useState('')
  const [nodePath, setNodePath] = useState('')
  const [usageDisplay, setUsageDisplay] = useState<'both' | 'cost' | 'tokens'>('both')
  const [javaCandidates, setJavaCandidates] = useState<ApiToolCandidate[]>([])
  const [mavenCandidates, setMavenCandidates] = useState<ApiToolCandidate[]>([])
  const [pythonCandidates, setPythonCandidates] = useState<ApiToolCandidate[]>([])
  const [nodeCandidates, setNodeCandidates] = useState<ApiToolCandidate[]>([])
  const [bundle, setBundle] = useState<ApiSettingsBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installer, setInstaller] = useState<ApiInstallerState | null>(null)
  const [pollKey, setPollKey] = useState(0)
  const startedByUs = useRef(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    let timer: number | null = null
    const tick = async () => {
      try {
        const s = await api.installerStatus()
        if (!alive) return
        setInstaller(s)
        if (s.running) {
          timer = window.setTimeout(tick, 1500)
          return
        }
        if (startedByUs.current && s.stage === 'done') {
          startedByUs.current = false
          const b = await api.appSettings()
          if (!alive) return
          setBundle(b)
          setJavaHome(b.settings.javaHome ?? '')
          setMavenHome(b.settings.mavenHome ?? '')
          setPythonPath(b.settings.pythonPath ?? '')
          setNodePath(b.settings.nodePath ?? '')
          onSaved(b)
          onNotify('工具链安装完成，已写入设置')
        } else if (startedByUs.current && s.stage === 'error') {
          startedByUs.current = false
          onNotify('自动安装失败：' + (s.error ?? '未知原因'))
        }
      } catch {
        if (alive) timer = window.setTimeout(tick, 2500)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pollKey])

  const install = async () => {
    startedByUs.current = true
    try {
      const s = await api.startInstaller()
      setInstaller(s)
      setPollKey((k) => k + 1)
      onNotify('已启动安装 Agent，可在下方查看进度')
    } catch (e) {
      startedByUs.current = false
      onNotify('启动安装失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const cancelInstall = async () => {
    try {
      const s = await api.cancelInstaller()
      setInstaller(s)
      setPollKey((k) => k + 1)
    } catch (e) {
      onNotify('取消失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setJavaCandidates([])
    setMavenCandidates([])
    setPythonCandidates([])
    setNodeCandidates([])
    let alive = true
    api
      .appSettings()
      .then((b) => {
        if (!alive) return
        setBundle(b)
        setJavaHome(b.settings.javaHome ?? '')
        setMavenHome(b.settings.mavenHome ?? '')
        setPythonPath(b.settings.pythonPath ?? '')
        setNodePath(b.settings.nodePath ?? '')
        setUsageDisplay(b.settings.usageDisplay)
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
  }, [open])

  const detect = async () => {
    setDetecting(true)
    setError(null)
    try {
      const r = await api.detectToolchain()
      setJavaCandidates(r.java)
      setMavenCandidates(r.maven)
      setPythonCandidates(r.python)
      setNodeCandidates(r.node)
      const total = r.java.length + r.maven.length + r.python.length + r.node.length
      if (!total) {
        onNotify('未在常见位置找到 JDK/Maven/Python/Node，请手动填写路径')
      } else {
        onNotify(
          `找到 ${r.java.length} 个 JDK、${r.maven.length} 个 Maven、${r.python.length} 个 Python、${r.node.length} 个 Node`,
        )
      }
    } catch (e) {
      onNotify('自动检测失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDetecting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const b = await api.saveAppSettings({
        javaHome: javaHome.trim() || null,
        mavenHome: mavenHome.trim() || null,
        pythonPath: pythonPath.trim() || null,
        nodePath: nodePath.trim() || null,
        usageDisplay,
      })
      onSaved(b)
      onNotify('设置已保存，之后的 Agent/命令都会使用新工具链')
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onNotify('保存失败：' + msg)
    } finally {
      setSaving(false)
    }
  }

  const missingJava = !javaHome.trim()
  const missingMaven = !mavenHome.trim()
  const installerRunning = Boolean(installer?.running)
  const showInstaller =
    installerRunning || installer?.stage === 'done' || installer?.stage === 'error' || missingJava || missingMaven

  return (
    <Modal open={open} onClose={onClose} width={760}>
      <ModalHeader
        title="设置"
        subtitle="工具链、用量与外观（全局生效）"
        icon={<Settings size={15} />}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[12px] text-dim">
            <Loader2 size={14} className="animate-spin" /> 正在读取设置…
          </div>
        ) : (
          <>
            {/* 工具链 */}
            <div className="mb-2 flex items-center gap-2">
              <Cpu size={13} className="text-accent2" />
              <span className="text-[12px] font-medium text-ink">开发工具链（Java / Python / Node）</span>
              <Chip tone="dim">全局</Chip>
              <button
                type="button"
                onClick={() => void detect()}
                disabled={detecting}
                className="ml-auto flex h-6 items-center gap-1 rounded border border-line2 px-2 text-[10.5px] text-dim hover:bg-soft disabled:opacity-60"
              >
                {detecting ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                自动检测本机
              </button>
            </div>
            <div className="rounded-lg border border-line bg-sunken px-3 py-2.5">
              <div className="grid grid-cols-[64px_1fr] items-center gap-2">
                <span className="text-[10.5px] text-faint">JAVA_HOME</span>
                <input
                  value={javaHome}
                  onChange={(e) => setJavaHome(e.target.value)}
                  placeholder="例如 C:\Program Files\Java\jdk-21（留空则使用 PATH）"
                  className="h-7 rounded border border-line2 bg-panel px-2 font-mono text-[10.5px] text-ink placeholder:text-faint/60 focus:border-accent/40"
                />
                <span className="text-[10.5px] text-faint">MAVEN_HOME</span>
                <input
                  value={mavenHome}
                  onChange={(e) => setMavenHome(e.target.value)}
                  placeholder="例如 C:\apache-maven-3.9.6（留空则使用 PATH）"
                  className="h-7 rounded border border-line2 bg-panel px-2 font-mono text-[10.5px] text-ink placeholder:text-faint/60 focus:border-accent/40"
                />
                <span className="text-[10.5px] text-faint">PYTHON</span>
                <input
                  value={pythonPath}
                  onChange={(e) => setPythonPath(e.target.value)}
                  placeholder="例如 C:\Python312\python.exe（留空则使用 PATH 中的 python）"
                  className="h-7 rounded border border-line2 bg-panel px-2 font-mono text-[10.5px] text-ink placeholder:text-faint/60 focus:border-accent/40"
                />
                <span className="text-[10.5px] text-faint">NODE</span>
                <input
                  value={nodePath}
                  onChange={(e) => setNodePath(e.target.value)}
                  placeholder="例如 C:\Program Files\nodejs\node.exe（留空则使用 PATH 中的 node）"
                  className="h-7 rounded border border-line2 bg-panel px-2 font-mono text-[10.5px] text-ink placeholder:text-faint/60 focus:border-accent/40"
                />
              </div>

              <div className="mt-2 flex items-center gap-2 text-[9.5px] text-faint">
                <span>
                  版本：
                  <span className="ml-1 font-mono text-dim">
                    {bundle?.toolchain.javaVersion ?? '未配置'} / {bundle?.toolchain.mavenVersion ?? '未配置'} /{' '}
                    {bundle?.toolchain.pythonVersion ?? '未配置'} / {bundle?.toolchain.nodeVersion ?? '未配置'}
                  </span>
                </span>
                <span className="ml-auto">保存后对新启动的 Agent、测试门禁、运行命令生效，并写入 Agent 系统提示；已运行的会话需停止后重新发消息才会使用新环境</span>
              </div>

              {(javaCandidates.length > 0 ||
                mavenCandidates.length > 0 ||
                pythonCandidates.length > 0 ||
                nodeCandidates.length > 0) && (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[9.5px] text-faint">检测到的 JDK</div>
                    <div className="max-h-[110px] space-y-1 overflow-auto">
                      {javaCandidates.length === 0 && <div className="text-[9.5px] text-faint">无</div>}
                      {javaCandidates.map((c) => (
                        <CandidateRow
                          key={c.path}
                          c={c}
                          active={javaHome === c.path}
                          onClick={() => setJavaHome(c.path)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[9.5px] text-faint">检测到的 Maven</div>
                    <div className="max-h-[110px] space-y-1 overflow-auto">
                      {mavenCandidates.length === 0 && <div className="text-[9.5px] text-faint">无（可手动填写）</div>}
                      {mavenCandidates.map((c) => (
                        <CandidateRow
                          key={c.path}
                          c={c}
                          active={mavenHome === c.path}
                          onClick={() => setMavenHome(c.path)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[9.5px] text-faint">检测到的 Python</div>
                    <div className="max-h-[110px] space-y-1 overflow-auto">
                      {pythonCandidates.length === 0 && <div className="text-[9.5px] text-faint">无（可手动填写）</div>}
                      {pythonCandidates.map((c) => (
                        <CandidateRow
                          key={c.path}
                          c={c}
                          active={pythonPath === c.path}
                          onClick={() => setPythonPath(c.path)}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[9.5px] text-faint">检测到的 Node</div>
                    <div className="max-h-[110px] space-y-1 overflow-auto">
                      {nodeCandidates.length === 0 && <div className="text-[9.5px] text-faint">无（可手动填写）</div>}
                      {nodeCandidates.map((c) => (
                        <CandidateRow
                          key={c.path}
                          c={c}
                          active={nodePath === c.path}
                          onClick={() => setNodePath(c.path)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {showInstaller && (
              <div className="mt-2 rounded-lg border border-accent/25 bg-accent/[0.04] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Wand2 size={12} className="shrink-0 text-accent2" />
                  <span className="text-[10.5px] text-ink">
                    {missingJava || missingMaven ? (
                      <>
                        缺少 {missingJava ? 'JDK' : ''}
                        {missingJava && missingMaven ? ' / ' : ''}
                        {missingMaven ? 'Maven' : ''}？让 Agent 自动安装
                      </>
                    ) : (
                      <>重新安装 / 升级工具链</>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {installerRunning ? (
                      <button
                        type="button"
                        onClick={() => void cancelInstall()}
                        className="h-6 rounded border border-err/35 px-2 text-[10px] text-err hover:bg-err/10"
                      >
                        取消安装
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void install()}
                        className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[10px] text-white hover:bg-accent2"
                      >
                        <Wand2 size={10} /> 让 Agent 自动安装
                      </button>
                    )}
                  </span>
                </div>
                <div className="mt-1 text-[9px] leading-relaxed text-faint">
                  Agent 会优先使用 winget / choco，失败时下载官方压缩包；完成后自动校验版本并写入上方设置。需要网络，可能耗时数分钟。
                </div>
                {(installerRunning || (installer?.log.length ?? 0) > 0) && (
                  <pre className="mt-1.5 max-h-[130px] overflow-auto rounded border border-line bg-[#0b0f16] px-2 py-1.5 font-mono text-[9px] leading-[1.55] text-[#c9d6e5]">
                    {installer?.log.slice(-24).join('\n')}
                  </pre>
                )}
                {installer?.stage === 'error' && installer.error && (
                  <div className="mt-1 text-[9.5px] text-err">{installer.error}</div>
                )}
                {installer?.stage === 'done' && installer.result && (
                  <div className="mt-1 text-[9.5px] text-ok">
                    已完成：{installer.result.javaHome ?? 'JDK 未变'} · {installer.result.mavenHome ?? 'Maven 未变'}
                  </div>
                )}
              </div>
            )}

            {/* 用量 */}
            <div className="mb-2 mt-5 flex items-center gap-2">
              <Terminal size={13} className="text-accent2" />
              <span className="text-[12px] font-medium text-ink">用量显示</span>
              <span className="text-[9.5px] text-faint">费用来自 claude 返回的 total_cost_usd，按会话累计</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {USAGE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setUsageDisplay(o.value)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left transition-colors',
                    usageDisplay === o.value
                      ? 'border-accent/50 bg-accent/[0.07]'
                      : 'border-line bg-sunken hover:border-line2',
                  )}
                >
                  <div className="flex items-center gap-1 text-[11px] text-ink">
                    {o.label}
                    {usageDisplay === o.value && <Check size={11} className="ml-auto text-ok" />}
                  </div>
                  <div className="mt-0.5 text-[9px] leading-relaxed text-faint">{o.hint}</div>
                </button>
              ))}
            </div>

            {/* 外观 */}
            <div className="mb-2 mt-5 flex items-center gap-2">
              <Sun size={13} className="text-accent2" />
              <span className="text-[12px] font-medium text-ink">外观</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['dark', '深空', Moon],
                  ['light', '浅色', Sun],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTheme(id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px]',
                    theme === id ? 'border-accent/45 bg-accent/[0.08] text-ink' : 'border-line text-dim hover:bg-soft',
                  )}
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-line" />
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
                  onClick={() => onZoom(id)}
                  className={cn(
                    'h-7 rounded-md border px-2.5 text-[11px]',
                    zoom === id ? 'border-accent/45 bg-accent/[0.08] text-ink' : 'border-line text-dim hover:bg-soft',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 关于 */}
            <div className="mb-2 mt-5 flex items-center gap-2">
              <User size={13} className="text-accent2" />
              <span className="text-[12px] font-medium text-ink">关于</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-lg border border-line bg-sunken px-3 py-2">
                <div className="text-faint">本地用户</div>
                <div className="mt-0.5 text-ink">
                  {bundle?.user.name ?? '—'}
                  {bundle?.user.email ? <span className="ml-1 text-faint">· {bundle.user.email}</span> : null}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-faint">{bundle?.user.host}</div>
              </div>
              <div className="rounded-lg border border-line bg-sunken px-3 py-2">
                <div className="text-faint">版本</div>
                <div className="mt-0.5 text-ink">AIDE 0.3.0</div>
                <div className="mt-0.5 font-mono text-[9px] text-faint">{claudeVersion ?? 'claude 未检测'}</div>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-err/30 bg-err/[0.06] px-3 py-2 text-[10.5px] text-err">
                {error}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-line2 px-3 text-[11.5px] text-dim hover:bg-soft"
        >
          取消
        </button>
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void save()}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-3 text-[11.5px] font-medium text-white',
            saving || loading ? 'cursor-not-allowed bg-soft text-faint' : 'bg-accent hover:bg-accent2',
          )}
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          保存设置
        </button>
      </div>
    </Modal>
  )
}
