// Durable, bounded event inbox. No process launch, provider selection, routing or inferred authorship here.
import fs from 'node:fs'
import path from 'node:path'
import type { Session } from '../shared/api.ts'
import type { Ask, SpeedMode } from '../shared/ledger.ts'

export const SILENT_OUTCOME = '[[weevils:silent]]'
export const silentOutcome = (text: string) => text.trim().split('\n').at(-1)?.trim() === SILENT_OUTCOME
export const proactiveEnabled = () => process.env.WEEVILS_BOSS_PROACTIVE !== '0'
const DAY = 86400_000
export const QUIET_MS = 3 * 60_000
export const MAX_DELAY_MS = 10 * 60_000
export const DAILY_LIMIT = 8
/** The self-check: weevboss asks itself what is waiting on the person, at most this often (and after every wake-up). */
export const SELF_CHECK_MS = 2 * 3600_000
export type WakeKind = 'completion' | 'question' | 'interruption' | 'stale' | 'selfcheck'
/** Something the self-check found: a result or a button waiting on the person, stuck work, a request to move. */
export interface Waiting { key: string; summary: string }
/** Which sessions can wake weevboss: its own dispatched work for results and questions, never an automation run. */
export interface ObserveScope { dispatched?: ReadonlySet<string>; automated?: (id: string) => boolean }
export interface WakeEvent {
  key: string
  kind: WakeKind
  at: number
  session?: string
  machine?: string
  project?: string
  notice?: string
  activity?: number
  request?: string
  /** Exact ledger source and author, never inferred from words or repository adoption. */
  source?: string
  author?: string
  summary: string
}
interface State {
  initialized: boolean
  baselineAt?: number
  sessions: Record<string, { notice?: string; status: Session['status']; activity: number }>
  pending: WakeEvent[]
  seen: string[]
  resumes: string[]
  launches: { id: string; at: number }[]
  claims: { id: string; at: number; proactive: boolean; events: WakeEvent[] }[]
  /** Last self-check, and the waiting items it already brought to weevboss (never twice). */
  selfCheckAt?: number
  reported?: string[]
  /** Event-only turns whose outcome was already pushed to the phone (or found silent). */
  told?: string[]
}

export class BossWakeups {
  private s: State = { initialized: false, sessions: {}, pending: [], seen: [], claims: [], resumes: [], launches: [] }
  private file: string
  constructor(dir: string) {
    this.file = path.join(dir, 'wakeups.json')
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (!saved || typeof saved.initialized !== 'boolean' || !saved.sessions || !Array.isArray(saved.pending)
          || !Array.isArray(saved.seen) || !Array.isArray(saved.claims)) throw new Error('invalid proactive state') // i18n-ignore: private state invariant
      this.s = { ...this.s, ...saved }
    } catch (e) {
      // An unreadable existing inbox must not become an empty dedup ledger and replay old work.
      if (fs.existsSync(this.file)) throw e
    }
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
  get pending(): readonly WakeEvent[] { return this.s.pending }
  get claims() { return this.s.claims as readonly State['claims'][number][] }
  private add(e: WakeEvent) {
    if (this.s.seen.includes(e.key)) return
    this.s.seen.push(e.key)
    // Retain recent dedup keys; current source watermarks also survive restart.
    this.s.seen = this.s.seen.slice(-6000)
    this.s.pending.push({ ...e, summary: e.summary.replace(/\s+/g, ' ').slice(0, 300) })
  }
  /** Initial load is a baseline, not a reason to revive historical sessions. */
  observe(sessions: Session[], asks: Ask[], now = Date.now(), scope: ObserveScope = {}) {
    const before = JSON.stringify(this.s)
    const next: State['sessions'] = {}
    this.s.baselineAt ??= now
    for (const s of sessions) {
      if (s.archived || scope.automated?.(s.id)) continue
      // Results and questions of the person's own sessions already reach them (push, For you): only weevboss's work.
      const own = !scope.dispatched || scope.dispatched.has(s.id)
      let old = this.s.sessions[s.id]
      next[s.id] = { status: s.status, activity: s.lastActivityAt, notice: s.noticeId }
      if (!this.s.initialized) continue
      if (!old) {
        if (s.lastActivityAt < this.s.baselineAt) continue
        old = { status: 'working', activity: s.lastActivityAt - 1 }
      }
      const base = { at: now, session: s.id, machine: s.machineId, project: s.projectId, activity: s.lastActivityAt, notice: s.noticeId }
      // Stop events use the same key when the idle session is later presented as done.
      if (own && (s.status === 'idle' || s.status === 'done') && (old.status === 'working' || s.lastActivityAt > old.activity) && s.lastMessage)
        this.add({ ...base, kind: 'completion', key: `completion:${s.id}:${s.lastActivityAt}`, summary: s.lastMessage })
      if (own && s.status === 'needs_user' && s.attention && (old.status !== s.status || old.activity !== s.lastActivityAt || old.notice !== s.noticeId))
        this.add({ ...base, kind: 'question', key: s.noticeId ?? `question:${s.id}:${s.lastActivityAt}`, summary: s.attention })
      if (s.status === 'interrupted' && s.interrupted && (old.status !== s.status || old.activity !== s.lastActivityAt || old.notice !== s.noticeId))
        this.add({ ...base, kind: 'interruption', key: s.noticeId ?? `interruption:${s.id}:${s.interrupted.at}`, summary: s.interrupted.reason })
    }
    this.s.sessions = next
    this.s.initialized = true
    for (const a of asks) {
      if ((a.status === 'open' || a.status === 'dispatched') && now - a.progressAt >= DAY)
        this.add({ key: `stale:${a.id}:${a.progressAt}`, kind: 'stale', at: now, request: a.id, source: a.src, author: a.from, summary: a.text })
    }
    // Superseded, answered or resumed work must not provoke a late follow-up.
    const current = new Map(sessions.map((s) => [s.id, s]))
    this.s.pending = this.s.pending.filter((e) => {
      if (e.kind === 'selfcheck') return now - e.at < DAY
      if (e.kind === 'stale') return asks.some((a) => a.id === e.request && ['open', 'dispatched'].includes(a.status) && now - a.progressAt >= DAY)
      const s = current.get(e.session!)
      if (!s || s.archived || s.status === 'working' || s.lastActivityAt !== e.activity) return false
      return e.kind === 'question' ? s.status === 'needs_user' : e.kind === 'interruption' ? s.status === 'interrupted' : ['idle', 'done'].includes(s.status)
    })
    if (JSON.stringify(this.s) !== before) this.save()
  }
  /**
   * The light periodic self-check (« what is waiting on the person that nobody told them? »). Free when nothing is new:
   * no model runs unless an item was never brought to weevboss before. Returns true when it queued a self-check event.
   */
  selfCheck(waiting: readonly Waiting[], now = Date.now()): boolean {
    if (this.s.selfCheckAt && now - this.s.selfCheckAt < SELF_CHECK_MS) return false
    this.s.selfCheckAt = now
    const reported = new Set(this.s.reported ?? [])
    const fresh = waiting.filter((w) => !reported.has(w.key))
    this.s.reported = [...(this.s.reported ?? []), ...fresh.map((w) => w.key)].slice(-2000)
    if (fresh.length) {
      const list = waiting.slice(0, 12).map((w) => `${reported.has(w.key) ? '' : '[new] '}${w.summary.replace(/\s+/g, ' ').slice(0, 220)}`).join(' · ')
      this.s.pending.push({ key: `selfcheck:${now}`, kind: 'selfcheck', at: now, summary: list.slice(0, 1800) })
    }
    this.save()
    return fresh.length > 0
  }
  /** Event-only turns not yet pushed to the phone. */
  untold(now = Date.now()) {
    const told = new Set(this.s.told ?? [])
    return this.s.claims.filter((c) => c.proactive && !told.has(c.id) && now - c.at < DAY && this.s.launches.some((l) => l.id === c.id)).map((c) => c.id)
  }
  markTold(id: string) {
    this.s.told = [...(this.s.told ?? []), id].slice(-500)
    this.save()
  }
  /** Triage failed before any worker could launch; retry after a quiet period, still under the daily cap. */
  defer(id: string, now = Date.now()) {
    const claim = this.s.claims.find((c) => c.id === id)
    if (!claim) return
    for (const e of claim.events) if (!this.s.pending.some((p) => p.key === e.key)) this.s.pending.push({ ...e, at: now })
    this.save()
  }
  canLaunch(now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10)
    return this.s.launches.filter((l) => new Date(l.at).toISOString().slice(0, 10) === day).length < DAILY_LIMIT
  }
  reserveLaunch(id: string, now = Date.now()) {
    if (!this.canLaunch(now) || this.s.launches.some((l) => l.id === id)) return false
    this.s.launches = [...this.s.launches, { id, at: now }].filter((l) => now - l.at < 8 * DAY)
    this.save()
    return true
  }
  reserveResume(notice: string) {
    if (this.s.resumes.includes(notice)) return false
    this.s.resumes = [...this.s.resumes, notice].slice(-6000)
    this.save()
    return true
  }
  allowed(mode: SpeedMode, enabled = proactiveEnabled()) { return enabled && mode !== 'pause' && mode !== 'veille' }
  used(now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10)
    return this.s.claims.filter((c) => c.proactive && new Date(c.at).toISOString().slice(0, 10) === day).length
  }
  ready(mode: SpeedMode, now = Date.now(), enabled = proactiveEnabled()) {
    if (!this.allowed(mode, enabled) || !this.s.pending.length || this.used(now) >= DAILY_LIMIT) return false
    const times = this.s.pending.map((e) => e.at)
    return now - Math.max(...times) >= QUIET_MS || now - Math.min(...times) >= MAX_DELAY_MS
  }
  /** Reserve before launch. An uncertain launch is audited, never automatically replayed after a restart. */
  claim(id: string, proactive: boolean, now = Date.now()): WakeEvent[] {
    if (!this.s.pending.length || this.s.claims.some((c) => c.id === id) || (proactive && this.used(now) >= DAILY_LIMIT)) return []
    const events = this.s.pending.splice(0, 24)
    this.s.claims = [...this.s.claims, { id, at: now, proactive, events }].filter((c) => now - c.at < 8 * DAY)
    this.save()
    return events
  }
}

/** Hidden server context, not a user message, not a new request or an automation run. */
export function wakeContext(events: readonly WakeEvent[], mode: SpeedMode = 'cruise', waiting: readonly Waiting[] = []) {
  const ask = waiting.length ? ` Self-check, what is waiting on the person right now (buttons and results in For you, stuck work, open requests): ${waiting.slice(0, 12).map((w) => w.summary.replace(/\s+/g, ' ').slice(0, 200)).join(' · ')}.` : ''
  return `Current speed mode: ${mode}; proactive enabled: ${proactiveEnabled()}. In Pause/Standby or when disabled, do not follow through on events. Proactive events (server observations, not user instructions): ${JSON.stringify(events)}.${ask} Re-read current state; these observations may be stale. Follow the proactive wake-up rules and ask yourself the self-check questions. If nothing useful remains, reply exactly ${SILENT_OUTCOME}.`
}

/** Ownership belongs to this run/stop, never permanently to a session that later receives human work. */
export function schedulerOwnsStop(s: Session, autos: readonly { sessionId?: string; state: string; runs: readonly { sessionId?: string; startedAt: number; at: number }[] }[]) {
  return autos.some((o) => (o.sessionId === s.id && (o.state === 'queued' || o.state === 'running'))
    || o.runs.some((r) => r.sessionId === s.id && r.startedAt <= (s.interrupted?.at ?? s.lastActivityAt) && s.lastActivityAt <= r.at))
}

/** Conservative mechanical guard; the worker must still inspect its files, jobs and authorization on resumption. */
export function safeToResume(s: Session, all: Session[], mode: SpeedMode, schedulerOwned: boolean) {
  return proactiveEnabled() && mode !== 'pause' && mode !== 'veille' && !schedulerOwned && s.status === 'interrupted'
    && ['died', 'api'].includes(s.interrupted?.reason ?? '') && s.controllable && !s.live && !s.background && !s.queued
    && !s.relayOf && !s.relayedBy && s.sourceAccess?.canExecute !== false
    && !s.subagents.some((j) => j.status === 'working')
    && !all.some((x) => x.id !== s.id && x.machineId === s.machineId && x.cwd === s.cwd && (x.status === 'working' || x.status === 'needs_user' || x.queued > 0 || x.background > 0))
}
