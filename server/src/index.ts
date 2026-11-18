import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, DB_PATH, HOST, PORT, WEB_DIST } from './config.js'
import { claudeVersion, resolveClaudeBinary } from './claude.js'
import { resetOrphanSessions } from './db.js'
import { registerRoutes } from './routes.js'
import { stopAllRuns } from './runtime.js'
import { shutdownAll } from './sessions.js'

const app = Fastify({
  logger: { level: process.env.AIDE_LOG ?? 'info' },
  bodyLimit: 4 * 1024 * 1024,
})

await app.register(cors, { origin: true, credentials: true })

const hasWeb = existsSync(join(WEB_DIST, 'index.html'))
if (hasWeb) {
  await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' })
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? ''
    if (url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

await app.register(registerRoutes)

const reset = resetOrphanSessions()

try {
  await app.listen({ host: HOST, port: PORT })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// 打包版通过该文件停止整个进程树（含 claude 子进程）
const pidFile = join(DATA_DIR, 'server.pid')
try {
  writeFileSync(pidFile, String(process.pid), 'utf8')
} catch {
  /* ignore */
}
process.on('exit', () => {
  try {
    rmSync(pidFile, { force: true })
  } catch {
    /* ignore */
  }
})

app.log.info(
  {
    db: DB_PATH,
    claude: resolveClaudeBinary(),
    claudeVersion: claudeVersion(),
    resetSessions: reset,
    web: hasWeb ? WEB_DIST : null,
    url: `http://${HOST}:${PORT}`,
  },
  'AIDE server ready',
)

let closing = false
const shutdown = async (signal: string) => {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  await shutdownAll().catch(() => {})
  await stopAllRuns().catch(() => {})
  await app.close().catch(() => {})
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
