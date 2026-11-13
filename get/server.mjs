// get — the public way in to weevils (https://get.scarville.tech). Someone opens the link on a phone or a computer,
// plugs in a machine (a VPS created for them at Hetzner, their own VPS, or this computer), watches it install, then
// lands on THEIR OWN weevils, where the existing onboarding (Claude Code or Codex sign-in, first steps) takes over.
//
// Security model (see get/README.md):
// - Nothing is stored: jobs live in memory and expire; no database, no file, no log of a request body.
// - Secrets are used once, in memory: a Hetzner token for two API calls, an SSH password or key for one SSH command
//   (passed through an askpass environment variable or a RAM file, never argv, never disk).
// - After the install this service has no access to the machine: it never keeps an SSH key, a token or a tunnel. The
//   new weevils is served by the user's machine itself (its own HTTPS), not proxied here.
// - The access code never reaches this service: the page generates an RSA key pair, the install encrypts the login
//   link with the public half, and this service only relays the ciphertext.
// - No code from visitors runs here: the only programs started are `ssh` with a fixed command, toward a public address.
// - Rate limits per client address and per job.
//
// Run: node get/server.mjs (env below). Zero dependencies beyond Node 22 and the system's ssh client.

import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function config(env = process.env) {
  return {
    port: Number(env.GET_PORT || 4182),
    host: env.GET_HOST || '127.0.0.1',
    base: (env.GET_BASE || 'https://get.scarville.tech').replace(/\/$/, ''),
    /** Until the public launch: every page and API call needs this key once (?k=…, then a cookie). */
    previewKey: env.GET_PREVIEW_KEY || '',
    repo: env.GET_REPO || 'https://github.com/Sc4rville/weevils.git',
    /** A git bundle served to the installs while the repository is private (see get/make-bundle.sh). */
    bundle: env.GET_BUNDLE || '',
    hetzner: (env.GET_HETZNER_API || 'https://api.hetzner.cloud/v1').replace(/\/$/, ''),
    hostinger: (env.GET_HOSTINGER_API || 'https://developers.hostinger.com').replace(/\/$/, ''),
    /** Tests only: private addresses accepted as SSH targets, and the URL their weevils will have (ip=url,…). */
    allowTargets: (env.GET_ALLOW_TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean),
    targetUrls: Object.fromEntries((env.GET_TARGET_URLS || '').split(',').filter((s) => s.includes('=')).map((s) => s.split('=').map((x) => x.trim()))),
    installer: env.GET_INSTALLER || path.join(HERE, '..', 'install.sh'),
    trustProxy: env.GET_TRUST_PROXY !== '0',
  }
}

// ---------------------------------------------------------------- small helpers

const id = (n = 18) => crypto.randomBytes(n).toString('base64url')
/** Short, typeable, unambiguous: the PC command carries it. */
const sidOf = () => Array.from(crypto.randomBytes(10), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

export function publicAddress(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (net.isIP(ip) === 6) {
    if (ip.includes('.') || ip.includes('%')) return false
    const halves = ip.toLowerCase().split('::')
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
    const [a, b] = parts.map((x) => parseInt(x, 16))
    return a >= 0x2000 && a <= 0x3fff && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) && a !== 0x2002 && !(a === 0x3fff && b < 0x1000)
  }
  return false
}

/** 1.2.3.4 → 1-2-3-4.sslip.io: a name that resolves to the machine, so Caddy gets it a real certificate. */
export const sslip = (ip) => (net.isIP(ip) === 4 ? ip.replace(/\./g, '-') : ip.replace(/:/g, '-')) + '.sslip.io'

/** The installer's step titles (English and French), read from install.sh: the only lines an install reports. */
export function stepTitles(installer) {
  const src = fs.readFileSync(installer, 'utf8')
  const titles = {}
  for (const m of src.matchAll(/^(EN|FR)\[(s_[a-z]+|waiting|ready|almost_login|almost_install)\]="([^"]+)"$/gm)) titles[m[3]] = m[2]
  return titles
}

class Limiter {
  constructor() { this.hits = new Map() }
  /** true when key may act again: at most n times per window (ms). */
  ok(key, n, windowMs) {
    const now = Date.now()
    const list = (this.hits.get(key) || []).filter((t) => now - t < windowMs)
    if (list.length >= n) return this.hits.set(key, list), false
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > 20000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < 3600_000)) this.hits.delete(k)
    return true
  }
}

// ---------------------------------------------------------------- jobs (memory only)

const JOB_TTL = 3 * 3600_000
const MAX_JOBS = 2000
const STEPS = ['created', 'start', 's_system', 's_source', 's_config', 's_build', 's_service', 's_https', 'tunnel', 'waiting', 'done']

export function createStore() {
  const jobs = new Map()
  const sweep = () => {
    const now = Date.now()
    for (const [k, j] of jobs) if (now - j.touched > JOB_TTL || (j.state === 'done' && j.fetched && now - j.fetched > 600_000)) jobs.delete(k)
  }
  return {
    jobs,
    create(kind, lang, pub) {
      sweep()
      if (jobs.size >= MAX_JOBS) return null
      const j = { sid: sidOf(), view: id(), kind, lang, pub, reach: '', mode: kind === 'pc' ? 'pc' : 'vps', state: 'waiting', step: 'created', steps: [], error: '', result: null, server: null, created: Date.now(), touched: Date.now(), fetched: 0, scriptFetches: 0, reports: 0 }
      jobs.set(j.sid, j)
      return j
    },
    get: (sid) => (typeof sid === 'string' ? jobs.get(sid) : undefined),
    sweep,
  }
}

/** What the page sees: never the view token, the public key or anything sent by the user. */
const view = (j) => ({ sid: j.sid, kind: j.kind, state: j.state, step: j.step, steps: j.steps, error: j.error, result: j.result, server: j.server, reach: j.reach })

// ---------------------------------------------------------------- Hetzner (a token used for two calls, then dropped)

// Three sizes, by memory (a Claude Code session takes up to about 1 GB): what runs in parallel, said in agents.
export const SIZES = [
  { size: 'light', memory: 4, agents: '2-3' },
  { size: 'recommended', memory: 8, agents: '6' },
  { size: 'strong', memory: 16, agents: '12' },
]
/** Where to put the machine: near the person (the page sends its browser's region). */
const REGIONS = { europe: ['nbg1', 'fsn1', 'hel1'], america: ['ash', 'hil'], asia: ['sin'] }
const region = (r) => (REGIONS[r] ? r : 'europe')

const HZ_RETRY = ['resource_unavailable', 'placement_error', 'invalid_input', 'unsupported_location']

async function hz(cfg, token, method, p, body) {
  const r = await fetch(cfg.hetzner + p, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const code = data?.error?.code || `http_${r.status}`
    throw Object.assign(new Error(code), { status: r.status, hz: code })
  }
  return data
}

/** For each size, the cheapest current x86 type with that memory (2+ vCPU), and where it is sold, cheapest first.
 * Prices are what the person pays, VAT included: Hetzner bills by the hour (`hourly`), never more than `monthly` in a
 * month, and the server's IPv4 address on top of its type (`GET /pricing`; left out, `ipv4: false`, if that fails). */
export async function hetznerQuote(cfg, token, where = 'europe') {
  const [{ server_types: types = [] }, pricing] = await Promise.all([
    hz(cfg, token, 'GET', '/server_types?per_page=50'),
    hz(cfg, token, 'GET', '/pricing').then((d) => d?.pricing, () => null),
  ])
  const ipv4 = (pricing?.primary_ips || []).find((x) => x.type === 'ipv4')?.prices || []
  const gross = (p, k) => Number(p?.[k]?.gross ?? NaN)
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d
  const locs = REGIONS[region(where)].concat(Object.values(REGIONS).flat().filter((l) => !REGIONS[region(where)].includes(l)))
  const sizes = []
  for (const z of SIZES) {
    const fit = []
    for (const t of types) {
      if (t.deprecated || t.deprecation || (t.architecture && t.architecture !== 'x86') || t.cores < 2 || t.memory !== z.memory) continue
      for (const loc of locs) {
        const p = (t.prices || []).find((x) => x.location === loc)
        if (!p) continue
        const ip = ipv4.find((x) => x.location === loc)
        fit.push({
          type: t.name, cores: t.cores, memory: t.memory, disk: t.disk, location: loc, ipv4: !!ip,
          hourly: round(gross(p, 'price_hourly') + (ip ? gross(ip, 'price_hourly') : 0), 6),
          monthly: round(gross(p, 'price_monthly') + (ip ? gross(ip, 'price_monthly') : 0), 4),
        })
      }
    }
    // Near first, then the cheapest.
    fit.sort((a, b) => (locs.indexOf(a.location) > 2) - (locs.indexOf(b.location) > 2) || a.monthly - b.monthly || locs.indexOf(a.location) - locs.indexOf(b.location))
    if (fit.length) sizes.push({ ...z, ...fit[0], currency: 'EUR', options: fit.slice(0, 6) })
  }
  if (!sizes.length) throw Object.assign(new Error('no_type'), { hz: 'no_type' })
  return { sizes }
}

export function cloudInit(cfg, sid) {
  return `#cloud-config\nruncmd:\n  - [bash, -c, "curl -fsSL --retry 5 --retry-delay 3 ${cfg.base}/i/${sid} | bash > /var/log/weevils-get.log 2>&1"]\n`
}

export async function hetznerCreate(cfg, token, sid, size = 'recommended', where = 'europe') {
  const { sizes } = await hetznerQuote(cfg, token, where)
  const pick = sizes.find((x) => x.size === size) || sizes.find((x) => x.size === 'recommended') || sizes[0]
  const tried = new Set()
  let last
  for (const o of [pick, ...pick.options]) {
    const key = `${o.type}@${o.location}`
    if (tried.has(key)) continue
    tried.add(key)
    try {
      const data = await hz(cfg, token, 'POST', '/servers', {
        name: `weevils-${sid.slice(0, 6)}`,
        server_type: o.type,
        location: o.location,
        image: 'ubuntu-24.04',
        user_data: cloudInit(cfg, sid),
        labels: { app: 'weevils' },
        public_net: { enable_ipv4: true, enable_ipv6: true },
        start_after_create: true,
      })
      const ip = data?.server?.public_net?.ipv4?.ip
      if (!ip) throw Object.assign(new Error('no_ip'), { hz: 'no_ip' })
      // data.root_password is dropped with the rest of the response: weevils never needs it.
      return { name: data.server.name, id: data.server.id, ip, size: pick.size, agents: pick.agents, type: o.type, cores: o.cores, memory: o.memory, location: o.location, hourly: o.hourly, monthly: o.monthly, currency: 'EUR' }
    } catch (e) {
      last = e
      // Full, or that type not sold there right now: next option. Anything else (token, quota, payment) stops.
      if (!HZ_RETRY.includes(e.hz)) throw e
    }
  }
  throw last
}

// ---------------------------------------------------------------- Hostinger (same: a token for a few calls, then dropped)
// https://developers.hostinger.com (OpenAPI 3.0.0): catalog → payment methods → post-install script → purchase.

async function hs(cfg, token, method, p, body) {
  const r = await fetch(cfg.hostinger + p, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 202) return { ...data, pending: true }
  if (!r.ok) {
    const code = r.status === 401 ? 'unauthorized' : r.status === 403 ? 'forbidden' : r.status === 429 ? 'slow_down' : r.status === 422 ? 'hs_invalid' : `http_${r.status}`
    throw Object.assign(new Error(code), { status: r.status, hz: code, detail: String(data?.message || '').slice(0, 200) })
  }
  return data
}

const HS_PLAN = { light: 1, recommended: 2, strong: 4 }
const HS_CONTINENT = { europe: 'Europe', america: 'North America', asia: 'Asia' }

/** The three KVM plans billed monthly (no 12- or 24-month commitment), their first-month and renewal prices, and
 * whether the account has a usable payment method. */
export async function hostingerQuote(cfg, token) {
  const [catalog, methods] = await Promise.all([hs(cfg, token, 'GET', '/api/billing/v1/catalog?category=VPS'), hs(cfg, token, 'GET', '/api/billing/v1/payment-methods')])
  const pay = (Array.isArray(methods) ? methods : []).filter((m) => !m.is_expired && !m.is_suspended).sort((a, b) => b.is_default - a.is_default)[0]
  const sizes = []
  for (const z of SIZES) {
    const n = HS_PLAN[z.size]
    const item = (Array.isArray(catalog) ? catalog : []).find((i) => new RegExp(`^KVM ${n}$`, 'i').test(String(i.name || '').trim()) || i.id === `hostingercom-vps-kvm${n}`)
    const prices = (item?.prices || []).filter((p) => p.period === 1 && /^month/i.test(String(p.period_unit)))
    const price = prices.find((p) => p.currency === 'EUR') || prices.find((p) => p.currency === 'USD') || prices[0]
    if (!item || !price) continue
    sizes.push({ ...z, type: item.name, item: price.id, monthly: price.price / 100, first: (price.first_period_price ?? price.price) / 100, currency: price.currency })
  }
  if (!sizes.length) throw Object.assign(new Error('no_type'), { hz: 'no_type' })
  return { sizes, payment: pay ? { id: pay.id, label: `${pay.name || pay.payment_method || ''} ${pay.identifier || ''}`.trim() } : null }
}

export async function hostingerCreate(cfg, token, sid, size = 'recommended', where = 'europe') {
  const q = await hostingerQuote(cfg, token)
  if (!q.payment) throw Object.assign(new Error('no_payment'), { status: 402, hz: 'no_payment' })
  const pick = q.sizes.find((x) => x.size === size) || q.sizes.find((x) => x.size === 'recommended') || q.sizes[0]
  const [templates, centers] = await Promise.all([hs(cfg, token, 'GET', '/api/vps/v1/templates'), hs(cfg, token, 'GET', '/api/vps/v1/data-centers')])
  const tpl = (Array.isArray(templates) ? templates : []).filter((t) => /^Ubuntu 24\.04\b/i.test(String(t.name))).sort((a, b) => String(a.name).length - String(b.name).length)[0]
  if (!tpl) throw Object.assign(new Error('no_template'), { hz: 'no_template' })
  const dcs = Array.isArray(centers) ? centers : []
  const dc = dcs.find((d) => d.continent === HS_CONTINENT[region(where)]) || dcs.find((d) => d.continent === 'Europe') || dcs[0]
  if (!dc) throw Object.assign(new Error('no_type'), { hz: 'no_type' })
  // The install runs as root once the OS is in (Hostinger saves it to /post_install, its output to /post_install.log).
  const script = await hs(cfg, token, 'POST', '/api/vps/v1/post-install-scripts', {
    name: `weevils-${sid}`,
    content: `#!/bin/bash\ncurl -fsSL --retry 10 --retry-delay 5 ${cfg.base}/i/${sid} | bash > /var/log/weevils-get.log 2>&1\n`,
  })
  const data = await hs(cfg, token, 'POST', '/api/vps/v1/virtual-machines', {
    item_id: pick.item,
    payment_method_id: q.payment.id,
    setup: { template_id: tpl.id, data_center_id: dc.id, post_install_script_id: script.id, hostname: `weevils-${sid.slice(0, 6)}`, enable_backups: false },
  })
  if (data.pending) throw Object.assign(new Error('payment_pending'), { status: 402, hz: 'payment_pending' })
  const vm = data.virtual_machine || {}
  const ip = [vm.ipv4].flat().map((a) => (typeof a === 'string' ? a : a?.address)).find((a) => net.isIP(a) === 4) || ''
  return { name: vm.hostname || `weevils-${sid.slice(0, 6)}`, id: vm.id, ip, size: pick.size, agents: pick.agents, type: pick.type, memory: pick.memory, location: dc.city || dc.name, monthly: pick.monthly, first: pick.first, currency: pick.currency }
}

// ---------------------------------------------------------------- SSH (a password or key used for one command)

const SSH_OPTS = ['-F', '/dev/null', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=15', '-o', 'IdentityAgent=none', '-o', 'ServerAliveInterval=10', '-o', 'NumberOfPasswordPrompts=1']

export async function resolveTarget(cfg, host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/.test(h)) throw new Error('bad_host')
  const addrs = net.isIP(h) ? [h] : (await dns.lookup(h, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addrs.length) throw new Error('bad_host')
  const ip = addrs.find((a) => net.isIP(a) === 4) || addrs[0]
  if (!cfg.allowTargets.includes(ip) && (!publicAddress(ip) || ownAddresses().includes(ip))) throw new Error('private_host')
  return ip
}

let OWN = null
const ownAddresses = () => (OWN ??= Object.values(os.networkInterfaces()).flat().map((a) => a.address))

/** Starts the install on the target, detached, then disconnects. Resolves when the command was accepted. */
export function sshStart(cfg, { ip, port, user, password, key, sid }) {
  const url = `${cfg.base}/i/${sid}`
  // Root: start it directly. Another user: sudo with the same password, read from stdin (never argv).
  const detached = `setsid nohup bash -c "curl -fsSL --retry 3 ${url} | bash" >/tmp/weevils-get.log 2>&1 </dev/null &`
  const cmd = user === 'root'
    ? `IFS= read -r _ignored; ${detached} echo WVOK`
    : `IFS= read -r pw; printf '%s\\n' "$pw" | sudo -S -p '' sh -c ${sq(detached + ' echo WVOK')} 2>/dev/null || { [ -z "$pw" ] && sudo -n sh -c ${sq(detached + ' echo WVOK')}; } || echo WVNOSUDO`
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'wvget-'))
    const env = { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8' }
    const args = [...SSH_OPTS, '-p', String(port)]
    try {
      if (key) {
        // A private key in a RAM file for the few seconds of the connection, then deleted.
        fs.writeFileSync(path.join(dir, 'id'), key.trim() + '\n', { mode: 0o600 })
        args.push('-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', path.join(dir, 'id'), '-o', 'PreferredAuthentications=publickey')
      } else {
        fs.writeFileSync(path.join(dir, 'askpass'), '#!/bin/sh\nprintf \'%s\\n\' "$WVGET_PW"\n', { mode: 0o700 })
        Object.assign(env, { SSH_ASKPASS: path.join(dir, 'askpass'), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0', WVGET_PW: password })
        args.push('-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password,keyboard-interactive')
      }
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true })
      return resolve({ ok: false, why: 'internal' })
    }
    const p = spawn('ssh', [...args, `${user}@${ip}`, cmd], { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d).length > 4096 && (out = out.slice(-4096)))
    p.stderr.on('data', (d) => (err += d).length > 4096 && (err = err.slice(-4096)))
    p.stdin.on('error', () => {})
    p.stdin.end((key ? '' : password) + '\n')
    const timer = setTimeout(() => p.kill('SIGKILL'), 45_000)
    const done = (code) => {
      clearTimeout(timer)
      fs.rmSync(dir, { recursive: true, force: true })
      if (/WVOK/.test(out)) return resolve({ ok: true })
      if (/WVNOSUDO/.test(out)) return resolve({ ok: false, why: 'sudo' })
      if (/Permission denied|Authentication failed/i.test(err)) return resolve({ ok: false, why: 'auth' })
      if (/timed out|No route|unreachable|Connection refused|Could not resolve/i.test(err)) return resolve({ ok: false, why: 'unreachable' })
      resolve({ ok: false, why: code === null ? 'timeout' : 'ssh' })
    }
    p.on('error', () => done(-1))
    p.on('exit', done)
  })
}

// ---------------------------------------------------------------- HTTP

const PAGE_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const STATIC = { '/': 'index.html', '/logo.svg': '../public/branding/weevboss.svg', '/qrcode.js': 'qrcode.js', '/icon-192.png': '../public/icon-192.png', '/icon-180.png': '../public/icon-180.png', '/favicon-32.png': '../public/favicon-32.png' }
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000',
  'cache-control': 'no-store',
}

export function createServer(cfg = config(), deps = {}) {
  const store = deps.store || createStore()
  const limit = new Limiter()
  const titles = stepTitles(cfg.installer)
  const titleList = '|' + Object.keys(titles).filter((t) => !t.includes('|')).join('|') + '|'
  const bootstrap = fs.readFileSync(path.join(HERE, 'bootstrap.sh'), 'utf8')
  const sshStarter = deps.sshStart || sshStart
  let sshBusy = 0

  const clientIp = (req) => {
    const direct = req.socket.remoteAddress || ''
    const fwd = cfg.trustProxy && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(direct) ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : ''
    return fwd || direct
  }
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, { 'content-type': type, ...SECURITY_HEADERS, ...extra })
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }
  const fail = (res, status, error) => send(res, status, { error })
  const readBody = (req, max = 16_384) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > max) reject(Object.assign(new Error('too_big'), { status: 413 })), req.destroy()
        else chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  const json = async (req) => {
    try {
      return JSON.parse(await readBody(req))
    } catch (e) {
      if (e.status) throw e
      throw Object.assign(new Error('bad_json'), { status: 400 })
    }
  }
  const keyOk = (k) => !!k && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(k)).digest(), crypto.createHash('sha256').update(cfg.previewKey).digest())
  /** Preview gate: the key in the URL (?k=), in a header the page adds to its API calls, or in a cookie. No redirect:
   * some iOS contexts (in-app browsers, private tabs) drop a cookie set on a redirect. */
  const gated = (req, url) => {
    if (!cfg.previewKey) return false
    const cookie = /(?:^|;\s*)gk=([^;]+)/.exec(req.headers.cookie || '')?.[1]
    return !(keyOk(url.searchParams.get('k')) || keyOk(req.headers['x-get-key']) || keyOk(cookie && decodeURIComponent(cookie)))
  }
  /** The job a page asks about: its sid and its view token must match. */
  const owned = (body) => {
    const j = store.get(body?.sid)
    if (!j || typeof body.view !== 'string' || body.view.length !== j.view.length || !crypto.timingSafeEqual(Buffer.from(body.view), Buffer.from(j.view))) return null
    j.touched = Date.now()
    return j
  }

  const script = (j) => {
    const vals = {
      BASE: cfg.base, SID: j.sid, LANG: j.lang, MODE: j.mode, REACH: j.reach, REPO: cfg.repo, BUNDLE: cfg.bundle ? '1' : '0', PUB: j.pub, TITLES: titleList,
    }
    return bootstrap.replace(/@([A-Z]+)@/g, (m, k) => (k in vals ? sq(vals[k]) : m))
  }

  const handlers = {
    // A new setup: kind is hetzner, ssh or pc; pub is the page's RSA-OAEP public key (base64 DER, SPKI).
    'POST /api/job': async (req, res, ip) => {
      if (!limit.ok(`job:${ip}`, 12, 3600_000)) return fail(res, 429, 'slow_down')
      const b = await json(req)
      if (!['hetzner', 'hostinger', 'ssh', 'pc'].includes(b.kind)) return fail(res, 400, 'bad_kind')
      if (typeof b.pub !== 'string' || !/^[A-Za-z0-9+/=]{200,800}$/.test(b.pub)) return fail(res, 400, 'bad_key')
      try {
        const k = crypto.createPublicKey({ key: Buffer.from(b.pub, 'base64'), format: 'der', type: 'spki' })
        if (k.asymmetricKeyType !== 'rsa' || k.asymmetricKeyDetails.modulusLength < 2048) throw new Error()
      } catch {
        return fail(res, 400, 'bad_key')
      }
      const j = store.create(b.kind, b.lang === 'fr' ? 'fr' : 'en', b.pub)
      if (!j) return fail(res, 503, 'busy')
      if (b.kind === 'pc') j.state = 'waiting'
      send(res, 200, { sid: j.sid, view: j.view, command: `curl -fsSL ${cfg.base}/i/${j.sid} | bash` })
    },
    'POST /api/status': async (req, res, ip) => {
      if (!limit.ok(`status:${ip}`, 1200, 3600_000)) return fail(res, 429, 'slow_down')
      const j = owned(await json(req))
      if (!j) return fail(res, 404, 'no_job')
      if (j.state === 'done' && !j.fetched) j.fetched = Date.now()
      send(res, 200, view(j))
    },
    // A server created for the person: Hetzner or Hostinger. The token is checked, used for the calls, then dropped.
    ...Object.fromEntries(['hetzner', 'hostinger'].flatMap((host) => {
      const quote = host === 'hetzner' ? hetznerQuote : hostingerQuote
      const create = host === 'hetzner' ? hetznerCreate : hostingerCreate
      const token = (b) => (typeof b.token === 'string' && /^[A-Za-z0-9|._-]{20,256}$/.test(b.token.trim()) ? b.token.trim() : '')
      const status = (e) => ([401, 402, 403, 429].includes(e.status) ? e.status : 502)
      return [
        [`POST /api/${host}/quote`, async (req, res, ip) => {
          if (!limit.ok(`hz:${host}:${ip}`, 20, 3600_000)) return fail(res, 429, 'slow_down')
          const b = await json(req)
          const j = owned(b)
          if (!j || j.kind !== host) return fail(res, 404, 'no_job')
          if (!token(b)) return fail(res, 400, 'bad_token')
          try {
            const q = await quote(cfg, token(b), b.region)
            send(res, 200, { sizes: q.sizes.map(({ options, item, ...z }) => z), payment: host === 'hostinger' ? !!q.payment : true, paymentLabel: q.payment?.label?.replace(/\d(?=\d{4})/g, '•') || '' })
          } catch (e) {
            fail(res, status(e), e.hz || 'host_down')
          }
        }],
        [`POST /api/${host}/create`, async (req, res, ip) => {
          if (!limit.ok(`hzc:${host}:${ip}`, 5, 3600_000)) return fail(res, 429, 'slow_down')
          const b = await json(req)
          const j = owned(b)
          if (!j || j.kind !== host) return fail(res, 404, 'no_job')
          if (j.server) return send(res, 200, view(j))
          if (!token(b)) return fail(res, 400, 'bad_token')
          if (!SIZES.some((z) => z.size === b.size)) return fail(res, 400, 'bad_size')
          try {
            const s = await create(cfg, token(b), j.sid, b.size, b.region)
            j.server = { name: s.name, ip: s.ip, type: s.type, size: s.size, agents: s.agents, location: s.location, hourly: s.hourly, monthly: s.monthly, currency: s.currency }
            // No address yet (Hostinger may give it later): the install's own address, when it fetches its script.
            if (s.ip) {
              j.reach = cfg.targetUrls[s.ip] || sslip(s.ip)
              j.mode = cfg.targetUrls[s.ip] ? 'url' : 'vps'
            }
            j.state = 'running'
            j.step = 'created'
            j.steps.push('created')
            send(res, 200, view(j))
          } catch (e) {
            fail(res, status(e), e.hz || 'host_down')
          }
        }],
      ]
    })),
    'POST /api/ssh': async (req, res, ip) => {
      if (!limit.ok(`ssh:${ip}`, 6, 3600_000)) return fail(res, 429, 'slow_down')
      const b = await json(req)
      const j = owned(b)
      if (!j || j.kind !== 'ssh') return fail(res, 404, 'no_job')
      const user = String(b.user || 'root').trim()
      const port = Number(b.port || 22)
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) return fail(res, 400, 'bad_user')
      if (!Number.isInteger(port) || !(port === 22 || (port >= 1024 && port <= 65535))) return fail(res, 400, 'bad_port')
      const password = typeof b.password === 'string' ? b.password : ''
      const key = typeof b.key === 'string' ? b.key : ''
      if ((!password && !key) || password.length > 1024 || /[\0\r\n]/.test(password) || key.length > 12_000 || (key && !/^-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----\s*$/.test(key.trim()))) return fail(res, 400, 'bad_secret')
      let target
      try {
        target = await resolveTarget(cfg, b.host)
      } catch (e) {
        return fail(res, 400, e.message)
      }
      if (sshBusy >= 4) return fail(res, 503, 'busy')
      sshBusy++
      try {
        j.reach = cfg.targetUrls[target] || sslip(target)
        j.mode = cfg.targetUrls[target] ? 'url' : 'vps'
        const r = await sshStarter(cfg, { ip: target, port, user, password, key, sid: j.sid })
        if (!r.ok) return fail(res, 400, `ssh_${r.why}`)
        j.server = { ip: target, name: target }
        j.state = 'running'
        j.step = 'created'
        j.steps.push('created')
        send(res, 200, view(j))
      } finally {
        sshBusy--
      }
    },
  }

  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req)
    const url = new URL(req.url || '/', 'http://x')
    try {
      // The install script for one setup. Gated by its unguessable sid, not by the preview cookie.
      let m = /^\/i\/([a-z2-9]{10})$/.exec(url.pathname)
      if (m && req.method === 'GET') {
        if (!limit.ok(`i:${ip}`, 60, 3600_000)) return fail(res, 429, 'slow_down')
        const j = store.get(m[1])
        if (!j || j.state === 'done' || j.state === 'failed' || ++j.scriptFetches > 12) return send(res, 404, 'echo "weevils: this setup link has expired: open the setup page again." >&2; exit 1\n', 'text/x-shellscript; charset=utf-8')
        j.touched = Date.now()
        if (j.kind === 'pc' && j.state === 'waiting') j.state = 'running'
        if (!j.reach && j.server && publicAddress(ip)) {
          j.reach = sslip(ip)
          j.server.ip ||= ip
        }
        return send(res, 200, script(j), 'text/x-shellscript; charset=utf-8')
      }
      // Progress from an install: an event, a step title from the allowlist, and the sealed link at the end.
      m = /^\/r\/([a-z2-9]{10})$/.exec(url.pathname)
      if (m && req.method === 'POST') {
        const j = store.get(m[1])
        if (!j || j.state === 'done' || ++j.reports > 300) return fail(res, 404, 'no_job')
        const f = new URLSearchParams(await readBody(req, 8192))
        j.touched = Date.now()
        const ev = f.get('event')
        let step = ''
        if (ev === 'start') step = 'start'
        else if (ev === 'step') step = f.get('title') ? titles[f.get('title')] || '' : ['tunnel'].includes(f.get('step')) ? f.get('step') : ''
        if (step && STEPS.includes(step)) {
          j.state = 'running'
          j.step = step
          if (!j.steps.includes(step)) j.steps.push(step)
        }
        if (ev === 'failed') {
          j.state = 'failed'
          j.error = String(f.get('error') || '').replace(/#k=\S*/g, '').slice(0, 300)
        }
        if (ev === 'done') {
          const u = String(f.get('url') || '')
          j.result = {
            url: /^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(u) ? u : '',
            mode: ['public', 'lan', 'local'].includes(f.get('mode')) ? f.get('mode') : 'local',
            ready: f.get('ready') === 'yes',
            sealed: /^[A-Za-z0-9+/=]{100,1200}$/.test(f.get('sealed') || '') ? f.get('sealed') : '',
          }
          j.state = 'done'
          j.step = 'done'
          j.steps.push('done')
        }
        return send(res, 200, { ok: true })
      }
      // The code, while the repository is private: only for a live setup.
      if (url.pathname === '/weevils.bundle' && req.method === 'GET') {
        const j = store.get(url.searchParams.get('sid'))
        if (!cfg.bundle || !j || j.state === 'done' || !limit.ok(`b:${j.sid}`, 6, 3600_000)) return fail(res, 404, 'no_bundle')
        res.writeHead(200, { 'content-type': 'application/octet-stream', ...SECURITY_HEADERS })
        return fs.createReadStream(cfg.bundle).pipe(res)
      }
      if (url.pathname === '/health') return send(res, 200, { ok: true })
      // Preview gate: until the launch, the page and its API need the key once.
      // Public assets (the page's own script, logo, icons) are served to anyone: they are in the open repository.
      const file = STATIC[url.pathname]
      if (file && url.pathname !== '/' && req.method === 'GET') {
        const p = path.join(HERE, file)
        return send(res, 200, fs.readFileSync(p), PAGE_TYPES[path.extname(p)] || 'application/octet-stream', { 'cache-control': 'public, max-age=3600' })
      }
      if (gated(req, url)) {
        // A key in the fragment (#k=…) never reaches a server: this page moves it to the query.
        return send(res, 404, '<!doctype html><meta name="viewport" content="width=device-width"><title>weevils</title><p style="font:17px system-ui;padding:24px">Not here yet.</p><script>var m=/[#&]k=([^&]+)/.exec(location.hash);if(m)location.replace("/?k="+m[1])</script>', 'text/html; charset=utf-8')
      }
      if (cfg.previewKey && keyOk(url.searchParams.get('k'))) res.setHeader('set-cookie', `gk=${encodeURIComponent(url.searchParams.get('k'))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`)
      const h = handlers[`${req.method} ${url.pathname}`]
      if (h) {
        if (req.headers['content-type'] && !String(req.headers['content-type']).startsWith('application/json')) return fail(res, 415, 'json_only')
        return await h(req, res, ip)
      }
      if (url.pathname === '/' && req.method === 'GET') return send(res, 200, fs.readFileSync(path.join(HERE, 'index.html')), PAGE_TYPES['.html'])
      fail(res, 404, 'not_found')
    } catch (e) {
      if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'internal')
      // Never the request: only the path and the error name.
      if (!e.status) console.error(`[get] ${req.method} ${url.pathname}: ${e.name}`)
    }
  })
  return { server, store }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = config()
  const { server } = createServer(cfg)
  server.listen(cfg.port, cfg.host, () => console.log(`[get] ${cfg.base} on ${cfg.host}:${cfg.port}${cfg.previewKey ? ' (preview key on)' : ''}${cfg.bundle ? ' (bundle)' : ''}`))
}
