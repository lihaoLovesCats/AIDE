import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CLAUDE_BIN } from './config.js'

let cached: string | null = null
let version: string | null = null

export function resolveClaudeBinary(): string {
  if (cached) return cached
  const candidates: string[] = []
  if (CLAUDE_BIN) candidates.push(CLAUDE_BIN)
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  }
  for (const c of candidates) {
    if (c && existsSync(c)) {
      cached = c
      return c
    }
  }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim()
    const p = join(root, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(p)) {
      cached = p
      return p
    }
  } catch {
    /* ignore */
  }
  cached = 'claude'
  return cached
}

export function claudeVersion(): string | null {
  if (version) return version
  try {
    version = execFileSync(resolveClaudeBinary(), ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    }).trim()
  } catch {
    version = null
  }
  return version
}

export function claudeAvailable(): boolean {
  return Boolean(claudeVersion())
}

export const CLAUDE_INSTALL_HINT =
  '未检测到 Claude Code CLI。请先安装并登录 Claude Code（https://docs.anthropic.com/en/docs/claude-code），然后重启 AIDE 或点击重试。'
