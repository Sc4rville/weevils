// The relay behind the stable addresses (https://<handle>.<domain>), run on the server that owns the domain, behind
// Caddy (TLS, one certificate per handle, on demand: Caddy asks GET /ask first). Wire rules: server/link-proto.ts.
//
//   POST relay.<domain>/v1/claim     {handle}            → 201 {handle, token, url}: the token is shown once
//   GET  relay.<domain>/v1/check/<h>                     → {handle, free, problem?}
//   POST relay.<domain>/v1/release   Bearer token        → the handle is free again
//   GET  relay.<domain>/v1/connect   Bearer token, X-Weevils-Handle, Upgrade: weevils-link → 101, then HTTP/2
//   GET  /ask?domain=<host>          (Caddy, 127.0.0.1)  → 200 when a certificate may be issued for that host
//   *    <handle>.<domain>/…                             → the weevils that holds the handle, or a « not connected » page
//
// What it guarantees: a request for <handle> only ever reaches the connection that showed <handle>'s token (kept as a
// SHA-256 hash only); nothing else is reachable through it (it opens no connection of its own: it only answers on
// connections a weevils opened). A revoked or released handle's connection is closed at once. It keeps no request,
// no body and no address: its log says when a handle connects or leaves, nothing about what goes through.
//
// Run:   node server/link-relay.ts serve [--port 4183] [--domain tryweevils.scarville.tech] [--data <file>]
// Admin: node server/link-relay.ts list | revoke <handle>   (the running relay sees the change within seconds)
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import os from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { endToEnd, handleProblem, LINK_PROTOCOL, packHead, UPGRADE_HEAD, UPGRADE_PATH } from './link-proto.ts'

export interface HandleRecord {
  hash: string
  created: number
  /** Last time its weevils connected (0: never yet). */
  seen: number
}
interface StoreFile {
  version: 1
  handles: Record<string, HandleRecord>
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** The claimed handles, in one JSON file (0600, written whole then renamed). Re-read when the admin command changed it. */
export class HandleStore {
  private data: StoreFile = { version: 1, handles: {} }
  private stamp = ''
  readonly file: string
  constructor(file: string) {
    this.file = file
    this.reload()
  }
  /** True when the file changed since the last read. */
  reload(): boolean {
    let st: fs.Stats
    try {
      st = fs.statSync(this.file)
    } catch {
      if (this.stamp === 'none') return false
      this.stamp = 'none'
      this.data = { version: 1, handles: {} }
      return true
    }
    const stamp = `${st.size}:${st.mtimeMs}`
    if (stamp === this.stamp) return false
    this.stamp = stamp
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile
      this.data = d && typeof d.handles === 'object' ? { version: 1, handles: d.handles } : { version: 1, handles: {} }
    } catch {
      /* a half-written file from an editor: kept as it was */
    }
    return true
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    const st = fs.statSync(this.file)
    this.stamp = `${st.size}:${st.mtimeMs}`
  }
  get(h: string): HandleRecord | undefined {
    return Object.hasOwn(this.data.handles, h) ? this.data.handles[h] : undefined
  }
  count() {
    return Object.keys(this.data.handles).length
  }
  list(): [string, HandleRecord][] {
    return Object.entries(this.data.handles)
  }
  /** A new token for a free handle, or null when it is taken. */
  claim(h: string, now = Date.now()): string | null {
    this.reload()
    if (this.get(h)) return null
    const token = `wvl_${crypto.randomBytes(32).toString('base64url')}`
    this.data.handles[h] = { hash: sha(token), created: now, seen: 0 }
    this.save()
    return token
  }
  verify(h: string, token: string): boolean {
    const r = this.get(h)
    return !!r && !!token && sameHash(r.hash, sha(token))
  }
  seen(h: string, now = Date.now()) {
    const r = this.get(h)
    if (!r) return
    // Written at most once an hour per handle: a reconnecting laptop does not rewrite the file each time.
    if (now - r.seen < 3600_000) return
    r.seen = now
    this.save()
  }
  remove(h: string): boolean {
    this.reload()
    if (!this.get(h)) return false
    delete this.data.handles[h]
    this.save()
    return true
  }
  /** Handles claimed but never connected within `unusedMs`, or not seen for `idleMs`: free again. */
  sweep(now = Date.now(), unusedMs = 2 * 86400_000, idleMs = 180 * 86400_000): string[] {
    this.reload()
    const gone = this.list()
      .filter(([, r]) => (r.seen === 0 && now - r.created > unusedMs) || (r.seen > 0 && now - r.seen > idleMs))
      .map(([h]) => h)
    if (!gone.length) return []
    for (const h of gone) delete this.data.handles[h]
    this.save()
    return gone
  }
}

export interface RelayOptions {
  /** The handles' parent domain: <handle>.<domain>. */
  domain: string
  dataFile: string
  port?: number
  host?: string
  /** Claims per client address per day. */
  claimsPerDay?: number
  maxHandles?: number
  /** How often the relay pings each connection (a laptop that went to sleep is seen gone after twice that). */
  pingMs?: number
  log?: (line: string) => void
}

const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])$/
const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:0 1.5rem;color:#222"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`

export function startLinkRelay(o: RelayOptions) {
  const domain = o.domain.toLowerCase().replace(/^\.+|\.+$/g, '')
  const control = `relay.${domain}`
  const store = new HandleStore(o.dataFile)
  const log = o.log ?? ((l: string) => console.log(`[relay] ${l}`))
  const sessions = new Map<string, http2.ClientHttp2Session>()
  const claims = new Map<string, number[]>()
  const pingMs = o.pingMs ?? 20_000

  const hostOf = (req: http.IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '')
  const handleOf = (host: string) => (host.endsWith(`.${domain}`) ? host.slice(0, -domain.length - 1) : '')
  // Caddy puts the client's address last in X-Forwarded-For (it drops what the client sent: no trusted proxies).
  const clientIp = (req: http.IncomingMessage) =>
    String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1) || req.socket.remoteAddress || ''
  const bearer = (req: http.IncomingMessage) => /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1] ?? ''
  const json = (res: http.ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra })
    res.end(JSON.stringify(body))
  }
  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (c: string) => {
        raw += c
        if (raw.length > 4096) req.destroy()
      })
      req.on('end', () => {
        try {
          const v = JSON.parse(raw || '{}')
          resolve(v && typeof v === 'object' ? v : {})
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })

  const drop = (h: string, why: string) => {
    const s = sessions.get(h)
    if (!s) return
    sessions.delete(h)
    s.destroy()
    log(`${h} closed (${why})`)
  }

  /** Every few seconds: the admin command's changes (a revoked handle loses its connection at once), and the sweep. */
  let lastSweep = 0
  const tick = setInterval(() => {
    if (store.reload()) for (const h of [...sessions.keys()]) if (!store.get(h)) drop(h, 'revoked')
    if (Date.now() - lastSweep > 3600_000) {
      lastSweep = Date.now()
      for (const h of store.sweep()) {
        drop(h, 'expired')
        log(`${h} freed (unused)`)
      }
    }
  }, 3000)
  tick.unref()

  async function claim(req: http.IncomingMessage, res: http.ServerResponse) {
    const b = await readJson(req)
    const h = String(b.handle ?? '').trim().toLowerCase()
    const problem = handleProblem(h)
    if (problem) return json(res, 400, { error: 'invalid', problem }) // i18n-ignore: protocol code, read by weevils
    const ip = clientIp(req)
    const now = Date.now()
    const recent = (claims.get(ip) ?? []).filter((t) => now - t < 86400_000)
    if (recent.length >= (o.claimsPerDay ?? 10)) return json(res, 429, { error: 'too_many' }, { 'retry-after': '3600' })
    if (store.count() >= (o.maxHandles ?? 5000)) return json(res, 503, { error: 'full' }) // i18n-ignore: protocol code, read by weevils
    const token = store.claim(h, now)
    if (!token) return json(res, 409, { error: 'taken' }) // i18n-ignore: protocol code, read by weevils
    recent.push(now)
    claims.set(ip, recent)
    if (claims.size > 10_000) claims.clear()
    log(`${h} claimed`)
    json(res, 201, { handle: h, token, url: `https://${h}.${domain}` })
  }

  async function release(req: http.IncomingMessage, res: http.ServerResponse) {
    const b = await readJson(req)
    const h = String(b.handle ?? '').trim().toLowerCase()
    if (!store.verify(h, bearer(req))) return json(res, 401, { error: 'unauthorized' }) // i18n-ignore: protocol code, read by weevils
    store.remove(h)
    drop(h, 'released')
    log(`${h} released`)
    json(res, 200, { ok: true })
  }

  /** A weevils connects: its token for its handle, then the connection turns into HTTP/2 with the relay as client. */
  function connect(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const h = String(req.headers['x-weevils-handle'] ?? '').trim().toLowerCase()
    const deny = (code: number, text: string) => {
      socket.end(`HTTP/1.1 ${code} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    }
    if (String(req.headers.upgrade ?? '').toLowerCase() !== LINK_PROTOCOL) return deny(400, 'Bad Request')
    store.reload()
    if (!store.verify(h, bearer(req))) return deny(401, 'Unauthorized')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${LINK_PROTOCOL}\r\nConnection: Upgrade\r\n\r\n`)
    if (head.length) socket.unshift(head)
    const s = http2.connect(`http://${h}.${domain}`, { createConnection: () => socket, settings: { enablePush: false } })
    const old = sessions.get(h)
    sessions.set(h, s)
    if (old) old.destroy()
    store.seen(h)
    log(`${h} connected`)
    // A ping a while: a computer gone to sleep or off the network leaves a connection that looks open; no answer, closed.
    let waiting = false
    const ping = setInterval(() => {
      if (waiting) return s.destroy()
      waiting = true
      try {
        s.ping((err) => {
          waiting = false
          if (err) s.destroy()
        })
      } catch {
        s.destroy()
      }
    }, pingMs)
    const gone = () => {
      clearInterval(ping)
      if (sessions.get(h) === s) {
        sessions.delete(h)
        log(`${h} left`)
      }
    }
    s.on('close', gone)
    s.on('error', () => s.destroy())
    s.on('goaway', () => s.destroy())
  }

  const forwarded = (req: http.IncomingMessage, host: string) => ({
    'x-forwarded-for': clientIp(req),
    'x-forwarded-proto': 'https',
    'x-forwarded-host': host,
  })

  /** The page a visitor sees while the computer is away, in French or English as their browser prefers. */
  function offline(res: http.ServerResponse, h: string, req?: http.IncomingMessage) {
    const fr = /^fr\b/i.test(String(req?.headers['accept-language'] ?? ''))
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '10' })
    res.end(
      fr
        ? page('weevils n’est pas connecté', `L’ordinateur de <b>${h}</b> est éteint, en veille ou hors ligne. Cette adresse revient d’elle-même dès qu’il est rallumé : rien à changer dans ton app ni dans tes apps de chat.`) // i18n-ignore: the relay has no translation tables, both languages are here
        : page('weevils is not connected right now', `<b>${h}</b>’s computer is off, asleep or offline. This address comes back by itself as soon as it is on again: no need to change anything in your app or your chat apps.`), // i18n-ignore: the relay has no translation tables, both languages are here
    )
  }

  /** A request for a handle: one HTTP/2 stream to its weevils, streamed both ways (server-sent events included). */
  function forward(req: http.IncomingMessage, res: http.ServerResponse, h: string, host: string) {
    const s = sessions.get(h)
    if (!s || s.closed || s.destroyed) return offline(res, h, req)
    let stream: http2.ClientHttp2Stream
    try {
      stream = s.request({ ':method': req.method ?? 'GET', ':path': req.url ?? '/', ':authority': host, ':scheme': 'https', ...endToEnd(req.headers, true), ...forwarded(req, host) })
    } catch {
      return offline(res, h, req)
    }
    req.pipe(stream)
    stream.on('response', (headers) => {
      const status = Number(headers[':status']) || 502
      res.writeHead(status, endToEnd(headers))
      stream.pipe(res)
    })
    // A stream that ends without an answer (the computer went away mid-request, or a newer connection took over):
    // the « not connected » page, never a request left hanging.
    const fail = () => {
      if (!res.headersSent) offline(res, h, req)
      else if (!res.writableEnded) res.destroy()
    }
    stream.on('error', fail)
    stream.on('close', fail)
    res.on('close', () => {
      if (!stream.closed) stream.close(http2.constants.NGHTTP2_CANCEL)
    })
  }

  /** An upgrade for a handle (a WebSocket): its request goes whole in one stream, then raw bytes both ways. */
  function forwardUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, h: string, host: string) {
    const s = sessions.get(h)
    if (!s || s.closed || s.destroyed) return socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    const headers: [string, string][] = []
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i].toLowerCase()
      if (k === 'host' || k.startsWith('x-forwarded-') || k === 'forwarded' || k === 'x-real-ip' || k === 'x-weevils-local' || k === 'cf-connecting-ip') continue
      headers.push([req.rawHeaders[i], req.rawHeaders[i + 1]])
    }
    for (const [k, v] of Object.entries(forwarded(req, host))) headers.push([k, v])
    let stream: http2.ClientHttp2Stream
    try {
      stream = s.request({ ':method': 'POST', ':path': UPGRADE_PATH, ':authority': host, ':scheme': 'https', [UPGRADE_HEAD]: packHead({ method: req.method ?? 'GET', path: req.url ?? '/', headers }) })
    } catch {
      return socket.destroy()
    }
    stream.on('response', (r) => {
      if (Number(r[':status']) !== 200) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        return stream.close()
      }
      if (head.length) stream.write(head)
      socket.pipe(stream).pipe(socket)
    })
    const end = () => {
      socket.destroy()
      if (!stream.closed) stream.close(http2.constants.NGHTTP2_CANCEL)
    }
    stream.on('error', end)
    stream.on('close', () => socket.destroy())
    socket.on('error', end)
    socket.on('close', end)
  }

  const server = http.createServer((req, res) => {
    const host = hostOf(req)
    const url = new URL(req.url ?? '/', 'http://x')
    // Caddy's question before it asks Let's Encrypt for a certificate (on-demand TLS): only for live names.
    if (url.pathname === '/ask' && !req.headers['x-forwarded-for']) {
      const d = String(url.searchParams.get('domain') ?? '').toLowerCase()
      const ok = d === control || (!!handleOf(d) && !!store.get(handleOf(d)))
      res.writeHead(ok ? 200 : 404)
      return res.end()
    }
    // The relay's own name, or the relay reached straight on its port (the admin, the tests): its own routes.
    if (host === control || LOOPBACK.test(host)) {
      if (req.method === 'POST' && url.pathname === '/v1/claim') return void claim(req, res)
      if (req.method === 'POST' && url.pathname === '/v1/release') return void release(req, res)
      const check = /^\/v1\/check\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && check) {
        const h = decodeURIComponent(check[1]).toLowerCase()
        const problem = handleProblem(h)
        return json(res, 200, { handle: h, free: !problem && !store.get(h), ...(problem ? { problem } : {}) })
      }
      if (url.pathname === '/') return json(res, 200, { relay: 'weevils', domain })
      return json(res, 404, { error: 'not_found' })
    }
    const h = handleOf(host)
    if (h && store.get(h)) return forward(req, res, h, host)
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('No weevils here', 'This address is not in use.'))
  })
  server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    const host = hostOf(req)
    const url = new URL(req.url ?? '/', 'http://x')
    if ((host === control || LOOPBACK.test(host)) && url.pathname === '/v1/connect') return connect(req, socket, head)
    const h = handleOf(host)
    if (h && store.get(h)) return forwardUpgrade(req, socket, head, h, host)
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  })
  // Streams live as long as the page that opened them (server-sent events): no timeout on the requests themselves.
  server.requestTimeout = 0
  server.headersTimeout = 30_000
  server.keepAliveTimeout = 65_000

  const ready = new Promise<number>((resolve) => {
    server.listen(o.port ?? 4183, o.host ?? '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  return {
    server,
    store,
    sessions,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(tick)
        for (const s of sessions.values()) s.destroy()
        sessions.clear()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// ---------------------------------------------------------------- the command

function main(argv: string[]) {
  const arg = (name: string, dflt: string) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
  }
  const dataFile = arg('--data', process.env.WEEVILS_RELAY_DATA || path.join(os.homedir(), '.local/share/weevils-relay/handles.json'))
  const [cmd, h] = argv
  if (cmd === 'serve') {
    const r = startLinkRelay({ domain: arg('--domain', process.env.WEEVILS_RELAY_DOMAIN || 'tryweevils.scarville.tech'), dataFile, port: Number(arg('--port', process.env.WEEVILS_RELAY_PORT || '4183')) })
    void r.ready.then((port) => console.log(`[relay] listening on 127.0.0.1:${port}, ${r.store.count()} handles`))
    const stop = () => void r.close().then(() => process.exit(0))
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    return
  }
  const store = new HandleStore(dataFile)
  if (cmd === 'list') {
    for (const [name, r] of store.list().sort()) console.log(`${name}\tclaimed ${new Date(r.created).toISOString().slice(0, 10)}\tseen ${r.seen ? new Date(r.seen).toISOString().slice(0, 16) : 'never'}`)
    return
  }
  if (cmd === 'revoke' && h) {
    console.log(store.remove(h.toLowerCase()) ? `${h} revoked` : `${h}: no such handle`)
    return
  }
  console.log('usage: node server/link-relay.ts serve [--port 4183] [--domain <domain>] [--data <file>] | list | revoke <handle>')
  process.exitCode = 2
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
