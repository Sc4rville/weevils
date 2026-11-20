// Another computer plugged in from one line (docs/install.md, "Several machines"). When the person asks, weevboss's
// thread shows, in its own words, the line to paste in a terminal on that computer:
//
//   curl -fsSL https://<this weevils>/api/join.sh | bash -s <code>
//
// server/join.sh, run there, makes an SSH key of its own and sends it with the computer's name to POST /api/join/<code>:
// the one-time code is its only credential (192 random bits, one use, one hour, only its SHA-256 kept). This side writes
// that key into ~/.ssh/authorized_keys, held to the reverse tunnel's one port and to registering that one machine (a
// forced `weevils-service remote-shell <id> <port>`: no shell, no other command, no other forward), and answers where to
// connect. The script then runs install.sh --secondary through that key: the federation already in place does the rest.
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'

export const JOIN_TTL = 60 * 60_000
export const FIRST_TUNNEL_PORT = 4192
const MAX_OPEN = 4
const CODE_RE = /^[A-Za-z0-9_-]{20,64}$/
const KEY_RE = /^(ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|ssh-rsa) ([A-Za-z0-9+/]{40,2000}={0,3})(?: [^\r\n"\\]{0,200})?$/
const TAG = 'weevils-join:'

export interface JoinCode {
  hash: string
  at: number
  /** user@host the other computer connects to (this machine, as reached from anywhere). */
  target: string
  /** The tunnel port this code reserves: the authorized key may only listen there. */
  port: number
  used?: { id: string; at: number }
}

export interface JoinDeps {
  /** DATA_DIR/join.json */
  file: string
  /** ~/.ssh/authorized_keys of the user weevilsd runs as. */
  authorizedKeys: string
  /** Absolute path of weevils-service, the forced command. */
  service: string
  /** WEEVILS_REMOTES as the config file says now (id=url,…). */
  remotes: () => string
  /** The machine ids already known (this one and its remotes). */
  machineIds: () => string[]
  now?: () => number
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** A name as weevils writes machine ids (install.sh's slug): lowercase, digits and dashes, 20 at most. */
export const slugId = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '')

/** The first tunnel port no remote uses and no open code reserves. */
export function freePort(remotes: string, reserved: number[]): number {
  const used = new Set(reserved)
  for (const m of remotes.matchAll(/127\.0\.0\.1:(\d+)/g)) used.add(Number(m[1]))
  let port = FIRST_TUNNEL_PORT
  while (used.has(port)) port++
  return port
}

/** The line that lets the other computer in: its own key, the tunnel's one port both ways, one forced command. */
export function authorizedLine(service: string, id: string, port: number, key: string): string {
  const [type, blob] = key.split(' ')
  const opts = `restrict,port-forwarding,permitlisten="127.0.0.1:${port}",permitopen="127.0.0.1:${port}",command="${service} remote-shell ${id} ${port}"`
  return `${opts} ${type} ${blob} ${TAG}${id}`
}

/** known_hosts lines for this machine under the name the other computer uses (read from sshd's public host keys). */
export function knownHosts(host: string, dir = '/etc/ssh'): string[] {
  const out: string[] = []
  for (const kind of ['ed25519', 'ecdsa', 'rsa']) {
    try {
      const [type, blob] = fs.readFileSync(path.join(dir, `ssh_host_${kind}_key.pub`), 'utf8').trim().split(/\s+/)
      if (type && blob && /^[A-Za-z0-9+/=]+$/.test(blob)) out.push(`${host} ${type} ${blob}`)
    } catch {
      /* not this kind */
    }
  }
  return out
}

/** WEEVILS_REMOTES as the config file says it now (weevils-service add-remote writes it there). */
export function remotesIn(configFile: string): string {
  try {
    return /^\s*WEEVILS_REMOTES\s*=\s*["']?([^"'\n]*)/m.exec(fs.readFileSync(configFile, 'utf8'))?.[1].trim() ?? ''
  } catch {
    return ''
  }
}

export class Join {
  private d: JoinDeps
  constructor(d: JoinDeps) {
    this.d = d
  }

  private now = () => (this.d.now ?? Date.now)()

  private read(): JoinCode[] {
    try {
      const codes = (JSON.parse(fs.readFileSync(this.d.file, 'utf8')) as { codes?: JoinCode[] }).codes ?? []
      // Spent or expired codes go; a used one stays an hour (its port stays reserved while the install runs there).
      return codes.filter((c) => this.now() - (c.used?.at ?? c.at) < JOIN_TTL)
    } catch {
      return []
    }
  }

  private write(codes: JoinCode[]) {
    fs.mkdirSync(path.dirname(this.d.file), { recursive: true })
    const tmp = `${this.d.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ codes }), { mode: 0o600 })
    fs.renameSync(tmp, this.d.file)
  }

  /** A new one-time code for `target` (user@host of this machine). Only a few are open at once. */
  create(target: string): string {
    const codes = this.read()
    const open = codes.filter((c) => !c.used)
    while (open.length >= MAX_OPEN) codes.splice(codes.indexOf(open.shift()!), 1)
    const code = crypto.randomBytes(24).toString('base64url')
    codes.push({ hash: sha(code), at: this.now(), target, port: freePort(this.d.remotes(), codes.map((c) => c.port)) })
    this.write(codes)
    return code
  }

  /** The open code behind `code`, if it can still be used. */
  open(code: string): JoinCode | null {
    if (!CODE_RE.test(code)) return null
    const h = sha(code)
    return this.read().find((c) => !c.used && c.hash === h) ?? null
  }

  /** The other computer's key and name, against its code: written once, the code spent. */
  use(code: string, rawId: string, rawKey: string): { ok: true; id: string; port: number; target: string } | { ok: false; why: 'expired' | 'bad' } {
    const key = rawKey.trim()
    if (!KEY_RE.test(key)) return { ok: false, why: 'bad' }
    const codes = this.read()
    const h = CODE_RE.test(code) ? sha(code) : ''
    const c = codes.find((x) => !x.used && x.hash === h)
    if (!c) return { ok: false, why: 'expired' }
    const blob = key.split(' ')[1]
    const lines = (() => {
      try {
        return fs.readFileSync(this.d.authorizedKeys, 'utf8').split('\n').filter(Boolean)
      } catch {
        return []
      }
    })()
    // The same computer again (its key already there): it keeps its id. Otherwise a name no machine has yet.
    const again = lines.find((l) => l.includes(` ${blob} ${TAG}`))
    let id = again ? again.slice(again.lastIndexOf(TAG) + TAG.length) : slugId(rawId) || 'computer'
    if (!again) {
      const taken = new Set([...this.d.machineIds(), ...lines.filter((l) => l.includes(TAG)).map((l) => l.slice(l.lastIndexOf(TAG) + TAG.length))])
      const base = id.slice(0, 17)
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    }
    const kept = lines.filter((l) => !l.endsWith(`${TAG}${id}`) && !l.includes(` ${blob} `))
    fs.mkdirSync(path.dirname(this.d.authorizedKeys), { recursive: true, mode: 0o700 })
    const tmp = `${this.d.authorizedKeys}.weevils.tmp`
    fs.writeFileSync(tmp, [...kept, authorizedLine(this.d.service, id, c.port, key)].join('\n') + '\n', { mode: 0o600 })
    fs.renameSync(tmp, this.d.authorizedKeys)
    c.used = { id, at: this.now() }
    this.write(codes)
    return { ok: true, id, port: c.port, target: c.target }
  }
}

export interface JoinRouteCtx {
  join: Join
  /** The main machine's id (the ssh alias the other computer writes: weevils-<id>). */
  machine: string
  lang: string
  /** sshd's host keys, for the other computer's known_hosts. */
  hostKeys?: (host: string) => string[]
  onJoined: (id: string) => void
}

/** GET /api/join.sh (the script, public like bring.sh) and POST /api/join/<code>. True when it answered. */
export async function joinRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, ctx: JoinRouteCtx): Promise<boolean> {
  const text = (status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }
  if (pathname === '/api/join.sh' && req.method === 'GET') {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim()
    if (!/^[A-Za-z0-9.:[\]-]{1,255}$/.test(host) || !/^https?$/.test(proto)) return text(400, 'bad host\n'), true
    text(200, fs.readFileSync(new URL('./join.sh', import.meta.url), 'utf8').replace('__BASE__', `${proto}://${host}`))
    return true
  }
  const m = /^\/api\/join\/([A-Za-z0-9_-]{1,80})$/.exec(pathname)
  if (!m || req.method !== 'POST') return false
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length
    if (size > 16 << 10) return text(413, 'too big\n'), true
    chunks.push(c)
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  const r = ctx.join.use(m[1], form.get('id') ?? '', form.get('key') ?? '')
  if (!r.ok) return text(r.why === 'bad' ? 400 : 404, `${r.why}\n`), true
  const host = r.target.slice(r.target.indexOf('@') + 1)
  console.log(`[join] ${r.id}: key authorized, tunnel port ${r.port}`)
  ctx.onJoined(r.id)
  const lines = [`id=${r.id}`, `port=${r.port}`, `target=${r.target}`, `alias=weevils-${slugId(ctx.machine) || 'main'}`, `lang=${ctx.lang === 'fr' ? 'fr' : 'en'}`, ...(ctx.hostKeys ?? knownHosts)(host).map((k) => `known=${k}`)]
  text(200, lines.join('\n') + '\n')
  return true
}
