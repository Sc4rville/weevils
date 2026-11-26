// The stable address end to end on this machine: a relay, a weevils link, and a stand-in for weevils' port.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { handleFrom, handleProblem, packHead, unpackHead } from './link-proto.ts'
import { HandleStore, startLinkRelay } from './link-relay.ts'
import { claimFirst, claimHandle, handleCandidates, linkUrl, releaseHandle, StableLink, type LinkStatus } from './stable-link.ts'

const DOMAIN = 'example.test'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wv-link-'))
const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
})

/** weevils' port, as far as the link knows: echoes what it got, streams on /sse, a WebSocket echo on /ws. */
async function app() {
  const seen: http.IncomingMessage[] = []
  const server = http.createServer((req, res) => {
    seen.push(req)
    if (req.url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => res.end('data: two\n\n'), 100)
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'], connection: 'keep-alive' })
      res.end(JSON.stringify({ method: req.method, url: req.url, body, host: req.headers.host, xff: req.headers['x-forwarded-for'], proto: req.headers['x-forwarded-proto'], local: req.headers['x-weevils-local'] ?? null }))
    })
  })
  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws, req) => {
    ws.send(`hello ${req.headers['x-forwarded-for']}`)
    ws.on('message', (m) => ws.send(`echo ${m}`))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  cleanup.push(() => new Promise((r) => (wss.close(), server.closeAllConnections(), server.close(() => r(undefined)))))
  return { port: (server.address() as { port: number }).port, seen }
}

async function relay(dir = tmp(), opts: { pingMs?: number; port?: number } = {}) {
  const r = startLinkRelay({ domain: DOMAIN, dataFile: path.join(dir, 'handles.json'), port: opts.port ?? 0, pingMs: opts.pingMs, log: () => undefined })
  const port = await r.ready
  cleanup.push(() => r.close())
  return { ...r, port, url: `http://127.0.0.1:${port}`, dir }
}

function link(relayUrl: string, handle: string, token: string, port: number, extra: Partial<ConstructorParameters<typeof StableLink>[0]> = {}) {
  const states: LinkStatus[] = []
  const l = new StableLink({ relay: relayUrl, handle, token, port, url: `https://${handle}.${DOMAIN}`, onState: (s) => states.push(s), ...extra }).start()
  cleanup.push(() => l.stop())
  return { l, states }
}

/** A request to the relay as Caddy would send it: Host is the handle's name, the client's address in X-Forwarded-For. */
function get(port: number, host: string, p: string, o: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: o.method ?? 'GET', headers: { host, 'x-forwarded-for': '203.0.113.7', ...o.headers } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end(o.body)
  })
}

describe('handles', () => {
  it('takes short lowercase names, never reserved or punycode-like ones', () => {
    expect(handleProblem('alex')).toBeNull()
    expect(handleProblem('al')).toBe('length')
    expect(handleProblem('Alex')).toBe('characters')
    expect(handleProblem('-alex')).toBe('characters')
    expect(handleProblem('xn--alex')).toBe('characters')
    expect(handleProblem('relay')).toBe('reserved')
    expect(handleProblem('www')).toBe('reserved')
    expect(handleFrom('Élodie Martin')).toBe('elodie-martin')
    expect(handleFrom('a')).toBe('')
  })
  it('tries the name asked for, then the person, then random endings', () => {
    let n = 0
    const c = handleCandidates('', 'Alex', 'tux', () => `r${n++}x`)
    expect(c[0]).toBe('alex')
    expect(c[1]).toBe('alex-r0x')
    expect(handleCandidates('My Shop', 'Alex', 'tux', () => 'zz9')[0]).toBe('my-shop')
    expect(handleCandidates('', '', 'tux', () => 'zz9')[0]).toBe('tux')
  })
  it('packs an upgrade head and refuses one that would inject a header line', () => {
    const h = { method: 'GET', path: '/ws?x=1', headers: [['Upgrade', 'websocket']] as [string, string][] }
    expect(unpackHead(packHead(h))).toEqual(h)
    expect(unpackHead(packHead({ ...h, headers: [['X-A', 'b\r\nX-Weevils-Local: 1']] }))).toBeNull()
    expect(unpackHead(packHead({ ...h, path: '/a b' }))).toBeNull()
    expect(unpackHead('not base64 json')).toBeNull()
  })
  it('gives the address of a handle on a relay', () => {
    expect(linkUrl('https://relay.tryweevils.example.com', 'alex')).toBe('https://alex.tryweevils.example.com')
  })
})

describe('the relay', () => {
  it('claims a handle once, keeps only its hash, and lets the owner release it', async () => {
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.url).toBe(`https://alex.${DOMAIN}`)
    expect(c.token).toMatch(/^wvl_/)
    const file = fs.readFileSync(path.join(r.dir, 'handles.json'), 'utf8')
    expect(file).not.toContain(c.token)
    expect(fs.statSync(path.join(r.dir, 'handles.json')).mode & 0o777).toBe(0o600)
    expect(await claimHandle(r.url, 'alex')).toMatchObject({ ok: false, error: 'taken' })
    expect(await claimHandle(r.url, 'relay')).toMatchObject({ ok: false, error: 'invalid' })
    const second = await claimFirst(r.url, ['alex', 'alex-2'])
    expect(second).toMatchObject({ ok: true, handle: 'alex-2' })
    expect(await releaseHandle(r.url, 'alex', 'wvl_wrong')).toBe(false)
    expect(await releaseHandle(r.url, 'alex', c.token)).toBe(true)
    expect((await claimHandle(r.url, 'alex')).ok).toBe(true)
  })

  it('limits claims per address', async () => {
    const d = tmp()
    const r = startLinkRelay({ domain: DOMAIN, dataFile: path.join(d, 'h.json'), port: 0, claimsPerDay: 2, log: () => undefined })
    const port = await r.ready
    cleanup.push(() => r.close())
    const url = `http://127.0.0.1:${port}`
    expect((await claimHandle(url, 'one-a')).ok).toBe(true)
    expect((await claimHandle(url, 'two-b')).ok).toBe(true)
    expect(await claimHandle(url, 'three-c')).toMatchObject({ ok: false, error: 'too_many' })
  })

  it('tells Caddy which names may get a certificate', async () => {
    const r = await relay()
    await claimHandle(r.url, 'alex')
    const ask = (d: string) => new Promise<number>((res) => http.get(`${r.url}/ask?domain=${d}`, (x) => (x.resume(), res(x.statusCode ?? 0))))
    expect(await ask(`alex.${DOMAIN}`)).toBe(200)
    expect(await ask(`relay.${DOMAIN}`)).toBe(200)
    expect(await ask(`nobody.${DOMAIN}`)).toBe(404)
    expect(await ask(`alex.elsewhere.test`)).toBe(404)
  })

  it('says a handle is not connected, and knows no other name', async () => {
    const r = await relay()
    await claimHandle(r.url, 'alex')
    const off = await get(r.port, `alex.${DOMAIN}`, '/')
    expect(off.status).toBe(502)
    expect(off.body).toContain('comes back by itself')
    expect((await get(r.port, `nobody.${DOMAIN}`, '/')).status).toBe(404)
    expect((await get(r.port, 'evil.test', '/')).status).toBe(404)
  })
})

describe('a weevils through the relay', () => {
  it('serves requests, bodies, cookies and streams, always as a visitor from elsewhere', async () => {
    const a = await app()
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    if (!c.ok) throw new Error('claim')
    const { l } = link(r.url, 'alex', c.token, a.port)
    await until(() => l.status().state === 'online')
    const res = await get(r.port, `alex.${DOMAIN}`, '/api/x?y=1', { method: 'POST', body: 'hi', headers: { 'x-weevils-local': 'deadbeef'.repeat(4), 'x-forwarded-proto': 'http' } })
    expect(res.status).toBe(201)
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2'])
    const b = JSON.parse(res.body)
    expect(b).toMatchObject({ method: 'POST', url: '/api/x?y=1', body: 'hi', host: `alex.${DOMAIN}`, xff: '203.0.113.7', proto: 'https', local: null })
    const sse = await get(r.port, `alex.${DOMAIN}`, '/sse')
    expect(sse.headers['content-type']).toBe('text/event-stream')
    expect(sse.body).toBe('data: one\n\ndata: two\n\n')
  })

  it('carries a WebSocket both ways', async () => {
    const a = await app()
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    if (!c.ok) throw new Error('claim')
    const { l } = link(r.url, 'alex', c.token, a.port)
    await until(() => l.status().state === 'online')
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws`, { headers: { host: `alex.${DOMAIN}`, 'x-forwarded-for': '203.0.113.9' } })
    const got: string[] = []
    ws.on('message', (m) => got.push(String(m)))
    await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)))
    ws.send('ping')
    await until(() => got.length >= 2)
    expect(got).toEqual(['hello 203.0.113.9', 'echo ping'])
    ws.close()
  })

  it('refuses a wrong token, and stops for good when the handle is revoked', async () => {
    const a = await app()
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    if (!c.ok) throw new Error('claim')
    let revoked = 0
    const bad = link(r.url, 'alex', 'wvl_nope', a.port, { onRevoked: () => revoked++ })
    await until(() => bad.l.status().state === 'revoked')
    expect(revoked).toBe(1)
    bad.l.stop()
    // Another handle's token never opens this one.
    const other = await claimHandle(r.url, 'sam-x')
    if (!other.ok) throw new Error('claim')
    const cross = link(r.url, 'alex', other.token, a.port)
    await until(() => cross.l.status().state === 'revoked')
    cross.l.stop()
    const good = link(r.url, 'alex', c.token, a.port, { onRevoked: () => revoked++ })
    await until(() => good.l.status().state === 'online')
    // The admin command removes the handle from the file: the relay closes it within seconds and the link stops.
    new HandleStore(path.join(r.dir, 'handles.json')).remove('alex')
    await until(() => good.l.status().state === 'revoked', 10_000)
    expect(revoked).toBe(2)
    expect((await get(r.port, `alex.${DOMAIN}`, '/')).status).toBe(404)
  }, 15_000)

  it('comes back by itself under the same address when the relay restarts', async () => {
    const a = await app()
    const r1 = await relay()
    const c = await claimHandle(r1.url, 'alex')
    if (!c.ok) throw new Error('claim')
    const { l, states } = link(r1.url, 'alex', c.token, a.port)
    await until(() => l.status().state === 'online')
    await r1.close()
    await until(() => l.status().state !== 'online')
    // Same port, same data: the relay after a restart.
    const r2 = await relay(r1.dir, { port: r1.port })
    await until(() => l.status().state === 'online', 10_000)
    expect((await get(r2.port, `alex.${DOMAIN}`, '/again')).status).toBe(201)
    expect(states.map((s) => s.state)).toContain('offline')
  }, 15_000)

  it('a newer connection for the same handle takes over from the old one', async () => {
    const a = await app()
    const b = await app()
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    if (!c.ok) throw new Error('claim')
    const first = link(r.url, 'alex', c.token, a.port)
    await until(() => first.l.status().state === 'online')
    first.l.stop()
    const second = link(r.url, 'alex', c.token, b.port)
    await until(() => second.l.status().state === 'online')
    await get(r.port, `alex.${DOMAIN}`, '/which')
    expect(b.seen.some((q) => q.url === '/which')).toBe(true)
    expect(a.seen.some((q) => q.url === '/which')).toBe(false)
  })
})

describe('when the computer goes away mid-request', () => {
  it('answers the « not connected » page instead of leaving the request hanging', async () => {
    const hang = http.createServer(() => undefined) // never answers
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r))
    cleanup.push(() => new Promise((r) => (hang.closeAllConnections(), hang.close(() => r(undefined)))))
    const r = await relay()
    const c = await claimHandle(r.url, 'alex')
    if (!c.ok) throw new Error('claim')
    const { l } = link(r.url, 'alex', c.token, (hang.address() as { port: number }).port)
    await until(() => l.status().state === 'online')
    const pending = get(r.port, `alex.${DOMAIN}`, '/slow')
    await new Promise((res) => setTimeout(res, 200))
    l.stop()
    const res = await pending
    expect(res.status).toBe(502)
  })
})
