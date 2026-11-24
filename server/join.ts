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
//
// The join carries the vault (docs/spec/07-vault.md): join.sh also makes a deploy key for the vault and sends its public
// half; when this machine has a vault, that key is registered on the vault's repository and the answer carries the
// vault's remote and key, so the new machine keeps its own conversations there too. No vault here, or GitHub not signed
// in: the join is what it always was, and says nothing.
import { spawnSync } from 'node:child_process'
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
/** What join.sh accepts for the vault: a git remote without anything a shell or JSON would read, a 32-byte key in base64. */
const VAULT_REMOTE_RE = /^[A-Za-z0-9@:/._~+-]{1,300}$/
const VAULT_KEY_RE = /^[A-Za-z0-9+/]{43}=$/

export interface JoinCode {
  hash: string
  at: number
  /** user@host the other computer connects to (this machine, as reached from anywhere). */
  target: string
  /** The tunnel port this code reserves: the authorized key may only listen there. */
  port: number
  used?: { id: string; at: number }
  /** When that computer's installer said it stopped (once per code). */
  failed?: number
}

/** What join.sh may say of a failed install: one line, no control characters, no backquote (it is shown as code). */
export function failText(raw: string, max = 300): string {
  const t = raw.replace(/[\u0000-\u001f\u007f`]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
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
  /** Something already listens on that port here (default: portBusy). */
  busy?: (port: number) => boolean
  now?: () => number
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** A name as weevils writes machine ids (install.sh's slug): lowercase, digits and dashes, 20 at most. */
export const slugId = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '')

/** The first tunnel port no remote uses, no open code reserves, and nothing listens on here: a port another program
 *  holds (a preview server left running for days) refuses the tunnel's sshd, and that machine never shows up. */
export function freePort(remotes: string, reserved: number[], busy: (port: number) => boolean = () => false): number {
  const used = new Set(reserved)
  for (const m of remotes.matchAll(/127\.0\.0\.1:(\d+)/g)) used.add(Number(m[1]))
  let port = FIRST_TUNNEL_PORT
  while (used.has(port) || busy(port)) port++
  return port
}

/** Something listens on `port` here, on any address (0.0.0.0:<port> keeps sshd from binding 127.0.0.1:<port> too).
 *  Linux: /proc/net/tcp and tcp6; elsewhere (a Mac): lsof; neither: not known, so free. */
export function portBusy(port: number): boolean {
  const hex = `:${port.toString(16).toUpperCase().padStart(4, '0')}`
  let read = false
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string
    try {
      text = fs.readFileSync(f, 'utf8')
    } catch {
      continue
    }
    read = true
    for (const line of text.split('\n').slice(1)) {
      const col = line.trim().split(/\s+/)
      if (col[3] === '0A' && col[1]?.endsWith(hex)) return true
    }
  }
  if (read) return false
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeout: 3000 })
  return r.status === 0
}

/** The tunnel ports the keys here already hold (permitlisten), whether or not their machine is in WEEVILS_REMOTES yet. */
const keyPorts = (lines: string[]) => lines.flatMap((l) => [...l.matchAll(/permitlisten="127\.0\.0\.1:(\d+)"/g)].map((m) => Number(m[1])))

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
  private busy = (port: number) => (this.d.busy ?? portBusy)(port)

  private keys(): string[] {
    try {
      return fs.readFileSync(this.d.authorizedKeys, 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

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
    // Never a leading dash: the line is `bash -s <code>`, and bash would read it as one of its own options.
    let code = crypto.randomBytes(24).toString('base64url')
    while (code.startsWith('-')) code = crypto.randomBytes(24).toString('base64url')
    codes.push({ hash: sha(code), at: this.now(), target, port: freePort(this.d.remotes(), [...codes.map((c) => c.port), ...keyPorts(this.keys())], this.busy) })
    this.write(codes)
    return code
  }

  /** The open code behind `code`, if it can still be used. */
  open(code: string): JoinCode | null {
    if (!CODE_RE.test(code)) return null
    const h = sha(code)
    return this.read().find((c) => !c.used && c.hash === h) ?? null
  }

  /** That computer's installer stopped: the spent code (still kept an hour) and its machine id vouch for it, once. */
  failed(code: string, id: string): boolean {
    if (!CODE_RE.test(code)) return false
    const codes = this.read()
    const h = sha(code)
    const c = codes.find((x) => x.used && x.hash === h)
    if (!c || c.used!.id !== id || c.failed) return false
    c.failed = this.now()
    this.write(codes)
    return true
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
    const lines = this.keys()
    // The same computer again (its key already there): it keeps its id. Otherwise a name no machine has yet.
    const again = lines.find((l) => l.includes(` ${blob} ${TAG}`))
    let id = again ? again.slice(again.lastIndexOf(TAG) + TAG.length) : slugId(rawId) || 'computer'
    if (!again) {
      const taken = new Set([...this.d.machineIds(), ...lines.filter((l) => l.includes(TAG)).map((l) => l.slice(l.lastIndexOf(TAG) + TAG.length))])
      const base = id.slice(0, 17)
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    }
    const kept = lines.filter((l) => !l.endsWith(`${TAG}${id}`) && !l.includes(` ${blob} `))
    // Taken since the line was made (it is valid an hour): another one, free now.
    if (this.busy(c.port)) {
      c.port = freePort(this.d.remotes(), [c.port, ...codes.filter((x) => x !== c).map((x) => x.port), ...keyPorts(kept)], this.busy)
    }
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
  /** The main machine's permission choice (server/ask-follow.ts): the new machine's agents start the same way. */
  ask?: boolean
  /** sshd's host keys, for the other computer's known_hosts. */
  hostKeys?: (host: string) => string[]
  /** Its key is in: it is shown at once (connecting), on its tunnel port. */
  onJoined: (id: string, port: number) => void
  /** That computer's installer stopped: why, in one sentence, and the command that fixes it (may be empty). */
  onFailed?: (id: string, why: string, fix: string) => void
  /** The vault for that machine (server/weevbook/vault-github.ts shareVault): its deploy key in, the remote and the
   *  vault key out; null when there is none to give. */
  vault?: (id: string, pub: string) => Promise<{ remote: string; key: string } | null>
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
  const m = /^\/api\/join\/([A-Za-z0-9_-]{1,80})(\/failed)?$/.exec(pathname)
  if (!m || req.method !== 'POST') return false
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length
    if (size > 16 << 10) return text(413, 'too big\n'), true
    chunks.push(c)
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
  // join.sh, after install.sh stopped on that computer: weevboss's thread says it rather than waiting for it.
  if (m[2]) {
    const id = form.get('id') ?? ''
    const why = failText(form.get('why') ?? '')
    if (!why || !ctx.join.failed(m[1], id)) return text(404, 'expired\n'), true
    console.log(`[join] ${id}: install failed (${why})`)
    ctx.onFailed?.(id, why, failText(form.get('fix') ?? '', 200))
    return text(200, 'ok\n'), true
  }
  const r = ctx.join.use(m[1], form.get('id') ?? '', form.get('key') ?? '')
  if (!r.ok) return text(r.why === 'bad' ? 400 : 404, `${r.why}\n`), true
  const host = r.target.slice(r.target.indexOf('@') + 1)
  console.log(`[join] ${r.id}: key authorized, tunnel port ${r.port}`)
  ctx.onJoined(r.id, r.port)
  const lines = [`id=${r.id}`, `port=${r.port}`, `target=${r.target}`, `alias=weevils-${slugId(ctx.machine) || 'main'}`, `lang=${ctx.lang === 'fr' ? 'fr' : 'en'}`, ...(ctx.ask === undefined ? [] : [`ask=${ctx.ask ? 1 : 0}`]), ...(ctx.hostKeys ?? knownHosts)(host).map((k) => `known=${k}`)]
  // The vault, when there is one: never a reason for the join to fail.
  const pub = (form.get('vault') ?? '').trim()
  if (ctx.vault && KEY_RE.test(pub)) {
    const v = await ctx.vault(r.id, pub).catch(() => null)
    if (v && VAULT_REMOTE_RE.test(v.remote) && VAULT_KEY_RE.test(v.key)) {
      lines.push(`vault_remote=${v.remote}`, `vault_key=${v.key}`)
      console.log(`[join] ${r.id}: vault given`)
    }
  }
  text(200, lines.join('\n') + '\n')
  return true
}
