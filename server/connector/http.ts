// The connector's addresses on weevilsd's app port (docs/spec/05-connector.md), on only with WEEVILS_CONNECTOR=1:
//
//   GET  /.well-known/oauth-protected-resource[/mcp]   where to sign in (RFC 9728)
//   GET  /.well-known/oauth-authorization-server       the sign-in's endpoints (RFC 8414)
//   POST /mcp                                          the MCP endpoint: streamable HTTP, JSON answers, no session
//   POST /mcp/register                                 a chat app registers itself (RFC 7591)
//   GET  /mcp/authorize, POST /mcp/authorize           the consent page, and the person's answer
//   POST /mcp/token                                    codes and refresh tokens for tokens (form-encoded)
//   POST /mcp/revoke                                   a chat app gives a token up (RFC 7009)
//
// Nothing here opens anything else: the app's own routes (/api) never read a connector token, and /mcp reads nothing
// but one. A call without a good token gets 401 with the address of the metadata and no data (CONN-7). Every address
// is rate-limited; wrong access codes on the consent page count with the app's own sign-in (server/login-limit.ts).

import type http from 'node:http'
import { appWriteAllowed, clientAddress } from '../http.ts'
import { APP_NAMES, INSTRUCTIONS, TOOLS, type Connector } from './tools.ts'
import { ConnectorAuth, SCOPE, type OAuthError } from './oauth.ts'
import { consentPage, messagePage } from './consent.ts'

/** The MCP versions this endpoint speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']

export interface ConnectorHttpOptions {
  auth: ConnectorAuth
  tools: Connector
  /** WEEVILS_PUBLIC_URL: this weevils' address when a proxy hides it (read at each request: the app can change it). */
  publicUrl?: () => string
  /** The browser is signed in to weevils (its device cookie). */
  hasDevice: (req: http.IncomingMessage) => boolean
  /** The access code, compared the way the app's sign-in does. */
  checkCode: (code: string) => boolean
  /** The app's sign-in limiter (server/login-limit.ts): wrong codes here count with wrong codes there. */
  limiter: { attempt(who: string, right: boolean): 'ok' | 'wrong' | 'limited' }
  /** The pause after a wrong code (the app's: 800 ms). */
  pauseMs?: number
  now?: () => number
  log?: (line: string) => void
}

/** Requests per address or per connection, in a fixed window. */
class Rate {
  private hits = new Map<string, { start: number; n: number }>()
  private limit: number
  private ms: number
  private now: () => number
  constructor(limit: number, ms: number, now: () => number) {
    this.limit = limit
    this.ms = ms
    this.now = now
  }
  take(key: string): boolean {
    const t = this.now()
    let w = this.hits.get(key)
    if (!w || t - w.start >= this.ms) {
      if (this.hits.size > 10_000) for (const [k, x] of this.hits) if (t - x.start >= this.ms) this.hits.delete(k)
      w = { start: t, n: 0 }
      this.hits.set(key, w)
    }
    return ++w.n <= this.limit
  }
}

const HOST = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/
const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
const first = (v: string | string[] | undefined) => String(Array.isArray(v) ? v[0] : (v ?? '')).split(',')[0].trim()

/** This weevils' address as the chat app reaches it: the host it asked for (a proxy's X-Forwarded-Host first),
 *  WEEVILS_PUBLIC_URL when that is the same host or when the request came to a loopback name through a tunnel. */
export function baseOf(req: http.IncomingMessage, publicUrl?: string): string {
  let host = first(req.headers['x-forwarded-host']) || first(req.headers.host)
  if (!HOST.test(host)) host = ''
  let pub: URL | null = null
  try {
    pub = publicUrl ? new URL(publicUrl) : null
  } catch {
    pub = null
  }
  if (pub && (!host || host.toLowerCase() === pub.host.toLowerCase() || LOOPBACK.test(host))) return pub.origin
  if (!host) return 'http://localhost'
  return `${first(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http'}://${host}`
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string | null> {
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

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(body === null ? undefined : JSON.stringify(body))
}
const html = (res: http.ServerResponse, status: number, body: string, formTo = '') => {
  res.writeHead(status, {
    // same-origin: the form's answer carries its Origin; the address of the request goes nowhere else.
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTo ? ` ${formTo}` : ''}; frame-ancestors 'none'; base-uri 'none'`,
  })
  res.end(body)
}
const redirect = (res: http.ServerResponse, to: string, status = 302) => {
  res.writeHead(status, { location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  res.end()
}
const oauthError = (res: http.ServerResponse, e: OAuthError) => send(res, e.status ?? 400, { error: e.error, error_description: e.error_description }, { pragma: 'no-cache' })

/** `Authorization: Basic` credentials of a client (RFC 6749 2.3.1: each part form-encoded). */
function basicOf(req: http.IncomingMessage): { id: string; secret: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(first(req.headers.authorization))
  if (!m) return null
  const text = Buffer.from(m[1], 'base64').toString('utf8')
  const i = text.indexOf(':')
  if (i < 0) return null
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '))
    } catch {
      return s
    }
  }
  return { id: dec(text.slice(0, i)), secret: dec(text.slice(i + 1)) }
}
/** A form body, or a JSON object read as one (some clients send JSON to the token endpoint). */
function formOf(text: string, type: string | undefined): URLSearchParams {
  if (/application\/json/i.test(type ?? '')) {
    try {
      const o = JSON.parse(text) as Record<string, unknown>
      return new URLSearchParams(Object.entries(o).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]))
    } catch {
      return new URLSearchParams()
    }
  }
  return new URLSearchParams(text)
}

export function connectorHttp(o: ConnectorHttpOptions) {
  const now = o.now ?? Date.now
  const log = o.log ?? ((l: string) => console.log(l))
  const pause = (ms = o.pauseMs ?? 800) => new Promise((r) => setTimeout(r, ms))
  const rates = {
    anonymous: new Rate(60, 60_000, now),
    grant: new Rate(120, 60_000, now),
    register: new Rate(10, 60 * 60_000, now),
    token: new Rate(60, 60_000, now),
    consent: new Rate(60, 60_000, now),
  }
  const who = clientAddress
  const base = (req: http.IncomingMessage) => baseOf(req, o.publicUrl?.())
  const metadataUrl = (b: string) => `${b}/.well-known/oauth-protected-resource`
  const tooMany = (res: http.ServerResponse) => send(res, 429, { error: 'slow_down', error_description: 'too many requests' }, { 'retry-after': '60' }) // i18n-ignore: protocol text

  function protectedResource(b: string) {
    return { resource: `${b}/mcp`, authorization_servers: [b], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'weevils' }
  }
  function authorizationServer(b: string) {
    const auth = ['none', 'client_secret_post', 'client_secret_basic']
    return {
      issuer: b,
      authorization_endpoint: `${b}/mcp/authorize`,
      token_endpoint: `${b}/mcp/token`,
      registration_endpoint: `${b}/mcp/register`,
      revocation_endpoint: `${b}/mcp/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: auth,
      revocation_endpoint_auth_methods_supported: auth,
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true,
    }
  }

  // ------------------------------------------------------------ MCP (JSON-RPC 2.0 over POST)

  type Msg = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }
  const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  async function rpc(m: Msg, ctx: { app: 'chatgpt' | 'claude-ai'; base: string }): Promise<object | null> {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(m?.id, -32600, 'Invalid Request') // i18n-ignore: protocol text
    if (m.id === undefined) return null // a notification (notifications/initialized…): nothing to answer
    const result = (r: unknown) => ({ jsonrpc: '2.0', id: m.id, result: r })
    const p = m.params ?? {}
    switch (m.method) {
      case 'initialize': {
        const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : ''
        return result({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'weevils', title: 'weevils', version: '1' },
          instructions: INSTRUCTIONS,
        })
      }
      case 'ping':
        return result({})
      case 'tools/list':
        return result({ tools: TOOLS })
      case 'tools/call':
        if (typeof p.name !== 'string') return rpcError(m.id, -32602, 'params.name is missing') // i18n-ignore: protocol text
        return result(await o.tools.call(p.name, p.arguments ?? {}, ctx))
      case 'resources/list':
        return result({ resources: [] })
      case 'resources/templates/list':
        return result({ resourceTemplates: [] })
      case 'prompts/list':
        return result({ prompts: [] })
      default:
        return rpcError(m.id, -32601, `Method not found: ${m.method}`) // i18n-ignore: protocol text
    }
  }

  async function mcp(req: http.IncomingMessage, res: http.ServerResponse) {
    const b = base(req)
    if (req.method !== 'POST') return send(res, 405, rpcError(null, -32000, 'POST only: this endpoint answers in JSON, with no event stream.'), { allow: 'POST' }) // i18n-ignore: protocol text
    // A token in the Authorization header, never in the address (MCP authorization: no token in a query string).
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(first(req.headers.authorization))?.[1]
    const grant = bearer ? o.auth.verify(bearer) : null
    if (!grant) {
      req.resume()
      if (!rates.anonymous.take(who(req))) return tooMany(res)
      const challenge = `Bearer resource_metadata="${metadataUrl(b)}", scope="${SCOPE}"${req.headers.authorization ? ', error="invalid_token", error_description="the token is unknown or expired"' : ''}` // i18n-ignore: protocol text
      return send(res, 401, rpcError(null, -32001, 'Sign in first.'), { 'www-authenticate': challenge }) // i18n-ignore: protocol text
    }
    if (!rates.grant.take(grant.id)) {
      req.resume()
      return send(res, 429, rpcError(null, -32000, 'Too many calls: wait a minute.'), { 'retry-after': '60' }) // i18n-ignore: protocol text
    }
    const text = await readBody(req, 4 << 20)
    if (text === null) return send(res, 413, rpcError(null, -32600, 'The request is too large: send fewer messages per part.')) // i18n-ignore: protocol text
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return send(res, 400, rpcError(null, -32700, 'Parse error')) // i18n-ignore: protocol text
    }
    const ctx = { app: grant.app, base: b }
    if (Array.isArray(payload)) {
      const out = []
      for (const m of payload.slice(0, 20)) {
        const r = await rpc(m as Msg, ctx)
        if (r) out.push(r)
      }
      return out.length ? send(res, 200, out) : send(res, 202, null)
    }
    const r = await rpc(payload as Msg, ctx)
    return r ? send(res, 200, r) : send(res, 202, null)
  }

  // ------------------------------------------------------------ sign-in

  async function register(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, null, { allow: 'POST' })
    if (!rates.register.take(who(req))) return tooMany(res)
    const text = await readBody(req, 64 << 10)
    let body: unknown = null
    try {
      body = text === null ? null : JSON.parse(text)
    } catch {
      body = null
    }
    const r = o.auth.register(body)
    if ('error' in r) return oauthError(res, r)
    log(`[connector] ${APP_NAMES[r.client.app]} registered (${r.client.id})`)
    return send(res, 201, r.response)
  }

  async function authorize(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const b = base(req)
    if (!rates.consent.take(who(req))) return tooMany(res)
    if (req.method === 'GET') {
      const r = o.auth.authorize(url.searchParams, `${b}/mcp`)
      if ('fatal' in r) return html(res, 400, messagePage('invalid'))
      if ('error' in r) return redirect(res, ConnectorAuth.errorRedirect(r.redirectUri, r.error, r.state, b))
      const p = r.pending
      return html(res, 200, consentPage({ app: APP_NAMES[p.client.app], host: new URL(p.redirectUri).host, request: p.id, signedIn: o.hasDevice(req) }), new URL(p.redirectUri).origin)
    }
    if (req.method !== 'POST') return send(res, 405, null, { allow: 'GET, POST' })
    // The answer comes from the page itself: never from another site's form (the app's own rule for what changes things).
    if (!appWriteAllowed(req, o.publicUrl?.())) {
      req.resume()
      return html(res, 403, messagePage('invalid'))
    }
    const text = await readBody(req, 16 << 10)
    const form = new URLSearchParams(text ?? '')
    const p = o.auth.pending(form.get('request'))
    if (!p) return html(res, 400, messagePage('expired'))
    const formTo = new URL(p.redirectUri).origin
    if (form.get('action') !== 'allow') return redirect(res, o.auth.deny(p, b), 303)
    if (!o.hasDevice(req)) {
      const w = who(req)
      const view = { app: APP_NAMES[p.client.app], host: new URL(p.redirectUri).host, request: p.id, signedIn: false }
      // The right code always gets in; wrong ones wait and are counted with the app's (server/login-limit.ts).
      const answer = o.limiter.attempt(w, o.checkCode(form.get('code') ?? ''))
      if (answer !== 'ok') {
        await pause()
        return html(res, answer === 'limited' ? 429 : 401, consentPage({ ...view, error: answer === 'limited' ? 'tooMany' : 'wrongCode' }), formTo)
      }
    }
    log(`[connector] ${APP_NAMES[p.client.app]} allowed (${p.client.id})`)
    return redirect(res, o.auth.approve(p, b), 303)
  }

  async function token(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, null, { allow: 'POST' })
    if (!rates.token.take(who(req))) return tooMany(res)
    const text = await readBody(req, 16 << 10)
    const r = o.auth.token(formOf(text ?? '', first(req.headers['content-type'])), basicOf(req))
    if ('error' in r) return oauthError(res, r)
    return send(res, 200, r, { pragma: 'no-cache' })
  }

  async function revoke(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST') return send(res, 405, null, { allow: 'POST' })
    if (!rates.token.take(who(req))) return tooMany(res)
    const text = await readBody(req, 16 << 10)
    const form = formOf(text ?? '', first(req.headers['content-type']))
    const raw = form.get('token')
    if (!raw) return oauthError(res, { error: 'invalid_request', error_description: 'token is missing' }) // i18n-ignore: protocol text
    o.auth.revokeToken(raw, basicOf(req)?.id ?? form.get('client_id'))
    return send(res, 200, {})
  }

  return {
    /** Answers the connector's addresses; false for any other, which the app serves as before. */
    async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
      const p = url.pathname
      if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') {
        send(res, 200, protectedResource(base(req)), { 'access-control-allow-origin': '*' })
        return true
      }
      if (p === '/.well-known/oauth-authorization-server') {
        send(res, 200, authorizationServer(base(req)), { 'access-control-allow-origin': '*' })
        return true
      }
      if (p === '/mcp' || p === '/mcp/') await mcp(req, res)
      else if (p === '/mcp/register') await register(req, res)
      else if (p === '/mcp/authorize') await authorize(req, res, url)
      else if (p === '/mcp/token') await token(req, res)
      else if (p === '/mcp/revoke') await revoke(req, res)
      // Other sign-in addresses a client may probe (OpenID discovery, a path-suffixed variant), and other /mcp/…
      // paths: a plain 404, never the app's page.
      else if (p.startsWith('/mcp/') || p.startsWith('/.well-known/oauth-') || p === '/.well-known/openid-configuration') send(res, 404, { error: 'not_found' })
      else return false
      return true
    },
  }
}
