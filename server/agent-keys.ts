// Agent keys (docs/agents.md): how a program elsewhere (a bot, a web agent) writes to weevboss without the access code.
//
// A key is created in the app's settings: a name the person picks (« Helper »), the author id made from it
// (« helper »: what signs its messages, `[from:helper]`), one scope (send messages to weevboss and read its replies),
// its creation and last use. The secret is shown once, at creation: `wva_<handle>_<32 random characters>`. Only its
// SHA-256 is kept, in DATA_DIR/agent-keys.json (0600, written whole then renamed), compared in constant time.
// Revoking forgets the hash at once; the entry stays (no secret) so its author keeps its name on old messages.
//
// A key's author is known to the author system (server/authors.ts) like a WEEVILS_AUTHOR_* line: the app shows its
// name and colour. A key whose id is already a declared author speaks as that author (its colour stays).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type AuthorConfig, loadAuthors, resetAuthors } from './authors.ts'
import { tr } from './i18n.ts'
import M from './i18n/agent-keys.ts'
import type { AgentKeyView } from '../shared/agent-keys.ts'

export type { AgentKeyView }

/** The one thing a key can do. */
export const AGENT_KEY_SCOPE = 'boss:messages'
export const AGENT_KEY_FILE = 'agent-keys.json'
const ID_RE = /^[a-z0-9_-]{1,32}$/
/** Ids no key may take: they name weevils itself, its agents or the person. */
export const RESERVED_IDS = new Set(['weevboss', 'weevils', 'boss', 'codex', 'claude', 'agent', 'owner', 'user', 'you', 'me'])
const KEY_RE = /^wva_([0-9a-f]{8})_([A-Za-z0-9_-]{32,128})$/
const MAX_NAME = 40
/** lastUsed is written at most this often per key (it is read at a glance, not an audit trail). */
const TOUCH_WRITE_MS = 5 * 60_000
const PALETTE = ['#ff6b8a', '#3fc1f0', '#f5a524', '#7c5cff', '#22c55e', '#ff7a1a', '#e64980', '#14b8a6']

export interface AgentKeyRecord {
  /** The author id, also the key's id in the app's routes. */
  id: string
  name: string
  color: string
  /** The secret's lookup part (`wva_<handle>_…`): finds the record before the hash is compared. */
  handle: string
  /** sha256 of the whole secret, hex. Gone once revoked. */
  hash?: string
  scope: typeof AGENT_KEY_SCOPE
  createdAt: number
  lastUsedAt?: number
  revokedAt?: number
}

export class AgentKeyError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** « Helper » → « helper », « Mon Agent n°2 » → « mon-agent-n-2 »: lowercase, accents dropped, 32 characters. */
export function slugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 32)
    .replace(/[-_]+$/g, '')
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest()
const view = ({ id, name, color, scope, createdAt, lastUsedAt }: AgentKeyRecord): AgentKeyView => ({ id, name, color, scope, createdAt, ...(lastUsedAt ? { lastUsedAt } : {}) })

function atomicWrite(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

export interface AgentKeyStoreOptions {
  file: string
  now?: () => number
  /** Ids already declared as authors (WEEVILS_AUTHOR_*): a key may take one and speak as it. */
  declared?: () => AuthorConfig[]
}

export class AgentKeyStore {
  private file: string
  private now: () => number
  private declared: () => AuthorConfig[]
  private keys: AgentKeyRecord[] = []
  private written = new Map<string, number>()

  constructor(o: AgentKeyStoreOptions) {
    this.file = o.file
    this.now = o.now ?? Date.now
    this.declared = o.declared ?? (() => loadAuthors())
    this.keys = this.read()
  }

  private read(): AgentKeyRecord[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { keys?: unknown }
      if (!Array.isArray(raw.keys)) return []
      return raw.keys.filter((k): k is AgentKeyRecord => !!k && typeof k.id === 'string' && ID_RE.test(k.id) && typeof k.handle === 'string' && typeof k.name === 'string' && typeof k.createdAt === 'number')
    } catch {
      return []
    }
  }

  private save() {
    atomicWrite(this.file, JSON.stringify({ version: 1, keys: this.keys }, null, 1) + '\n')
  }

  /** The keys in use, oldest first. */
  list(): AgentKeyView[] {
    return this.keys.filter((k) => k.hash && !k.revokedAt).map(view)
  }

  get(id: string): AgentKeyView | undefined {
    const k = this.keys.find((x) => x.id === id && x.hash && !x.revokedAt)
    return k ? view(k) : undefined
  }

  /** A new key: its secret, returned here once and never again. */
  create(rawName: unknown): { key: string } & AgentKeyView {
    const name = (typeof rawName === 'string' ? rawName : '').replace(/[\u0000-\u001f\u007f|]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!name) throw new AgentKeyError(400, tr(M).nameMissing)
    if (name.length > MAX_NAME) throw new AgentKeyError(400, tr(M).nameTooLong)
    const id = slugOf(name)
    if (!id || !ID_RE.test(id)) throw new AgentKeyError(400, tr(M).nameBad)
    if (RESERVED_IDS.has(id)) throw new AgentKeyError(400, tr(M).nameReserved(id))
    if (this.keys.some((k) => k.id === id && k.hash && !k.revokedAt)) throw new AgentKeyError(409, tr(M).nameTaken(id))
    let handle = ''
    do handle = crypto.randomBytes(4).toString('hex')
    while (this.keys.some((k) => k.handle === handle))
    const key = `wva_${handle}_${crypto.randomBytes(24).toString('base64url')}`
    const old = this.keys.find((k) => k.id === id)
    const env = this.declared().find((a) => a.id === id)
    const color = env?.color || old?.color || PALETTE[parseInt(sha(id).toString('hex').slice(0, 6), 16) % PALETTE.length]
    const rec: AgentKeyRecord = { id, name: env?.name && env.name !== id ? env.name : name, color, handle, hash: sha(key).toString('hex'), scope: AGENT_KEY_SCOPE, createdAt: this.now() }
    this.keys = [...this.keys.filter((k) => k.id !== id), rec]
    this.save()
    resetAuthors()
    return { key, ...view(rec) }
  }

  /** The key behind a secret, or null (malformed, unknown, revoked). Constant time on the hash. */
  verify(secret: unknown): AgentKeyView | null {
    if (typeof secret !== 'string') return null
    const m = KEY_RE.exec(secret.trim())
    if (!m) return null
    const rec = this.keys.find((k) => k.handle === m[1])
    const want = Buffer.from(rec?.hash ?? '0'.repeat(64), 'hex')
    const ok = crypto.timingSafeEqual(sha(secret.trim()), want.length === 32 ? want : Buffer.alloc(32))
    return ok && rec?.hash && !rec.revokedAt ? view(rec) : null
  }

  /** A key was just used: its date, written to disk at most every few minutes. */
  touch(id: string) {
    const rec = this.keys.find((k) => k.id === id && k.hash)
    if (!rec) return
    const t = this.now()
    rec.lastUsedAt = t
    if (t - (this.written.get(id) ?? 0) < TOUCH_WRITE_MS) return
    this.written.set(id, t)
    try { this.save() } catch { /* a date, never a reason to refuse a message */ }
  }

  /** Revoked at once: the hash is forgotten, the next request with it gets 401. */
  revoke(id: string): boolean {
    const rec = this.keys.find((k) => k.id === id && k.hash && !k.revokedAt)
    if (!rec) return false
    delete rec.hash
    rec.revokedAt = this.now()
    this.save()
    return true
  }

  /** Every key's author, revoked ones included (their old messages keep a name): for server/authors.ts. */
  authors(): AuthorConfig[] {
    return this.keys.map((k) => ({ id: k.id, name: k.name, color: k.color, emails: [], via: 'key' as const }))
  }
}
