// 同时启动后端（7800）与前端 Vite（5180），Ctrl+C 一起退出。
import { spawn } from 'node:child_process'

const children = []
let stopping = false

function kill(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* ignore */
  }
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) kill(c.pid)
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

function start(label, command) {
  const child = spawn(command, { stdio: 'inherit', shell: true, env: process.env })
  child.on('exit', (code) => {
    console.log(`[${label}] 退出（code=${code}）`)
    stop(code ?? 0)
  })
  children.push(child)
}

console.log('AIDE dev: server http://127.0.0.1:7800 · web http://127.0.0.1:5180')
start('server', 'pnpm --dir server dev')
start('web', 'pnpm --dir prototype dev')
