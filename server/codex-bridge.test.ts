import { expect, it, vi } from 'vitest'
import { CodexBridge } from './codex-bridge.ts'
const fixture = (active = false) => {
  const queue: any[] = []
  const calls: string[] = []
  const rpc = vi.fn(async (method: string, p: any = {}) => {
    calls.push(method)
    if (method === 'thread/loaded/list') return { data: ['existing'], nextCursor: null }
    if (method === 'thread/read') return { thread: { status: { type: active ? 'active' : 'idle' } } }
    if (method === 'thread/queue/list') return { data: queue }
    if (method === 'thread/queue/add') { const q = { id: 'queued', ...p }; queue.push(q); return { queuedSubmission: q } }
    if (method === 'thread/queue/start') { queue.shift(); return {} }
    throw new Error('unexpected method')
  })
  const transport = async <T>(_socket: string, run: (rpc: any) => Promise<T>) => run(rpc)
  return { queue, calls, rpc, transport, idle: () => { active = false } }
}
it('queues while active and starts the same durable entry only after idle', async () => {
  const f = fixture(true), bridge = new CodexBridge('/test/socket', f.transport)
  await bridge.refresh()
  expect(bridge.can('existing')).toBe(true)
  await bridge.send('existing', 'a user answer')
  expect(f.queue).toHaveLength(1)
  expect(f.calls).not.toContain('thread/queue/start')
  const input = f.rpc.mock.calls.find(c => c[0] === 'thread/queue/add')![1].input
  expect(input[0].text).toBe('a user answer')
  f.idle()
  // A fresh weevils instance recovers the queue from the existing daemon.
  await new CodexBridge('/test/socket', f.transport).refresh()
  expect(f.queue).toHaveLength(0)
  expect(f.calls.filter(c => c === 'thread/queue/add')).toHaveLength(1)
  expect(f.calls.some(c => /resume|interrupt|steer|thread\/start/.test(c))).toBe(false)
})
it('never loads missing threads, and a disabled bridge never connects', async () => {
  const f = fixture(), bridge = new CodexBridge('/test/socket', f.transport)
  await expect(bridge.send('missing', 'hello')).rejects.toThrow()
  expect(f.calls).toEqual(['thread/loaded/list'])
  f.calls.length = 0
  await new CodexBridge('', f.transport).refresh()
  expect(f.calls).toEqual([])
})
it('keeps an acknowledged message queued if starting fails without resending', async () => {
  const f = fixture()
  const transport = async <T>(_s: string, run: (rpc: any) => Promise<T>) => run((m: string, p: any) => m === 'thread/queue/start' ? Promise.reject(new Error('offline')) : f.rpc(m, p))
  await new CodexBridge('/test/socket', transport).send('existing', 'hello')
  expect(f.queue).toHaveLength(1)
  expect(f.calls.filter(c => c === 'thread/queue/add')).toHaveLength(1)
})
it('uses the real Unix WebSocket transport and acknowledges a queued user message', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path')
  const { createServer } = await import('node:http')
  const { WebSocketServer } = await import('ws')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-bridge-'))
  const socket = path.join(dir, 'rpc.sock'), http = createServer(), server = new WebSocketServer({ server: http })
  const f = fixture()
  server.on('connection', ws => ws.on('message', async data => {
    const m = JSON.parse(data.toString())
    if (!m.id) return
    const result = m.method === 'initialize' ? {} : await f.rpc(m.method, m.params)
    ws.send(JSON.stringify({ id: m.id, result }))
  }))
  await new Promise<void>(resolve => http.listen(socket, resolve))
  try {
    const bridge = new CodexBridge(socket)
    await bridge.refresh()
    expect(bridge.can('existing')).toBe(true)
    await bridge.send('existing', 'Exact user wording')
    expect(f.calls.filter(m => m === 'thread/queue/add')).toHaveLength(1)
    expect(f.calls.filter(m => m === 'thread/queue/start')).toHaveLength(1)
  } finally {
    for (const client of server.clients) client.terminate()
    await new Promise<void>(resolve => server.close(() => http.close(() => resolve())))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
