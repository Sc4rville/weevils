// The spend ledger: what really went into the work, kept over time, so Tempo's estimates come from measured history.
//
// What it keeps, in DATA_DIR/spend-ledger.json (on this machine only, never published):
// - per day, forever: dollars at list prices, tokens, answers and agent-hours, per repo, per model and per tool;
// - per day and per session, 90 days (the detail; Claude Code deletes old transcripts, the ledger does not);
// - every subscription meter reading (Claude and Codex: plan, % of the week and of the 5-hour window, source, time),
//   120 days.
//
// Where it reads: server/spend.ts (every answer in the transcripts, priced), server/usage.ts (the providers' own
// meters) and spend-calibration.jsonl (each Claude reading next to the spend up to it: the size of the plan, learned).
// An agent-hour is a 5-minute slice in which a session answered at least once, counted per session: the time agents
// really worked, not the time their windows stayed open.

import fs from 'node:fs'
import path from 'node:path'
import type { Confidence, Figure } from '../shared/tempo.ts'
import type { SpendEntry } from './spend.ts'

const DAY = 86400_000
const SLICE = 5 * 60_000
const DETAIL_DAYS = 90
const QUOTA_DAYS = 120

export interface Agg {
  usd: number
  tokens: number
  answers: number
  agentHours: number
}
export interface DayRow {
  repos: Record<string, Agg>
  models: Record<string, Agg>
  tools: Record<string, Agg>
  /** Per session, kept DETAIL_DAYS. */
  sessions?: Record<string, Agg & { repo: string }>
}
export interface QuotaReading {
  at: number
  tool: 'claude' | 'codex'
  plan?: string
  weekPct?: number
  weekResets?: number | null
  sessionPct?: number
  source: string
}
export interface LedgerFile {
  days: Record<string, DayRow>
  quotas: QuotaReading[]
  updatedAt: number
}

const empty = (): Agg => ({ usd: 0, tokens: 0, answers: 0, agentHours: 0 })
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d

/** Roll answers up into days: per repo, model, tool and session. Pure, exported for tests. */
export function rollUp(es: readonly SpendEntry[], repoOf: (sid: string) => string): Record<string, DayRow> {
  const out: Record<string, DayRow> = {}
  const slices = new Map<string, Set<number>>()
  for (const e of es) {
    const d = dayOf(e.at)
    const row = (out[d] ??= { repos: {}, models: {}, tools: {}, sessions: {} })
    const repo = repoOf(e.sid) || 'other'
    const slice = Math.floor(e.at / SLICE)
    const k = `${d}|${e.sid}`
    const set = slices.get(k) ?? new Set<number>()
    const fresh = !set.has(slice)
    set.add(slice)
    slices.set(k, set)
    const h = fresh ? SLICE / 3600_000 : 0
    for (const a of [(row.repos[repo] ??= empty()), (row.models[e.model] ??= empty()), (row.tools[e.tool] ??= empty()), (row.sessions![e.sid] ??= { ...empty(), repo })]) {
      a.usd += e.cost
      a.tokens += e.tokens
      a.answers += 1
      a.agentHours += h
    }
  }
  for (const row of Object.values(out)) for (const g of [row.repos, row.models, row.tools, row.sessions!]) for (const a of Object.values(g)) (a.usd = round(a.usd)), (a.agentHours = round(a.agentHours, 3))
  return out
}

/** A figure from a list of daily samples: the median, the spread between the quartiles, and how sure it is. */
export function figureOf(samples: number[], source: string, at: number, fallback: number): Figure {
  const xs = samples.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (!xs.length) return { value: fallback, lo: fallback * 0.5, hi: fallback * 1.5, confidence: 'default', source: 'default', at, days: 0 }
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1) + 0.5))]
  const confidence: Confidence = xs.length >= 7 ? 'measured' : 'rough'
  const value = q(0.5)
  // With little history the range is at least ±30 %; it narrows to the measured quartiles as days come in.
  const widen = confidence === 'measured' ? 0 : 0.3
  return { value, lo: Math.min(q(0.25), value * (1 - widen)), hi: Math.max(q(0.75), value * (1 + widen)), confidence, source, at, days: xs.length }
}

/** One Claude reading of the calibration log (server/spend.ts logCalibration). */
export interface CalLine {
  quotaAt: number
  weekPct: number | null
  weekResets: number
  weekCost: number
}

/**
 * The size of the Claude plan, in dollars of work a week: each week, the spend up to a reading over its percent
 * (readings under 10 % are too coarse). The value is the latest week's, the range spans the last weeks'.
 */
export function weekUsdOf(lines: readonly CalLine[], at: number): Figure | null {
  const by = new Map<number, number[]>()
  for (const l of lines) {
    if (!l.weekPct || l.weekPct < 10 || !(l.weekCost > 0)) continue
    const k = Math.round(l.weekResets / DAY)
    const v = by.get(k) ?? []
    v.push((l.weekCost / l.weekPct) * 100)
    by.set(k, v)
  }
  const weeks = [...by.entries()].sort((a, b) => a[0] - b[0]).slice(-4).map(([, v]) => v.sort((a, b) => a - b)[v.length >> 1])
  if (!weeks.length) return null
  const value = weeks.at(-1)!
  const confidence: Confidence = weeks.length >= 3 ? 'measured' : 'rough'
  const widen = confidence === 'measured' ? 0 : 0.25
  return {
    value,
    lo: Math.min(...weeks, value * (1 - widen)),
    hi: Math.max(...weeks, value * (1 + widen)),
    confidence,
    source: "Claude's usage meter",
    at,
    days: weeks.length * 7,
  }
}

export class SpendLedger {
  private f: LedgerFile = { days: {}, quotas: [], updatedAt: 0 }
  private file: string
  constructor(dir: string) {
    this.file = path.join(dir, 'spend-ledger.json')
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (saved && typeof saved.days === 'object' && Array.isArray(saved.quotas)) this.f = saved
    } catch {
      /* first run */
    }
  }
  get data(): Readonly<LedgerFile> {
    return this.f
  }
  /**
   * Fold the answers of the last days in. The days the transcripts still cover are recomputed whole (an answer read
   * twice counts once); older days stay as recorded, even once their transcripts are gone.
   */
  record(es: readonly SpendEntry[], repoOf: (sid: string) => string, now = Date.now()) {
    const fresh = rollUp(es, repoOf)
    const first = es.length ? Math.min(...es.map((e) => e.at)) : now
    // The first covered day may be partial in the answers: keep whichever saw more.
    for (const [d, row] of Object.entries(fresh)) {
      const old = this.f.days[d]
      if (d === dayOf(first) && old && sumOf(old.tools).answers > sumOf(row.tools).answers) continue
      this.f.days[d] = row
    }
    const cut = dayOf(now - DETAIL_DAYS * DAY)
    for (const [d, row] of Object.entries(this.f.days)) if (d < cut) delete row.sessions
    this.f.updatedAt = now
    this.save()
  }
  /** A meter reading, once per change (same plan and percents within 10 minutes: not kept). */
  quota(r: QuotaReading) {
    const last = [...this.f.quotas].reverse().find((q) => q.tool === r.tool)
    if (last && r.at - last.at < 10 * 60_000 && last.weekPct === r.weekPct && last.sessionPct === r.sessionPct && last.plan === r.plan) return
    if (last && last.at === r.at) return
    this.f.quotas.push(r)
    this.f.quotas = this.f.quotas.filter((q) => r.at - q.at < QUOTA_DAYS * DAY)
    this.save()
  }
  /** Daily totals for one key of one dimension, the last `days` days that had any work. */
  daily(dim: 'repos' | 'models' | 'tools', key: string | null, days = 28, now = Date.now()): Agg[] {
    const from = dayOf(now - days * DAY)
    const today = dayOf(now)
    return Object.entries(this.f.days)
      .filter(([d]) => d >= from && d < today)
      .map(([, row]) => (key ? row[dim][key] : sumOf(row[dim])))
      .filter((a): a is Agg => !!a && a.agentHours > 0)
  }
  /** What an agent-hour really costs (list-price dollars) and reads (tokens), from the last 4 weeks. */
  perAgentHour(repo: string | null = null, now = Date.now()): { usd: Figure; tokens: Figure } {
    const pick = (repo ? this.daily('repos', repo, 28, now) : []).length >= 3 ? this.daily('repos', repo, 28, now) : this.daily('tools', 'claude', 28, now)
    const src = (n: number) => (n ? `${n} days of your sessions` : 'default')
    const usd = figureOf(pick.map((a) => a.usd / a.agentHours), src(pick.length), now, 13)
    const tokens = figureOf(pick.map((a) => a.tokens / a.agentHours), src(pick.length), now, 6e6)
    return { usd, tokens }
  }
  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.f), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch {
      /* read-only disk: the memory copy still serves */
    }
  }
}

export function sumOf(g: Record<string, Agg>): Agg {
  const s = empty()
  for (const a of Object.values(g)) (s.usd += a.usd), (s.tokens += a.tokens), (s.answers += a.answers), (s.agentHours += a.agentHours)
  return s
}

/** The calibration log, read (server/spend.ts writes it). */
export function readCalibration(file: string): CalLine[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}
