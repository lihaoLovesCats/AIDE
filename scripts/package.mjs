import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { bundleServer } from './bundle-server.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : null
}

const version = argValue('--version') ?? rootPkg.version
const skipBuild = has('--skip-build')
const noInstaller = has('--no-installer')

const outRoot = join(ROOT, 'dist-package')
const stageName = `AIDE-${version}`
const stage = join(outRoot, stageName)
const appDir = join(stage, 'app')

function run(cmd, cmdArgs, cwd = ROOT, label = '') {
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', windowsHide: false })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`${label || cmd} failed with exit code ${res.status}`)
}

function sizeMb(path) {
  if (!existsSync(path)) return 0
  if (statSync(path).isFile()) return statSync(path).size / 1024 / 1024
  return 0
}

const buildDate = new Date()
const buildIso = buildDate.toISOString()
const buildHuman = buildDate.toLocaleString('zh-CN', { hour12: false })
let gitCommit = ''
try {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
  if (r.status === 0) gitCommit = (r.stdout || '').trim()
} catch {
  /* ignore */
}

function readme() {
  return `AIDE 内部测试版 ${version}
构建时间：${buildHuman}
构建版本：${gitCommit || 'local'} / Node ${process.version} / win32-x64

一、这是什么
AIDE 是一个 Agent 驱动的多语言 Web IDE：没有传统编辑器，左侧选项目，右侧与多个 Agent 对话；
经理 Agent 按功能模块调度，Git 项目使用独立 worktree，支持一键提交/推送、运行预览与项目知识。

二、前置条件
- Windows 10/11 x64；
- 已安装 Claude Code CLI（claude）并完成登录：https://docs.anthropic.com/en/docs/claude-code
- Git 可选：Git 项目可以用 worktree/提交/分支；
- SVN 可选：SVN 项目需要 svn 命令行客户端（SlikSVN/TortoiseSVN CLI），使用共享工作副本；
- 非版本控制项目也可以直接使用；
- 无需安装 Node.js（安装包已自带 node.exe）。

三、安装与启动
方式 A（安装包）：双击 AIDE-Setup-${version}.exe，按向导安装（当前为用户级安装，无需管理员），
  安装完成后勾选启动，或从开始菜单/桌面打开 AIDE。
方式 B（免安装 ZIP）：解压 AIDE-${version}-win-x64.zip 到任意目录，双击 start-aide.cmd。

启动后会打开 http://127.0.0.1:7800 。如果 7800 被占用，可设置环境变量 AIDE_PORT 换端口；
停止：关闭 AIDE 的命令行窗口，或双击 stop-aide.cmd。
Windows SmartScreen 可能提示“未知发布者”，这是内部未签名版本，选择“更多信息 → 仍要运行”。

四、数据与日志
- 数据目录：%APPDATA%\\AIDE
  - aide.db（项目/会话/消息/设置）
  - server.log（服务日志）
  - server.pid（用于 stop-aide.cmd）
  - mcp/（Agent 的 MCP 配置）
- 卸载不会删除数据目录；需要彻底清理时手动删除 %APPDATA%\\AIDE。

五、快速自测清单
1. 首次打开：注册一个本地项目（文件夹选择器可选任意目录）。
2. 与项目经理对话，让它说明当前模块与负责人。
3. 新建一个模块 Agent（只填模块/任务），确认标题会自动变成模块名。
4. 在经理里派发任务，确认派发卡片会从“执行中”变为“已完成”。
5. 两个模块 Agent 互相发协作消息（跨模块协作卡片）。
6. 打开设置：自动检测 JDK/Maven/Python/Node；保存后确认版本显示正确。
7. 运行预览：启动某个会话的运行实例，查看日志与端口。
8. 非版本控制项目：注册后确认 VCS 区显示“无版本控制”、提交按钮禁用。
9. 一键提交：Git 项目修改后提交，确认测试门禁/提交信息/推送流程。
10. SVN 项目：注册含 .svn 的目录，确认显示 SVN/working copy，可提交并查看 rN 日志。
11. 项目知识：点击项目头部书本图标，查看 CLAUDE.md 来源，生成 .aide/PROJECT.md 等文档。

六、已知限制（内部测试）
- 默认端口 7800，可用 AIDE_PORT 覆盖；
- SVN 为共享工作副本，没有独立 worktree/分支合并；
- 知识生成会调用 Claude，耗时约 1–3 分钟；
- 运行实例只存在内存中，关闭 AIDE 后需要重新启动；
- 费用来自 Claude CLI 的 total_cost_usd，AIDE 只做累计与展示；
- 安装包未签名，SmartScreen 可能拦截；
- 当前只提供 win-x64。

七、反馈
请附上：操作步骤、截图、%APPDATA%\\AIDE\\server.log 的相关片段、以及项目是 Git / SVN / 非版本控制。
`
}

console.log(`[package] AIDE ${version}`)
console.log(`[package] stage: ${stage}`)

if (!skipBuild) {
  console.log('[package] building web + server ...')
  run('cmd.exe', ['/d', '/s', '/c', 'pnpm build'], ROOT, 'pnpm build')
}

for (const required of ['server/dist/index.js', 'prototype/dist/index.html']) {
  if (!existsSync(join(ROOT, required))) throw new Error(`missing build output: ${required}`)
}

mkdirSync(outRoot, { recursive: true })
rmSync(stage, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })

// 1) server bundle (single ESM file, no node_modules in the installer)
console.log('[package] bundling server (esbuild) ...')
mkdirSync(join(appDir, 'server'), { recursive: true })
copyFileSync(join(ROOT, 'server/package.json'), join(appDir, 'server/package.json'))
mkdirSync(join(appDir, 'server/dist'), { recursive: true })
await bundleServer(join(appDir, 'server/dist/index.js'))
cpSync(join(ROOT, 'server/mcp'), join(appDir, 'server/mcp'), { recursive: true })

console.log('[package] copying web dist ...')
cpSync(join(ROOT, 'prototype/dist'), join(appDir, 'web'), { recursive: true })

// 2) bundled node runtime
console.log('[package] bundling node runtime ...')
mkdirSync(join(stage, 'node'), { recursive: true })
copyFileSync(process.execPath, join(stage, 'node', 'node.exe'))

// 3) launchers + docs
for (const file of ['start-aide.cmd', 'stop-aide.cmd', 'open-browser.ps1']) {
  copyFileSync(join(ROOT, 'installer', file), join(stage, file))
}
writeFileSync(join(stage, 'README-内部测试.txt'), readme(), 'utf8')
writeFileSync(join(stage, 'VERSION'), `${version}\n${buildIso}\n`, 'utf8')
writeFileSync(
  join(stage, 'build-info.json'),
  JSON.stringify(
    {
      name: 'AIDE',
      version,
      buildDate: buildIso,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      git: gitCommit || null,
    },
    null,
    2,
  ) + '\n',
  'utf8',
)
if (existsSync(join(ROOT, 'README.md'))) copyFileSync(join(ROOT, 'README.md'), join(stage, 'README.md'))

// 4) portable zip
const zip = join(outRoot, `AIDE-${version}-win-x64.zip`)
rmSync(zip, { force: true })
console.log('[package] creating portable zip ...')
let zipped = false
try {
  run('tar.exe', ['-a', '-c', '-f', zip, '-C', stage, '.'], ROOT, 'tar zip')
  zipped = existsSync(zip)
} catch {
  /* fallback below */
}
if (!zipped) {
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`,
    ],
    ROOT,
    'Compress-Archive',
  )
}

// 5) Windows installer (Inno Setup)
const isccCandidates = [
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\ProgramData\\chocolatey\\bin\\ISCC.exe',
]
const iscc = isccCandidates.find((p) => existsSync(p))
let setup = null
if (!noInstaller && iscc) {
  console.log('[package] compiling Windows installer ...')
  run(
    iscc,
    [
      `/DStageDir=${stage}`,
      `/DOutputDir=${outRoot}`,
      `/DAppVersion=${version}`,
      join(ROOT, 'installer', 'aide.iss'),
    ],
    ROOT,
    'ISCC',
  )
  const candidate = join(outRoot, `AIDE-Setup-${version}.exe`)
  if (existsSync(candidate)) setup = candidate
} else if (!noInstaller) {
  console.warn('[package] ISCC.exe not found; skipped Windows installer')
}

const zipSize = existsSync(zip) ? statSync(zip).size / 1024 / 1024 : 0
const setupSize = setup ? statSync(setup).size / 1024 / 1024 : 0
console.log('')
console.log(`[package] done: ${stage}`)
console.log(`[package] zip:  ${zip} (${zipSize.toFixed(1)} MB)`)
if (setup) console.log(`[package] setup: ${setup} (${setupSize.toFixed(1)} MB)`)
