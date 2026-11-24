// Tempo's arithmetic, every number named here (docs/product/tempo.md). Pure: the inputs are measured elsewhere
// (server/spend-ledger.ts, server/usage.ts, server/infra.ts) and handed in; server/tempo-service.ts wires them.
//
// Three questions, one function each:
//   capacityOf  what the subscriptions and the machine can feed (the tank, the line, the machine)
//   modesOf     which of the 7 modes are open, what each would use (the band) and what would open a locked one
//   splitOf     the global ceiling shared fairly between the active repos
//   dueStarts   which queued requests start now, with which model tier; it holds the one rule:
//               every mode but Pause takes requests, within MAX_WAIT_MS of its repo being free.

import fs from 'node:fs'
import path from 'node:path'
import { AGENTS, GLOBAL_DEFAULT, HOURS, MAX_WAIT_MS, NEED_HOURS, REPO_DEFAULT, TEMPO_MODES, fromLegacy, isTempoMode, lowerOf, rankOf, type Figure, type TempoCapacity, type TempoMode, type TempoModeView, type Tier } from '../shared/tempo.ts'

const DAY = 86400_000
const WEEK = 7 * DAY

/** Defaults while the machine has not been measured: what a working agent takes with its tools (tests, builds). */
export const DEFAULT_CORES_PER_AGENT = 0.5
export const DEFAULT_MEM_PER_AGENT_GB = 1
/** A worktree and its caches, per agent. */
export const DISK_PER_AGENT_GB = 1.5
/** Kept free on the machine: 20 % of the cores, 15 % of the memory, 10 GB of disk. */
const CPU_HEADROOM = 0.8
const MEM_HEADROOM = 0.85
const DISK_RESERVE_GB = 10

/** How far over the week's line (points) each mode keeps its full pace. Under it, it slows; it never stops. */
export const FULL_PACE_UNTIL: Record<TempoMode, number> = { pause: -Infinity, standby: -5, cruise: 0, turbo: 10, max: Infinity, fleet: Infinity, swarm: Infinity }
/** Turbo may run this much ahead of the week's daily share; Max and above, everything there is. */
const AHEAD: Partial<Record<TempoMode, number>> = { standby: 1, cruise: 1, turbo: 1.4 }

export interface MachineInput {
  cores: number
  memGb: number
  diskFreeGb: number
  /** Measured per working agent (null: not enough history). */
  coresPerAgent?: number | null
  memPerAgentGb?: number | null
  host?: { plan?: string; nextPlan?: string; nextVcpu?: number; nextRamGb?: number; nextPrice?: number; currency?: string }
  at: number
}
export interface QuotaInput {
  plan?: string
  weekPct?: number | null
  weekResets?: number | null
  sessionPct?: number | null
  /** The provider stopped work (a limit message, or 100 %). */
  hardLimit?: boolean
  at: number
}

export function capacityOf(o: {
  weekUsd: Figure | null
  accounts: number
  usdPerAgentHour: Figure
  tokensPerAgentHour: Figure
  claude?: QuotaInput
  codex?: QuotaInput
  machine: MachineInput
  now?: number
}): TempoCapacity {
  const now = o.now ?? Date.now()
  const m = o.machine
  const cpa = m.coresPerAgent ?? DEFAULT_CORES_PER_AGENT
  const mpa = m.memPerAgentGb ?? DEFAULT_MEM_PER_AGENT_GB
  const byCpu = (m.cores * CPU_HEADROOM) / cpa
  const byMem = (m.memGb * MEM_HEADROOM) / mpa
  const byDisk = Math.max(0, m.diskFreeGb - DISK_RESERVE_GB) / DISK_PER_AGENT_GB
  const agents = Math.max(1, Math.floor(Math.min(byCpu, byMem, byDisk)))
  const measured = m.coresPerAgent != null && m.memPerAgentGb != null
  const machineFig: Figure = { value: agents, lo: agents, hi: agents, confidence: measured ? 'measured' : 'default', source: measured ? 'this machine, measured' : 'this machine, default share per agent', at: m.at }
  const tank = o.weekUsd ? scale(o.weekUsd, Math.max(1, o.accounts)) : null
  const perDay = tank ? perDayHours(tank, o.usdPerAgentHour) : null
  const q = o.claude
  const resets = q?.weekResets ?? null
  const elapsedPct = resets ? Math.min(100, Math.max(0, ((now - (resets - WEEK)) / WEEK) * 100)) : null
  const weekPct = q?.weekPct ?? null
  const over = weekPct != null && elapsedPct != null ? weekPct - elapsedPct : null
  // Every tank must be stopped for it to be a hard limit: with Codex signed in and below its own, work goes on there.
  const codexOpen = !!o.codex && !o.codex.hardLimit && (o.codex.weekPct ?? 0) < 100
  const hardLimit = !!q && (q.hardLimit || (weekPct ?? 0) >= 100 || (q.sessionPct ?? 0) >= 100) && !codexOpen
  return {
    weekUsd: tank,
    accounts: Math.max(1, o.accounts),
    ...(q?.plan ? { plan: q.plan } : {}),
    ...(o.codex ? { codex: { ...(o.codex.plan ? { plan: o.codex.plan } : {}), ...(o.codex.weekPct != null ? { weekPct: o.codex.weekPct } : {}) } } : {}),
    usdPerAgentHour: o.usdPerAgentHour,
    tokensPerAgentHour: o.tokensPerAgentHour,
    agentHoursPerDay: perDay,
    machine: { agents: machineFig, cores: m.cores, memGb: round1(m.memGb), diskFreeGb: Math.round(m.diskFreeGb), memPerAgentGb: round1(mpa), coresPerAgent: Math.round(cpa * 100) / 100, ...(m.host?.plan ? { host: m.host.plan } : {}) },
    pace: { weekPct, elapsedPct: elapsedPct == null ? null : Math.round(elapsedPct), over: over == null ? null : Math.round(over), hardLimit, resetsAt: resets },
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const scale = (f: Figure, k: number): Figure => ({ ...f, value: f.value * k, lo: f.lo * k, hi: f.hi * k })
/** A week of dollars, over the cost of an agent-hour, over 7 days. The range crosses both ranges. */
function perDayHours(week: Figure, perHour: Figure): Figure {
  return {
    value: week.value / 7 / perHour.value,
    lo: week.lo / 7 / perHour.hi,
    hi: week.hi / 7 / perHour.lo,
    confidence: worst(week.confidence, perHour.confidence),
    source: `${week.source} and ${perHour.source}`,
    at: Math.max(week.at, perHour.at),
    days: Math.min(week.days ?? 0, perHour.days ?? 0),
  }
}
const worst = (...cs: Figure['confidence'][]) => (cs.includes('default') ? 'default' : cs.includes('rough') ? 'rough' : 'measured')

/** The 7 modes against this capacity: open or locked, the band's numbers, and what would open a locked one. */
export function modesOf(c: TempoCapacity, machine: MachineInput): TempoModeView[] {
  const perDay = c.agentHoursPerDay
  const perAccount = perDay ? perDay.value / c.accounts : null
  return TEMPO_MODES.map((id) => {
    const agents = AGENTS[id]
    const need = NEED_HOURS[id]
    const lacksBrain = need > 0 && !!perDay && perDay.value < need
    const lacksBody = agents > c.machine.agents.value
    const missing: TempoModeView['missing'] = [...(lacksBrain ? (['intelligence'] as const) : []), ...(lacksBody ? (['machine'] as const) : [])]
    const unlock: TempoModeView['unlock'] = {}
    if (lacksBrain && perAccount) unlock.subscriptions = Math.ceil(need / perAccount)
    if (lacksBody) {
      unlock.cores = Math.ceil((agents * c.machine.coresPerAgent) / CPU_HEADROOM)
      unlock.ramGb = Math.ceil((agents * c.machine.memPerAgentGb) / MEM_HEADROOM)
      const h = machine.host
      if (h?.nextPlan && (h.nextVcpu ?? 0) >= unlock.cores && (h.nextRamGb ?? 0) >= unlock.ramGb) {
        unlock.hostPlan = h.nextPlan
        if (h.nextPrice != null) unlock.hostPrice = `${h.nextPrice} ${h.currency ?? ''}`.trim()
      }
    }
    // The band: agents × their hours, held to the week's daily share in the modes that keep to the line.
    let hours = agents * HOURS[id]
    const ahead = AHEAD[id]
    if (perDay && ahead != null) hours = Math.min(hours, perDay.value * ahead)
    const tokens = c.tokensPerAgentHour
    const tokensPerDay: Figure = { ...tokens, value: hours * tokens.value, lo: hours * tokens.lo, hi: hours * tokens.hi }
    const pct: Figure | null = perDay
      ? { ...perDay, value: pctOf(hours, perDay.value), lo: pctOf(hours, perDay.hi), hi: pctOf(hours, perDay.lo) }
      : null
    const memGb = agents * c.machine.memPerAgentGb
    const memFig: Figure = { value: round1(memGb), lo: round1(memGb), hi: round1(memGb), confidence: c.machine.agents.confidence, source: c.machine.agents.source, at: c.machine.agents.at }
    return {
      id,
      agents,
      unlocked: !missing.length,
      missing,
      ...(Object.keys(unlock).length ? { unlock } : {}),
      needHours: need,
      band: { tokensPerDay, pctIntelligence: pct, memGb: memFig, memPct: c.machine.memGb ? Math.round((memGb / c.machine.memGb) * 100) : 0 },
    }
  })
}
const pctOf = (hours: number, perDay: number) => (perDay > 0 ? Math.round((hours / perDay) * 100) : 0)

/** The highest open mode at or under `m` (Pause is always open). */
export function clampTo(m: TempoMode, modes: readonly TempoModeView[]): TempoMode {
  for (let i = rankOf(m); i > 0; i--) if (modes.find((x) => x.id === TEMPO_MODES[i])?.unlocked) return TEMPO_MODES[i]
  return 'pause'
}

/**
 * The global ceiling shared fairly: each active repo wants the agents of its own mode (never above the global one);
 * the ceiling is split equally, and what a repo does not use goes to the others (water-filling).
 */
export function splitOf(global: TempoMode, repos: readonly { id: string; mode: TempoMode }[]): Record<string, number> {
  const ceiling = AGENTS[global]
  const want = new Map(repos.map((r) => [r.id, AGENTS[rankOf(r.mode) > rankOf(global) ? global : r.mode]]))
  const out: Record<string, number> = Object.fromEntries(repos.map((r) => [r.id, 0]))
  let left = ceiling
  let open = repos.filter((r) => want.get(r.id)! > 0).map((r) => r.id)
  while (left > 0 && open.length) {
    const share = Math.max(1, Math.floor(left / open.length))
    for (const id of open) {
      if (left <= 0) break
      const give = Math.min(share, want.get(id)! - out[id], left)
      out[id] += give
      left -= give
    }
    open = open.filter((id) => out[id] < want.get(id)!)
  }
  return out
}

export interface RepoQueue {
  id: string
  mode: TempoMode
  /** Requests waiting to start, any order (sorted here, oldest first): when each was asked or went back to the queue. */
  queued: { ask: string; since: number }[]
  running: number
  /** Since when the repo has had nothing running (null: something runs). */
  freeSince: number | null
}
export interface Start {
  repo: string
  ask: string
  tier: Tier
  /** Why now: within the mode's pace, or the floor (the oldest waited its limit). */
  why: 'pace' | 'floor'
}

/** The model tier of a start, by mode and by whether the week is over its pace for that mode. */
export function tierOf(mode: TempoMode, slowed: boolean): Tier {
  if (mode === 'standby' || slowed) return 'light'
  return mode === 'cruise' || mode === 'turbo' ? 'usual' : 'strong'
}

/**
 * Which queued requests start now. Pause: none. A hard limit on every tank: none (they start again by themselves
 * the minute a window reopens). Otherwise each repo fills its share of the split while the week is within its
 * mode's pace; over it, one agent at a time on the light tier; and in every mode but Pause the oldest request of a
 * free repo starts once it has waited MAX_WAIT_MS, whatever the budget: the floor under every rule.
 */
export function dueStarts(o: { global: TempoMode; repos: readonly RepoQueue[]; split: Record<string, number>; over: number | null; hardLimit: boolean; now: number }): Start[] {
  if (o.global === 'pause' || o.hardLimit) return []
  const out: Start[] = []
  for (const r of o.repos) {
    const mode = rankOf(r.mode) > rankOf(o.global) ? o.global : r.mode
    if (mode === 'pause' || !r.queued.length) continue
    const queue = [...r.queued].sort((a, b) => a.since - b.since)
    const slowed = o.over != null && o.over > FULL_PACE_UNTIL[mode]
    const share = o.split[r.id] ?? 0
    const slots = slowed ? (mode === 'standby' ? 0 : Math.min(1, share)) : share
    const free = Math.max(0, slots - r.running)
    const take = queue.slice(0, free)
    for (const q of take) out.push({ repo: r.id, ask: q.ask, tier: tierOf(mode, slowed), why: 'pace' })
    if (!take.length && r.running === 0 && r.freeSince != null) {
      const oldest = queue[0]
      if (o.now - Math.max(oldest.since, r.freeSince) >= MAX_WAIT_MS[mode]) out.push({ repo: r.id, ask: oldest.ask, tier: 'light', why: 'floor' })
    }
  }
  return out
}

// ---------------------------------------------------------------- the chosen modes

export interface TempoChoice {
  global: TempoMode
  repos: Record<string, TempoMode>
  at: number
}

/** The modes the user chose, in DATA_DIR/tempo.json. A repo never set runs at Cruise, under the global ceiling. */
export class TempoStore {
  private c: TempoChoice
  private file: string
  constructor(dir: string, env: NodeJS.ProcessEnv = process.env) {
    this.file = path.join(dir, 'tempo.json')
    // WEEVILS_SPEED_MODE (the older single mode) becomes the ceiling until a mode is set in the app.
    const fallback = fromLegacy(env.WEEVILS_SPEED_MODE) ?? GLOBAL_DEFAULT
    this.c = { global: fallback, repos: {}, at: 0 }
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      const g = fromLegacy(saved?.global)
      if (g) this.c.global = g
      for (const [k, v] of Object.entries(saved?.repos ?? {})) if (isTempoMode(v)) this.c.repos[k] = v
      this.c.at = Number(saved?.at) || 0
    } catch {
      /* never chosen: the server's setting, else the default ceiling */
    }
  }
  get choice(): Readonly<TempoChoice> {
    return this.c
  }
  /** The global ceiling (repo null), or a repo's own mode: its choice, else Cruise; never above the ceiling. */
  modeOf(repo: string | null): TempoMode {
    if (!repo) return this.c.global
    return lowerOf(this.c.repos[repo] ?? REPO_DEFAULT, this.c.global)
  }
  set(mode: TempoMode, repo?: string | null, now = Date.now()) {
    if (repo) this.c.repos[repo] = mode
    else this.c.global = mode
    this.c.at = now
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.c), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch {
      /* read-only disk: holds until the restart */
    }
  }
  /** A repo back to its default. */
  follow(repo: string, now = Date.now()) {
    delete this.c.repos[repo]
    this.set(this.c.global, null, now)
  }
}
