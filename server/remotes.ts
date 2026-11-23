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

import type { Session, Snapshot } from '../shared/api.ts'
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

  constructor(id: string, url: string, onChange: () => void, o: { dataDir?: string; weevbookDir?: string } = {}) {
    this.id = id
    this.url = url.replace(/\/$/, '')
    this.onChange = onChange
    this.tokenFile = remoteTokenFile(id)
    this.kept = new KeptRows(path.join(o.dataDir ?? DATA_DIR, 'remotes', `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.rows.json`))
    this.keptRows = this.kept.load()
    this.gitDir = path.join(o.weevbookDir ?? WEEVBOOK_DIR, '.git')
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
    setInterval(() => void this.poll(), 2000)
  }

  /** One look at the machine: its snapshot when it answers; offline (with its kept rows) when it does not. */
  async poll() {
    try {
      const res = await fetch(`${this.url}/api/snapshot`, { headers: this.headers(), signal: AbortSignal.timeout(2500) })
      if (!res.ok) throw new Error(String(res.status))
      let s = (await res.json()) as Snapshot
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
      this.online = true
      if (changed) {
        this.keptRows = sessions
        this.kept.save(sessions)
        this.bookAt = 0
        this.onChange()
      }
    } catch {
      if (this.online) {
        this.online = false
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
