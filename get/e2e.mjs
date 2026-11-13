// Drives a real setup through get's API exactly like the page does (RSA-OAEP key, job, polling, unsealing).
//   node get/e2e.mjs ssh <host> <user> [port]        (password read from WVGET_PASSWORD)
//   node get/e2e.mjs pc                                prints the command, then follows it
//   node get/e2e.mjs hetzner|hostinger                 token from WVGET_TOKEN, size from WVGET_SIZE (a real server!)
// Env: WVGET_BASE (https://get.scarville.tech), WVGET_KEY (preview key, if the site is still gated).
import crypto from 'node:crypto'

const base = process.env.WVGET_BASE || 'https://get.scarville.tech'
const cookie = process.env.WVGET_KEY ? `gk=${encodeURIComponent(process.env.WVGET_KEY)}` : ''
const [kind, ...rest] = process.argv.slice(2)

async function api(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${p}: ${data.error || r.status}`)
  return data
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const job = await api('/api/job', { kind, lang: process.env.WVGET_LANG || 'en', pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') })
console.log(`job ${job.sid}`)
if (kind === 'pc') console.log(`run: ${job.command}`)
if (kind === 'ssh') {
  const [host, user = 'root', port = '22'] = rest
  console.log(await api('/api/ssh', { sid: job.sid, view: job.view, host, user, port: Number(port), password: process.env.WVGET_PASSWORD || '' }).then((s) => `started on ${s.server.ip}, reach ${s.reach}`))
}
if (kind === 'hetzner' || kind === 'hostinger') {
  const token = process.env.WVGET_TOKEN || ''
  const size = process.env.WVGET_SIZE || 'recommended'
  const q = await api(`/api/${kind}/quote`, { sid: job.sid, view: job.view, token, region: 'europe' })
  for (const z of q.sizes) console.log(`size ${z.size}: ${z.type} ${z.memory} GB, ${z.agents} agents, ${z.first && z.first !== z.monthly ? `${z.first} then ` : ''}${z.monthly} ${z.currency}/month`)
  const s = await api(`/api/${kind}/create`, { sid: job.sid, view: job.view, token, size, region: 'europe' })
  console.log(`created ${s.server.name} ${s.server.ip} (${s.server.type}, ${s.server.location})`)
}
const t0 = Date.now()
let last = ''
for (;;) {
  const s = await api('/api/status', { sid: job.sid, view: job.view })
  const line = `${s.state} ${s.steps.join(' → ')}`
  if (line !== last) console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${(last = line)}`)
  if (s.state === 'failed') {
    console.log(`FAILED: ${s.error}`)
    process.exit(1)
  }
  if (s.state === 'done') {
    const link = s.result.sealed ? crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(s.result.sealed, 'base64')).toString() : ''
    console.log(`DONE url=${s.result.url} mode=${s.result.mode} ready=${s.result.ready} sealed=${link.startsWith(s.result.url + '/#k=') ? 'ok' : 'MISSING'}`)
    if (process.env.WVGET_SHOW_LINK) console.log(link)
    // The page opens this link; check the instance answers to its code.
    const code = link.split('#k=')[1] || ''
    const login = await fetch(`${s.result.url}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.result.url }, body: JSON.stringify({ secret: code }) }).catch((e) => ({ status: e.message, headers: new Headers() }))
    const wv = (login.headers.get('set-cookie') || '').split(';')[0]
    const feed = wv ? await fetch(`${s.result.url}/api/snapshot`, { headers: { cookie: wv } }).catch((e) => ({ status: e.message })) : { status: 'no cookie' }
    console.log(`instance login → ${login.status}, snapshot with its cookie → ${feed.status}`)
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 3000))
}
