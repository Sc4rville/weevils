import { deliveryContext } from './outbox.ts'
import fs from 'node:fs'
import crypto from 'node:crypto'
import WebSocket from 'ws'
import { tr } from './i18n.ts'
import M from './i18n/codex-bridge.ts'

type Rpc = (method: string, params?: object) => Promise<any>
type Connect = <T>(socket: string, run: (rpc: Rpc) => Promise<T>) => Promise<T>
/** Connect only to the explicitly configured, already running daemon. Never spawn or resume. */
const connect: Connect = async (socket, run) => {
  const stat = fs.statSync(socket)
  if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error(tr(M).unavailable)
  const ws = new WebSocket(`ws+unix://${socket}:/`)
  let seq = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(tr(M).uncertain)) }; pending.clear() }
  ws.on('error', fail); ws.on('close', fail)
  ws.on('message', data => {
    let m: any
    try { m = JSON.parse(data.toString()) } catch { return }
    const p = pending.get(m.id)
    if (!p) return // Never answer approvals or tool requests owned by another client.
    pending.delete(m.id); clearTimeout(p.timer)
    if (m.error) p.reject(new Error(tr(M).unavailable))
    else p.resolve(m.result)
  })
  const rpc: Rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(tr(M).uncertain)) }, 5000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }), err => { if (err) { clearTimeout(timer); pending.delete(id); reject(new Error(tr(M).unavailable)) } })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(tr(M).unavailable)), 3000)
      ws.once('open', () => { clearTimeout(timer); resolve() })
      ws.once('error', () => { clearTimeout(timer); reject(new Error(tr(M).unavailable)) })
    })
    await rpc('initialize', { clientInfo: { name: 'weevils', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    ws.send(JSON.stringify({ method: 'initialized' }))
    return await run(rpc)
  } finally { fail(); ws.terminate() }
}

export class CodexBridge {
  private loaded = new Set<string>()
  private checked = 0
  private busy = false
  private socket: string
  private transport: Connect
  private changed: () => void
  constructor(socket = '', transport: Connect = connect, changed = () => {}) { this.socket = socket; this.transport = transport; this.changed = changed }
  can(id: string) { return !!this.socket && Date.now() - this.checked < 20_000 && this.loaded.has(id) }
  private async ids(rpc: Rpc) {
    const ids = new Set<string>(); let cursor: string | undefined
    do {
      const page = await rpc('thread/loaded/list', cursor ? { cursor } : {})
      for (const id of page.data ?? []) if (typeof id === 'string') ids.add(id)
      cursor = page.nextCursor || undefined
    } while (cursor)
    return ids
  }
  /** Native durable queue survives both disconnects and weevils restarts. */
  private async drain(rpc: Rpc, id: string) {
    const state = await rpc('thread/read', { threadId: id, includeTurns: false })
    if (state.thread?.status?.type !== 'idle') return
    const queue = await rpc('thread/queue/list', { threadId: id })
    const first = queue.data?.[0]
    if (!first?.clientUserMessageId?.startsWith('weevils:')) return
    await rpc('thread/queue/start', { threadId: id, queuedSubmissionId: first.id })
  }
  async refresh() {
    if (!this.socket || this.busy) return
    this.busy = true
    try {
      await this.transport(this.socket, async rpc => {
        this.loaded = await this.ids(rpc); this.checked = Date.now(); this.changed()
        for (const id of this.loaded) await this.drain(rpc, id)
      })
    } catch { this.loaded.clear(); this.checked = 0; this.changed() }
    finally { this.busy = false }
  }
  async send(id: string, text: string) {
    if (!this.socket) throw new Error(tr(M).unavailable)
    await this.transport(this.socket, async rpc => {
      if (!(await this.ids(rpc)).has(id)) throw new Error(tr(M).unavailable)
      const key = `weevils:${deliveryContext.getStore()?.messageId ?? crypto.randomUUID()}`
      const out = await rpc('thread/queue/add', { threadId: id, clientUserMessageId: key, input: [{ type: 'text', text, text_elements: [] }] })
      if (out.queuedSubmission?.clientUserMessageId !== key) throw new Error(tr(M).uncertain)
      // The queue acknowledgement is delivery. Failure to start must never trigger a resend.
      try { await this.drain(rpc, id) } catch { /* the next poll retries the same native queue entry */ }
    })
  }
}
