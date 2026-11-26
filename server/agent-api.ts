// The agents' address (docs/agents.md): a program elsewhere writes to weevboss with an agent key (server/agent-keys.ts),
// on weevilsd's app port, outside /api and before the app's sign-in:
//
//   POST /agent/v1/messages            {"text": "…"} (or text/plain) → 202 {id, status: "sent"}
//   GET  /agent/v1/messages/:id?wait=N  → {id, status: "working" | "answered" | "timeout", reply?}; wait ≤ 25 s long-polls
//
// Authorization: Bearer <agent key>, and nothing else: no cookie, no access code, no CORS (server to server). The key
// never opens /api, and nothing here opens anything but these two addresses. The message reaches weevboss the way the
// app's own messages do (Weevils.sendMain), signed by the server with the key's author: `[from:<id>] text`. The author
// comes from the key, never from the body; a `[from:…]` the agent writes stays quoted content inside its text
// (authors.ts signAs). It never arrives as the user. weevboss's reply is awaited in the background (like the mail
// bridge, 45 min) and kept in memory a day, the last 200 per key; a key reads only its own messages.
// Only on the machine that runs weevboss; elsewhere every address here answers 404.
import crypto from 'node:crypto'
import type http from 'node:http'
import { signAs } from './authors.ts'
import { clientAddress } from './http.ts'
import { tr } from './i18n.ts'
import M from './i18n/agent-keys.ts'
import { OutboxDeferred, OutboxError } from './outbox.ts'
import { AgentKeyError, type AgentKeyStore, type AgentKeyView } from './agent-keys.ts'

export const AGENT_PREFIX = '/agent/v1'
export const MAX_TEXT = 20_000
/** Raw body bytes: 20 000 characters, JSON-escaped at worst. */
const MAX_BODY = 256 << 10
const MAX_WAIT_S = 25
const KEEP_MS = 24 * 3600_000
const KEEP_PER_KEY = 200

export interface AgentApiOptions {
  store: AgentKeyStore
  /** This machine runs weevboss (ORCHESTRATOR). */
  enabled: () => boolean
  /** Into weevboss's thread, as the app's messages go (Weevils.sendMain with origin 'server'). */
  send: (text: string) => Promise<unknown>
  /** weevboss's written reply to what was sent at `since` (Weevils.waitMainReply). */
  waitReply: (since: number, timeoutMs: number) => Promise<string | null>
  /** How long a reply is awaited (WEEVILS_MAIL_REPLY_MIN's default: 45 min). */
  replyTimeoutMs?: number
  /** Messages per key: per minute, per hour. */
  perMinute?: number
  perHour?: number
  /** Wrong keys per address and minute before 429. */
  badPerMinute?: number
  now?: () => number
  log?: (line: string) => void
}

/** Hits per key in a fixed window. */
class Window {
  private hits = new Map<string, { start: number; n: number }>()
  private limit: number
  private ms: number
  constructor(limit: number, ms: number) {
    this.limit = limit
    this.ms = ms
  }
  /** 0 when allowed, else the seconds until the window opens again. */
  take(key: string, t: number): number {
    let w = this.hits.get(key)
    if (!w || t - w.start >= this.ms) {
      if (this.hits.size > 10_000) for (const [k, x] of this.hits) if (t - x.start >= this.ms) this.hits.delete(k)
      w = { start: t, n: 0 }
      this.hits.set(key, w)
    }
    if (w.n >= this.limit) return Math.max(1, Math.ceil((w.start + this.ms - t) / 1000))
    w.n++
    return 0
  }
}

interface Sent {
  id: string
  at: number
  status: 'working' | 'answered' | 'timeout'
  reply?: string
  done: Promise<void>
}

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(JSON.stringify(body))
}

function readRaw(req: http.IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) over = true
      else chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The bearer token of a request, or ''. */
const bearer = (req: http.IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''

export function agentHttp(o: AgentApiOptions) {
  const now = o.now ?? Date.now
  const log = o.log ?? ((l: string) => console.log(l))
  const replyMs = o.replyTimeoutMs ?? 45 * 60_000
  const minute = new Window(o.perMinute ?? 10, 60_000)
  const hour = new Window(o.perHour ?? 100, 3600_000)
  const bad = new Window(o.badPerMinute ?? 30, 60_000)
  const sent = new Map<string, Map<string, Sent>>()

  const prune = (t: number) => {
    for (const [key, list] of sent) {
      for (const [id, s] of list) if (t - s.at > KEEP_MS) list.delete(id)
      while (list.size > KEEP_PER_KEY) list.delete(list.keys().next().value!)
      if (!list.size) sent.delete(key)
    }
  }

  async function post(req: http.IncomingMessage, res: http.ServerResponse, key: AgentKeyView) {
    const t = now()
    const wait = minute.take(key.id, t) || hour.take(key.id, t)
    if (wait) return send(res, 429, { error: tr(M).rateLimited }, { 'retry-after': String(wait) })
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const json = type === 'application/json' || type.endsWith('+json')
    if (type && !json && type !== 'text/plain') return send(res, 415, { error: tr(M).badType })
    const raw = await readRaw(req, MAX_BODY)
    if (raw === null) return send(res, 413, { error: tr(M).tooLong(MAX_TEXT) })
    let text: unknown = raw
    if (json || (!type && raw.trimStart().startsWith('{'))) {
      try {
        const body = JSON.parse(raw) as { text?: unknown }
        text = body && typeof body === 'object' ? body.text : undefined
      } catch {
        return send(res, 400, { error: tr(M).badJson })
      }
    }
    if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: tr(M).emptyMessage })
    if (text.length > MAX_TEXT) return send(res, 413, { error: tr(M).tooLong(MAX_TEXT) })
    // The author is the key's, set here: whatever the text says about who wrote it stays inside it.
    const signed = signAs(key.id, text.trim())
    const since = Date.now()
    try {
      await o.send(signed)
    } catch (e) {
      if (e instanceof OutboxDeferred) {
        const after = Math.max(1, Math.ceil((e.retryAt - Date.now()) / 1000))
        return send(res, 503, { error: tr(M).waiting }, { 'retry-after': String(after) })
      }
      if (e instanceof OutboxError) return send(res, e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message })
      log(`[agent] ${key.id}: not delivered (${(e as Error).message})`)
      return send(res, 502, { error: tr(M).failed })
    }
    const id = `msg_${crypto.randomBytes(12).toString('base64url')}`
    let resolve!: () => void
    const entry: Sent = { id, at: t, status: 'working', done: new Promise<void>((r) => (resolve = r)) }
    prune(t)
    const list = sent.get(key.id) ?? new Map<string, Sent>()
    sent.set(key.id, list)
    list.set(id, entry)
    prune(t)
    log(`[agent] → weevboss · from ${key.id} (${text.length} chars)`)
    void o
      .waitReply(since, replyMs)
      .catch(() => null)
      .then((reply) => {
        entry.status = reply ? 'answered' : 'timeout'
        if (reply) entry.reply = reply
        resolve()
      })
    send(res, 202, { id, status: 'sent' })
  }

  async function get(res: http.ServerResponse, url: URL, key: AgentKeyView, id: string) {
    prune(now())
    const entry = sent.get(key.id)?.get(id)
    if (!entry) return send(res, 404, { error: tr(M).unknownMessage })
    const wait = Math.min(MAX_WAIT_S, Math.max(0, Number(url.searchParams.get('wait')) || 0))
    if (entry.status === 'working' && wait > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([entry.done, new Promise<void>((r) => (timer = setTimeout(r, wait * 1000)))])
      clearTimeout(timer)
    }
    send(res, 200, { id: entry.id, status: entry.status, ...(entry.reply ? { reply: entry.reply } : {}) })
  }

  return {
    /** true when the request was one of the agents' addresses (answered here, whatever the outcome). */
    async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
      if (url.pathname !== AGENT_PREFIX && !url.pathname.startsWith(AGENT_PREFIX + '/')) return false
      try {
        if (!o.enabled()) return send(res, 404, { error: tr(M).notHere }), true
        const token = bearer(req)
        const who = clientAddress(req)
        if (!token) return send(res, 401, { error: tr(M).noKey }, { 'www-authenticate': 'Bearer realm="weevils"' }), true
        const key = o.store.verify(token)
        if (!key) {
          const wait = bad.take(who, now())
          if (wait) return send(res, 429, { error: tr(M).tooManyBadKeys }, { 'retry-after': String(wait) }), true
          return send(res, 401, { error: tr(M).badKey }, { 'www-authenticate': 'Bearer realm="weevils", error="invalid_token"' }), true
        }
        o.store.touch(key.id)
        const rest = url.pathname.slice(AGENT_PREFIX.length)
        const one = /^\/messages\/(msg_[A-Za-z0-9_-]{1,64})$/.exec(rest)
        if (rest === '/messages') {
          if (req.method !== 'POST') return send(res, 405, { error: tr(M).badMethod }, { allow: 'POST' }), true
          await post(req, res, key)
          return true
        }
        if (one) {
          if (req.method !== 'GET') return send(res, 405, { error: tr(M).badMethod }, { allow: 'GET' }), true
          await get(res, url, key, one[1])
          return true
        }
        if (/^\/messages\/[^/]+$/.test(rest) && req.method === 'GET') return send(res, 404, { error: tr(M).unknownMessage }), true
        send(res, 404, { error: tr(M).unknownRoute })
      } catch (e) {
        if (!res.headersSent) send(res, e instanceof AgentKeyError ? e.status : 400, { error: (e as Error).message })
      }
      return true
    },
  }
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

export interface AgentKeyRoutesOptions {
  json: Json
  readBody: ReadBody
  /** This weevils' address as the browser reached it (WEEVILS_PUBLIC_URL first). */
  base: (req: http.IncomingMessage) => string
  /** The connector (/mcp) is on. */
  connector: () => boolean
  /** This machine runs weevboss: the agents' address answers here. */
  enabled: () => boolean
  /** A browser signed in with the access code: only it creates a key. */
  canCreate: (req: http.IncomingMessage) => boolean
}

/**
 * The app's side, behind its own sign-in: GET /api/agent-keys → { keys, enabled, endpoint, connector } ·
 * POST /api/agent-keys { name } → { key, id, name, … } (the secret, this once) · DELETE /api/agent-keys/:id → { revoked }
 */
export function agentKeyRoutes(store: AgentKeyStore, o: AgentKeyRoutesOptions): [string, RegExp, Handler][] {
  return [
    ['GET', /^\/api\/agent-keys$/, (req, res) => {
      const base = o.base(req).replace(/\/$/, '')
      o.json(res, 200, { keys: store.list(), enabled: o.enabled(), base, endpoint: `${base}${AGENT_PREFIX}/messages`, connector: o.connector() ? `${base}/mcp` : null })
    }],
    ['POST', /^\/api\/agent-keys$/, async (req, res) => {
      const body = await o.readBody(req)
      if (!o.enabled()) return o.json(res, 404, { error: tr(M).notHere })
      if (!o.canCreate(req)) return o.json(res, 403, { error: tr(M).createFromApp })
      try {
        o.json(res, 200, store.create(body?.name))
      } catch (e) {
        o.json(res, e instanceof AgentKeyError ? e.status : 400, { error: (e as Error).message })
      }
    }],
    ['DELETE', /^\/api\/agent-keys\/([a-z0-9_-]{1,32})$/, (_req, res, _u, [id]) => {
      const revoked = store.revoke(id)
      o.json(res, revoked ? 200 : 404, revoked ? { revoked: true } : { error: tr(M).notFound })
    }],
  ]
}
