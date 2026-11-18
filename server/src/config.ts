import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 以模块位置定位 server 根目录，避免从不同工作目录启动时数据/前端路径错位
const HERE = dirname(fileURLToPath(import.meta.url))
export const SERVER_ROOT = resolve(HERE, '..')

export const DATA_DIR = process.env.AIDE_DATA ? resolve(process.env.AIDE_DATA) : join(SERVER_ROOT, 'data')
mkdirSync(DATA_DIR, { recursive: true })

export const DB_PATH = join(DATA_DIR, 'aide.db')
export const WEB_DIST = process.env.AIDE_WEB_DIST
  ? resolve(process.env.AIDE_WEB_DIST)
  : resolve(SERVER_ROOT, '..', 'prototype', 'dist')
export const HOST = process.env.AIDE_HOST ?? '127.0.0.1'
export const PORT = Number(process.env.AIDE_PORT ?? 7800)
export const CLAUDE_TIMEOUT_MS = Number(process.env.AIDE_CLAUDE_TIMEOUT ?? 10 * 60 * 1000)
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? ''
