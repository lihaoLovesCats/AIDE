import { exec, execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import * as store from './db.js'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)
const isWin = process.platform === 'win32'

export type UsageDisplay = 'both' | 'cost' | 'tokens'

export interface AppSettings {
  javaHome: string | null
  mavenHome: string | null
  pythonPath: string | null
  nodePath: string | null
  usageDisplay: UsageDisplay
}

export interface ToolchainInfo {
  javaHome: string | null
  mavenHome: string | null
  pythonPath: string | null
  nodePath: string | null
  javaVersion: string | null
  mavenVersion: string | null
  pythonVersion: string | null
  nodeVersion: string | null
}

export interface ToolCandidate {
  path: string
  version: string | null
  source: string
}

export function readSettings(): AppSettings {
  const s = store.getSettings()
  return {
    javaHome: s.javaHome?.trim() || null,
    mavenHome: s.mavenHome?.trim() || null,
    pythonPath: s.pythonPath?.trim() || null,
    nodePath: s.nodePath?.trim() || null,
    usageDisplay:
      s.usageDisplay === 'cost' || s.usageDisplay === 'tokens' ? s.usageDisplay : 'both',
  }
}

export function saveSettings(patch: {
  javaHome?: string | null
  mavenHome?: string | null
  pythonPath?: string | null
  nodePath?: string | null
  usageDisplay?: UsageDisplay
}): AppSettings {
  if (patch.javaHome !== undefined) {
    if (patch.javaHome) store.setSetting('javaHome', patch.javaHome)
    else store.deleteSetting('javaHome')
  }
  if (patch.mavenHome !== undefined) {
    if (patch.mavenHome) store.setSetting('mavenHome', patch.mavenHome)
    else store.deleteSetting('mavenHome')
  }
  if (patch.pythonPath !== undefined) {
    if (patch.pythonPath) store.setSetting('pythonPath', patch.pythonPath)
    else store.deleteSetting('pythonPath')
  }
  if (patch.nodePath !== undefined) {
    if (patch.nodePath) store.setSetting('nodePath', patch.nodePath)
    else store.deleteSetting('nodePath')
  }
  if (patch.usageDisplay !== undefined) store.setSetting('usageDisplay', patch.usageDisplay)
  invalidateToolchain()
  return readSettings()
}

/** 注入 JAVA_HOME / MAVEN_HOME / Python / Node，并把可执行目录放到 PATH 最前 */
export function applyToolchainEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const s = readSettings()
  const env: NodeJS.ProcessEnv = { ...base }
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const adds: string[] = []
  if (s.javaHome) {
    env.JAVA_HOME = s.javaHome
    adds.push(join(s.javaHome, 'bin'))
  }
  if (s.mavenHome) {
    env.MAVEN_HOME = s.mavenHome
    env.M2_HOME = s.mavenHome
    adds.push(join(s.mavenHome, 'bin'))
  }
  if (s.pythonPath) {
    env.PYTHONUTF8 = '1'
    env.PYTHONIOENCODING = 'utf-8'
    if (/[\\/]/.test(s.pythonPath)) adds.push(dirname(s.pythonPath))
  }
  if (s.nodePath && /[\\/]/.test(s.nodePath)) {
    adds.push(dirname(s.nodePath))
  }
  if (adds.length) {
    const cur = env[pathKey] ?? ''
    env[pathKey] = [...adds, cur].filter(Boolean).join(isWin ? ';' : ':')
  }
  return env
}

export function mvnBin(home: string | null): string | null {
  if (!home) return null
  for (const name of isWin ? ['mvn.cmd', 'mvn.bat', 'mvn'] : ['mvn']) {
    const p = join(home, 'bin', name)
    if (existsSync(p)) return p
  }
  return null
}

/** 已配置 Maven 时可执行文件；未配置返回 null */
export function mavenCommand(): string | null {
  return mvnBin(readSettings().mavenHome)
}

/** Python 可执行文件：优先已配置路径，否则常见命令 */
export function pythonCommand(): string {
  const s = readSettings()
  if (s.pythonPath) return s.pythonPath
  for (const c of ['python', 'python3', 'py']) {
    if (commandExists(c)) return c
  }
  return 'python'
}

/** Node 可执行文件：优先已配置路径，否则 node */
export function nodeCommand(): string {
  const s = readSettings()
  if (s.nodePath) return s.nodePath
  for (const c of ['node']) {
    if (commandExists(c)) return c
  }
  return 'node'
}

/** 给 Agent 的系统提示：工具链路径（同步，不探测版本） */
export function toolchainHint(): string {
  const s = readSettings()
  if (!s.javaHome && !s.mavenHome && !s.pythonPath && !s.nodePath) {
    return '本机未配置专用工具链。需要 Java/Maven/Python/Node 时使用 PATH 中的命令；如果找不到，请让用户在「设置 → 工具链」中配置。'
  }
  const lines = [
    '本机工具链已注入所有命令的环境变量（JAVA_HOME/MAVEN_HOME 与 PATH）：',
    s.javaHome ? `- JAVA_HOME=${s.javaHome}` : null,
    s.mavenHome ? `- MAVEN_HOME=${s.mavenHome}（优先使用 "${mvnBin(s.mavenHome) ?? 'mvn'}"）` : null,
    s.pythonPath ? `- PYTHON=${s.pythonPath}` : null,
    s.nodePath ? `- NODE=${s.nodePath}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

export function invalidateToolchain(): void {
  cache = null
}

let cache: { at: number; value: ToolchainInfo } | null = null

export async function getToolchain(): Promise<ToolchainInfo> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value
  const s = readSettings()
  const javaVersion = s.javaHome ? await probeJava(s.javaHome) : null
  const mavenVersion = s.mavenHome ? await probeMaven(s.mavenHome, s.javaHome) : null
  const pythonVersion = s.pythonPath ? await probePython(s.pythonPath) : null
  const nodeVersion = s.nodePath ? await probeNode(s.nodePath) : null
  const value: ToolchainInfo = {
    javaHome: s.javaHome,
    mavenHome: s.mavenHome,
    pythonPath: s.pythonPath,
    nodePath: s.nodePath,
    javaVersion,
    mavenVersion,
    pythonVersion,
    nodeVersion,
  }
  cache = { at: Date.now(), value }
  return value
}

export async function probeJava(home: string): Promise<string | null> {
  const exe = join(home, 'bin', isWin ? 'java.exe' : 'java')
  if (!existsSync(exe)) return null
  try {
    const res = await execFileAsync(exe, ['-version'], { windowsHide: true, timeout: 15000 })
    return parseJavaVersion(`${res.stdout}\n${res.stderr}`)
  } catch (err: any) {
    return parseJavaVersion(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}`)
  }
}

function parseJavaVersion(out: string): string | null {
  const m = /version "([^"]+)"/.exec(out)
  if (m) return m[1]
  const first = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /version/i.test(s))
  return first ?? null
}

export async function probeMaven(home: string, javaHome?: string | null): Promise<string | null> {
  const bin = mvnBin(home)
  if (!bin) return null
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (javaHome) {
    env.JAVA_HOME = javaHome
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path'
    env[pathKey] = `${join(javaHome, 'bin')}${isWin ? ';' : ':'}${env[pathKey] ?? ''}`
  }
  try {
    const res = isWin
      ? await execAsync(`"${bin}" -v`, {
          env,
          windowsHide: true,
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        })
      : await execFileAsync(bin, ['-v'], { env, timeout: 30000 })
    return parseMavenVersion(res.stdout)
  } catch (err: any) {
    return parseMavenVersion(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}`)
  }
}

function parseMavenVersion(out: string): string | null {
  const m = /Apache Maven\s+([\d.]+)/.exec(out)
  return m ? m[1] : null
}

export async function probePython(exe: string): Promise<string | null> {
  try {
    const res = await execFileAsync(exe, ['--version'], { windowsHide: true, timeout: 15000 })
    return parsePythonVersion(`${res.stdout}\n${res.stderr}`)
  } catch (err: any) {
    return parsePythonVersion(`${err?.stdout ?? ''}\n${err?.stderr ?? ''}`)
  }
}

function parsePythonVersion(out: string): string | null {
  const m = /Python\s+([\d.]+)/i.exec(out)
  return m ? m[1] : null
}

export async function probeNode(exe: string): Promise<string | null> {
  try {
    const res = await execFileAsync(exe, ['--version'], { windowsHide: true, timeout: 15000 })
    const m = /v?([\d.]+)/.exec(`${res.stdout} ${res.stderr}`)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** 同步检查 PATH 中是否有某个命令（用于 toolchainHint / 命令选择） */
function commandExists(cmd: string): boolean {
  if (/[\\/]/.test(cmd)) return existsSync(cmd)
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : ['']
  const path = process.env.PATH ?? ''
  for (const dir of path.split(isWin ? ';' : ':')) {
    if (!dir) continue
    for (const ext of exts) {
      if (existsSync(join(dir, cmd + ext))) return true
    }
  }
  return false
}

async function where(cmd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(isWin ? 'where' : 'which', [cmd], { windowsHide: true })
    return stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function dirsOf(root: string): string[] {
  try {
    return readdirSync(root).map((name) => join(root, name))
  } catch {
    return []
  }
}

/** Windows 下扫描所有盘符的 Program Files（IDE 常装在 D: 等非系统盘） */
function programFilesDirs(): string[] {
  if (!isWin) return []
  const roots = new Set<string>()
  if (process.env.ProgramFiles) roots.add(process.env.ProgramFiles)
  if (process.env['ProgramFiles(x86)']) roots.add(process.env['ProgramFiles(x86)'])
  for (const letter of 'CDEFGH') {
    roots.add(`${letter}:\\Program Files`)
    roots.add(`${letter}:\\Program Files (x86)`)
  }
  return [...roots].filter((p) => existsSync(p))
}

/** JetBrains 产品目录（IntelliJ/PyCharm 等），用于发现自带 JBR 与 Maven */
function jetbrainsProductDirs(): string[] {
  const roots = [
    ...programFilesDirs().map((p) => join(p, 'JetBrains')),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs')] : []),
  ]
  const out: string[] = []
  for (const root of roots) {
    for (const p of dirsOf(root)) {
      try {
        if (statSync(p).isDirectory()) out.push(p)
      } catch {
        /* ignore */
      }
    }
  }
  return out
}

async function detectJava(): Promise<ToolCandidate[]> {
  const found = new Map<string, ToolCandidate>()
  const add = async (home: string | undefined | null, source: string) => {
    if (!home) return
    const exe = join(home, 'bin', isWin ? 'java.exe' : 'java')
    if (!existsSync(exe)) return
    const key = home.replace(/\\/g, '/').toLowerCase()
    if (found.has(key)) return
    found.set(key, { path: home, version: await probeJava(home), source })
  }

  await add(process.env.JAVA_HOME, 'JAVA_HOME')
  for (const p of await where('java')) await add(dirname(dirname(p)), 'PATH')

  const roots: string[] = []
  if (isWin) {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    roots.push(
      join(pf, 'Java'),
      join(pf, 'Eclipse Adoptium'),
      join(pf, 'Microsoft'),
      join(pf, 'Amazon Corretto'),
      join(pf, 'Zulu'),
      join(pf, 'BellSoft'),
      join(pf86, 'Java'),
    )
    if (process.env.USERPROFILE) roots.push(join(process.env.USERPROFILE, '.jdks'))
    if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'))
  } else {
    roots.push('/usr/lib/jvm', '/Library/Java/JavaVirtualMachines')
  }

  for (const root of roots) {
    for (const p of dirsOf(root)) {
      try {
        if (statSync(p).isDirectory()) await add(p, root)
      } catch {
        /* ignore */
      }
    }
  }

  // JetBrains 自带 JBR（常见于 IntelliJ IDEA / PyCharm 等安装目录）
  for (const product of jetbrainsProductDirs()) {
    const jbr = join(product, 'jbr')
    if (existsSync(join(jbr, 'bin', isWin ? 'java.exe' : 'java'))) {
      await add(jbr, `${product.split(/[\\/]/).pop()} (JBR)`)
    }
  }

  return [...found.values()].sort((a, b) => String(b.version ?? '').localeCompare(String(a.version ?? '')))
}

async function detectMaven(javaHome: string | null): Promise<ToolCandidate[]> {
  const found = new Map<string, ToolCandidate>()
  const add = async (home: string | undefined | null, source: string) => {
    if (!home) return
    const bin = mvnBin(home)
    if (!bin) return
    const key = home.replace(/\\/g, '/').toLowerCase()
    if (found.has(key)) return
    found.set(key, { path: home, version: await probeMaven(home, javaHome), source })
  }

  await add(process.env.MAVEN_HOME, 'MAVEN_HOME')
  await add(process.env.M2_HOME, 'M2_HOME')
  for (const p of await where('mvn')) await add(dirname(dirname(p)), 'PATH')

  const roots: string[] = []
  if (isWin) {
    roots.push(process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Apache') : 'C:\\Program Files\\Apache')
    roots.push(process.env.USERPROFILE ?? '')
    roots.push(process.env.ProgramData ? join(process.env.ProgramData, 'chocolatey', 'lib') : '')
  } else {
    roots.push('/opt', '/usr/local', process.env.HOME ?? '')
  }

  for (const root of roots.filter(Boolean)) {
    for (const p of dirsOf(root)) {
      const name = p.split(/[\\/]/).pop() ?? ''
      if (!/^(apache-maven|maven)/i.test(name)) continue
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (/chocolatey/i.test(root)) {
        for (const sub of dirsOf(p)) {
          if (/^apache-maven-/i.test(sub.split(/[\\/]/).pop() ?? '')) await add(sub, root)
        }
      } else {
        await add(p, root)
      }
    }
  }

  // C:\apache-maven-*
  if (isWin) {
    for (const p of dirsOf('C:\\')) {
      if (/^apache-maven-/i.test(p.split(/[\\/]/).pop() ?? '')) await add(p, 'C:')
    }
  }

  // IntelliJ 自带的 Maven（plugins/maven/lib/maven3）
  if (isWin) {
    for (const product of jetbrainsProductDirs()) {
      const m3 = join(product, 'plugins', 'maven', 'lib', 'maven3')
      if (mvnBin(m3)) await add(m3, `${product.split(/[\\/]/).pop()} (bundled)`)
    }
  }

  return [...found.values()].sort((a, b) => String(b.version ?? '').localeCompare(String(a.version ?? '')))
}

async function detectPython(): Promise<ToolCandidate[]> {
  const found = new Map<string, ToolCandidate>()
  const add = async (exe: string | undefined | null, source: string) => {
    if (!exe) return
    if (!existsSync(exe) && !commandExists(exe)) return
    const key = exe.replace(/\\/g, '/').toLowerCase()
    if (found.has(key)) return
    const version = await probePython(exe)
    if (!version) return
    found.set(key, { path: exe, version, source })
  }

  for (const cmd of ['python', 'python3', 'py']) {
    for (const p of await where(cmd)) await add(p, 'PATH')
  }

  const roots: string[] = []
  if (process.env.LOCALAPPDATA) roots.push(join(process.env.LOCALAPPDATA, 'Programs', 'Python'))
  if (process.env.USERPROFILE) {
    roots.push(join(process.env.USERPROFILE, 'miniconda3'), join(process.env.USERPROFILE, 'anaconda3'))
  }
  if (process.env.ProgramData) {
    roots.push(join(process.env.ProgramData, 'miniconda3'), join(process.env.ProgramData, 'anaconda3'))
  }
  if (isWin) {
    for (const p of dirsOf('C:\\')) {
      if (/^python\d*/i.test(p.split(/[\\/]/).pop() ?? '')) roots.push(p)
    }
  }

  for (const root of roots) {
    const exe = join(root, isWin ? 'python.exe' : 'bin/python')
    if (existsSync(exe)) {
      await add(exe, root)
      continue
    }
    for (const p of dirsOf(root)) {
      const inner = join(p, isWin ? 'python.exe' : 'bin/python')
      if (existsSync(inner)) await add(inner, root)
    }
  }

  return [...found.values()].sort((a, b) => String(b.version ?? '').localeCompare(String(a.version ?? '')))
}

async function detectNode(): Promise<ToolCandidate[]> {
  const found = new Map<string, ToolCandidate>()
  const add = async (exe: string | undefined | null, source: string) => {
    if (!exe) return
    if (!existsSync(exe) && !commandExists(exe)) return
    const key = exe.replace(/\\/g, '/').toLowerCase()
    if (found.has(key)) return
    const version = await probeNode(exe)
    if (!version) return
    found.set(key, { path: exe, version, source })
  }

  for (const p of await where('node')) await add(p, 'PATH')
  if (isWin) {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
    await add(join(pf, 'nodejs', 'node.exe'), pf)
    if (process.env.APPDATA) {
      for (const p of dirsOf(join(process.env.APPDATA, 'nvm'))) {
        await add(join(p, 'node.exe'), 'nvm')
      }
    }
  } else {
    await add('/usr/local/bin/node', '/usr/local/bin')
    await add('/usr/bin/node', '/usr/bin')
  }

  return [...found.values()].sort((a, b) => String(b.version ?? '').localeCompare(String(a.version ?? '')))
}

export async function detectToolchain(): Promise<{
  java: ToolCandidate[]
  maven: ToolCandidate[]
  python: ToolCandidate[]
  node: ToolCandidate[]
}> {
  const java = await detectJava()
  const s = readSettings()
  const preferredJava = s.javaHome ?? java.find((c) => c.version)?.path ?? null
  const [maven, python, node] = await Promise.all([detectMaven(preferredJava), detectPython(), detectNode()])
  return { java, maven, python, node }
}

export async function validatePythonPath(exe: string): Promise<{ ok: boolean; version: string | null; error?: string }> {
  if (!existsSync(exe) && !commandExists(exe)) {
    return { ok: false, version: null, error: `未找到 Python 可执行文件：${exe}` }
  }
  const version = await probePython(exe)
  if (!version) return { ok: false, version: null, error: '无法执行 python --version' }
  return { ok: true, version }
}

export async function validateNodePath(exe: string): Promise<{ ok: boolean; version: string | null; error?: string }> {
  if (!existsSync(exe) && !commandExists(exe)) {
    return { ok: false, version: null, error: `未找到 Node 可执行文件：${exe}` }
  }
  const version = await probeNode(exe)
  if (!version) return { ok: false, version: null, error: '无法执行 node --version' }
  return { ok: true, version }
}

export async function validateJavaHome(home: string): Promise<{ ok: boolean; version: string | null; error?: string }> {
  if (!existsSync(join(home, 'bin', isWin ? 'java.exe' : 'java'))) {
    return { ok: false, version: null, error: `未找到 ${join(home, 'bin', isWin ? 'java.exe' : 'java')}` }
  }
  const version = await probeJava(home)
  if (!version) return { ok: false, version: null, error: '无法执行 java -version' }
  return { ok: true, version }
}

export async function validateMavenHome(
  home: string,
  javaHome: string | null,
): Promise<{ ok: boolean; version: string | null; error?: string }> {
  const bin = mvnBin(home)
  if (!bin) return { ok: false, version: null, error: `未找到 ${join(home, 'bin', isWin ? 'mvn.cmd' : 'mvn')}` }
  const version = await probeMaven(home, javaHome)
  if (!version) {
    return {
      ok: false,
      version: null,
      error: 'mvn -v 执行失败（请先配置可用的 JDK，或检查 MAVEN_HOME）',
    }
  }
  return { ok: true, version }
}

export interface LocalUser {
  name: string
  email: string | null
  host: string
}

export async function getLocalUser(): Promise<LocalUser> {
  let name = ''
  let email = ''
  try {
    name = (await execFileAsync('git', ['config', '--global', 'user.name'], { windowsHide: true })).stdout.trim()
  } catch {
    /* ignore */
  }
  try {
    email = (await execFileAsync('git', ['config', '--global', 'user.email'], { windowsHide: true })).stdout.trim()
  } catch {
    /* ignore */
  }
  let host = os.hostname()
  try {
    host = os.hostname()
  } catch {
    /* ignore */
  }
  return { name: name || os.userInfo().username, email: email || null, host }
}
