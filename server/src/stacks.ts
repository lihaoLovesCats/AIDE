import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mavenCommand, nodeCommand, pythonCommand } from './settings.js'

const isWin = process.platform === 'win32'
const PORT_REF = isWin ? '%PORT%' : '${PORT}'

export interface StackInfo {
  kind: 'java' | 'python' | 'node' | 'go' | 'rust' | 'static' | 'unknown'
  label: string
  language: string
  framework: string | null
  testCommand: string | null
  runCommand: string | null
}

interface ProjectCommands {
  testCommand?: string | null
  runCommand?: string | null
}

const q = (s: string) => (/[\s"]/.test(s) ? `"${s}"` : s)

function commandExists(cmd: string): boolean {
  if (/[\\/]/.test(cmd)) return existsSync(cmd)
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(isWin ? ';' : ':')) {
    if (!dir) continue
    for (const ext of exts) if (existsSync(join(dir, cmd + ext))) return true
  }
  return false
}

function text(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function dirs(root: string): string[] {
  try {
    return readdirSync(root).map((n) => join(root, n))
  } catch {
    return []
  }
}

function hasTestsDir(cwd: string): boolean {
  const tests = join(cwd, 'tests')
  if (!existsSync(tests)) return false
  try {
    return readdirSync(tests).some((n) => /^(test_.*|.*_test)\.py$/i.test(n))
  } catch {
    return false
  }
}

interface NodePackage {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function nodePackage(cwd: string): NodePackage | null {
  if (!existsSync(join(cwd, 'package.json'))) return null
  return readJson<NodePackage>(join(cwd, 'package.json'))
}

function nodeFramework(pkg: NodePackage | null, cwd: string): string | null {
  if (!pkg) return null
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  if (deps.next) return 'Next.js'
  if (deps['@nestjs/core']) return 'NestJS'
  if (deps.vite) return 'Vite'
  if (deps.express) return 'Express'
  if (deps.fastify) return 'Fastify'
  if (deps.svelte) return 'Svelte'
  if (deps.vue) return 'Vue'
  if (deps.react) return 'React'
  if (existsSync(join(cwd, 'tsconfig.json')) || deps.typescript) return 'TypeScript'
  return null
}

function isTypeScript(cwd: string, pkg: NodePackage | null): boolean {
  if (existsSync(join(cwd, 'tsconfig.json'))) return true
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  if (deps.typescript) return true
  return ['src', 'app', 'lib'].some((d) => dirs(join(cwd, d)).some((p) => p.endsWith('.ts') || p.endsWith('.tsx')))
}

function pythonFramework(cwd: string): string | null {
  const blob = [
    text(join(cwd, 'pyproject.toml')),
    text(join(cwd, 'requirements.txt')),
    text(join(cwd, 'setup.py')),
    text(join(cwd, 'Pipfile')),
  ]
    .join('\n')
    .toLowerCase()
  if (existsSync(join(cwd, 'manage.py'))) return 'Django'
  if (blob.includes('fastapi')) return 'FastAPI'
  if (blob.includes('flask')) return 'Flask'
  if (blob.includes('django')) return 'Django'
  return null
}

function hasPython(cwd: string): boolean {
  return ['pyproject.toml', 'requirements.txt', 'setup.py', 'manage.py', 'Pipfile', 'uv.lock', 'poetry.lock'].some(
    (f) => existsSync(join(cwd, f)),
  )
}

function javaFramework(cwd: string): string | null {
  const blob = [text(join(cwd, 'pom.xml')), text(join(cwd, 'build.gradle')), text(join(cwd, 'build.gradle.kts'))]
    .join('\n')
    .toLowerCase()
  if (blob.includes('spring-boot')) return 'Spring Boot'
  return null
}

export function detectStackInfo(cwd: string): StackInfo {
  const hasPom = existsSync(join(cwd, 'pom.xml'))
  const hasGradle = existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))
  const hasJava = hasPom || hasGradle || existsSync(join(cwd, 'src', 'main', 'java'))
  const hasPy = hasPython(cwd)
  const pkg = nodePackage(cwd)
  const hasNodePkg = Boolean(pkg)
  const hasNodeScript = hasNode(cwd, pkg)
  const hasGo = existsSync(join(cwd, 'go.mod'))
  const hasRust = existsSync(join(cwd, 'Cargo.toml'))
  const hasStatic = !hasNodeScript && existsSync(join(cwd, 'index.html'))

  const labels: string[] = []
  let kind: StackInfo['kind'] = 'unknown'
  let language = ''
  let framework: string | null = null

  if (hasJava) {
    framework = javaFramework(cwd)
    labels.push(`Java${framework ? ` · ${framework}` : hasPom ? ' · Maven' : hasGradle ? ' · Gradle' : ''}`)
    kind = 'java'
    language = 'Java'
  }
  if (hasPy) {
    const fw = pythonFramework(cwd)
    labels.push(`Python${fw ? ` · ${fw}` : ''}`)
    if (kind === 'unknown') {
      kind = 'python'
      language = 'Python'
      framework = fw
    }
  }
  if (hasNodeScript) {
    const fw = nodeFramework(pkg, cwd)
    const ts = isTypeScript(cwd, pkg)
    labels.push(`Node${ts ? ' · TypeScript' : ''}${fw ? ` · ${fw}` : ''}`)
    if (kind === 'unknown') {
      kind = 'node'
      language = ts ? 'TypeScript' : 'JavaScript'
      framework = fw
    }
  }
  if (hasGo) {
    labels.push('Go')
    if (kind === 'unknown') {
      kind = 'go'
      language = 'Go'
    }
  }
  if (hasRust) {
    labels.push('Rust')
    if (kind === 'unknown') {
      kind = 'rust'
      language = 'Rust'
    }
  }
  if (!labels.length && hasStatic) {
    labels.push('Static HTML')
    kind = 'static'
    language = 'HTML'
  }

  const test = detectTestCommand(cwd, {})
  const run = detectRunCommand(cwd, {})
  return {
    kind,
    label: labels.join(' + ') || '未知',
    language: language || 'Unknown',
    framework,
    testCommand: test?.command ?? null,
    runCommand: run ?? null,
  }
}

/** 项目卡片/列表使用的简短技术栈 */
export function detectStack(cwd: string): string {
  return detectStackInfo(cwd).label
}

function pythonTestCommand(cwd: string): { command: string; label: string } | null {
  const py = q(pythonCommand())
  if (existsSync(join(cwd, 'manage.py'))) {
    return { command: `${py} manage.py test`, label: 'Django test' }
  }
  const blob = [text(join(cwd, 'pyproject.toml')), text(join(cwd, 'requirements.txt'))].join('\n').toLowerCase()
  const pytest =
    blob.includes('pytest') ||
    existsSync(join(cwd, 'pytest.ini')) ||
    existsSync(join(cwd, 'conftest.py')) ||
    hasTestsDir(cwd)
  if (pytest) return { command: `${py} -m pytest -q`, label: 'pytest' }
  if (existsSync(join(cwd, 'tests'))) {
    return { command: `${py} -m unittest discover -s tests -q`, label: 'unittest' }
  }
  return null
}

function hasNode(cwd: string, pkg: NodePackage | null): boolean {
  if (pkg) return true
  if (['server.js', 'server.mjs', 'index.js', 'index.mjs'].some((f) => existsSync(join(cwd, f)))) {
    // 没有 package.json 的纯 Node 脚本；如果同时有 index.html，更像静态站点
    return !existsSync(join(cwd, 'index.html')) || existsSync(join(cwd, 'server.js')) || existsSync(join(cwd, 'server.mjs'))
  }
  return false
}

function nodePackageManager(cwd: string): string {
  if (existsSync(join(cwd, 'pnpm-lock.yaml')) && commandExists('pnpm')) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock')) && commandExists('yarn')) return 'yarn'
  if ((existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) && commandExists('bun')) return 'bun'
  if (existsSync(join(cwd, 'package-lock.json')) && commandExists('npm')) return 'npm'
  // 没有锁文件时以 npm 为默认，避免把普通项目误判成 pnpm
  if (commandExists('npm')) return 'npm'
  for (const pm of ['pnpm', 'yarn', 'bun']) if (commandExists(pm)) return pm
  return 'npm'
}

export function detectTestCommand(
  cwd: string,
  project: ProjectCommands,
): { command: string; label: string } | null {
  const override = project.testCommand?.trim() || process.env.AIDE_TEST_CMD?.trim()
  if (override) return { command: override, label: project.testCommand ? '项目测试命令' : 'AIDE_TEST_CMD' }

  const hasPom = existsSync(join(cwd, 'pom.xml'))
  const hasGradle = existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))
  if (hasPom) {
    const wrapper = join(cwd, isWin ? 'mvnw.cmd' : 'mvnw')
    if (existsSync(wrapper)) return { command: `${q(wrapper)} -B -q test`, label: 'mvnw test' }
    const configured = mavenCommand()
    if (configured) return { command: `${q(configured)} -B -q test`, label: 'mvn test（已配置）' }
    if (commandExists('mvn')) return { command: 'mvn -B -q test', label: 'mvn test' }
    return null
  }
  if (hasGradle) {
    const wrapper = join(cwd, isWin ? 'gradlew.bat' : 'gradlew')
    if (existsSync(wrapper)) return { command: `${q(wrapper)} test`, label: 'gradlew test' }
    if (commandExists('gradle')) return { command: 'gradle test', label: 'gradle test' }
    return null
  }

  const pkg = nodePackage(cwd)
  if (pkg?.scripts?.test) {
    const pm = nodePackageManager(cwd)
    return {
      command: pm === 'npm' ? 'npm test --silent' : `${pm} test`,
      label: `${pm} test`,
    }
  }

  if (hasPython(cwd)) {
    const py = pythonTestCommand(cwd)
    if (py) return py
  }

  if (existsSync(join(cwd, 'go.mod')) && commandExists('go')) {
    return { command: 'go test ./...', label: 'go test' }
  }
  if (existsSync(join(cwd, 'Cargo.toml')) && commandExists('cargo')) {
    return { command: 'cargo test', label: 'cargo test' }
  }
  return null
}

function fastapiModule(cwd: string): string | null {
  const candidates: Array<[string, string]> = [
    ['main.py', 'main'],
    ['app.py', 'app'],
    ['app/main.py', 'app.main'],
    ['src/main.py', 'src.main'],
    ['backend/main.py', 'backend.main'],
  ]
  for (const [file, mod] of candidates) {
    const full = join(cwd, file)
    if (existsSync(full) && /FastAPI\s*\(/.test(text(full))) return mod
  }
  return null
}

function flaskModule(cwd: string): string | null {
  if (existsSync(join(cwd, 'app.py'))) return 'app'
  if (existsSync(join(cwd, 'wsgi.py'))) return 'wsgi'
  if (existsSync(join(cwd, 'main.py'))) return 'main'
  return null
}

export function detectRunCommand(cwd: string, project: ProjectCommands): string | null {
  const override = project.runCommand?.trim() || process.env.AIDE_RUN_CMD?.trim()
  if (override) return override

  const hasPom = existsSync(join(cwd, 'pom.xml'))
  const hasGradle = existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))
  if (hasPom) {
    if (existsSync(join(cwd, isWin ? 'mvnw.cmd' : 'mvnw'))) return 'mvnw spring-boot:run'
    const configured = mavenCommand()
    if (configured) return `${q(configured)} spring-boot:run`
    if (commandExists('mvn')) return 'mvn spring-boot:run'
  }
  if (hasGradle) {
    if (existsSync(join(cwd, isWin ? 'gradlew.bat' : 'gradlew'))) return 'gradlew bootRun'
    if (commandExists('gradle')) return 'gradle bootRun'
  }

  if (hasPython(cwd)) {
    const py = q(pythonCommand())
    if (existsSync(join(cwd, 'manage.py'))) {
      return `${py} manage.py runserver 127.0.0.1:${PORT_REF} --noreload`
    }
    const fastapi = fastapiModule(cwd)
    if (fastapi) {
      return `${py} -m uvicorn ${fastapi}:app --host 127.0.0.1 --port ${PORT_REF}`
    }
    const flask = flaskModule(cwd)
    if (flask) {
      return `${py} -m flask --app ${flask} run --host 127.0.0.1 --port ${PORT_REF}`
    }
    if (existsSync(join(cwd, 'main.py'))) return `${py} main.py`
    if (existsSync(join(cwd, 'app.py'))) return `${py} app.py`
  }

  const pkg = nodePackage(cwd)
  if (pkg) {
    const pm = nodePackageManager(cwd)
    const scripts = pkg.scripts ?? {}
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const name of ['dev', 'start', 'preview', 'serve']) {
      const script = scripts[name]
      if (!script) continue
      let extra = ''
      if (!script.includes('--port')) {
        if (deps.vite) extra = ` -- --port ${PORT_REF} --strictPort --host 127.0.0.1`
        else if (deps.next) extra = ` -- -p ${PORT_REF} -H 127.0.0.1`
      }
      return `${pm} run ${name}${extra}`
    }
    for (const file of ['server.js', 'index.js', 'server.mjs', 'index.mjs']) {
      if (existsSync(join(cwd, file))) return `${q(nodeCommand())} ${file}`
    }
  }

  if (!pkg) {
    for (const file of ['server.js', 'server.mjs']) {
      if (existsSync(join(cwd, file))) return `${q(nodeCommand())} ${file}`
    }
    if (!existsSync(join(cwd, 'index.html'))) {
      for (const file of ['index.js', 'index.mjs']) {
        if (existsSync(join(cwd, file))) return `${q(nodeCommand())} ${file}`
      }
    }
  }

  if (existsSync(join(cwd, 'go.mod')) && commandExists('go')) return 'go run .'
  if (existsSync(join(cwd, 'Cargo.toml')) && commandExists('cargo')) return 'cargo run'
  if (!pkg && existsSync(join(cwd, 'index.html'))) {
    return `${q(pythonCommand())} -m http.server ${PORT_REF} --bind 127.0.0.1`
  }
  return null
}

/** 给 Agent 的项目上下文：技术栈 + 测试/运行命令 */
export function stackPrompt(cwd: string): string {
  const info = detectStackInfo(cwd)
  const lines = [`项目技术栈：${info.label}。`]
  if (info.testCommand) lines.push(`测试命令：${info.testCommand}`)
  if (info.runCommand) lines.push(`运行命令：${info.runCommand}`)
  lines.push('先读取项目清单（pom.xml / pyproject.toml / package.json / go.mod 等）确认技术栈，不要默认 Java 或 Maven。')
  return lines.join('\n')
}
