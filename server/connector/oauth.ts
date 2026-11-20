// The connector's sign-in (docs/spec/05-connector.md#sign-in): an OAuth 2.1 authorization server of its own, the
// minimum ChatGPT and Claude.ai need to reach a person's weevils: dynamic client registration (RFC 7591), the
// authorization code with PKCE S256, refresh tokens replaced at each use, and revocation (RFC 7009).
//
// Only the two chat apps may register: a client's redirect address must be one of theirs, and that address tells which
// app a token belongs to. A token is good for /mcp and nothing else (http.ts): it can read and append to the weevbook
// and ask for a turn; it never opens /api, a file or a setting.
//
// DATA_DIR/connector.json (0600) keeps the registered clients and the grants (one per approval of a chat app), with the
// SHA-256 of their tokens, never the tokens. It also keeps a fingerprint of the access code: when the code changes,
// every grant is dropped. Authorization codes and consent requests waiting for an answer live in memory only.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { App } from '../weevbook/journal.ts'

export const ACCESS_MS = 60 * 60_000
export const REFRESH_MS = 30 * 24 * 60 * 60_000
export const CODE_MS = 5 * 60_000
export const PENDING_MS = 10 * 60_000
export const SCOPE = 'weevbook'
const MAX_CLIENTS = 200
const MAX_PENDING = 100

/** The redirect addresses of the two chat apps, and the app each one is (docs: Claude's callback is fixed, ChatGPT's
 *  is the stable one or one per connector). */
export function appOfRedirect(uri: string): App | null {
  if (uri === 'https://claude.ai/api/mcp/auth_callback') return 'claude-ai'
  if (uri === 'https://chatgpt.com/connector_platform_oauth_redirect') return 'chatgpt'
  if (/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(uri)) return 'chatgpt'
  return null
}

export interface Client {
  id: string
  name: string
  app: App
  redirectUris: string[]
  /** none, client_secret_post or client_secret_basic, as it registered. */
  auth: string
  secretHash: string
  created: number
}
export interface Grant {
  id: string
  client: string
  app: App
  created: number
  used: number
  resource?: string
  refresh: { hash: string; expires: number } | null
  access: { hash: string; expires: number }[]
}
/** A grant as weevils lists it (GET /api/connector): never a token. */
export interface GrantInfo {
  id: string
  app: App
  client: string
  created: string
  used: string
  expires: string | null
}
interface Saved {
  v: 1
  code: string
  clients: Client[]
  grants: Grant[]
}
/** A consent request waiting for the person's answer (the page carries its id). */
export interface Pending {
  id: string
  client: Client
  redirectUri: string
  challenge: string
  state?: string
  resource?: string
  expires: number
}
interface Code {
  client: string
  redirectUri: string
  challenge: string
  resource?: string
  expires: number
}

export type OAuthError = { error: string; error_description: string; status?: number }
export interface Tokens {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const token = (prefix: string) => `${prefix}${crypto.randomBytes(32).toString('base64url')}`
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const err = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status })
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

/** The fingerprint of an access code kept beside the grants: a changed code drops them all. */
export const codeFingerprint = (secret: string) => crypto.createHmac('sha256', secret).update('weevils-connector').digest('hex').slice(0, 32)

export class ConnectorAuth {
  readonly file: string
  private now: () => number
  private data: Saved
  /** Access token hash → grant id. */
  private byAccess = new Map<string, string>()
  private codes = new Map<string, Code>()
  private pendings = new Map<string, Pending>()

  constructor(o: { file: string; fingerprint: string; now?: () => number }) {
    this.file = o.file
    this.now = o.now ?? Date.now
    let saved: Saved | null = null
    try {
      saved = JSON.parse(fs.readFileSync(o.file, 'utf8')) as Saved
    } catch {
      /* nothing approved yet */
    }
    this.data = saved && saved.v === 1 ? saved : { v: 1, code: o.fingerprint, clients: [], grants: [] }
    // Changing the access code revokes every connector token (docs/spec/05-connector.md).
    if (this.data.code !== o.fingerprint) {
      this.data = { ...this.data, code: o.fingerprint, grants: [] }
      this.save()
    }
    for (const g of this.data.grants) for (const a of g.access) this.byAccess.set(a.hash, g.id)
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.next`
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    fs.chmodSync(this.file, 0o600)
  }
  private prune() {
    const now = this.now()
    let changed = false
    for (const g of this.data.grants) {
      const access = g.access.filter((a) => a.expires > now)
      if (access.length !== g.access.length) {
        for (const a of g.access) if (a.expires <= now) this.byAccess.delete(a.hash)
        g.access = access
        changed = true
      }
    }
    const live = this.data.grants.filter((g) => (g.refresh && g.refresh.expires > now) || g.access.length)
    if (live.length !== this.data.grants.length) {
      this.data.grants = live
      changed = true
    }
    for (const [k, c] of this.codes) if (c.expires <= now) this.codes.delete(k)
    for (const [k, p] of this.pendings) if (p.expires <= now) this.pendings.delete(k)
    return changed
  }

  // -------------------------------------------------------------- registration (RFC 7591)

  register(body: unknown): { client: Client; secret: string; response: Record<string, unknown> } | OAuthError {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const uris = b.redirect_uris
    if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every((u) => typeof u === 'string')) return err('invalid_redirect_uri', 'redirect_uris: one to five addresses') // i18n-ignore: OAuth protocol text
    const apps = new Set((uris as string[]).map(appOfRedirect))
    if (apps.has(null) || apps.size !== 1) return err('invalid_redirect_uri', 'only ChatGPT and Claude.ai can connect to this weevils') // i18n-ignore: OAuth protocol text
    const app = [...apps][0] as App
    const auth = b.token_endpoint_auth_method === undefined ? 'client_secret_basic' : String(b.token_endpoint_auth_method)
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(auth)) return err('invalid_client_metadata', 'token_endpoint_auth_method: none, client_secret_post or client_secret_basic') // i18n-ignore: OAuth protocol text
    const grants = b.grant_types === undefined ? ['authorization_code', 'refresh_token'] : b.grant_types
    if (!Array.isArray(grants) || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) return err('invalid_client_metadata', 'grant_types: authorization_code and refresh_token') // i18n-ignore: OAuth protocol text
    const types = b.response_types === undefined ? ['code'] : b.response_types
    if (!Array.isArray(types) || !types.every((t) => t === 'code')) return err('invalid_client_metadata', 'response_types: code') // i18n-ignore: OAuth protocol text
    const name = typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 80) : app === 'chatgpt' ? 'ChatGPT' : 'Claude'
    this.prune()
    // Claude registers again at each new connection: the oldest clients that never got a grant make room.
    if (this.data.clients.length >= MAX_CLIENTS) {
      const used = new Set(this.data.grants.map((g) => g.client))
      const idle = this.data.clients.filter((c) => !used.has(c.id)).sort((x, y) => x.created - y.created)
      const drop = new Set(idle.slice(0, this.data.clients.length - MAX_CLIENTS + 1).map((c) => c.id))
      if (!drop.size) return err('temporarily_unavailable', 'too many clients', 503) // i18n-ignore: OAuth protocol text
      this.data.clients = this.data.clients.filter((c) => !drop.has(c.id))
    }
    // A secret for every client: ChatGPT expects one even as a public client. It is checked when it is presented;
    // what protects the code is PKCE and the redirect address.
    const secret = token('wvs_')
    const client: Client = { id: `wvc-${crypto.randomBytes(12).toString('hex')}`, name, app, redirectUris: uris as string[], auth, secretHash: sha(secret), created: this.now() }
    this.data.clients.push(client)
    this.save()
    return {
      client,
      secret,
      response: {
        client_id: client.id, client_secret: secret, client_id_issued_at: Math.floor(client.created / 1000), client_secret_expires_at: 0,
        client_name: name, redirect_uris: client.redirectUris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        token_endpoint_auth_method: auth, scope: SCOPE,
      },
    }
  }
  client(id: unknown): Client | undefined {
    return typeof id === 'string' ? this.data.clients.find((c) => c.id === id) : undefined
  }

  // -------------------------------------------------------------- authorization: the consent page's request

  /**
   * Checks an authorization request. `fatal`: nothing may be sent back to the chat app (an unknown client or redirect
   * address): the page says so. Otherwise an error goes back to the redirect address; a good request waits for the
   * person's answer.
   */
  authorize(q: URLSearchParams, resourceUrl: string): { pending: Pending } | { fatal: string } | { error: OAuthError; redirectUri: string; state?: string } {
    this.prune()
    const client = this.client(q.get('client_id'))
    if (!client) return { fatal: 'client' }
    const asked = q.get('redirect_uri')
    const redirectUri = asked ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { fatal: 'redirect' }
    const state = q.get('state') ?? undefined
    const back = (e: OAuthError) => ({ error: e, redirectUri, state })
    if (state !== undefined && state.length > 2048) return back(err('invalid_request', 'state is too long')) // i18n-ignore: OAuth protocol text
    if (q.get('response_type') !== 'code') return back(err('unsupported_response_type', 'response_type must be code')) // i18n-ignore: OAuth protocol text
    const challenge = q.get('code_challenge') ?? ''
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back(err('invalid_request', 'PKCE with S256 is required')) // i18n-ignore: OAuth protocol text
    const resource = q.get('resource') ?? undefined
    if (resource !== undefined && !sameResource(resource, resourceUrl)) return back(err('invalid_target', 'this server is its /mcp address')) // i18n-ignore: OAuth protocol text
    while (this.pendings.size >= MAX_PENDING) this.pendings.delete(this.pendings.keys().next().value!)
    const pending: Pending = { id: crypto.randomBytes(18).toString('base64url'), client, redirectUri, challenge, state, resource, expires: this.now() + PENDING_MS }
    this.pendings.set(pending.id, pending)
    return { pending }
  }
  pending(id: unknown): Pending | undefined {
    this.prune()
    return typeof id === 'string' ? this.pendings.get(id) : undefined
  }
  /** The person allowed it: a one-time code for the chat app. Returns where to send the browser. */
  approve(p: Pending, issuer: string): string {
    this.pendings.delete(p.id)
    const code = token('wva_')
    this.codes.set(sha(code), { client: p.client.id, redirectUri: p.redirectUri, challenge: p.challenge, resource: p.resource, expires: this.now() + CODE_MS })
    return redirectTo(p.redirectUri, { code, state: p.state, iss: issuer })
  }
  /** The person said no. */
  deny(p: Pending, issuer: string): string {
    this.pendings.delete(p.id)
    return redirectTo(p.redirectUri, { error: 'access_denied', error_description: 'the user did not allow it', state: p.state, iss: issuer }) // i18n-ignore: OAuth protocol text
  }
  /** Where an error goes back to the chat app. */
  static errorRedirect(redirectUri: string, e: OAuthError, state: string | undefined, issuer: string): string {
    return redirectTo(redirectUri, { error: e.error, error_description: e.error_description, state, iss: issuer })
  }

  // -------------------------------------------------------------- the token endpoint

  /** POST /mcp/token: the form's fields, and the client's Basic credentials when it sent some. */
  token(form: URLSearchParams, basic: { id: string; secret: string } | null): Tokens | OAuthError {
    this.prune()
    const id = basic?.id ?? form.get('client_id')
    const client = this.client(id)
    if (!client) return err('invalid_client', 'unknown client', 401) // i18n-ignore: OAuth protocol text
    const secret = basic?.secret ?? form.get('client_secret')
    if (secret !== null && !sameHash(sha(secret), client.secretHash)) return err('invalid_client', 'wrong client secret', 401) // i18n-ignore: OAuth protocol text
    const grantType = form.get('grant_type')
    if (grantType === 'authorization_code') {
      const raw = form.get('code') ?? ''
      const code = this.codes.get(sha(raw))
      // A code is good once.
      this.codes.delete(sha(raw))
      if (!code || code.expires <= this.now() || code.client !== client.id) return err('invalid_grant', 'the code is unknown, used or expired') // i18n-ignore: OAuth protocol text
      if (form.get('redirect_uri') !== null && form.get('redirect_uri') !== code.redirectUri) return err('invalid_grant', 'redirect_uri differs') // i18n-ignore: OAuth protocol text
      const verifier = form.get('code_verifier') ?? ''
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || crypto.createHash('sha256').update(verifier).digest('base64url') !== code.challenge) return err('invalid_grant', 'code_verifier does not match') // i18n-ignore: OAuth protocol text
      const resource = form.get('resource') ?? code.resource
      const now = this.now()
      const grant: Grant = { id: `g-${crypto.randomBytes(6).toString('hex')}`, client: client.id, app: client.app, created: now, used: now, resource, refresh: null, access: [] }
      this.data.grants.push(grant)
      return this.issue(grant)
    }
    if (grantType === 'refresh_token') {
      const hash = sha(form.get('refresh_token') ?? '')
      const grant = this.data.grants.find((g) => g.refresh && sameHash(g.refresh.hash, hash))
      // Replaced at each use: an old refresh token is no longer good (RFC 6749 invalid_grant, which chat apps expect).
      if (!grant || grant.client !== client.id || grant.refresh!.expires <= this.now()) return err('invalid_grant', 'the refresh token is unknown, used or expired') // i18n-ignore: OAuth protocol text
      return this.issue(grant)
    }
    return err('unsupported_grant_type', 'authorization_code or refresh_token') // i18n-ignore: OAuth protocol text
  }
  private issue(grant: Grant): Tokens {
    const now = this.now()
    const access = token('wvt_')
    const refresh = token('wvr_')
    grant.access.push({ hash: sha(access), expires: now + ACCESS_MS })
    grant.access = grant.access.slice(-4)
    this.byAccess.clear()
    for (const g of this.data.grants) for (const a of g.access) this.byAccess.set(a.hash, g.id)
    grant.refresh = { hash: sha(refresh), expires: now + REFRESH_MS }
    this.save()
    return { access_token: access, token_type: 'Bearer', expires_in: Math.floor(ACCESS_MS / 1000), refresh_token: refresh, scope: SCOPE }
  }

  /** The grant of an access token, when it is good now. */
  verify(accessToken: string): Grant | null {
    const hash = sha(accessToken)
    const id = this.byAccess.get(hash)
    const grant = id ? this.data.grants.find((g) => g.id === id) : undefined
    const now = this.now()
    if (!grant || !grant.access.some((a) => sameHash(a.hash, hash) && a.expires > now)) return null
    // When it was last used, kept on disk at most every ten minutes.
    if (now - grant.used > 10 * 60_000) {
      grant.used = now
      this.save()
    } else grant.used = Math.max(grant.used, now)
    return grant
  }

  // -------------------------------------------------------------- revoking

  /** RFC 7009: the chat app gives up a token. Its grant goes with it. */
  revokeToken(raw: string, clientId: string | null): void {
    const hash = sha(raw)
    const before = this.data.grants.length
    this.data.grants = this.data.grants.filter((g) => !((clientId === null || g.client === clientId) && (g.refresh?.hash === hash || g.access.some((a) => a.hash === hash))))
    if (this.data.grants.length !== before) this.reindex()
  }
  /** From weevils: one grant by id, every grant of an app (`chatgpt`, `claude-ai`), or `all`. How many went. */
  revoke(what: string): number {
    const before = this.data.grants.length
    this.data.grants = this.data.grants.filter((g) => !(what === 'all' || g.id === what || g.app === what))
    const n = before - this.data.grants.length
    if (n) this.reindex()
    return n
  }
  private reindex() {
    this.byAccess.clear()
    for (const g of this.data.grants) for (const a of g.access) this.byAccess.set(a.hash, g.id)
    this.save()
  }
  list(): GrantInfo[] {
    if (this.prune()) this.save()
    return this.data.grants.map((g) => ({
      id: g.id, app: g.app, client: this.client(g.client)?.name ?? g.client, created: iso(g.created), used: iso(g.used),
      expires: g.refresh ? iso(g.refresh.expires) : null,
    }))
  }
}

/** The `resource` a chat app names is this server's /mcp, whatever spelling of its host it reached. */
function sameResource(asked: string, mine: string): boolean {
  try {
    const a = new URL(asked)
    const m = new URL(mine)
    return a.pathname.replace(/\/$/, '') === m.pathname && a.host.toLowerCase() === m.host.toLowerCase()
  } catch {
    return false
  }
}

function redirectTo(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v)
  return u.toString()
}
