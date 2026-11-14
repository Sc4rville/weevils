// Hetzner Cloud and Hostinger API doubles for end-to-end tests of get's "create a server for me", without paying.
// Creating a server "boots" a machine: MOCK_BOOT (a shell command) runs with BOOT_SCRIPT pointing to what the real
// host would run as root at first boot (Hetzner: cloud-init's runcmd; Hostinger: the post-install script). The
// server answers with MOCK_IP. A new root password (« continue on this one ») runs MOCK_PASSWD with the password on
// its stdin. Only the calls get makes; shapes from each host's API reference.
//   MOCK_PORT=4184 MOCK_IP=172.30.99.10 MOCK_BOOT='…' MOCK_PASSWD='…' node get/host-mock.mjs
//   Hetzner: GET_HETZNER_API=http://127.0.0.1:4184/hetzner   Hostinger: GET_HOSTINGER_API=http://127.0.0.1:4184/hostinger
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const HZ_TOKEN = process.env.MOCK_HETZNER_TOKEN || 'mocktoken0000000000000000000000000000000000000000000000000000000'
const HS_TOKEN = process.env.MOCK_HOSTINGER_TOKEN || '42|mockhostingertoken00000000000000000000'
const IP = process.env.MOCK_IP || '203.0.113.10'
let n = 0
const scripts = new Map()
/** The servers made so far, as each host lists them. */
const made = []
/** Sets the machine's root password (MOCK_PASSWD reads it on stdin), as the host's agent would. */
function setRoot(password) {
  const r = spawnSync('bash', ['-c', process.env.MOCK_PASSWD || 'cat >/dev/null'], { input: `${password}\n`, stdio: ['pipe', 'inherit', 'inherit'] })
  console.log(`[mock] root password set on the machine (exit ${r.status})`)
}
const hzView = (x) => ({ id: x.id, name: x.name, status: 'running', created: new Date(x.at).toISOString(), labels: x.labels, public_net: { ipv4: { ip: IP } }, datacenter: { location: { name: x.location, city: 'Nuremberg' } }, server_type: { name: x.type } })
const hsView = (x) => ({ id: x.id, hostname: x.name, state: 'running', created_at: new Date(x.at).toISOString(), plan: x.type, ipv4: [{ id: 1, address: IP }] })

function boot(content) {
  const file = path.join(os.tmpdir(), `host-mock-${process.pid}-${++n}.sh`)
  fs.writeFileSync(file, content, { mode: 0o755 })
  const p = spawn('bash', ['-c', process.env.MOCK_BOOT || 'true'], { env: { ...process.env, BOOT_SCRIPT: file }, stdio: 'inherit', detached: true })
  p.unref()
}

const hzPrice = (location, gross) => ({ location, price_hourly: { net: (gross / 1.19 / 625).toFixed(4), gross: (gross / 625).toFixed(4) }, price_monthly: { net: (gross / 1.19).toFixed(4), gross: String(gross) } })
const hzIpv4 = (location) => ({ location, price_hourly: { net: '0.0008', gross: '0.0010' }, price_monthly: { net: '0.5000', gross: '0.5950' } })
const HZ_TYPES = [
  { id: 1, name: 'cx23', cores: 2, memory: 4, disk: 40, architecture: 'x86', deprecated: false, prices: [hzPrice('nbg1', 4.15), hzPrice('fsn1', 4.15), hzPrice('hel1', 4.15), hzPrice('ash', 4.49)] },
  { id: 2, name: 'cx33', cores: 4, memory: 8, disk: 80, architecture: 'x86', deprecated: false, prices: [hzPrice('nbg1', 6.59), hzPrice('fsn1', 6.59), hzPrice('hel1', 6.59)] },
  { id: 3, name: 'cx43', cores: 8, memory: 16, disk: 160, architecture: 'x86', deprecated: false, prices: [hzPrice('nbg1', 11.99), hzPrice('fsn1', 11.99)] },
  { id: 4, name: 'cax21', cores: 4, memory: 8, disk: 80, architecture: 'arm', deprecated: false, prices: [hzPrice('nbg1', 7.49)] },
]
const hsPlan = (k, monthly, first) => ({ id: `hostingercom-vps-kvm${k}`, name: `KVM ${k}`, category: 'VPS', metadata: {}, prices: [
  { id: `hostingercom-vps-kvm${k}-eur-12m`, name: `KVM ${k} (billed every 12 months)`, currency: 'EUR', price: Math.round(monthly * 1100), first_period_price: Math.round(first * 1200), period: 12, period_unit: 'month' },
  { id: `hostingercom-vps-kvm${k}-eur-1m`, name: `KVM ${k} (billed every month)`, currency: 'EUR', price: Math.round(monthly * 100), first_period_price: Math.round(first * 100), period: 1, period_unit: 'month' },
] })

http.createServer((req, res) => {
  const reply = (status, body) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const b = body ? JSON.parse(body) : {}
    // ---- Hetzner Cloud
    if (req.url.startsWith('/hetzner/')) {
      const url = req.url.slice('/hetzner'.length)
      if (req.headers.authorization !== `Bearer ${HZ_TOKEN}`) return reply(401, { error: { code: 'unauthorized', message: 'unable to authenticate' } })
      if (req.method === 'GET' && url.startsWith('/server_types')) return reply(200, { server_types: HZ_TYPES })
      if (req.method === 'GET' && url === '/pricing') return reply(200, { pricing: { currency: 'EUR', vat_rate: '19.00', primary_ips: [{ type: 'ipv4', prices: ['nbg1', 'fsn1', 'hel1', 'ash'].map(hzIpv4) }] } })
      if (req.method === 'POST' && url === '/servers') {
        const cmd = /^ {2}- \[bash, -c, "(.*)"\]$/m.exec(b.user_data || '')?.[1] || 'true'
        console.log(`[mock] Hetzner create ${b.name} ${b.server_type}@${b.location} image=${b.image}`)
        boot(`#!/bin/bash\n${cmd}\n`)
        const x = { host: 'hetzner', id: 1000 + n, name: b.name, labels: b.labels || {}, location: b.location, type: b.server_type, at: Date.now() }
        made.push(x)
        return reply(201, { server: { id: x.id, name: b.name, status: 'initializing', public_net: { ipv4: { ip: IP } } }, root_password: 'mock-root-password' })
      }
      if (req.method === 'GET' && url.startsWith('/servers?')) {
        const sel = new URL(url, 'http://x').searchParams.get('label_selector') || ''
        const [k, v] = sel.split('=')
        const list = made.filter((x) => x.host === 'hetzner' && (!k || (v === undefined ? k in x.labels : x.labels[k] === v)))
        if (/created:desc/.test(url)) list.reverse()
        return reply(200, { servers: list.map(hzView) })
      }
      let m = /^\/servers\/(\d+)$/.exec(url)
      if (req.method === 'GET' && m) {
        const x = made.find((y) => y.host === 'hetzner' && String(y.id) === m[1])
        return x ? reply(200, { server: hzView(x) }) : reply(404, { error: { code: 'not_found', message: 'server not found' } })
      }
      m = /^\/servers\/(\d+)\/actions\/reset_password$/.exec(url)
      if (req.method === 'POST' && m && made.some((y) => String(y.id) === m[1])) {
        const pw = crypto.randomBytes(15).toString('base64url')
        console.log(`[mock] Hetzner reset_password on ${m[1]}`)
        setRoot(pw)
        return reply(201, { root_password: pw, action: { id: 900 + n, command: 'reset_password', status: 'running' } })
      }
      if (req.method === 'GET' && /^\/servers\/\d+\/actions\/\d+$/.test(url)) return reply(200, { action: { id: 1, command: 'reset_password', status: 'success' } })
      return reply(404, { error: { code: 'not_found', message: 'not found' } })
    }
    // ---- Hostinger
    if (req.url.startsWith('/hostinger/')) {
      const url = req.url.slice('/hostinger'.length)
      if (req.headers.authorization !== `Bearer ${HS_TOKEN}`) return reply(401, { message: 'Unauthenticated.', correlation_id: 'mock' })
      if (req.method === 'GET' && url === '/api/billing/v1/catalog?category=VPS') return reply(200, [hsPlan(1, 10.99, 6.49), hsPlan(2, 15.99, 8.99), hsPlan(4, 29.99, 13.99), hsPlan(8, 59.99, 25.99)])
      if (req.method === 'GET' && url === '/api/billing/v1/payment-methods') return reply(200, [{ id: 6523, name: 'Credit Card', identifier: '4970*****6464', payment_method: 'card', is_default: true, is_expired: false, is_suspended: false }])
      if (req.method === 'GET' && url === '/api/vps/v1/templates') return reply(200, [{ id: 1002, name: 'Ubuntu 24.04', description: 'Ubuntu 24.04 LTS' }, { id: 1077, name: 'Ubuntu 24.04 with Docker' }])
      if (req.method === 'GET' && url === '/api/vps/v1/data-centers') return reply(200, [{ id: 17, name: 'fr', location: 'fr', city: 'Paris', continent: 'Europe' }, { id: 29, name: 'phx', location: 'us', city: 'Phoenix', continent: 'North America' }])
      if (req.method === 'POST' && url === '/api/vps/v1/post-install-scripts') {
        const id = 300 + scripts.size
        scripts.set(id, b.content)
        return reply(201, { id, name: b.name, content: b.content })
      }
      if (req.method === 'POST' && url === '/api/vps/v1/virtual-machines') {
        const script = scripts.get(b.setup?.post_install_script_id)
        if (!script) return reply(422, { message: 'The selected post install script id is invalid.' })
        console.log(`[mock] Hostinger buy ${b.item_id} with payment ${b.payment_method_id}, template ${b.setup.template_id}, dc ${b.setup.data_center_id}`)
        boot(script)
        const x = { host: 'hostinger', id: 17923 + n, name: b.setup.hostname || 'srv12345.hstgr.cloud', type: 'KVM 2', at: Date.now() }
        made.push(x)
        return reply(200, { order: { id: 1, status: 'completed', currency: 'EUR' }, virtual_machine: { id: x.id, hostname: x.name, state: 'initial', ipv4: [{ id: 1, address: IP }] } })
      }
      if (req.method === 'GET' && url === '/api/vps/v1/virtual-machines') return reply(200, made.filter((x) => x.host === 'hostinger').map(hsView))
      let m = /^\/api\/vps\/v1\/virtual-machines\/(\d+)$/.exec(url)
      if (req.method === 'GET' && m) {
        const x = made.find((y) => y.host === 'hostinger' && String(y.id) === m[1])
        return x ? reply(200, hsView(x)) : reply(404, { message: 'Not found' })
      }
      m = /^\/api\/vps\/v1\/virtual-machines\/(\d+)\/root-password$/.exec(url)
      if (req.method === 'PUT' && m) {
        if (!/[A-Z]/.test(b.password || '') || !/[a-z]/.test(b.password) || !/\d/.test(b.password) || b.password.length < 12) return reply(422, { message: 'The password is too weak.' })
        console.log(`[mock] Hostinger root-password on ${m[1]}`)
        setRoot(b.password)
        return reply(200, { id: 800 + n, name: 'set_root_password', state: 'success', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }
      if (req.method === 'GET' && /^\/api\/vps\/v1\/virtual-machines\/\d+\/actions\/\d+$/.test(url)) return reply(200, { id: 1, name: 'set_root_password', state: 'success' })
      return reply(404, { message: 'Not found' })
    }
    reply(404, {})
  })
}).listen(Number(process.env.MOCK_PORT || 4184), '127.0.0.1', () => console.log('[mock] Hetzner + Hostinger API doubles ready'))
