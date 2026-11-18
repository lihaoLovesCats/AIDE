import type { ServerResponse } from 'node:http'

interface Client {
  id: string
  res: ServerResponse
}

const clients = new Map<string, Client>()

export function addClient(id: string, res: ServerResponse): void {
  clients.set(id, { id, res })
  res.on('close', () => clients.delete(id))
}

export function removeClient(id: string): void {
  clients.delete(id)
}

export function clientCount(): number {
  return clients.size
}

export function broadcast(event: Record<string, unknown>): void {
  const line = `data: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`
  for (const [id, c] of clients) {
    try {
      c.res.write(line)
    } catch {
      clients.delete(id)
    }
  }
}

const heartbeat = setInterval(() => {
  for (const [id, c] of clients) {
    try {
      c.res.write(': ping\n\n')
    } catch {
      clients.delete(id)
    }
  }
}, 15000)
heartbeat.unref()
