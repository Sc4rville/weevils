// What a simulated run is made of: machines and their clocks, accounts and their quotas, projects, the threads that
// exist at the start, the messages the phone sends, and the faults. `randomScenario(seed)` draws one from a seed;
// `referenceScenario()` is the reference scenario of docs/spec/06-dispatch.md, with its faults at the exact moments.

import type { Provider } from '../journal.ts'
import { Rng } from './rng.ts'

export type MachineId = 'laptop' | 'server'
export const S = 1000
export const MIN = 60 * S

export interface MachineSpec {
  id: MachineId
  /** Clock offset from real time, ms. */
  offset: number
  /** Clock rate error: local time runs (1 + drift) times real time. */
  drift: number
  projects: string[]
  engines: { engine: string; signedIn: boolean }[]
}
export interface ProjectSpec {
  /** `none`: a checkpoint cannot be taken (a home folder): the thread only continues where it is. */
  kind: 'git' | 'none'
  cloneable: boolean
}
export interface QuotaSpec {
  /** Percent of the 5-hour and weekly windows used at the start. */
  five: number
  week: number
  /** When the 5-hour window starts again, real ms from the start. */
  resetsAt: number
  /** Mean points of the 5-hour window one tool step costs. */
  burn: number
}
/** A thread that exists at the start: legs of engines, each with turns done. */
export interface ThreadSpec {
  project: string
  legs: { engine: string; turns: number }[]
}
/** Messages the phone sends to one thread (an existing one, by index, or a new one), at these times. */
export interface Conversation {
  existing: number | null
  project: string
  at: number[]
}
export type Fault =
  | { t: number; kind: 'off'; machine: MachineId; for: number }
  | { t: number; kind: 'cut'; machine: MachineId | 'phone'; for: number }
  | { t: number; kind: 'spike'; account: string; points: number }

/** What a scenario's hooks may do to the world, at the moment they choose. */
export interface Control {
  off(machine: MachineId): void
  on(machine: MachineId, after: number): void
  setQuota(account: string, five: number): void
  /** The index of a starting thread's id. */
  threadId(index: number): string
}
export interface RunView {
  thread: string
  machine: MachineId
  engine: string
  turn: number
  attempt: number
  taken: number
}
export interface Hooks {
  /** A run has just taken a tool step. */
  onStep?(c: Control, run: RunView): void
  /** A run has just started (its `running` is in the hub). */
  onStart?(c: Control, run: RunView): void
}

export interface Scenario {
  name: string
  /** How long faults and messages happen; then everything comes back and the run settles. */
  chaos: number
  machines: MachineSpec[]
  projects: Record<string, ProjectSpec>
  quotas: Record<string, QuotaSpec>
  threads: ThreadSpec[]
  conversations: Conversation[]
  faults: Fault[]
  /** Probability that a tool step ends in an API error. */
  apiErrors: number
  /** Probability that the dispatcher's answer to the phone is lost (the phone sends the message again). */
  lostAnswers: number
  preferred: Provider
  hooks?: Hooks
  /** Steps per turn, and seconds per step: inclusive ranges. */
  steps: [number, number]
  stepTime: [number, number]
}

export const A = 'claude:a3f9c1'
export const B = 'claude:7b20d4'
export const C = 'claude:e91f55'
export const X = 'codex:c81d2e'

/** A run drawn from its seed: same seed, same scenario. */
export function randomScenario(seed: number): Scenario {
  const rng = new Rng(seed)
  // Clocks: a few seconds apart, drifting by up to 0.1 %. One run in five breaks the 30 s the spec assumes: a clock
  // set minutes wrong, or a slow (or fast) clock that drifts by 1 to 3 % and ends up past 30 s within the run.
  const wide = rng.pick(['no', 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'offset', 'drift'] as const)
  const offset = () => rng.int(-12, 12) * S
  const drift = () => rng.real(-0.001, 0.001)
  const wrong = wide === 'offset' ? rng.pick(['laptop', 'server'] as const) : null
  const slow = wide === 'drift' ? rng.pick(['laptop', 'server'] as const) : null
  const clockOf = (m: MachineId) => ({
    offset: m === wrong ? rng.pick([-1, 1]) * rng.int(31, 300) * S : offset(),
    drift: m === slow ? rng.pick([-1, 1]) * rng.real(0.01, 0.03) : drift(),
  })
  const laptopClock = clockOf('laptop')
  const serverClock = clockOf('server')
  const signed = (p: number) => rng.chance(p)
  const notes = rng.chance(0.3)
  const tripOnServer = rng.chance(0.8)
  const machines: MachineSpec[] = [
    {
      id: 'laptop', ...laptopClock, projects: ['shop-app', 'trip-planner', ...(notes ? ['notes'] : [])],
      engines: [{ engine: `${A}@laptop`, signedIn: true }, { engine: `${B}@laptop`, signedIn: signed(0.8) }, { engine: `${C}@laptop`, signedIn: signed(0.6) }, { engine: `${X}@laptop`, signedIn: true }],
    },
    {
      id: 'server', ...serverClock, projects: ['shop-app', ...(tripOnServer ? ['trip-planner'] : [])],
      engines: [{ engine: `${A}@server`, signedIn: signed(0.9) }, { engine: `${B}@server`, signedIn: signed(0.9) }, { engine: `${C}@server`, signedIn: signed(0.9) }],
    },
  ]
  const tight = rng.pick([A, B, C])
  const quota = (account: string): QuotaSpec => ({
    five: account === tight ? rng.int(80, 96) : account === X ? rng.int(0, 60) : rng.int(0, 90),
    week: rng.chance(0.05) ? rng.int(86, 95) : rng.int(10, 80),
    resetsAt: rng.int(20, 300) * MIN,
    burn: account === X ? rng.real(1, 3) : rng.real(1, 4),
  })
  const chaos = 30 * MIN
  // Starting threads: on different accounts, one of them on Codex after a first leg on Claude.
  const claudeEngines = machines.flatMap((m) => m.engines.filter((e) => e.signedIn && e.engine.startsWith('claude')).map((e) => e.engine))
  const threads: ThreadSpec[] = []
  const n = rng.int(3, 5)
  for (let i = 0; i < n; i++) {
    const project = rng.pick(['shop-app', 'shop-app', 'trip-planner'])
    const has = (e: string) => machines.find((m) => e.endsWith(`@${m.id}`))!.projects.includes(project)
    const engine = rng.pick(claudeEngines.filter(has).length ? claudeEngines.filter(has) : [`${A}@laptop`])
    threads.push({ project, legs: i === 0 ? [{ engine: `${A}@laptop`, turns: rng.int(1, 2) }, { engine: `${X}@laptop`, turns: rng.int(1, 2) }] : [{ engine, turns: rng.int(1, 3) }] })
  }
  if (notes) threads.push({ project: 'notes', legs: [{ engine: `${A}@laptop`, turns: 1 }] })
  const conversations: Conversation[] = threads.map((t, i) => ({
    existing: i,
    project: t.project,
    at: [rng.int(5, 180) * S, ...Array.from({ length: rng.int(0, 3) }, () => rng.int(3 * 60, chaos / S) * S)].sort((a, b) => a - b),
  }))
  for (let i = rng.int(0, 3); i > 0; i--) {
    conversations.push({ existing: null, project: rng.pick(['shop-app', 'trip-planner']), at: Array.from({ length: rng.int(1, 3) }, () => rng.int(10, chaos / S - 300) * S).sort((a, b) => a - b) })
  }
  const faults: Fault[] = []
  // One run in ten is a storm: the laptop and the server go off and lose their links again and again.
  if (rng.chance(0.1)) {
    for (let i = rng.int(4, 10); i > 0; i--) faults.push({ t: rng.int(30, chaos / S) * S, kind: rng.pick(['off', 'cut'] as const), machine: 'laptop', for: rng.int(5, 200) * S })
    for (let i = rng.int(1, 4); i > 0; i--) faults.push({ t: rng.int(30, chaos / S) * S, kind: 'off', machine: 'server', for: rng.int(5, 150) * S })
  }
  for (let i = rng.pick([0, 1, 1, 2, 3]); i > 0; i--) faults.push({ t: rng.int(60, chaos / S) * S, kind: 'off', machine: 'laptop', for: rng.int(20, 480) * S })
  if (rng.chance(0.25)) faults.push({ t: rng.int(300, chaos / S) * S, kind: 'off', machine: 'server', for: rng.int(20, 240) * S })
  for (let i = rng.pick([0, 1, 2, 3]); i > 0; i--) faults.push({ t: rng.int(30, chaos / S) * S, kind: 'cut', machine: 'laptop', for: rng.int(10, 300) * S })
  for (let i = rng.pick([0, 0, 1, 2]); i > 0; i--) faults.push({ t: rng.int(0, chaos / S) * S, kind: 'cut', machine: 'phone', for: rng.int(30, 300) * S })
  for (let i = rng.pick([0, 1, 2]); i > 0; i--) faults.push({ t: rng.int(60, chaos / S) * S, kind: 'spike', account: rng.pick([A, B, C, X]), points: rng.int(20, 60) })
  return {
    name: `seed ${seed}`, chaos, machines, projects: { 'shop-app': { kind: 'git', cloneable: true }, 'trip-planner': { kind: 'git', cloneable: true }, notes: { kind: 'none', cloneable: false } },
    quotas: { [A]: quota(A), [B]: quota(B), [C]: quota(C), [X]: quota(X) }, threads, conversations, faults: faults.sort((a, b) => a.t - b.t),
    apiErrors: 0.01, lostAnswers: 0.05, preferred: 'claude', steps: [1, rng.pick([6, 6, 12])], stepTime: rng.pick([[5, 40], [5, 40], [20, 90]]),
  }
}

/**
 * The reference scenario (docs/spec/README.md step 4, docs/spec/06-dispatch.md): a phone, a laptop and a server; three
 * Claude accounts and Codex; four threads at work at once on different accounts, one of them on Codex. The laptop dies
 * in the middle of a turn; an account's quota reaches zero in the middle of another; the laptop comes back while the
 * server is answering the thread it lost.
 */
export function referenceScenario(): Scenario {
  const all = (m: MachineId, out: string[] = []) => [A, B, C, ...(m === 'laptop' ? [X] : [])].map((a) => ({ engine: `${a}@${m}`, signedIn: !out.includes(a) }))
  let laptopDied = false
  return {
    name: 'reference',
    chaos: 20 * MIN,
    machines: [
      { id: 'laptop', offset: 7 * S, drift: 0.0005, projects: ['shop-app', 'trip-planner'], engines: all('laptop', [C]) },
      { id: 'server', offset: -12 * S, drift: -0.0005, projects: ['shop-app', 'trip-planner'], engines: all('server') },
    ],
    projects: { 'shop-app': { kind: 'git', cloneable: true }, 'trip-planner': { kind: 'git', cloneable: true } },
    quotas: {
      [A]: { five: 30, week: 41, resetsAt: 4 * 60 * MIN, burn: 2 },
      [B]: { five: 55, week: 40, resetsAt: 4 * 60 * MIN, burn: 2 },
      [C]: { five: 20, week: 30, resetsAt: 4 * 60 * MIN, burn: 2 },
      [X]: { five: 8, week: 15, resetsAt: 4 * 60 * MIN, burn: 1.5 },
    },
    threads: [
      { project: 'shop-app', legs: [{ engine: `${A}@laptop`, turns: 1 }] },
      { project: 'shop-app', legs: [{ engine: `${B}@server`, turns: 2 }] },
      { project: 'trip-planner', legs: [{ engine: `${C}@server`, turns: 1 }] },
      { project: 'shop-app', legs: [{ engine: `${A}@laptop`, turns: 1 }, { engine: `${X}@laptop`, turns: 1 }] },
    ],
    conversations: [
      { existing: 0, project: 'shop-app', at: [10 * S, 9 * MIN] },
      { existing: 1, project: 'shop-app', at: [12 * S, 11 * MIN] },
      { existing: 2, project: 'trip-planner', at: [14 * S] },
      { existing: 3, project: 'shop-app', at: [16 * S, 14 * MIN] },
    ],
    faults: [],
    apiErrors: 0,
    lostAnswers: 0,
    preferred: 'claude',
    steps: [4, 6],
    stepTime: [5, 40],
    hooks: {
      onStep(c, run) {
        // The laptop dies in the middle of thread 0's turn, right after a step it has not pushed yet.
        if (!laptopDied && run.thread === c.threadId(0) && run.machine === 'laptop' && run.taken === 2) {
          laptopDied = true
          c.off('laptop')
        }
        // Thread 1's account reaches zero in the middle of its turn.
        if (run.thread === c.threadId(1) && run.engine.startsWith(B) && run.taken === 1) c.setQuota(B, 100)
      },
      onStart(c, run) {
        // The laptop comes back while the server is answering the thread it lost.
        if (laptopDied && run.thread === c.threadId(0) && run.machine === 'server') c.on('laptop', 15 * S)
      },
    },
  }
}
