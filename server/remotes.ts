import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR, DATA_DIR, MACHINE, WEEVBOOK_DIR } from './config.ts'
import { KeptRows, offlineRow, weevbookRows } from './offline-machines.ts'
import { machinePart } from './weevbook/sync.ts'
import { LOCAL_TOKEN_HEADER, parseLocalToken } from './http.ts'
// Fédération : le weevilsd du VPS lit les weevilsd des autres machines (le PC) à travers un tunnel SSH inversé.
// Côté PC, la requête arrive de 127.0.0.1 sans en-tête de proxy ni Origin, Host 127.0.0.1:<port du tunnel>, avec le
// jeton local du PC : elle est de confiance, comme un outil local (server/http.ts isLocal). Ce jeton, le PC l'a donné à
// la machine principale en s'y inscrivant (server/install.sh, weevils-update → weevils-service add-remote), qui le
// garde dans ~/.config/weevils/remotes/<id>.token (0600).

/** Where the main machine keeps the local token of the secondary machine <id>. */
export const remoteTokenFile = (id: string, dir = CONFIG_DIR) => path.join(dir, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.token`)

import type { MachineAway, Session, Snapshot } from '../shared/api.ts'
import { lang, tr } from './i18n.ts'
import M from './i18n/remotes.ts'

export class Remote {
  id: string
  url: string
  snap: Snapshot | null = null
  online = false
  private onChange: () => void
  private tokenFile: string
  /** Its rows the last time it answered (on disk), and the threads synced here still open on it (the weevbook). */
  private kept: KeptRows
  private keptRows: Session[]
  private bookRows: Session[] = []
  private bookAt = 0
  private bookBusy = false
  private gitDir: string
  /** The last time it answered, on disk (a restart here keeps « since 15:03 »), and why it does not now. */
  private seenFile: string
  private seenAt: number | null = null
  private seenSaved = 0
  private why: MachineAway['why'] = 'link'
  /** Plugged in from a line (server/join.ts): when, and why its install stopped if it did. On disk. */
  private joinFile: string
  private join: { at: number; failed?: { why: string; fix: string } } | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(id: string, url: string, onChange: () => void, o: { dataDir?: string; weevbookDir?: string } = {}) {
    this.id = id
    this.url = url.replace(/\/$/, '')
    this.onChange = onChange
    this.tokenFile = remoteTokenFile(id)
    this.kept = new KeptRows(path.join(o.dataDir ?? DATA_DIR, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.rows.json`))
    this.keptRows = this.kept.load()
    this.gitDir = path.join(o.weevbookDir ?? WEEVBOOK_DIR, '.git')
    const dataDir = o.dataDir ?? DATA_DIR
    this.seenFile = path.join(dataDir, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.seen`)
    this.seenAt = readSeen(this.seenFile, path.join(dataDir, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.rows.json`))
    this.joinFile = path.join(dataDir, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.join.json`)
    try {
      const j = JSON.parse(fs.readFileSync(this.joinFile, 'utf8')) as Remote['join']
      if (j && typeof j.at === 'number') this.join = j
    } catch {
      // never joined from a line
    }
  }

  /** Why it does not answer, and since when (server/core.ts puts it on the machine, the app says it in one line). Its
   *  line just pasted and not seen since: installing (3 hours at most), or why that install stopped. */
  away(now = Date.now()): MachineAway {
    const j = this.join
    if (j && (this.seenAt == null || this.seenAt < j.at)) {
      if (j.failed) return { why: 'failed', since: j.at, detail: j.failed.why, ...(j.failed.fix ? { fix: j.failed.fix } : {}) }
      if (now - j.at < 3 * 3600_000) return { why: 'joining', since: j.at }
    }
    return { why: this.why, since: this.seenAt }
  }

  /** Its key just came in (server/join.ts): shown at once, as installing. */
  joined(now = Date.now()) {
    this.join = { at: now }
    this.saveJoin()
  }

  /** Its installer stopped (join.sh told): why, and the command that fixes it. */
  failed(why: string, fix: string) {
    this.join = { at: this.join?.at ?? Date.now(), failed: { why, fix } }
    this.saveJoin()
    this.onChange()
  }

  private saveJoin() {
    try {
      fs.mkdirSync(path.dirname(this.joinFile), { recursive: true })
      fs.writeFileSync(this.joinFile, JSON.stringify(this.join))
    } catch {
      // kept in memory
    }
  }

  /** It answered: written at most once a minute while it does, so the time it stopped is known within a minute. */
  private seen(now = Date.now()) {
    this.seenAt = now
    if (now - this.seenSaved < 60_000) return
    this.seenSaved = now
    try {
      fs.mkdirSync(path.dirname(this.seenFile), { recursive: true })
      fs.writeFileSync(this.seenFile, String(now))
    } catch {
      // A full disk: kept in memory.
    }
  }

  /** The machine's id as its rows carry it (its own snapshot's, else the one its kept rows had, else the name given). */
  machineId(): string {
    return this.snap?.machines[0]?.id ?? this.keptRows[0]?.machineId ?? this.id
  }

  /** While it does not answer: its conversations, readable, marked offline (server/offline-machines.ts). */
  offlineRows(): Session[] {
    if (this.online) return []
    const rows = new Map<string, Session>()
    for (const s of this.bookRows) rows.set(s.id, s)
    for (const s of this.keptRows) rows.set(s.id, offlineRow({ ...rows.get(s.id), ...s }))
    return [...rows.values()]
  }

  /** The weevbook's threads still open on it, read again at most once a minute while it does not answer. */
  async refreshBook(now = Date.now()) {
    if (this.online || this.bookBusy || now - this.bookAt < 60_000) return
    this.bookBusy = true
    try {
      const rows = await weevbookRows(this.gitDir, machinePart(this.machineId()), now)
      this.bookAt = now
      if (JSON.stringify(rows) !== JSON.stringify(this.bookRows)) {
        this.bookRows = rows
        this.onChange()
      }
    } finally {
      this.bookBusy = false
    }
  }

  /** The remote's local token, read on each call (a re-registration replaces the file without a restart). */
  headers(): Record<string, string> {
    try {
      const t = parseLocalToken(fs.readFileSync(this.tokenFile, 'utf8'))
      return t ? { [LOCAL_TOKEN_HEADER]: t } : {}
    } catch {
      return {}
    }
  }

  start() {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), 2000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One look at the machine: its snapshot when it answers; offline (with its kept rows) when it does not. */
  async poll() {
    try {
      const res = await fetch(`${this.url}/api/snapshot`, { headers: this.headers(), signal: AbortSignal.timeout(2500) })
      if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status })
      // Not weevils' JSON: another program answers on its port here (a preview server, say), not that machine.
      let s = (await res.json().catch(() => {
        throw Object.assign(new Error('not weevils'), { status: 404 }) // i18n-ignore: internal, classified by awayWhy
      })) as Snapshot
      const owner = s.machines?.[0]
      // A reverse tunnel can accidentally lead back to us. Never ingest our own aggregate.
      if (!owner || owner.id === MACHINE.id) {
        this.snap = null
        throw new Error('remote is this machine') // i18n-ignore: internal guard, caught locally and never displayed
      }
      // A peer may federate other machines too: only ingest the peer's own records, once.
      const sessions = [...new Map(s.sessions.filter((x) => x.machineId === owner.id).map((x) => [x.id, x])).values()]
      const ids = new Set(sessions.map((x) => x.id))
      s = { ...s, machines: [owner], sessions,
        h24: [...new Map(s.h24.map((x) => [x.id, x])).values()],
        ...(s.relay ? { relay: { ...s.relay, plans: s.relay.plans.filter((p) => ids.has(p.sessionId)) } } : {}),
      }
      const changed = !this.online || s.version !== this.snap?.version
      this.snap = s
      if (!this.online) this.seenSaved = 0
      this.seen()
      this.online = true
      if (changed) {
        this.keptRows = sessions
        this.kept.save(sessions)
        this.bookAt = 0
        this.onChange()
      }
    } catch (e) {
      const why = awayWhy(e)
      if (this.online || why !== this.why) {
        // The minute it stopped answering, kept: « since » is when it was last seen, not when this was written.
        if (this.online && this.seenAt) {
          this.seenSaved = 0
          this.seen(this.seenAt)
        }
        this.online = false
        this.why = why
        this.onChange()
      }
      await this.refreshBook().catch(() => undefined)
    }
  }

  has(sessionId: string) {
    return !!this.online && !!this.snap?.sessions.some((s) => s.id === sessionId)
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.online) throw new Error(tr(M).offline(this.id))
    const res = await fetch(`${this.url}${path}`, {
      method,
      headers: { ...this.headers(), 'X-Weevils-Locale': lang(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw Object.assign(new Error(data.error ?? tr(M).failed(this.id, res.status)), { status: res.status })
    return data
  }
}

/** The last time a machine answered: its own file, else when its kept rows were last written (a machine that stopped
 *  before this file existed), else null. */
function readSeen(file: string, rows: string): number | null {
  try {
    const n = Number(fs.readFileSync(file, 'utf8').trim())
    if (Number.isFinite(n) && n > 0) return n
  } catch {
    // none yet
  }
  try {
    return Math.round(fs.statSync(rows).mtimeMs)
  } catch {
    return null
  }
}

/** What a failed look at a machine says about it. Through the reverse SSH tunnel:
 *  - nothing listens on its port here (refused), or the call hangs (a tunnel whose far end is asleep): no link;
 *  - the tunnel takes the call then closes it, or answers an error: weevils on that machine does not answer;
 *  - 404 or not JSON: another program holds its port here;
 *  - 401 / 403: it answers, but no longer trusts this machine's token. */
export function awayWhy(e: unknown): MachineAway['why'] {
  const err = e as { status?: number; name?: string; code?: string; cause?: { code?: string; name?: string } }
  if (err?.status === 401 || err?.status === 403) return 'key'
  // weevilsd always has /api/snapshot: a 404 (or no JSON) comes from another program on that port here.
  if (err?.status === 404) return 'port'
  if (typeof err?.status === 'number') return 'stopped'
  const code = err?.cause?.code ?? err?.code ?? ''
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return 'stopped'
  return 'link'
}

/** WEEVILS_REMOTES="pc=http://127.0.0.1:4192,autre=http://…" */
export function parseRemotes(spec: string | undefined): [string, string][] {
  return (spec ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf('=')
      return [x.slice(0, i), x.slice(i + 1)] as [string, string]
    })
    .filter(([id, url]) => id && url)
}
