import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { resolveClaudeBinary } from './claude.js'
import { DATA_DIR } from './config.js'
import { broadcast } from './events.js'
import { saveSettings, validateJavaHome, validateMavenHome } from './settings.js'

export type InstallerStage = 'idle' | 'starting' | 'running' | 'done' | 'error'

export interface InstallerState {
  running: boolean
  stage: InstallerStage
  startedAt: number | null
  finishedAt: number | null
  log: string[]
  error: string | null
  result: { javaHome: string | null; mavenHome: string | null } | null
  pid: number | null
}

const MAX_LOG = 400

const state: InstallerState = {
  running: false,
  stage: 'idle',
  startedAt: null,
  finishedAt: null,
  log: [],
  error: null,
  result: null,
  pid: null,
}

let child: ChildProcess | null = null
let timer: NodeJS.Timeout | null = null
let finalText = ''
let cancelled = false

export function getInstallerState(): InstallerState {
  return { ...state, log: [...state.log] }
}

function pushLog(line: string): void {
  const text = line.replace(/\r$/, '').trim()
  if (!text) return
  for (const l of text.split('\n')) {
    state.log.push(l.slice(0, 2000))
    if (state.log.length > MAX_LOG) state.log.shift()
  }
  broadcast({ type: 'toolchain.install', payload: { stage: state.stage, log: state.log.slice(-30 ) } })
}

function setStage(stage: InstallerStage, message?: string): void {
  state.stage = stage
  if (message) pushLog(message)
  broadcast({ type: 'toolchain.install', payload: { stage, log: state.log.slice(-30), state: getInstallerState() } })
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const v = o.command ?? o.file_path ?? o.path ?? o.query ?? o.pattern ?? o.url
  return v ? String(v).slice(0, 160) : ''
}

function buildPrompt(workdir: string): string {
  return [
    '你是 AIDE 的环境安装 Agent，负责在这台 Windows 机器上安装 Java 与 Maven。',
    `工作目录：${workdir}。不要修改 AIDE 的 server/ 或 prototype/ 源码，不要提交 git。`,
    '',
    '目标：JDK 21（Temurin）与 Maven 3.9+。步骤建议：',
    '0. 先检查是否已有可用的 JDK 21+ 与 Maven 3.9+（where java、mvn -v、C:\\Program Files\\Eclipse Adoptium、Chocolatey 等）；',
    '   若已满足要求，不要重复安装，直接验证并输出路径。',
    '1. 先运行 `where winget`。可用则优先：',
    '   winget install --id EclipseAdoptium.Temurin.21.JDK -e --silent --accept-package-agreements --accept-source-agreements',
    '   winget install --id Apache.Maven -e --silent --accept-package-agreements --accept-source-agreements',
    '2. winget 不可用或失败：尝试 `choco install temurin21 maven -y`；再不行再下载官方 zip 到工作目录并解压。',
    '3. 安装后用绝对路径验证：`<JDK>\\bin\\java.exe -version`、`<MAVEN>\\bin\\mvn.cmd -v`（运行 Maven 前把 JAVA_HOME 指向新 JDK）。',
    '4. 如果 PATH 没有刷新，直接搜索安装目录（如 C:\\Program Files\\Eclipse Adoptium\\jdk-21*、C:\\Program Files\\Apache\\maven-*、C:\\ProgramData\\chocolatey\\lib\\...），不要只依赖 PATH。',
    '5. 不需要安装项目依赖，不要改任何项目文件。',
    '',
    '最终回复的最后两行必须严格为（即使失败也输出空值）：',
    'JAVA_HOME=<绝对路径或空>',
    'MAVEN_HOME=<绝对路径或空>',
  ].join('\n')
}

function parsePath(text: string, key: string): string | null {
  const m = new RegExp(`${key}\\s*=\\s*([^\\r\\n]*)`, 'i').exec(text)
  if (!m) return null
  const v = m[1].trim().replace(/^["']|["']$/g, '')
  return v || null
}

function killTree(pid?: number | null): void {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

function handleLine(line: string): void {
  let ev: any
  try {
    ev = JSON.parse(line)
  } catch {
    return
  }
  if (ev.type === 'system' && ev.subtype === 'init') {
    pushLog('安装 Agent 已就绪')
    return
  }
  if (ev.type === 'assistant') {
    const blocks: any[] = Array.isArray(ev.message?.content) ? ev.message.content : []
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        finalText = b.text
        pushLog(b.text.trim().slice(0, 1500))
      } else if (b.type === 'tool_use') {
        pushLog(`$ ${b.name} ${summarize(b.input)}`)
      }
    }
    return
  }
  if (ev.type === 'result') {
    if (typeof ev.result === 'string' && ev.result.trim()) finalText = ev.result
    if (ev.is_error) pushLog('Agent 报告安装失败：' + String(ev.result ?? '').slice(0, 300))
    return
  }
}

async function finish(code: number | null): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  state.running = false
  state.pid = null
  state.finishedAt = Date.now()
  child = null

  if (cancelled) {
    state.stage = 'error'
    state.error = '安装已取消'
    setStage('error')
    return
  }
  if (code !== 0 && !finalText) {
    state.stage = 'error'
    state.error = `安装 Agent 退出（code=${code ?? 'null'}）`
    setStage('error')
    return
  }

  const rawJava = parsePath(finalText, 'JAVA_HOME')
  const rawMaven = parsePath(finalText, 'MAVEN_HOME')
  pushLog(`解析结果：JAVA_HOME=${rawJava ?? '空'}；MAVEN_HOME=${rawMaven ?? '空'}`)

  let javaHome: string | null = null
  let mavenHome: string | null = null
  if (rawJava) {
    const check = await validateJavaHome(rawJava)
    if (check.ok) {
      javaHome = rawJava
      pushLog(`JDK 校验通过：${check.version}`)
    } else {
      pushLog(`JDK 校验失败：${check.error ?? '未知原因'}`)
    }
  }
  if (rawMaven) {
    const check = await validateMavenHome(rawMaven, javaHome ?? rawJava)
    if (check.ok) {
      mavenHome = rawMaven
      pushLog(`Maven 校验通过：${check.version}`)
    } else {
      pushLog(`Maven 校验失败：${check.error ?? '未知原因'}`)
    }
  }

  state.result = { javaHome, mavenHome }
  if (!javaHome && !mavenHome) {
    state.stage = 'error'
    state.error = '安装未产生可用的 JDK/Maven 路径'
    setStage('error')
    return
  }

  const patch: { javaHome?: string; mavenHome?: string } = {}
  if (javaHome) patch.javaHome = javaHome
  if (mavenHome) patch.mavenHome = mavenHome
  saveSettings(patch)
  state.stage = 'done'
  state.error = null
  setStage('done', '工具链已写入设置')
}

export function startToolchainInstall(): InstallerState {
  if (state.running) throw new Error('安装任务已在运行')
  const workdir = join(DATA_DIR, 'installer')
  mkdirSync(workdir, { recursive: true })

  state.running = true
  state.stage = 'starting'
  state.startedAt = Date.now()
  state.finishedAt = null
  state.log = []
  state.error = null
  state.result = null
  finalText = ''
  cancelled = false

  const prompt = buildPrompt(workdir)
  const proc = spawn(
    resolveClaudeBinary(),
    [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--add-dir',
      workdir,
    ],
    {
      cwd: workdir,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child = proc
  state.pid = proc.pid ?? null
  setStage('running', '已启动安装 Agent（winget/choco/下载）')

  const rl = createInterface({ input: proc.stdout! })
  rl.on('line', handleLine)
  proc.stderr?.on('data', (buf: Buffer) => {
    const t = buf.toString('utf8').trim()
    if (t) pushLog('[stderr] ' + t.slice(-300))
  })
  proc.on('error', (err) => {
    state.error = err.message
    pushLog('启动失败：' + err.message)
  })
  proc.on('exit', (code) => {
    void finish(code)
  })

  timer = setTimeout(() => {
    pushLog('安装超时（20 分钟），终止安装 Agent')
    killTree(state.pid)
  }, 20 * 60 * 1000)
  timer.unref?.()

  return getInstallerState()
}

export function cancelToolchainInstall(): InstallerState {
  if (!state.running) return getInstallerState()
  cancelled = true
  pushLog('用户取消安装')
  killTree(state.pid)
  return getInstallerState()
}
