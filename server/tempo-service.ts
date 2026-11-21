// Tempo, wired: reads the measurements (spend ledger, provider meters, machine), keeps the chosen modes, answers the
// app (GET/POST /api/tempo) and tells weevboss which queued requests to start (core.ts, intake wake-ups).
// The arithmetic is in server/tempo.ts; this file only gathers its inputs and remembers what it already raised.

import type { Session } from '../shared/api.ts'
import type { Ask } from '../shared/ledger.ts'
import { projectOfAsk } from '../shared/ask-project.ts'
import { MAX_WAIT_MS, lowerOf, type TempoMode, type TempoView } from '../shared/tempo.ts'
import { readCalibration, SpendLedger, weekUsdOf } from './spend-ledger.ts'
import type { SpendEntry } from './spend.ts'
import { capacityOf, clampTo, dueStarts, modesOf, splitOf, TempoStore, type MachineInput, type QuotaInput, type RepoQueue, type Start } from './tempo.ts'

const HOUR = 3600_000
/** Requests about no repo (a question to weevboss, the machine) are weevboss's own queue, on the global mode. */
export const NO_REPO = 'weevboss'

export interface QuotaLike {
  ok: boolean
  plan?: string
  windows: { kind: string; percent: number; resetsAt?: number | null }[]
  at: number
  source?: string
}

export interface TempoDeps {
  dir: string
  entries: () => SpendEntry[]
  quotas: () => Promise<{ claude?: QuotaLike; codex?: QuotaLike }>
  machine: () => Promise<MachineInput>
  accounts: () => number
  sessions: () => Session[]
  projects: () => { id: string; name: string }[]
  /** The Claude readings next to their spend (server/spend.ts logCalibration writes it). */
  calibrationFile: string
  /** Logs a Claude reading in the calibration file (spend.ts), so the plan's size is learned without the app open. */
  calibrate?: () => Promise<void>
}

const quotaOf = (q: QuotaLike | undefined): QuotaInput | undefined => {
  if (!q?.ok) return undefined
  const week = q.windows.find((w) => w.kind === 'week')
  const session = q.windows.find((w) => w.kind === 'session')
  return { ...(q.plan ? { plan: q.plan } : {}), weekPct: week?.percent ?? null, weekResets: week?.resetsAt ?? null, sessionPct: session?.percent ?? null, at: q.at }
}

/**
 * Each repo's queue: requests never sent (not « later » in the user's own words), and requests whose session was cut
 * (back to the queue); running: the sessions weevboss sent work to that are working now. Exported for tests.
 */
export function queuesOf(asks: readonly Ask[], sessions: readonly Session[], projects: readonly { id: string; name: string }[], modeOf: (repo: string) => TempoMode): RepoQueue[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const repos = new Map<string, RepoQueue>()
  const repo = (id: string) => {
    let r = repos.get(id)
    if (!r) repos.set(id, (r = { id, mode: modeOf(id), queued: [], running: 0, freeSince: 0 }))
    return r
  }
  const counted = new Set<string>()
  for (const a of asks) {
    if (a.kind !== 'task' || a.status === 'done' || a.status === 'dropped') continue
    const r = repo(projectOfAsk(a, projects, byId) ?? NO_REPO)
    const last = a.dispatches.at(-1)
    const s = last ? byId.get(last.session) : undefined
    if (!last) {
      if (a.why === 'you-said-later') continue
      r.queued.push({ ask: a.id, since: a.at })
    } else if (s?.status === 'interrupted') {
      r.queued.push({ ask: a.id, since: s.interrupted?.at ?? s.lastActivityAt })
    } else if (s && !counted.has(s.id)) {
      counted.add(s.id)
      if (s.status === 'working') r.running++
      else r.freeSince = Math.max(r.freeSince ?? 0, s.lastActivityAt)
    }
  }
  for (const r of repos.values()) if (r.running) r.freeSince = null
  return [...repos.values()]
}

/** How long before a start weevboss did not make is asked again: the mode's wait (an hour at least), doubled each time, a day at most. */
export function retryAfter(mode: TempoMode, times: number): number {
  const base = Math.max(HOUR, Number.isFinite(MAX_WAIT_MS[mode]) ? MAX_WAIT_MS[mode] : HOUR)
  return Math.min(24 * HOUR, base * 2 ** Math.max(0, times - 1))
}

export class TempoService {
  readonly store: TempoStore
  readonly ledger: SpendLedger
  private last: TempoView | null = null
  private machine: MachineInput | null = null
  /** Starts already handed to weevboss: when, and how many times (a request it could not start is asked again
   *  later and later: 1 h, 2 h, 4 h… at most once a day, so an impossible one never costs a turn an hour). */
  private raised = new Map<string, { at: number; n: number }>()
  private d: TempoDeps
  constructor(d: TempoDeps) {
    this.d = d
    this.store = new TempoStore(d.dir)
    this.ledger = new SpendLedger(d.dir)
  }

  /** Every 10 minutes: the meters into the ledger, the answers rolled up, the view recomputed. */
  async tick(now = Date.now()) {
    const q = await this.d.quotas().catch(() => ({}) as { claude?: QuotaLike; codex?: QuotaLike })
    for (const tool of ['claude', 'codex'] as const) {
      const r = q[tool]
      const qi = quotaOf(r)
      if (r && qi) this.ledger.quota({ at: r.at, tool, ...(qi.plan ? { plan: qi.plan } : {}), ...(qi.weekPct != null ? { weekPct: qi.weekPct } : {}), weekResets: qi.weekResets ?? null, ...(qi.sessionPct != null ? { sessionPct: qi.sessionPct } : {}), source: r.source ?? tool })
    }
    await this.d.calibrate?.().catch(() => undefined)
    const sessions = new Map(this.d.sessions().map((s) => [s.id, s.projectId]))
    this.ledger.record(this.d.entries(), (sid) => sessions.get(sid) ?? '', now)
    this.machine = await this.d.machine().catch(() => this.machine)
    this.last = this.compute(q, now)
    return this.last
  }

  private compute(q: { claude?: QuotaLike; codex?: QuotaLike }, now: number): TempoView {
    const machine = this.machine ?? { cores: 1, memGb: 1, diskFreeGb: 20, at: now }
    const per = this.ledger.perAgentHour(null, now)
    const weekUsd = weekUsdOf(readCalibration(this.d.calibrationFile), now)
    const capacity = capacityOf({ weekUsd, accounts: this.d.accounts(), usdPerAgentHour: per.usd, tokensPerAgentHour: per.tokens, claude: quotaOf(q.claude), codex: quotaOf(q.codex), machine, now })
    const modes = modesOf(capacity, machine)
    const c = this.store.choice
    const effective = clampTo(c.global, modes)
    return { global: c.global, effective, repos: { ...c.repos }, modes, capacity, split: this.last?.split ?? {}, at: now }
  }

  /** The view for the app; computed at the first call, then at every tick and every change. */
  async view(now = Date.now()): Promise<TempoView> {
    if (!this.last) await this.tick(now)
    return this.last!
  }

  /** A mode chosen in the app: for one repo, or the global ceiling (repo null). A locked mode is refused. */
  async set(mode: TempoMode, repo: string | null, now = Date.now()): Promise<TempoView> {
    const v = await this.view(now)
    if (!v.modes.find((m) => m.id === mode)?.unlocked) throw new Error('locked')
    this.store.set(mode, repo, now)
    this.last = { ...v, global: this.store.choice.global, effective: clampTo(this.store.choice.global, v.modes), repos: { ...this.store.choice.repos }, at: now }
    return this.last
  }

  /** The mode a repo runs at now: its own, never above the global one, never above what is open. */
  modeOf(repo: string): TempoMode {
    const v = this.last
    const g = v?.effective ?? this.store.choice.global
    const m = lowerOf(this.store.modeOf(repo), g)
    return v ? clampTo(m, v.modes) : m
  }

  /** The global ceiling in force. */
  globalMode(): TempoMode {
    return this.last?.effective ?? this.store.choice.global
  }
  /** What the older « speed mode » readers see (request handling, follow-up wake-ups): weevboss's own queue's mode. */
  speedMode(): TempoMode {
    return this.modeOf(NO_REPO)
  }

  /**
   * The requests to start now. Each is raised once, then again only if it is still waiting after its mode's wait
   * (at least an hour), doubling each time up to a day: weevboss is asked, never flooded.
   */
  intake(asks: readonly Ask[], now = Date.now()): (Start & { mode: TempoMode; project: string })[] {
    const v = this.last
    if (!v) return []
    const sessions = this.d.sessions()
    const repos = queuesOf(asks, sessions, this.d.projects(), (id) => this.modeOf(id))
    const global = this.globalMode()
    const split = splitOf(global, repos.filter((r) => r.queued.length || r.running))
    const starts = dueStarts({ global, repos, split, over: v.capacity.pace.over, hardLimit: v.capacity.pace.hardLimit, now })
    this.last = { ...v, split }
    const names = new Map(this.d.projects().map((p) => [p.id, p.name]))
    const out: (Start & { mode: TempoMode; project: string })[] = []
    for (const s of starts) {
      const mode = repos.find((r) => r.id === s.repo)!.mode
      const r = this.raised.get(s.ask)
      if (r && now - r.at < retryAfter(mode, r.n)) continue
      this.raised.set(s.ask, { at: now, n: (r?.n ?? 0) + 1 })
      out.push({ ...s, mode, project: names.get(s.repo) ?? s.repo })
    }
    for (const [k, r] of this.raised) if (now - r.at > 3 * 86400_000) this.raised.delete(k)
    return out
  }
}
