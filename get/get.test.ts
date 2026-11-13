// get/server.mjs: the public setup service. A mock Hetzner API, the real bootstrap's encryption through openssl, and
// the guards (preview key, SSRF, step allowlist, rate limits). No real network beyond 127.0.0.1.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript module, no types
import { config, createServer, hetznerQuote, publicAddress, resolveTarget, sslip, stepTitles } from './server.mjs'

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))

// ---- a Hetzner API double
const created: Record<string, unknown>[] = []
const hetzner = http.createServer((req, res) => {
  const auth = req.headers.authorization
  const reply = (status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (auth === 'Bearer readonlytoken0000000000') {
    if (req.method === 'POST') return reply(403, { error: { code: 'forbidden', message: 'insufficient permissions' } })
  } else if (auth !== 'Bearer goodtoken00000000000000') return reply(401, { error: { code: 'unauthorized', message: 'unable to authenticate' } })
  if (req.method === 'GET' && req.url?.startsWith('/server_types')) {
    const price = (location: string, gross: string) => ({ location, price_monthly: { net: '0', gross } })
    return reply(200, {
      server_types: [
        { name: 'cx22', cores: 2, memory: 4, disk: 40, architecture: 'x86', deprecated: true, prices: [price('nbg1', '3.00')] },
        { name: 'cx11', cores: 1, memory: 2, disk: 20, architecture: 'x86', prices: [price('nbg1', '2.00')] },
        { name: 'cax11', cores: 2, memory: 4, disk: 40, architecture: 'arm', prices: [price('nbg1', '3.50')] },
        { name: 'cpx22', cores: 2, memory: 4, disk: 80, architecture: 'x86', prices: [price('nbg1', '6.00'), price('hel1', '5.50')] },
        { name: 'cx23', cores: 2, memory: 4, disk: 40, architecture: 'x86', prices: [price('nbg1', '4.15'), price('fsn1', '4.15'), price('ash', '3.90')] },
      ],
    })
  }
  if (req.method === 'POST' && req.url === '/servers') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const b = JSON.parse(body)
      created.push(b)
      if (created.length === 1 && b.location === 'nbg1') return reply(412, { error: { code: 'resource_unavailable', message: 'full' } })
      reply(201, { server: { id: 42, name: b.name, public_net: { ipv4: { ip: '203.0.113.50' } } }, root_password: 'never-used' })
    })
    return
  }
  reply(404, { error: { code: 'not_found' } })
})

let hzPort = 0
let base = ''
let svc: http.Server
let gated: http.Server
let gatedBase = ''
const sshCalls: Record<string, unknown>[] = []

beforeAll(async () => {
  hzPort = await listen(hetzner)
  const cfg = config({ GET_BASE: 'https://get.example', GET_HETZNER_API: `http://127.0.0.1:${hzPort}`, GET_TRUST_PROXY: '0', GET_ALLOW_TARGETS: '172.30.99.10', GET_TARGET_URLS: '172.30.99.10=https://essai.example' })
  svc = createServer(cfg, { sshStart: async (_c: unknown, a: Record<string, unknown>) => (sshCalls.push(a), a.password === 'right' ? { ok: true } : { ok: false, why: 'auth' }) }).server
  base = `http://127.0.0.1:${await listen(svc)}`
  gated = createServer(config({ GET_PREVIEW_KEY: 'letmein', GET_TRUST_PROXY: '0' })).server
  gatedBase = `http://127.0.0.1:${await listen(gated)}`
})
afterAll(() => {
  hetzner.close()
  svc.close()
  gated.close()
})

const post = async (p: string, body: unknown, b = base) => {
  const r = await fetch(b + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const keyPair = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const pubB64 = (k: crypto.KeyObject) => k.export({ type: 'spki', format: 'der' }).toString('base64')
const report = (sid: string, fields: Record<string, string>) => fetch(`${base}/r/${sid}`, { method: 'POST', body: new URLSearchParams(fields) })

describe('helpers', () => {
  it('reads the step titles from install.sh, both languages', () => {
    const t = stepTitles(config().installer)
    expect(t['getting weevils']).toBe('s_source')
    expect(t['dependencies and app build']).toBe('s_build')
    expect(Object.values(t)).toContain('s_https')
    expect(Object.keys(t).some((k) => /é/.test(k))).toBe(true)
  })
  it('names a machine by its address', () => {
    expect(sslip('203.0.113.5')).toBe('203-0-113-5.sslip.io')
  })
  it('refuses private, loopback and link-local targets unless allowed for tests', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.2', '169.254.169.254', '172.16.0.1', '100.64.0.1', '::1', 'fd00::1']) expect(publicAddress(ip)).toBe(false)
    expect(publicAddress('8.8.8.8')).toBe(true)
    const cfg = config({ GET_ALLOW_TARGETS: '172.30.99.10' })
    await expect(resolveTarget(cfg, '127.0.0.1')).rejects.toThrow('private_host')
    await expect(resolveTarget(cfg, '169.254.169.254')).rejects.toThrow('private_host')
    await expect(resolveTarget(cfg, 'localhost')).rejects.toThrow('private_host')
    await expect(resolveTarget(cfg, 'a b;rm')).rejects.toThrow('bad_host')
    expect(await resolveTarget(cfg, '172.30.99.10')).toBe('172.30.99.10')
  })
})

describe('Hetzner (mock API)', () => {
  it('quotes the cheapest x86 server with 2 vCPU and 4 GB in Europe', async () => {
    const q = await hetznerQuote(config({ GET_HETZNER_API: `http://127.0.0.1:${hzPort}` }), 'goodtoken00000000000000')
    expect(q.best).toMatchObject({ type: 'cx23', location: 'nbg1', monthly: 4.15 })
  })
  it('creates the server with the install in cloud-init, then forgets the token', async () => {
    const { pub } = { pub: pubB64(keyPair().publicKey) }
    const job = (await post('/api/job', { kind: 'hetzner', lang: 'en', pub })).data
    expect((await post('/api/hetzner/quote', { sid: job.sid, view: job.view, token: 'badtoken000000000000000' })).data.error).toBe('unauthorized')
    const ro = await post('/api/hetzner/create', { sid: job.sid, view: job.view, token: 'readonlytoken0000000000' })
    expect(ro.status).toBe(403)
    expect(ro.data.error).toBe('forbidden')
    const ok = await post('/api/hetzner/create', { sid: job.sid, view: job.view, token: 'goodtoken00000000000000' })
    expect(ok.status).toBe(200)
    expect(ok.data.server).toMatchObject({ ip: '203.0.113.50', type: 'cx23', location: 'fsn1' })
    expect(ok.data.reach).toBe('203-0-113-50.sslip.io')
    const sent = created.at(-1) as Record<string, string>
    expect(sent.image).toBe('ubuntu-24.04')
    expect(sent.user_data).toContain(`https://get.example/i/${job.sid}`)
    expect(JSON.stringify(ok.data)).not.toMatch(/goodtoken|never-used/)
    // The page sees the job, never its key or token.
    const st = (await post('/api/status', { sid: job.sid, view: job.view })).data
    expect(JSON.stringify(st)).not.toMatch(/goodtoken|never-used|view|pub/)
  })
  it('needs the page’s view token for every call', async () => {
    const job = (await post('/api/job', { kind: 'hetzner', lang: 'en', pub: pubB64(keyPair().publicKey) })).data
    expect((await post('/api/status', { sid: job.sid, view: 'x'.repeat(job.view.length) })).status).toBe(404)
    expect((await post('/api/hetzner/create', { sid: job.sid, token: 'goodtoken00000000000000' })).status).toBe(404)
  })
})

describe('an install, end to end through the API', () => {
  it('serves its script, keeps only allowlisted step titles, and relays a link only the page can open', async () => {
    const { publicKey, privateKey } = keyPair()
    const job = (await post('/api/job', { kind: 'ssh', lang: 'fr', pub: pubB64(publicKey) })).data
    expect((await post('/api/ssh', { sid: job.sid, view: job.view, host: '10.1.2.3', password: 'right' })).data.error).toBe('private_host')
    expect((await post('/api/ssh', { sid: job.sid, view: job.view, host: '172.30.99.10', user: 'pote', password: 'wrong' })).data.error).toBe('ssh_auth')
    const ok = await post('/api/ssh', { sid: job.sid, view: job.view, host: '172.30.99.10', user: 'pote', password: 'right' })
    expect(ok.status).toBe(200)
    expect(ok.data.reach).toBe('https://essai.example')
    expect(JSON.stringify(ok.data)).not.toContain('right')

    const script = await (await fetch(`${base}/i/${job.sid}`)).text()
    expect(script).not.toMatch(/@[A-Z]+@/)
    expect(script).toContain(`SID='${job.sid}'`)
    expect(script).toContain(`MODE='url'`)
    expect(script).toContain(`REACH='https://essai.example'`)
    execFileSync('bash', ['-n'], { input: script })

    await report(job.sid, { event: 'start' })
    await report(job.sid, { event: 'step', title: 'récupération de weevils' })
    await report(job.sid, { event: 'step', title: '  code : SECRET123' })
    let st = (await post('/api/status', { sid: job.sid, view: job.view })).data
    expect(st.steps).toEqual(['created', 'start', 's_source'])
    expect(JSON.stringify(st)).not.toContain('SECRET123')

    // The bootstrap's own openssl command, then the page's RSA-OAEP SHA-256 decryption.
    const link = 'https://essai.example/#k=AbCdEf123456'
    const der = Buffer.from(pubB64(publicKey), 'base64')
    const fs = await import('node:fs')
    const tmp = `/tmp/wvget-test-${process.pid}.der`
    fs.writeFileSync(tmp, der)
    const sealed = execFileSync('openssl', ['pkeyutl', '-encrypt', '-pubin', '-keyform', 'DER', '-inkey', tmp, '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256', '-pkeyopt', 'rsa_mgf1_md:sha256'], { input: link }).toString('base64')
    fs.rmSync(tmp)
    await report(job.sid, { event: 'done', url: 'https://essai.example', mode: 'public', ready: 'no', sealed })
    st = (await post('/api/status', { sid: job.sid, view: job.view })).data
    expect(st.state).toBe('done')
    expect(st.result.url).toBe('https://essai.example')
    const opened = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(st.result.sealed, 'base64')).toString()
    expect(opened).toBe(link)
    // A finished setup no longer serves its script.
    expect((await fetch(`${base}/i/${job.sid}`)).status).toBe(404)
  })
  it('reports a failure without anything that looks like a login link', async () => {
    const job = (await post('/api/job', { kind: 'pc', lang: 'en', pub: pubB64(keyPair().publicKey) })).data
    expect(job.command).toBe(`curl -fsSL https://get.example/i/${job.sid} | bash`)
    await fetch(`${base}/i/${job.sid}`)
    await report(job.sid, { event: 'failed', error: 'oops https://x/#k=abc' })
    const st = (await post('/api/status', { sid: job.sid, view: job.view })).data
    expect(st.state).toBe('failed')
    expect(st.error).not.toContain('abc')
  })
  it('rejects a weak or malformed page key', async () => {
    const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
    expect((await post('/api/job', { kind: 'pc', pub: pubB64(weak) })).data.error).toBe('bad_key')
    expect((await post('/api/job', { kind: 'pc', pub: 'A'.repeat(300) })).data.error).toBe('bad_key')
  })
})

describe('guards', () => {
  it('hides everything behind the preview key until launch, except the install scripts', async () => {
    expect((await fetch(gatedBase + '/')).status).toBe(404)
    expect((await post('/api/job', { kind: 'pc', pub: 'x' }, gatedBase)).status).toBe(404)
    const r = await fetch(gatedBase + '/?k=letmein', { redirect: 'manual' })
    expect(r.status).toBe(302)
    const cookie = r.headers.get('set-cookie')!.split(';')[0]
    const page = await fetch(gatedBase + '/', { headers: { cookie } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
  it('limits job creation per address', async () => {
    const own = createServer(config({ GET_TRUST_PROXY: '0' })).server
    const b = `http://127.0.0.1:${await listen(own)}`
    const pub = pubB64(keyPair().publicKey)
    const codes: number[] = []
    for (let i = 0; i < 14; i++) codes.push((await post('/api/job', { kind: 'pc', pub }, b)).status)
    own.close()
    expect(codes.filter((c) => c === 200)).toHaveLength(12)
    expect(codes.at(-1)).toBe(429)
  })
})
