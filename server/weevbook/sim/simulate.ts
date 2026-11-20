// One simulated run from its seed, checked; and the summary of many. Used by main.ts (`npm run sim`) and sim.test.ts.

import { check, type Stats, type Violation } from './check.ts'
import { randomScenario, referenceScenario, type Scenario } from './scenario.ts'
import { World } from './world.ts'

export interface Result {
  seed: number
  scenario: Scenario
  world: World
  violations: Violation[]
  stats: Stats
}

/** Runs a scenario with the world's own randomness drawn from `seed`, then checks every invariant. */
export function simulate(seed: number, o: { scenario?: Scenario; trace?: boolean } = {}): Result {
  const scenario = o.scenario ?? randomScenario(seed)
  const world = new World(scenario, seed, { trace: o.trace }).run()
  const { violations, stats } = check(world)
  return { seed, scenario, world, violations, stats }
}

/** The reference scenario of docs/spec/06-dispatch.md. */
export const simulateReference = (o: { trace?: boolean } = {}) => simulate(1, { scenario: referenceScenario(), trace: o.trace })

export interface Summary {
  seeds: number
  failed: { seed: number; violations: Violation[] }[]
  /** Violations by invariant, over every seed. */
  byInvariant: Record<string, number>
  totals: { messages: number; turnsDone: number; runs: number; steals: number; liveSteals: number; orphans: number; lateNotes: number; switches: number; quotaStops: number; held: Record<string, number> }
  maxStealDelay: number
  maxSwitches: number
  wideClockRuns: number
  simulatedHours: number
}

export function summarize(results: Iterable<Pick<Result, 'seed' | 'violations' | 'stats'>>): Summary {
  const s: Summary = {
    seeds: 0, failed: [], byInvariant: {},
    totals: { messages: 0, turnsDone: 0, runs: 0, steals: 0, liveSteals: 0, orphans: 0, lateNotes: 0, switches: 0, quotaStops: 0, held: {} },
    maxStealDelay: 0, maxSwitches: 0, wideClockRuns: 0, simulatedHours: 0,
  }
  for (const r of results) {
    s.seeds++
    if (r.violations.length) s.failed.push({ seed: r.seed, violations: r.violations })
    for (const v of r.violations) s.byInvariant[v.invariant] = (s.byInvariant[v.invariant] ?? 0) + 1
    const t = s.totals
    t.messages += r.stats.messages
    t.turnsDone += r.stats.turnsDone
    t.runs += r.stats.runs
    t.steals += r.stats.steals
    t.liveSteals += r.stats.liveSteals
    t.orphans += r.stats.orphans
    t.lateNotes += r.stats.lateNotes
    t.switches += r.stats.switches
    t.quotaStops += r.stats.quotaStops
    for (const [k, n] of Object.entries(r.stats.held)) t.held[k] = (t.held[k] ?? 0) + n
    s.maxStealDelay = Math.max(s.maxStealDelay, r.stats.stealDelay)
    s.maxSwitches = Math.max(s.maxSwitches, r.stats.maxSwitches)
    if (r.stats.wideClocks) s.wideClockRuns++
    s.simulatedHours += r.stats.simulated / 3_600_000
  }
  return s
}
