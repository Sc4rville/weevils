// Tempo: how fast weevils takes requests, per repo, under one global ceiling (docs/product/tempo.md).
// Shared by the server (server/tempo.ts decides) and the app (src/ui/tempo.tsx shows).

import type { SpeedMode } from './ledger.ts'

export type TempoMode = 'pause' | 'standby' | 'cruise' | 'turbo' | 'max' | 'fleet' | 'swarm'

/** Slowest first. */
export const TEMPO_MODES: readonly TempoMode[] = ['pause', 'standby', 'cruise', 'turbo', 'max', 'fleet', 'swarm']

export const isTempoMode = (x: unknown): x is TempoMode => typeof x === 'string' && (TEMPO_MODES as readonly string[]).includes(x)
export const rankOf = (m: TempoMode) => TEMPO_MODES.indexOf(m)
export const lowerOf = (a: TempoMode, b: TempoMode): TempoMode => (rankOf(a) <= rankOf(b) ? a : b)

/** A repo never set runs at Cruise (today's pace), or lower when the global ceiling is lower. */
export const REPO_DEFAULT: TempoMode = 'cruise'
/** The global ceiling, never set: as high as can be; only a repo turned up spends more than today. */
export const GLOBAL_DEFAULT: TempoMode = 'max'

/** Agents a mode may run at once. */
export const AGENTS: Record<TempoMode, number> = { pause: 0, standby: 1, cruise: 2, turbo: 4, max: 6, fleet: 12, swarm: 24 }

/** Hours a day a mode's agents may work at most, for the « up to » of the band. */
export const HOURS: Record<TempoMode, number> = { pause: 0, standby: 4, cruise: 6, turbo: 6, max: 8, fleet: 8, swarm: 8 }

/**
 * Agent-hours a day the subscriptions must feed for a mode to open. Up to Cruise: any plan. Turbo: a mid plan; Max:
 * about one Max 20x (measured: 17 to 25 a day on Opus); Fleet about two; Swarm about four.
 */
export const NEED_HOURS: Record<TempoMode, number> = { pause: 0, standby: 0, cruise: 0, turbo: 8, max: 15, fleet: 30, swarm: 60 }

const HOUR = 3600_000
/**
 * The invariant: every mode but Pause takes requests. The longest the oldest request of a repo waits, counted from
 * the moment that repo has nothing running, whatever the budget says.
 */
export const MAX_WAIT_MS: Record<TempoMode, number> = { pause: Infinity, standby: 4 * HOUR, cruise: HOUR, turbo: 0, max: 0, fleet: 0, swarm: 0 }

/** The model tier a start uses: light (cheapest), usual, strong (the strongest the user has). */
export type Tier = 'light' | 'usual' | 'strong'

/** The global mode in the older words the rest of the server still reads (request-handling.ts, boss-wakeups.ts). */
export function legacyOf(m: TempoMode): SpeedMode {
  if (m === 'standby') return 'veille'
  if (m === 'fleet' || m === 'swarm') return 'max'
  return m
}

/** The older words, read back (WEEVILS_SPEED_MODE, an older tempo.json). */
export function fromLegacy(x: unknown): TempoMode | undefined {
  if (x === 'veille' || x === 'idle') return 'standby'
  return isTempoMode(x) ? x : undefined
}

/** How sure a figure is: measured over enough history, rough (little history), or a careful default. */
export type Confidence = 'measured' | 'rough' | 'default'

/** A number with its range, where it came from and when. */
export interface Figure {
  value: number
  lo: number
  hi: number
  confidence: Confidence
  /** Plain words: « Claude's usage meter », « 3 weeks of your sessions », « default ». */
  source: string
  at: number
  /** Days of history behind it. */
  days?: number
}

export interface TempoModeView {
  id: TempoMode
  agents: number
  unlocked: boolean
  /** What a locked mode lacks. */
  missing: ('intelligence' | 'machine')[]
  /** What would open it: subscriptions in all (counting what you have), and a machine with this many cores / GB. */
  unlock?: { subscriptions?: number; cores?: number; ramGb?: number; hostPlan?: string; hostPrice?: string }
  /** Agent-hours a day it needs to open. */
  needHours: number
  band: {
    tokensPerDay: Figure
    /** Share of the subscriptions' daily capacity at most (over 100: ahead of the week's pace). */
    pctIntelligence: Figure | null
    /** Memory its agents take at once, GB, and that as a share of the machine's memory. */
    memGb: Figure
    memPct: number
  }
}

export interface TempoCapacity {
  /** The Claude subscriptions' week, in dollars of work at list prices (null: no quota reading). */
  weekUsd: Figure | null
  accounts: number
  plan?: string
  codex?: { plan?: string; weekPct?: number }
  usdPerAgentHour: Figure
  tokensPerAgentHour: Figure
  /** What the subscriptions feed a day, in agent-hours. */
  agentHoursPerDay: Figure | null
  machine: { agents: Figure; cores: number; memGb: number; diskFreeGb: number; memPerAgentGb: number; coresPerAgent: number; host?: string }
  pace: { weekPct: number | null; elapsedPct: number | null; over: number | null; hardLimit: boolean; resetsAt?: number | null }
}

export interface TempoView {
  global: TempoMode
  /** The global mode once clamped to what is open. */
  effective: TempoMode
  repos: Record<string, TempoMode>
  modes: TempoModeView[]
  capacity: TempoCapacity
  /** Agents each active repo may run now under the global ceiling (the fair split). */
  split: Record<string, number>
  at: number
}
