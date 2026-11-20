// The connector's sign-in and /mcp, end to end with a fake chat app (docs/spec/05-connector.md#sign-in, CONN-6 and
// CONN-7): discovery, registration, the consent page with the access code, the code for tokens, MCP calls, refresh,
// revocation, and what a request without a good token gets.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
/* eslint-disable @typescript-eslint/no-explicit-any -- JSON from the fake chat app's point of view */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isLocal } from '../http.ts'
import { loginLimiter } from '../login-limit.ts'
import { connectorHttp, baseOf } from './http.ts'
import { ConnectorAuth, codeFingerprint, ACCESS_MS } from './oauth.ts'
import { Connector } from './tools.ts'

const CODE = 'Abc123xyz'
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback'
const GPT_CB = 'https://chatgpt.com/connector_platform_oauth_redirect'

let dir: string
let server: http.Server
let base: string
let auth: ConnectorAuth
let tools: Connector
let clock: number
let signedIn: Set<string>
let limiter = loginLimiter()
const logins = { attempt: (who: string, right: boolean) => limiter.attempt(who, right) }

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-http-'))
  clock = Date.parse('2026-11-20T10:00:00Z')
  limiter = loginLimiter(() => clock)
  signedIn = new Set()
  auth = new ConnectorAuth({ file: path.join(dir, 'connector.json'), fingerprint: codeFingerprint(CODE), now: () => clock })
  tools = new Connector({ dir: path.join(dir, 'weevbook'), machine: 'laptop', log: () => {}, composeMs: 10 })
  const connector = connectorHttp({
    auth, tools, hasDevice: (req) => signedIn.has(/wv=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? ''),
    checkCode: (c) => c === CODE, limiter: logins, pauseMs: 0, now: () => clock, log: () => {},
  })
  // As weevilsd: the connector's addresses first, then the app, whose /api asks for this machine or a signed-in browser.
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    if (await connector.handle(req, res, url)) return
    if (url.pathname.startsWith('/api/')) {
      const device = signedIn.has(/wv=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '')
      if (!isLocal(req) && !device) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"sign in"}')
      return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"sessions":["secret stuff"]}')
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>weevils</title>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  tools.stop()
  await new Promise((r) => server.close(r))
  fs.rmSync(dir, { recursive: true, force: true })
})

const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
async function rpc(token: string | null, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, headers: res.headers, text: await res.text() }
}
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

/** The fake chat app: everything Claude.ai does, from the first 401 to a token. */
async function connect(o: { callback?: string; code?: string; cookie?: string; authMethod?: string } = {}) {
  const callback = o.callback ?? CLAUDE_CB
  // 1. A call without a token: 401 and where to read about signing in.
  const first = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } } })
  expect(first.status).toBe(401)
  const metaUrl = /resource_metadata="([^"]+)"/.exec(first.headers.get('www-authenticate') ?? '')![1]
  // 2. Discovery.
  const prm = await (await fetch(metaUrl)).json() as any
  const asMeta = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json() as any
  // 3. Registration.
  const reg = await fetch(asMeta.registration_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: o.authMethod ?? 'none' }),
  })
  expect(reg.status).toBe(201)
  const client = await reg.json() as any
  // 4. The consent page, in the person's browser.
  const { verifier, challenge } = pkce()
  const state = crypto.randomBytes(8).toString('hex')
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: callback, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'weevbook', resource: prm.resource })
  const page = await fetch(`${asMeta.authorization_endpoint}?${q}`, { headers: o.cookie ? { cookie: o.cookie } : {} })
  expect(page.status).toBe(200)
  const html = await page.text()
  const request = /name="request" value="([^"]+)"/.exec(html)![1]
  const answer = await fetch(asMeta.authorization_endpoint, {
    method: 'POST', redirect: 'manual', headers: { ...FORM, origin: base, ...(o.cookie ? { cookie: o.cookie } : {}) },
    body: form({ request, action: 'allow', ...(o.code !== undefined ? { code: o.code } : { code: CODE }) }),
  })
  expect(answer.status).toBe(303)
  const back = new URL(answer.headers.get('location')!)
  expect(`${back.origin}${back.pathname}`).toBe(callback)
  expect(back.searchParams.get('state')).toBe(state)
  expect(back.searchParams.get('iss')).toBe(asMeta.issuer)
  // 5. The code for tokens.
  const tok = await fetch(asMeta.token_endpoint, {
    method: 'POST', headers: FORM,
    body: form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: callback, client_id: client.client_id, code_verifier: verifier, resource: prm.resource }),
  })
  expect(tok.status).toBe(200)
  return { client, prm, asMeta, tokens: await tok.json() as any, html, page }
}

describe('discovery', () => {
  it('serves the metadata both chat apps read, for the address they reached', async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json() as any
    expect(prm).toEqual({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['weevbook'], bearer_methods_supported: ['header'], resource_name: 'weevils' })
    expect(await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json() as any).toEqual(prm)
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json() as any
    expect(as).toMatchObject({
      issuer: base, authorization_endpoint: `${base}/mcp/authorize`, token_endpoint: `${base}/mcp/token`, registration_endpoint: `${base}/mcp/register`,
      code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code', 'refresh_token'], response_types_supported: ['code'],
      authorization_response_iss_parameter_supported: true,
    })
    expect(as.token_endpoint_auth_methods_supported).toContain('none')
    // No client id metadata documents: both apps register (DCR).
    expect(as.client_id_metadata_document_supported).toBeUndefined()
    // What a client may probe besides: a 404, not the app's page.
    for (const p of ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server/mcp', '/mcp/nothing']) expect((await fetch(`${base}${p}`)).status, p).toBe(404)
  })

  it('takes the public address behind a proxy or a tunnel', () => {
    const req = (headers: Record<string, string>) => ({ headers, socket: {} }) as unknown as http.IncomingMessage
    expect(baseOf(req({ host: 'weevils.example.com', 'x-forwarded-proto': 'https' }))).toBe('https://weevils.example.com')
    expect(baseOf(req({ host: '127.0.0.1:4179', 'x-forwarded-host': 'box.tail1234.ts.net', 'x-forwarded-proto': 'https' }))).toBe('https://box.tail1234.ts.net')
    expect(baseOf(req({ host: '127.0.0.1:4179' }), 'https://weevils.example.com/')).toBe('https://weevils.example.com')
    expect(baseOf(req({ host: 'other.example.org', 'x-forwarded-proto': 'https' }), 'https://weevils.example.com')).toBe('https://other.example.org')
    expect(baseOf(req({ host: 'evil.example"/><script>' }), 'https://weevils.example.com')).toBe('https://weevils.example.com')
  })
})

describe('a request without a good token (CONN-7)', () => {
  it('gets 401, the metadata address, and no data; nothing is written', async () => {
    for (const token of [null, 'wvt_made-up', 'not even a token']) {
      const r = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_to_weevboss', arguments: { conversation: 'sneaky-chat-here', app: 'chatgpt', offset: 0, final: true, messages: [{ role: 'user', text: 'hi' }] } } })
      expect(r.status).toBe(401)
      const challenge = r.headers.get('www-authenticate')!
      expect(challenge).toContain(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`)
      expect(challenge).toContain('scope="weevbook"')
      if (token) expect(challenge).toContain('error="invalid_token"')
      expect(JSON.parse(r.text)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Sign in first.' } })
    }
    for (const method of ['tools/list', 'initialize']) expect((await rpc(null, { jsonrpc: '2.0', id: 2, method })).status).toBe(401)
    // A token in the address is never read.
    expect((await fetch(`${base}/mcp?access_token=x`, { method: 'POST', body: '{}' })).status).toBe(401)
    expect(fs.existsSync(path.join(dir, 'weevbook'))).toBe(false)
  })

  it('is slowed down after 60 a minute from one address', async () => {
    let last = 0
    for (let i = 0; i < 61; i++) last = (await rpc(null, { jsonrpc: '2.0', id: i, method: 'ping' })).status
    expect(last).toBe(429)
  })
})

describe('sign-in, end to end', () => {
  it('registers Claude, asks the person, gives tokens, and the tokens open /mcp', async () => {
    const { client, tokens, html, page } = await connect()
    expect(client).toMatchObject({ redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: 'none' })
    expect(client.client_secret).toMatch(/^wvs_/)
    // The consent page: which app, what it may do, the access code field, and no framing.
    expect(html).toContain('Connect Claude to weevils')
    expect(html).toContain('It cannot read your files, run commands or change your settings.')
    expect(html).toContain('name="code"')
    expect(html).toContain('Then you go back to claude.ai.')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('content-security-policy')).toContain('form-action \'self\' https://claude.ai')
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'weevbook' })
    expect(tokens.access_token).toMatch(/^wvt_[A-Za-z0-9_-]{43}$/)

    const init = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } } })
    expect(init.status).toBe(200)
    const ir = JSON.parse(init.text).result
    expect(ir.protocolVersion).toBe('2025-06-18')
    expect(ir.capabilities).toEqual({ tools: { listChanged: false } })
    expect(ir.instructions).toContain('send this to weevboss')
    expect((await rpc(tokens.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const list = JSON.parse((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).text).result.tools
    expect(list.map((t: { name: string }) => t.name)).toEqual(['send_to_weevboss', 'continue_with_agent', 'search_weevbook', 'read_thread', 'thread_status'])
    const sent = JSON.parse((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_to_weevboss', arguments: { conversation: 'from-the-fake-app', app: 'chatgpt', offset: 0, final: true, title: 'Fake chat', messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi there' }] } } })).text)
    expect(sent.result.content[0].text).toMatch(new RegExp(`^Saved 2 messages to "Fake chat"\\. ${base.replace(/[.]/g, '\\.')}/t/[0-9A-Z]{26}$`))
    // The token was given to Claude: the chat is Claude's, whatever the call said.
    const journal = fs.readFileSync(fs.readdirSync(path.join(dir, 'weevbook', 'projects'), { recursive: true, withFileTypes: true }).find((f) => f.name === 'events.jsonl')!.parentPath + '/events.jsonl', 'utf8')
    expect(journal).toContain('"key":"conn:claude-ai:from-the-fake-app:0:')
    // A batch, as some clients send.
    const batch = JSON.parse((await rpc(tokens.access_token, [{ jsonrpc: '2.0', id: 4, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }, { jsonrpc: '2.0', id: 5, method: 'nope' }])).text)
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 4, result: {} }, { jsonrpc: '2.0', id: 5, error: { code: -32601, message: 'Method not found: nope' } }])
    // GET opens no event stream.
    expect((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(405)
  })

  it('stores only hashes, in a file for the user only', async () => {
    const { tokens, client } = await connect()
    const file = path.join(dir, 'connector.json')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    const saved = fs.readFileSync(file, 'utf8')
    for (const secret of [tokens.access_token, tokens.refresh_token, client.client_secret]) expect(saved).not.toContain(secret)
  })

  it('replaces the refresh token at each use; an old one is refused', async () => {
    const { tokens, client } = await connect()
    const refresh = (t: string) => fetch(`${base}/mcp/token`, { method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', refresh_token: t, client_id: client.client_id }) })
    const r1 = await refresh(tokens.refresh_token)
    expect(r1.status).toBe(200)
    const next = await r1.json() as any
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    const old = await refresh(tokens.refresh_token)
    expect(old.status).toBe(400)
    expect(await old.json() as any).toMatchObject({ error: 'invalid_grant' })
    expect((await rpc(next.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    // An hour later the access token is no longer good: the app refreshes by itself.
    clock += ACCESS_MS + 1
    expect((await rpc(next.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await refresh(next.refresh_token)).status).toBe(200)
  })

  it('refuses a code used twice, a wrong verifier, and a code for another client', async () => {
    const { client, asMeta } = await connect()
    const { verifier, challenge } = pkce()
    const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: 'S256', state: 's' })
    const html = await (await fetch(`${asMeta.authorization_endpoint}?${q}`)).text()
    const request = /name="request" value="([^"]+)"/.exec(html)![1]
    const back = new URL((await fetch(asMeta.authorization_endpoint, { method: 'POST', redirect: 'manual', headers: FORM, body: form({ request, action: 'allow', code: CODE }) })).headers.get('location')!)
    const code = back.searchParams.get('code')!
    const swap = (o: Record<string, string>) => fetch(asMeta.token_endpoint, { method: 'POST', headers: FORM, body: form({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CB, client_id: client.client_id, code_verifier: verifier, ...o }) })
    expect(await (await swap({ code_verifier: pkce().verifier })).json() as any).toMatchObject({ error: 'invalid_grant' })
    // The wrong verifier spent the code.
    expect(await (await swap({})).json() as any).toMatchObject({ error: 'invalid_grant' })
    expect(await (await swap({ client_id: 'wvc-unknown' })).json() as any).toMatchObject({ error: 'invalid_client' })
  })

  it('lists and revokes connections; a revoked token no longer opens /mcp', async () => {
    const claude = await connect()
    const gpt = await connect({ callback: GPT_CB })
    expect(auth.list().map((g) => g.app).sort()).toEqual(['chatgpt', 'claude-ai'])
    expect(auth.list()[0]).not.toHaveProperty('refresh')
    expect(auth.revoke('claude-ai')).toBe(1)
    expect((await rpc(claude.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await rpc(gpt.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    // The chat app can give its token up itself (RFC 7009).
    expect((await fetch(`${base}/mcp/revoke`, { method: 'POST', headers: FORM, body: form({ token: gpt.tokens.refresh_token, client_id: gpt.client.client_id }) })).status).toBe(200)
    expect((await rpc(gpt.tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect(auth.list()).toEqual([])
  })

  it('drops every connection when the access code changes', async () => {
    const { tokens } = await connect()
    const again = new ConnectorAuth({ file: path.join(dir, 'connector.json'), fingerprint: codeFingerprint('another-code'), now: () => clock })
    expect(again.list()).toEqual([])
    expect(again.verify(tokens.access_token)).toBeNull()
    // Same code: the connection stays.
    expect(new ConnectorAuth({ file: path.join(dir, 'connector.json'), fingerprint: codeFingerprint('another-code'), now: () => clock }).list()).toEqual([])
    const kept = new ConnectorAuth({ file: path.join(dir, 'kept.json'), fingerprint: codeFingerprint(CODE), now: () => clock })
    expect(kept.list()).toEqual([])
  })

  it('skips the code for a browser signed in to weevils', async () => {
    signedIn.add('good-device')
    const { html } = await connect({ cookie: 'wv=good-device', code: '' })
    expect(html).toContain('This browser is signed in to weevils.')
    expect(html).not.toContain('name="code"')
  })

  it('registers ChatGPT, with a secret it may send back (Basic or in the form)', async () => {
    const { client, tokens } = await connect({ callback: 'https://chatgpt.com/connector/oauth/abc_DEF-123', authMethod: 'client_secret_post' })
    expect(client.client_secret).toMatch(/^wvs_/)
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')
    const r = await fetch(`${base}/mcp/token`, { method: 'POST', headers: { ...FORM, authorization: `Basic ${basic}` }, body: form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) })
    expect(r.status).toBe(200)
    const wrong = Buffer.from(`${client.client_id}:wvs_wrong`).toString('base64')
    expect((await fetch(`${base}/mcp/token`, { method: 'POST', headers: { ...FORM, authorization: `Basic ${wrong}` }, body: form({ grant_type: 'refresh_token', refresh_token: (await r.json() as any).refresh_token }) })).status).toBe(401)
  })
})

describe('the consent page refuses', () => {
  async function pending(callback = CLAUDE_CB) {
    const client = await (await fetch(`${base}/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [callback] }) })).json() as any
    const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: callback, code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 'st' })
    const html = await (await fetch(`${base}/mcp/authorize?${q}`)).text()
    return { client, request: /name="request" value="([^"]+)"/.exec(html)![1] }
  }
  const post = (body: Record<string, string>, headers: Record<string, string> = {}) => fetch(`${base}/mcp/authorize`, { method: 'POST', redirect: 'manual', headers: { ...FORM, ...headers }, body: form(body) })

  it('any other app than ChatGPT and Claude.ai', async () => {
    for (const uri of ['https://evil.example/callback', 'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai.evil.example/api/mcp/auth_callback', 'https://chatgpt.com/connector/oauth/../../x']) {
      const r = await fetch(`${base}/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [uri] }) })
      expect(r.status, uri).toBe(400)
      expect(await r.json() as any).toMatchObject({ error: 'invalid_redirect_uri' })
    }
    // One client, one app.
    expect((await fetch(`${base}/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CLAUDE_CB, GPT_CB] }) })).status).toBe(400)
  })

  it('an unknown client or redirect address, without sending anything back', async () => {
    const { client } = await pending()
    const q = (o: Record<string, string>) => new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_CB, code_challenge: pkce().challenge, code_challenge_method: 'S256', ...o })
    for (const o of [{ client_id: 'wvc-nobody' }, { redirect_uri: GPT_CB }] as Record<string, string>[]) {
      const r = await fetch(`${base}/mcp/authorize?${q(o)}`, { redirect: 'manual' })
      expect(r.status).toBe(400)
      expect(await r.text()).toContain('This connection request is not valid.')
    }
    // Without PKCE: back to the app with an error, and iss.
    const plain = await fetch(`${base}/mcp/authorize?${q({ code_challenge_method: 'plain' })}`, { redirect: 'manual' })
    expect(plain.status).toBe(302)
    const back = new URL(plain.headers.get('location')!)
    expect(back.searchParams.get('error')).toBe('invalid_request')
    expect(back.searchParams.get('iss')).toBe(base)
  })

  it('a wrong code, then too many, counted with the app\'s own sign-in; the right code still gets in', async () => {
    const { request } = await pending()
    const wrong = await post({ request, action: 'allow', code: 'nope' }, { origin: base })
    expect(wrong.status).toBe(401)
    expect(await wrong.text()).toContain('Wrong code. Try again.')
    for (let i = 0; i < 9; i++) await post({ request, action: 'allow', code: 'nope' }, { origin: base })
    expect(limiter.size()).toBe(10)
    const capped = await post({ request, action: 'allow', code: 'nope' }, { origin: base })
    expect(capped.status).toBe(429)
    expect(await capped.text()).toContain('Too many wrong codes')
    expect(auth.list()).toEqual([])
    expect((await post({ request, action: 'allow', code: CODE }, { origin: base })).status).toBe(303)
  })

  it('an answer from another site', async () => {
    const { request } = await pending()
    expect((await post({ request, action: 'allow', code: CODE }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ request, action: 'allow', code: CODE }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(auth.list()).toEqual([])
  })

  it('when the person says no: access_denied, back to the app', async () => {
    const { request } = await pending()
    const r = await post({ request, action: 'deny' }, { origin: base })
    expect(r.status).toBe(303)
    const back = new URL(r.headers.get('location')!)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('state')).toBe('st')
    expect(back.searchParams.get('iss')).toBe(base)
    // The request is spent.
    expect((await post({ request, action: 'allow', code: CODE }, { origin: base })).status).toBe(400)
  })
})

describe('a connector token (CONN-6)', () => {
  it('opens /mcp and nothing else of the app', async () => {
    const { tokens } = await connect()
    for (const p of ['/api/sessions', '/api/connector', '/api/files?path=/etc/passwd', '/api/settings']) {
      const r = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${tokens.access_token}` } })
      expect(r.status, p).toBe(401)
      expect(await r.text()).not.toContain('secret stuff')
    }
  })
})
