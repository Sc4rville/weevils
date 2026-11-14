// get/server.mjs: the public setup service. A mock Hetzner API, the real bootstrap's encryption through openssl, and
// the guards (preview key, SSRF, step allowlist, rate limits). No real network beyond 127.0.0.1.
// The Mac path, as far as Linux can check it: the script under bash 3.2, the page for a Mac visitor, the Node way of
// sealing the link. Its branches run for real in get/test-macos.sh (a fake Mac) and get/e2e-mac.mjs (a real one).
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
  if (req.method === 'GET' && req.url === '/pricing') {
    // Hetzner bills the server's IPv4 address on top of its type (shape from the API reference, GET /pricing).
    const ip = (location: string) => ({ location, price_hourly: { net: '0.0008', gross: '0.0010' }, price_monthly: { net: '0.5000', gross: '0.5950' } })
    return reply(200, { pricing: { currency: 'EUR', vat_rate: '19.00', primary_ips: [{ type: 'ipv6', prices: [] }, { type: 'ipv4', prices: ['nbg1', 'fsn1', 'hel1', 'ash'].map(ip) }] } })
  }
  if (req.method === 'GET' && req.url?.startsWith('/server_types')) {
    const price = (location: string, gross: string) => ({ location, price_hourly: { net: '0', gross: (Number(gross) / 625).toFixed(4) }, price_monthly: { net: '0', gross } })
    return reply(200, {
      server_types: [
        { name: 'cx22', cores: 2, memory: 4, disk: 40, architecture: 'x86', deprecated: true, prices: [price('nbg1', '3.00')] },
        { name: 'cx11', cores: 1, memory: 2, disk: 20, architecture: 'x86', prices: [price('nbg1', '2.00')] },
        { name: 'cax11', cores: 2, memory: 4, disk: 40, architecture: 'arm', prices: [price('nbg1', '3.50')] },
        { name: 'cpx22', cores: 2, memory: 4, disk: 80, architecture: 'x86', prices: [price('nbg1', '6.00'), price('hel1', '5.50')] },
        { name: 'cx23', cores: 2, memory: 4, disk: 40, architecture: 'x86', prices: [price('nbg1', '4.15'), price('fsn1', '4.15'), price('ash', '3.90')] },
        { name: 'cx33', cores: 4, memory: 8, disk: 80, architecture: 'x86', prices: [price('nbg1', '6.59'), price('fsn1', '6.59')] },
        { name: 'cpx32', cores: 4, memory: 8, disk: 160, architecture: 'x86', prices: [price('nbg1', '12.00')] },
        { name: 'cx43', cores: 8, memory: 16, disk: 160, architecture: 'x86', prices: [price('nbg1', '11.99'), price('hel1', '11.99')] },
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

// ---- a Hostinger API double (paths and shapes from developers.hostinger.com, OpenAPI 3.0.0)
const hsCalls: { method: string; url: string; body: any }[] = []
let hsPayment = true
const hostinger = http.createServer((req, res) => {
  const reply = (status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (req.headers.authorization !== 'Bearer 123|hostingertoken000000000') return reply(401, { message: 'Unauthenticated.', correlation_id: 'x' })
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    hsCalls.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : null })
    const plan = (n: number, monthly: number, first: number) => ({ id: `hostingercom-vps-kvm${n}`, name: `KVM ${n}`, category: 'VPS', metadata: {}, prices: [
      { id: `hostingercom-vps-kvm${n}-eur-24m`, name: `KVM ${n} (billed every 24 months)`, currency: 'EUR', price: monthly * 1500, first_period_price: first * 1000, period: 24, period_unit: 'month' },
      { id: `hostingercom-vps-kvm${n}-eur-1m`, name: `KVM ${n} (billed every month)`, currency: 'EUR', price: monthly * 100, first_period_price: first * 100, period: 1, period_unit: 'month' },
    ] })
    if (req.method === 'GET' && req.url === '/api/billing/v1/catalog?category=VPS') return reply(200, [plan(1, 10.99, 6.49), plan(2, 15.99, 8.99), plan(4, 29.99, 13.99), plan(8, 59.99, 25.99)])
    if (req.method === 'GET' && req.url === '/api/billing/v1/payment-methods') return reply(200, hsPayment ? [{ id: 6523, name: 'Credit Card', identifier: '1234*****6464', payment_method: 'card', is_default: true, is_expired: false, is_suspended: false }] : [])
    if (req.method === 'GET' && req.url === '/api/vps/v1/templates') return reply(200, [{ id: 1, name: 'Ubuntu 22.04' }, { id: 1077, name: 'Ubuntu 24.04 with Docker' }, { id: 1002, name: 'Ubuntu 24.04' }])
    if (req.method === 'GET' && req.url === '/api/vps/v1/data-centers') return reply(200, [{ id: 29, name: 'phx', location: 'us', city: 'Phoenix', continent: 'North America' }, { id: 17, name: 'fr', location: 'fr', city: 'Paris', continent: 'Europe' }])
    if (req.method === 'POST' && req.url === '/api/vps/v1/post-install-scripts') return reply(201, { id: 325, name: JSON.parse(body).name, content: JSON.parse(body).content })
    if (req.method === 'POST' && req.url === '/api/vps/v1/virtual-machines') return reply(200, { order: { id: 1, status: 'completed' }, virtual_machine: { id: 17923, hostname: 'srv12345.hstgr.cloud', state: 'initial', ipv4: [{ id: 1, address: '203.0.113.77' }] } })
    reply(404, { message: 'Not found' })
  })
})

let hzPort = 0
let hsPort = 0
let base = ''
let svc: http.Server
let gated: http.Server
let gatedBase = ''
const sshCalls: Record<string, unknown>[] = []

beforeAll(async () => {
  hzPort = await listen(hetzner)
  hsPort = await listen(hostinger)
  const cfg = config({ GET_BASE: 'https://get.example', GET_HETZNER_API: `http://127.0.0.1:${hzPort}`, GET_HOSTINGER_API: `http://127.0.0.1:${hsPort}`, GET_TRUST_PROXY: '0', GET_ALLOW_TARGETS: '172.30.99.10', GET_TARGET_URLS: '172.30.99.10=https://essai.example' })
  svc = createServer(cfg, { sshStart: async (_c: unknown, a: Record<string, unknown>) => (sshCalls.push(a), a.password === 'right' ? { ok: true } : { ok: false, why: 'auth' }) }).server
  base = `http://127.0.0.1:${await listen(svc)}`
  gated = createServer(config({ GET_PREVIEW_KEY: 'letmein', GET_TRUST_PROXY: '0' })).server
  gatedBase = `http://127.0.0.1:${await listen(gated)}`
})
afterAll(() => {
  hetzner.close()
  hostinger.close()
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
  it('reads them from both spellings of the installer’s table (bash 4 arrays, bash 3.2 plain variables)', () => {
    const file = path.join(os.tmpdir(), `wvget-titles-${process.pid}.sh`)
    fs.writeFileSync(file, 'EN[s_source]="getting weevils"\nFR_s_source="récupération de weevils"\nEN_waiting="waiting for weevilsd"\nEN_usage="usage: install.sh"\nEN_s_build_extra="no"\n')
    expect(stepTitles(file)).toEqual({ 'getting weevils': 's_source', 'récupération de weevils': 's_source', 'waiting for weevilsd': 'waiting' })
    fs.rmSync(file)
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
  it('quotes three sizes (4, 8, 16 GB) with their agents and the cheapest x86 type near the person', async () => {
    const cfg = config({ GET_HETZNER_API: `http://127.0.0.1:${hzPort}` })
    const q = await hetznerQuote(cfg, 'goodtoken00000000000000')
    // What the person pays, VAT included: the type plus its IPv4 address, by the hour, never more than the month.
    expect(q.sizes.map((z: any) => [z.size, z.type, z.location, z.hourly, z.monthly, z.ipv4, z.agents])).toEqual([
      ['light', 'cx23', 'nbg1', 0.0076, 4.745, true, '2-3'],
      ['recommended', 'cx33', 'nbg1', 0.0115, 7.185, true, '6'],
      ['strong', 'cx43', 'nbg1', 0.0202, 12.585, true, '12'],
    ])
    expect((await hetznerQuote(cfg, 'goodtoken00000000000000', 'america')).sizes[0]).toMatchObject({ type: 'cx23', location: 'ash', monthly: 4.495 })
  })
  it('creates the server with the install in cloud-init, then forgets the token', async () => {
    const { pub } = { pub: pubB64(keyPair().publicKey) }
    const job = (await post('/api/job', { kind: 'hetzner', lang: 'en', pub })).data
    expect((await post('/api/hetzner/quote', { sid: job.sid, view: job.view, token: 'badtoken000000000000000' })).data.error).toBe('unauthorized')
    const ro = await post('/api/hetzner/create', { sid: job.sid, view: job.view, token: 'readonlytoken0000000000', size: 'light' })
    expect(ro.status).toBe(403)
    expect(ro.data.error).toBe('forbidden')
    expect((await post('/api/hetzner/create', { sid: job.sid, view: job.view, token: 'goodtoken00000000000000', size: 'huge' })).data.error).toBe('bad_size')
    const ok = await post('/api/hetzner/create', { sid: job.sid, view: job.view, token: 'goodtoken00000000000000', size: 'recommended' })
    expect(ok.status).toBe(200)
    expect(ok.data.server).toMatchObject({ ip: '203.0.113.50', type: 'cx33', location: 'fsn1', size: 'recommended', agents: '6' })
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

describe('Hostinger (mock API)', () => {
  it('quotes the three KVM plans billed monthly, then buys with the saved card and a post-install script', async () => {
    const job = (await post('/api/job', { kind: 'hostinger', lang: 'en', pub: pubB64(keyPair().publicKey) })).data
    expect((await post('/api/hostinger/quote', { sid: job.sid, view: job.view, token: 'wrongtoken0000000000000' })).status).toBe(401)
    const q = (await post('/api/hostinger/quote', { sid: job.sid, view: job.view, token: '123|hostingertoken000000000' })).data
    expect(q.payment).toBe(true)
    expect(q.paymentLabel).toBe('Credit Card 1234*****6464')
    expect(q.sizes.map((z: any) => [z.size, z.type, z.memory, z.agents, z.first, z.monthly, z.currency])).toEqual([
      ['light', 'KVM 1', 4, '2-3', 6.49, 10.99, 'EUR'],
      ['recommended', 'KVM 2', 8, '6', 8.99, 15.99, 'EUR'],
      ['strong', 'KVM 4', 16, '12', 13.99, 29.99, 'EUR'],
    ])
    expect(JSON.stringify(q)).not.toContain('hostingercom-vps')
    const ok = await post('/api/hostinger/create', { sid: job.sid, view: job.view, token: '123|hostingertoken000000000', size: 'recommended', region: 'europe' })
    expect(ok.status).toBe(200)
    expect(ok.data.server).toMatchObject({ ip: '203.0.113.77', type: 'KVM 2', location: 'Paris', size: 'recommended' })
    expect(ok.data.reach).toBe('203-0-113-77.sslip.io')
    const script = hsCalls.find((c) => c.url === '/api/vps/v1/post-install-scripts')!.body
    expect(script.content).toContain(`https://get.example/i/${job.sid}`)
    const buy = hsCalls.find((c) => c.url === '/api/vps/v1/virtual-machines')!.body
    expect(buy).toMatchObject({ item_id: 'hostingercom-vps-kvm2-eur-1m', payment_method_id: 6523, setup: { template_id: 1002, data_center_id: 17, post_install_script_id: 325 } })
    expect(buy.setup.password).toBeUndefined()
  })
  it('says so when no card is saved, before buying anything', async () => {
    hsPayment = false
    const job = (await post('/api/job', { kind: 'hostinger', lang: 'en', pub: pubB64(keyPair().publicKey) })).data
    const before = hsCalls.length
    const r = await post('/api/hostinger/create', { sid: job.sid, view: job.view, token: '123|hostingertoken000000000', size: 'light' })
    hsPayment = true
    expect(r.status).toBe(402)
    expect(r.data.error).toBe('no_payment')
    expect(hsCalls.slice(before).some((c) => c.method === 'POST')).toBe(false)
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
  it('takes the two steps the bootstrap does itself by name, and no other name', async () => {
    const job = (await post('/api/job', { kind: 'pc', lang: 'en', pub: pubB64(keyPair().publicKey) })).data
    await report(job.sid, { event: 'start' })
    await report(job.sid, { event: 'step', step: 's_system' })
    await report(job.sid, { event: 'step', step: 'done' })
    await report(job.sid, { event: 'step', step: 'https://x/#k=abc' })
    await report(job.sid, { event: 'step', step: 'tunnel' })
    const st = (await post('/api/status', { sid: job.sid, view: job.view })).data
    expect(st.state).toBe('running')
    expect(st.steps).toEqual(['start', 's_system', 'tunnel'])
  })
  it('rejects a weak or malformed page key', async () => {
    const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey
    expect((await post('/api/job', { kind: 'pc', pub: pubB64(weak) })).data.error).toBe('bad_key')
    expect((await post('/api/job', { kind: 'pc', pub: 'A'.repeat(300) })).data.error).toBe('bad_key')
  })
})

describe('guards', () => {
  it('hides the page and API behind the preview key until launch, without relying on a redirect or a cookie', async () => {
    const gate = await fetch(gatedBase + '/')
    expect(gate.status).toBe(404)
    expect(await gate.text()).toContain('location.replace("/?k="')
    expect((await post('/api/job', { kind: 'pc', pub: 'x' }, gatedBase)).status).toBe(404)
    expect((await fetch(gatedBase + '/?k=wrong')).status).toBe(404)
    // The key in the URL opens the page directly (no 302), and keeps working on reload.
    const page = await fetch(gatedBase + '/?k=letmein', { redirect: 'manual' })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    // The page's own assets are public; its API calls carry the key in a header.
    expect((await fetch(gatedBase + '/qrcode.js')).status).toBe(200)
    const r = await fetch(gatedBase + '/api/job', { method: 'POST', headers: { 'content-type': 'application/json', 'x-get-key': 'letmein' }, body: JSON.stringify({ kind: 'pc', pub: pubB64(keyPair().publicKey) }) })
    expect(r.status).toBe(200)
    // A cookie still works too.
    expect((await fetch(gatedBase + '/', { headers: { cookie: 'gk=letmein' } })).status).toBe(200)
  })
  it('open to anyone since the launch: an old ?k= link still opens the page, which carries its share card', async () => {
    const page = await fetch(base + '/?k=anOldSharedKey', { redirect: 'manual' })
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<meta property="og:title" content="weevils — your AI dev team, in your pocket">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('<meta property="og:image" content="https://tryweevils.scarville.tech/og.png">')
    // The card: a PNG of 1200×630, small enough for WhatsApp's previews.
    const card = await fetch(base + '/og.png')
    expect(card.headers.get('content-type')).toBe('image/png')
    const png = Buffer.from(await card.arrayBuffer())
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
    expect(png.length).toBeLessThan(300_000)
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

// ---- macOS
const here = path.dirname(new URL(import.meta.url).pathname)
const bootstrap = fs.readFileSync(path.join(here, 'bootstrap.sh'), 'utf8')
const page = fs.readFileSync(path.join(here, 'index.html'), 'utf8')

describe('a Mac', () => {
  it('gets a script that macOS’s own bash (3.2) can read', async () => {
    const job = (await post('/api/job', { kind: 'pc', lang: 'fr', pub: pubB64(keyPair().publicKey) })).data
    const script = await (await fetch(`${base}/i/${job.sid}`)).text()
    expect(script).not.toMatch(/@[A-Z]+@/)
    expect(script).toContain(`MODE='pc'`)
    // The real thing when Docker has the image (never pulled from a test), else the host's bash.
    const bash32 = spawnSync('docker', ['image', 'inspect', 'bash:3.2'], { stdio: 'ignore' }).status === 0
    const r = bash32 ? spawnSync('docker', ['run', '--rm', '-i', 'bash:3.2', 'bash', '-n'], { input: script }) : spawnSync('bash', ['-n'], { input: script })
    expect(r.stderr.toString()).toBe('')
    expect(r.status).toBe(0)
    // What bash 3.2 or the tools of macOS do not have (see the contract of the port), comments left out.
    const code = bootstrap.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
    for (const gnu of [/tail [^|\n]*--pid/, /sed -i /, /(?<!openssl )base64 -[dw] /, /readlink -f/, /date -d/, /stat -c/, /\bsha256sum\b/, /\btimeout \d/, /\bsetsid\b/, /declare -A/, /\bmapfile\b/, /\$\{[A-Za-z_]+,,\}/, /\|&/, /&>>/]) expect(code).not.toMatch(gnu)
  }, 120_000)

  it('seals the link with Node as well as with openssl, both opened the way the page does (WebCrypto RSA-OAEP, SHA-256)', async () => {
    // The page's own key pair and import (index.html: newJob, unseal).
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt'])
    const pub = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64')
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
    const link = 'https://essai-mac.trycloudflare.com/#k=AbCdEf123456_-xyz'
    // The bootstrap's own shell functions, cut out of the script.
    const fns = ['seal_openssl', 'seal_node'].map((name) => new RegExp(`^  ${name}\\(\\) \\{\\n[\\s\\S]*?\\n  \\}$`, 'm').exec(bootstrap)?.[0])
    expect(fns.every(Boolean)).toBe(true)
    for (const how of ['seal_node', 'seal_openssl']) {
      const sealed = execFileSync('bash', ['-euo', 'pipefail', '-c', `${fns.join('\n')}\n${how}`], { input: link, env: { ...process.env, PUB: pub } }).toString()
      expect(sealed, how).toMatch(/^[A-Za-z0-9+/=]{340,350}$/)
      const opened = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, Buffer.from(sealed, 'base64')))
      expect(opened, how).toBe(link)
    }
    // No openssl at all, or one that fails (an old LibreSSL): nothing comes out, and nothing breaks the script.
    const none = execFileSync('bash', ['-euo', 'pipefail', '-c', `openssl() { return 1; }\n${fns.join('\n')}\nseal_openssl; echo "[$?]"`], { input: link, env: { ...process.env, PUB: pub } }).toString()
    expect(none).toBe('[0]\n')
    expect(bootstrap).toMatch(/\[ "\$OS" != Darwin \] \|\| order='node openssl'/)
  })

  // The page's script, run for one visitor: what the first screen shows.
  async function firstScreen(userAgent: string, lang = 'en') {
    const window = new Window({ url: 'https://get.example/', settings: { navigator: { userAgent } } })
    const document = window.document
    document.body.innerHTML = /<body>([\s\S]*?)<script src=/.exec(page)![1]
    window.localStorage.setItem('wvlang', lang)
    const calls: string[] = []
    const fetchStub = async (p: string) => {
      calls.push(p)
      const body = p === '/api/job' ? { sid: 'abcdefghjk', view: 'v', command: 'curl -fsSL https://get.example/i/abcdefghjk | bash' } : { state: 'waiting', steps: [] }
      return { ok: true, status: 200, json: async () => body }
    }
    const code = /<script>\n([\s\S]*?)<\/script>/.exec(page)![1]
    const names = ['window', 'document', 'navigator', 'localStorage', 'location', 'matchMedia', 'scrollTo', 'getSelection', 'fetch', 'crypto', 'setTimeout', 'setInterval']
    const values = [window, document, window.navigator, window.localStorage, window.location, () => ({ matches: false }), () => {}, () => ({ selectAllChildren() {} }), fetchStub, crypto.webcrypto, () => 0, () => 0]
    new Function(...names, code)(...values)
    const app = document.getElementById('app')!
    return { app, calls, text: () => app.textContent || '' }
  }
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

  it('is offered the “connect this computer” command on the first screen, like Linux, with the nudge toward a server', async () => {
    const mac = await firstScreen(MAC)
    await vi.waitFor(() => expect(mac.text()).toContain('curl -fsSL https://get.example/i/abcdefghjk | bash'), { timeout: 20_000 })
    expect(mac.calls[0]).toBe('/api/job')
    expect(mac.text()).toContain('Connect this computer')
    expect(mac.text()).toContain('Better: a server')
    expect(mac.text()).toContain('your phone and computer are off')
    expect(mac.text()).toContain('Mac password')
    expect(mac.text()).not.toMatch(/Linux for now|take a VPS/)
    // Same screen for Linux, without the Mac note; a phone gets servers first and no command.
    const linux = await firstScreen(LINUX)
    await vi.waitFor(() => expect(linux.text()).toContain('curl -fsSL https://get.example/i/abcdefghjk | bash'), { timeout: 20_000 })
    expect(linux.text()).toContain('Connect this computer')
    expect(linux.text()).not.toContain('Mac password')
    const phone = await firstScreen(IPHONE)
    expect(phone.calls).toEqual([])
    expect(phone.text()).toContain('Mac, Linux, or Windows with WSL.')
    expect(phone.text()).not.toContain('curl')
    // French, and no sentence left that sends a Mac away.
    const fr = await firstScreen(MAC, 'fr')
    expect(fr.text()).toContain('Branche cet ordinateur')
    expect(fr.text()).toContain('mot de passe du Mac')
    expect((await firstScreen(IPHONE, 'fr')).text()).toContain('Mac, Linux, ou Windows avec WSL.')
    expect(page).not.toMatch(/Linux for now|Linux pour l’instant|prends un VPS|take a VPS/)
  }, 60_000)

  it('resumes a computer setup on the first screen, where its command already is', async () => {
    expect(page).toContain("const computer = os === 'linux' || os === 'windows' || os === 'mac'")
    expect(page).toContain('if (!computer) pc()')
  })
})
