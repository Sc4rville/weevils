// The stable address of a weevils with no domain of its own (a computer at home, a laptop): https://<handle>.<domain>,
// the same after every restart, network change or sleep, so a chat app's connector (<address>/mcp), the installed app
// and every link already sent keep working. weevils keeps one outgoing connection open to the relay
// (server/link-relay.ts; wire rules in server/link-proto.ts) and serves the requests that come down it from its own
// port on 127.0.0.1, exactly as if they had come through Caddy: marked as coming from elsewhere (X-Forwarded-For), so
// nothing that arrives this way is ever taken for this machine itself (server/http.ts isLocal), and the access code is
// asked as for any visitor. It replaces the Cloudflare quick tunnel, whose address changed at every start.
//
// The handle and its token are in the config (WEEVILS_LINK_HANDLE, WEEVILS_LINK_TOKEN); the token never leaves this
// machine except to the relay, which keeps only its hash.
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import { DEFAULT_RELAY, endToEnd, handleFrom, handleProblem, LINK_PROTOCOL, safeHeader, unpackHead, UPGRADE_HEAD, UPGRADE_PATH } from './link-proto.ts'

export type LinkState = 'connecting' | 'online' | 'offline' | 'revoked'
export interface LinkStatus {
  handle: string
  url: string
  state: LinkState
  /** Since when it is in that state (ms). */
  since: number
  error?: string
}

export interface LinkOptions {
  relay: string
  handle: string
  token: string
  /** weevils' own port on 127.0.0.1, where every request is replayed. */
  port: number
  host?: string
  /** The public address the relay gave with the token (default: https://<handle>.<the relay's domain>). */
  url?: string
  /** The relay refused the token (revoked, released): weevils stops trying and tells the person. */
  onRevoked?: () => void
  onState?: (s: LinkStatus) => void
  /** How often weevils checks the connection still answers (a network change leaves a dead one that looks open). */
  pingMs?: number
  log?: (line: string) => void
}

/** The address a handle gets on a relay: relay.<domain> → https://<handle>.<domain>. */
export function linkUrl(relay: string, handle: string): string {
  const u = new URL(relay)
  const domain = u.hostname.replace(/^relay\./, '')
  return `${u.protocol}//${handle}.${domain}${u.port ? `:${u.port}` : ''}`
}

export class StableLink {
  private h2 = http2.createServer({ settings: { maxConcurrentStreams: 256, enablePush: false } })
  private session: http2.ServerHttp2Session | null = null
  private timer: NodeJS.Timeout | null = null
  private ping: NodeJS.Timeout | null = null
  private wait = 1000
  private stopped = false
  private upAt = 0
  private st: LinkStatus
  private o: LinkOptions
  constructor(o: LinkOptions) {
    this.o = o
    this.st = { handle: o.handle, url: o.url ?? linkUrl(o.relay, o.handle), state: 'connecting', since: Date.now() }
    this.h2.on('stream', (stream, headers) => this.serve(stream as http2.ServerHttp2Stream, headers))
    this.h2.on('sessionError', () => undefined)
  }

  status(): LinkStatus {
    return { ...this.st }
  }

  private set(state: LinkState, error?: string) {
    if (this.st.state === state && this.st.error === error) return
    this.st = { ...this.st, state, since: Date.now(), ...(error ? { error } : { error: undefined }) }
    this.o.onState?.(this.status())
  }

  start() {
    this.stopped = false
    this.connect()
    return this
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.ping) clearInterval(this.ping)
    this.timer = this.ping = null
    this.session?.destroy()
    this.session = null
    this.set('offline')
  }

  private retry(why: string) {
    if (this.stopped || this.timer) return
    // Back off up to 30 s; a connection that held a minute starts again from 1 s.
    if (this.upAt && Date.now() - this.upAt > 60_000) this.wait = 1000
    this.upAt = 0
    const ms = this.wait
    this.wait = Math.min(this.wait * 2, 30_000)
    this.set(this.st.state === 'revoked' ? 'revoked' : 'offline', why)
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, ms)
    this.timer.unref?.()
  }

  private connect() {
    if (this.stopped) return
    if (this.st.state !== 'online') this.set('connecting', this.st.error)
    const u = new URL('/v1/connect', this.o.relay)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(u, {
      method: 'GET',
      agent: false,
      timeout: 20_000,
      headers: { connection: 'Upgrade', upgrade: LINK_PROTOCOL, authorization: `Bearer ${this.o.token}`, 'x-weevils-handle': this.o.handle },
    })
    req.on('upgrade', (_res, socket, head) => {
      req.setTimeout(0)
      if (this.stopped) return socket.destroy()
      if (head.length) socket.unshift(head)
      if ('setKeepAlive' in socket) (socket as net.Socket).setKeepAlive(true, 15_000)
      // Through HTTPS the socket is a TLS one that agreed on HTTP/1.1 with the relay's proxy: the HTTP/2 server would
      // take it for an HTTP/1.1 client and close it. What runs inside it from here on is HTTP/2 (the 101 said so).
      if ('alpnProtocol' in socket) (socket as { alpnProtocol?: string | false }).alpnProtocol = 'h2'
      this.h2.once('session', (s: http2.ServerHttp2Session) => this.adopt(s))
      this.h2.emit('connection', socket)
    })
    req.on('response', (res) => {
      res.resume()
      if (res.statusCode === 401) {
        this.stopped = true
        this.set('revoked', 'the relay no longer knows this address')
        this.o.log?.(`${this.o.handle}: the relay refused the token (released or revoked)`)
        this.o.onRevoked?.()
        return
      }
      this.retry(`relay answered ${res.statusCode}`)
    })
    req.on('timeout', () => req.destroy(new Error('relay did not answer'))) // i18n-ignore: protocol code, read by weevils
    req.on('error', (e) => this.retry(e.message))
    req.end()
  }

  private adopt(s: http2.ServerHttp2Session) {
    this.session?.destroy()
    this.session = s
    this.upAt = Date.now()
    this.set('online')
    this.o.log?.(`${this.st.url} connected`)
    if (this.ping) clearInterval(this.ping)
    let waiting = false
    this.ping = setInterval(() => {
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
    }, this.o.pingMs ?? 25_000)
    this.ping.unref?.()
    const gone = () => {
      if (this.session !== s) return
      this.session = null
      if (this.ping) clearInterval(this.ping)
      this.ping = null
      this.retry('connection closed')
    }
    s.on('close', gone)
    s.on('error', () => s.destroy())
    s.on('goaway', () => s.destroy())
  }

  /** The headers weevils' port receives: the client's own, plus where it really came from (never this machine). */
  private headersFor(raw: Record<string, string | string[]>, authority: string) {
    const h: Record<string, string | string[]> = { ...raw, host: authority }
    delete h['x-weevils-local']
    // Always a proxied request: if the relay said nothing, still marked as coming from elsewhere.
    if (!h['x-forwarded-for']) h['x-forwarded-for'] = '0.0.0.0'
    h['x-forwarded-proto'] = 'https'
    h['x-forwarded-host'] = authority
    return h
  }

  private serve(stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) {
    stream.on('error', () => undefined)
    const authority = this.st.url.replace(/^https?:\/\//, '')
    if (headers[':path'] === UPGRADE_PATH && typeof headers[UPGRADE_HEAD] === 'string') return this.upgrade(stream, String(headers[UPGRADE_HEAD]), authority)
    const up = http.request({
      host: this.o.host ?? '127.0.0.1',
      port: this.o.port,
      method: String(headers[':method'] ?? 'GET'),
      path: String(headers[':path'] ?? '/'),
      headers: this.headersFor(endToEnd(headers), authority),
    })
    stream.pipe(up)
    up.on('response', (r) => {
      if (stream.destroyed) return r.destroy()
      try {
        stream.respond({ ':status': r.statusCode ?? 502, ...endToEnd(r.headers) })
      } catch {
        return r.destroy()
      }
      r.pipe(stream)
    })
    up.on('error', () => {
      if (stream.destroyed) return
      if (!stream.headersSent) stream.respond({ ':status': 502, 'content-type': 'text/plain' })
      stream.end('weevils is starting')
    })
    stream.on('close', () => up.destroy())
  }

  /** An upgrade (a WebSocket): its request written as it came to weevils' port, then raw bytes both ways. */
  private upgrade(stream: http2.ServerHttp2Stream, packed: string, authority: string) {
    const head = unpackHead(packed)
    if (!head) {
      stream.respond({ ':status': 400 })
      return stream.end()
    }
    const pairs: [string, string][] = head.headers.filter(([k]) => !/^(host|x-weevils-local|x-forwarded-proto|x-forwarded-host)$/i.test(k))
    if (!pairs.some(([k]) => k.toLowerCase() === 'x-forwarded-for')) pairs.push(['X-Forwarded-For', '0.0.0.0'])
    pairs.push(['X-Forwarded-Proto', 'https'], ['X-Forwarded-Host', authority])
    if (!pairs.every(([k, v]) => safeHeader(k, v))) {
      stream.respond({ ':status': 400 })
      return stream.end()
    }
    const sock = net.connect(this.o.port, this.o.host ?? '127.0.0.1')
    const end = () => {
      sock.destroy()
      if (!stream.destroyed) stream.close(http2.constants.NGHTTP2_CANCEL)
    }
    sock.on('connect', () => {
      sock.write(`${head.method} ${head.path} HTTP/1.1\r\nHost: ${authority}\r\n${pairs.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      stream.respond({ ':status': 200 })
      sock.pipe(stream).pipe(sock)
    })
    sock.on('error', () => {
      if (!stream.headersSent && !stream.destroyed) {
        stream.respond({ ':status': 502 })
        stream.end()
      } else end()
    })
    sock.on('close', end)
    stream.on('close', () => sock.destroy())
  }
}

// ---------------------------------------------------------------- claiming a handle

export type ClaimResult = { ok: true; handle: string; token: string; url: string } | { ok: false; error: 'taken' | 'invalid' | 'too_many' | 'full' | 'unreachable'; problem?: string }

export async function claimHandle(relay: string, handle: string, fetcher: typeof fetch = fetch): Promise<ClaimResult> {
  const problem = handleProblem(handle)
  if (problem) return { ok: false, error: 'invalid', problem } // i18n-ignore: protocol code, read by weevils
  try {
    const r = await fetcher(new URL('/v1/claim', relay), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle }), signal: AbortSignal.timeout(15_000) })
    const b = (await r.json().catch(() => ({}))) as Record<string, string>
    if (r.status === 201 && b.token && b.url) return { ok: true, handle: b.handle || handle, token: b.token, url: b.url }
    const error = (['taken', 'invalid', 'too_many', 'full'] as const).find((e) => e === b.error) ?? 'unreachable'
    return { ok: false, error, ...(b.problem ? { problem: b.problem } : {}) }
  } catch {
    return { ok: false, error: 'unreachable' } // i18n-ignore: protocol code, read by weevils
  }
}

/** The handles to try for a person, best first: the one asked for, then their name (and with a few random letters). */
export function handleCandidates(wanted: string, name: string, user: string, random: () => string): string[] {
  const out: string[] = []
  const add = (h: string) => {
    if (h && !handleProblem(h) && !out.includes(h)) out.push(h)
  }
  const ask = handleFrom(wanted)
  add(ask)
  const base = handleFrom(name) || handleFrom(user) || 'weevils'
  if (!ask) add(base)
  const stem = (ask || base).slice(0, 25)
  for (let i = 0; i < 4; i++) add(`${stem}-${random()}`)
  return out
}

/** Claims the first free handle of the candidates; stops at the first answer that is not « taken ». */
export async function claimFirst(relay: string, candidates: string[], fetcher: typeof fetch = fetch): Promise<ClaimResult> {
  let last: ClaimResult = { ok: false, error: 'invalid' } // i18n-ignore: protocol code, read by weevils
  for (const h of candidates) {
    last = await claimHandle(relay, h, fetcher)
    if (last.ok || (last.error !== 'taken' && last.error !== 'invalid')) return last
  }
  return last
}

export async function releaseHandle(relay: string, handle: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetcher(new URL('/v1/release', relay), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ handle }), signal: AbortSignal.timeout(15_000) })
    return r.ok
  } catch {
    return false
  }
}

export { DEFAULT_RELAY }
