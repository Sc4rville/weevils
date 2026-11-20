import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJournal, type JournalEvent } from './journal.ts'
import {
  ALIVE_FOR, BACK_UNDER, ENTER_UNDER, STAY_UNDER, accountOf, decide, release, reserve, reservedOn, settle, threadFacts,
  type DecideInput, type MachineFacts, type Quota, type Reservation, type Table, type ThreadFacts,
} from './dispatch.ts'
import { Rng } from './sim/rng.ts'

// The reference scenario of docs/spec/06-dispatch.md at 13:53, with three Claude accounts and one Codex account.
const NOW = Date.parse('2026-11-18T13:53:46Z')
const AT_17 = Date.parse('2026-11-18T17:00:00Z')
const MIN = 60_000
const q = (five: number, week: number, resetsAt: number | null = AT_17): Quota => ({ readAt: NOW - MIN, fiveHour: { used: five, resetsAt }, week: { used: week, resetsAt: null } })
const machine = (name: string, engines: [string, boolean][], o: Partial<MachineFacts> = {}): MachineFacts => ({
  machine: name, seen: NOW - 6_000, projects: ['shop-app', 'trip-planner'], engines: engines.map(([engine, signedIn]) => ({ engine, signedIn })), ...o,
})
function table(o: { laptop?: Partial<MachineFacts>; server?: Partial<MachineFacts>; quotas?: Record<string, Quota>; now?: number } = {}): Table {
  const seen = { seen: (o.now ?? NOW) - 6_000 }
  return {
    machines: [
      machine('laptop', [['claude:a3f9c1@laptop', true], ['claude:e91f55@laptop', false], ['codex:c81d2e@laptop', true]], { ...seen, ...o.laptop }),
      machine('server', [['claude:a3f9c1@server', true], ['claude:7b20d4@server', true]], { ...seen, ...o.server }),
    ],
    quotas: { 'claude:a3f9c1': q(100, 41), 'claude:7b20d4': q(64, 70), 'claude:e91f55': q(5, 5), 'codex:c81d2e': q(8, 15), ...o.quotas },
  }
}
const ledger30: Reservation[] = [1, 2, 3].map((n) => ({ account: 'claude:7b20d4', thread: `T${n}`, turn: 1, points: 10, at: NOW - 30_000 }))
const facts = (o: Partial<ThreadFacts> = {}): ThreadFacts => ({
  thread: '01M7QDKAT85KGENVY3NP4N74YB', project: 'shop-app', cloneable: true, last: 'claude:a3f9c1@laptop', first: 'claude',
  sessions: { claude: 'claude:a3f9c1@laptop' }, doneHere: 1, checkpoint: 'git', history: false, retry: false, ...o,
})
const input = (o: Omit<Partial<DecideInput>, 'thread'> & { thread?: Partial<ThreadFacts> } = {}): DecideInput => ({
  now: NOW, table: table(), ledger: ledger30, preferred: 'claude', ...o, thread: facts(o.thread),
})

describe('the worked example of the spec', () => {
  it('turn 2 of "Add CSV export to orders" goes to Codex, with the reason the journal has', () => {
    const d = decide(input({ thread: { retry: true } }))
    expect(d).toEqual({
      rule: 'provider', engine: 'codex:c81d2e@laptop', rung: 3,
      reason: 'claude a3f9c1 is at its 5-hour limit until 17:00 UTC; no other claude engine has room; codex c81d2e is at 8 %',
      reserve: { account: 'codex:c81d2e', points: 20 },
    })
  })
  it('at 14:20 the next message stays on Codex; at 17:05, after the reset, it still stays', () => {
    const onCodex = { last: 'codex:c81d2e@laptop', sessions: { claude: 'claude:a3f9c1@laptop', codex: 'codex:c81d2e@laptop' }, doneHere: 1 }
    expect(decide(input({ now: NOW + 27 * MIN, table: table({ now: NOW + 27 * MIN }), thread: onCodex })).rule).toBe('stay')
    expect(decide(input({ now: AT_17 + 5 * MIN, table: table({ now: AT_17 + 5 * MIN }), thread: onCodex }))).toMatchObject({ rule: 'stay', engine: 'codex:c81d2e@laptop' })
  })
})

describe('one test per row of the decision table', () => {
  it('new: machines that have the project, the preferred provider first, then the most room', () => {
    const t = { last: null, first: null, sessions: {}, doneHere: 0 }
    const quotas = { 'claude:a3f9c1': q(30, 20), 'claude:7b20d4': q(12, 20) }
    expect(decide(input({ ledger: [], table: table({ quotas }), thread: t }))).toEqual({
      rule: 'new', engine: 'claude:7b20d4@server', rung: 0, reason: 'shop-app is on server; claude 7b20d4 is at 12 % of its 5-hour window', reserve: { account: 'claude:7b20d4', points: 10 },
    })
    expect(decide(input({ ledger: [], table: table({ quotas }), preferred: 'codex', thread: t })).engine).toBe('codex:c81d2e@laptop')
    // Only the laptop has the project: the server's accounts are not candidates.
    expect(decide(input({ ledger: [], table: table({ quotas, server: { projects: [] } }), thread: t })).engine).toBe('claude:a3f9c1@laptop')
  })
  it('new: a thread that came from a chat starts on rung 3, and its engine rereads it (20 points)', () => {
    const d = decide(input({ ledger: [], table: table({ quotas: { 'claude:a3f9c1': q(30, 20) } }), thread: { last: null, first: null, sessions: {}, history: true } }))
    expect(d).toMatchObject({ rule: 'new', rung: 3, reserve: { points: 20 } })
  })
  it('back: after 2 turns where it is, between turns, to its first provider under 50 % on both windows', () => {
    const onCodex = { last: 'codex:c81d2e@laptop', sessions: { claude: 'claude:a3f9c1@laptop', codex: 'codex:c81d2e@laptop' }, doneHere: 2 }
    const quotas = { 'claude:a3f9c1': q(20, 45) }
    expect(decide(input({ table: table({ quotas }), thread: onCodex }))).toMatchObject({ rule: 'back', engine: 'claude:a3f9c1@laptop', rung: 1, reserve: { points: 20 } })
    // Its old session is on the laptop: on the server it is rung 2.
    expect(decide(input({ table: table({ quotas, laptop: { engines: [{ engine: 'codex:c81d2e@laptop', signedIn: true }] } }), thread: onCodex }))).toMatchObject({ rule: 'back', engine: 'claude:a3f9c1@server', rung: 2 })
  })
  it('back: not before 2 turns, not after a failure, not at 50 % on either window', () => {
    const onCodex = { last: 'codex:c81d2e@laptop', sessions: { claude: 'claude:a3f9c1@laptop', codex: 'codex:c81d2e@laptop' }, doneHere: 2 }
    expect(decide(input({ table: table({ quotas: { 'claude:a3f9c1': q(20, 45) } }), thread: { ...onCodex, doneHere: 1 } })).rule).toBe('stay')
    expect(decide(input({ table: table({ quotas: { 'claude:a3f9c1': q(20, 45) } }), thread: { ...onCodex, retry: true } })).rule).toBe('stay')
    expect(decide(input({ table: table({ quotas: { 'claude:a3f9c1': q(20, BACK_UNDER) } }), thread: onCodex })).rule).toBe('stay')
    // A window that has just reset does not pull the thread back while the other window is high.
    expect(decide(input({ now: AT_17 + MIN, table: table({ now: AT_17 + MIN, quotas: { 'claude:a3f9c1': q(100, 60) } }), thread: onCodex })).rule).toBe('stay')
  })
  it('stay: its engine is alive, signed in and under 97 %, reservations included', () => {
    const d = decide(input({ table: table({ quotas: { 'claude:a3f9c1': q(93, 41) } }) }))
    expect(d).toEqual({ rule: 'stay', engine: 'claude:a3f9c1@laptop', rung: 1, reason: 'the engine of the last leg is alive; claude a3f9c1 is at 93 % of its 5-hour window', reserve: { account: 'claude:a3f9c1', points: 7 } })
    expect(decide(input({ table: table({ quotas: { 'claude:a3f9c1': q(STAY_UNDER, 41) } }) })).rule).not.toBe('stay')
    const busy: Reservation[] = [{ account: 'claude:a3f9c1', thread: 'X', turn: 1, points: 10, at: NOW }]
    expect(decide(input({ ledger: busy, table: table({ quotas: { 'claude:a3f9c1': q(90, 41) } }) })).rule).not.toBe('stay')
  })
  it('account: another account of the same provider on the same machine, under 85 %, the most room first', () => {
    const quotas = { 'claude:a3f9c1': q(99, 41), 'claude:7b20d4': q(30, 30), 'claude:e91f55': q(10, 10) }
    const server = { last: 'claude:a3f9c1@server', sessions: { claude: 'claude:a3f9c1@server' } }
    expect(decide(input({ ledger: [], table: table({ quotas }), thread: server }))).toMatchObject({ rule: 'account', engine: 'claude:7b20d4@server', rung: 1, reserve: { points: 20 } })
    // On the laptop the other account is signed out: no `account`.
    expect(decide(input({ ledger: [], table: table({ quotas }) })).rule).not.toBe('account')
    // Signed in there now, it is taken.
    const signed = table({ quotas, laptop: { engines: [{ engine: 'claude:a3f9c1@laptop', signedIn: true }, { engine: 'claude:e91f55@laptop', signedIn: true }] } })
    expect(decide(input({ ledger: [], table: signed }))).toMatchObject({ rule: 'account', engine: 'claude:e91f55@laptop' })
  })
  it('machine: the same provider elsewhere, E\'s account first, then the most room; rung 2', () => {
    const silent = table({ laptop: { seen: NOW - ALIVE_FOR - 1 }, quotas: { 'claude:a3f9c1': q(41, 41), 'claude:7b20d4': q(5, 5) } })
    expect(decide(input({ ledger: [], table: silent, thread: { retry: true } }))).toMatchObject({
      rule: 'machine', engine: 'claude:a3f9c1@server', rung: 2, reserve: { points: 10 },
      reason: 'laptop has been silent since 13:50; server has shop-app and the same account: claude a3f9c1 is at 41 %',
    })
    // E's account is spent: the other account of the server, a change of account.
    const spent = table({ laptop: { seen: NOW - ALIVE_FOR - 1 }, quotas: { 'claude:7b20d4': q(5, 5) } })
    expect(decide(input({ ledger: [], table: spent }))).toMatchObject({ rule: 'machine', engine: 'claude:7b20d4@server', reserve: { points: 20 } })
    // A machine without the project can clone it when the project has an origin.
    const bare = table({ laptop: { seen: NOW - ALIVE_FOR - 1 }, server: { projects: [] }, quotas: { 'claude:a3f9c1': q(41, 41) } })
    expect(decide(input({ ledger: [], table: bare })).rule).toBe('machine')
    expect(decide(input({ ledger: [], table: bare, thread: { cloneable: false } })).rule).toBe('hold')
  })
  it('machine: never when the last checkpoint is kind none (the code cannot travel)', () => {
    const silent = table({ laptop: { seen: NOW - ALIVE_FOR - 1 }, quotas: { 'claude:a3f9c1': q(41, 41) } })
    expect(decide(input({ ledger: [], table: silent, thread: { checkpoint: 'none' } }))).toMatchObject({ rule: 'hold', hold: 'only-there' })
  })
  it('provider: another provider on a machine that has the project, E\'s machine first', () => {
    const codexBoth = table({ server: { engines: [{ engine: 'claude:7b20d4@server', signedIn: true }, { engine: 'codex:c81d2e@server', signedIn: true }] } })
    expect(decide(input({ table: codexBoth, thread: { retry: true } })).engine).toBe('codex:c81d2e@laptop')
    expect(decide(input({ table: codexBoth, thread: { retry: true, last: 'claude:a3f9c1@server', sessions: { claude: 'claude:a3f9c1@server' } } })).engine).toBe('codex:c81d2e@server')
  })
  it('provider: back to the first provider when forced, on its old session (rung 1 or 2, not 3)', () => {
    const quotas = { 'codex:c81d2e': q(100, 50), 'claude:a3f9c1': q(70, 41) }
    const onCodex = { last: 'codex:c81d2e@laptop', sessions: { claude: 'claude:a3f9c1@laptop', codex: 'codex:c81d2e@laptop' }, retry: true }
    expect(decide(input({ table: table({ quotas }), thread: onCodex }))).toMatchObject({ rule: 'provider', engine: 'claude:a3f9c1@laptop', rung: 1 })
  })
  it('hold: no-room, with the time the first account starts again', () => {
    const d = decide(input({ table: table({ quotas: { 'codex:c81d2e': q(90, 15, AT_17 - 30 * MIN) } }) }))
    expect(d).toMatchObject({ rule: 'hold', engine: null, hold: 'no-room', reason: 'every account that can take it is at its limit until 16:30 UTC' })
  })
  it('hold: no-machine, not-signed-in, only-there', () => {
    const off = { seen: NOW - ALIVE_FOR - 1 }
    expect(decide(input({ table: table({ laptop: off, server: off }) }))).toMatchObject({ hold: 'no-machine' })
    const out = (m: MachineFacts) => ({ engines: m.engines.map((e) => ({ ...e, signedIn: false })) })
    const t = table()
    expect(decide(input({ table: table({ laptop: out(t.machines[0]), server: out(t.machines[1]) }) }))).toMatchObject({ hold: 'not-signed-in' })
    expect(decide(input({ table: table({ laptop: off }), thread: { checkpoint: 'none' } }))).toMatchObject({ hold: 'only-there', reason: 'the code of this thread can only continue on laptop; laptop has been silent since 13:50' })
  })
})

describe('the engine table', () => {
  it('alive: seen in the last 180 s, or answering the dispatcher; a failed call wins over an old reading', () => {
    const quotas = { 'claude:a3f9c1': q(41, 41) }
    expect(decide(input({ table: table({ quotas, laptop: { seen: NOW - ALIVE_FOR + 1 } }) })).rule).toBe('stay')
    expect(decide(input({ table: table({ quotas, laptop: { seen: NOW - ALIVE_FOR } }) })).rule).toBe('machine')
    expect(decide(input({ table: table({ quotas, laptop: { seen: NOW - 1_000, answers: false } }) })).rule).toBe('machine')
    expect(decide(input({ table: table({ quotas, laptop: { seen: NOW - 3_600_000, answers: true } }) })).rule).toBe('stay')
  })
  it('two thresholds: an account at 90 % keeps its threads and takes no new one', () => {
    const quotas = { 'claude:a3f9c1': q(90, 41), 'claude:7b20d4': q(90, 41), 'codex:c81d2e': q(90, 41) }
    expect(decide(input({ ledger: [], table: table({ quotas }) })).rule).toBe('stay')
    expect(decide(input({ ledger: [], table: table({ quotas }), thread: { last: null, first: null, sessions: {} } })).rule).toBe('hold')
  })
  it('ties go to the engine id in alphabetical order', () => {
    const quotas = { 'claude:a3f9c1': q(10, 10), 'claude:7b20d4': q(10, 10) }
    const d = decide(input({ ledger: [], table: table({ quotas, laptop: { seen: 0 } }), thread: { last: null, first: null, sessions: {} } }))
    expect(d.engine).toBe('claude:7b20d4@server')
  })
  it('a window past its reset counts as 0', () => {
    expect(decide(input({ now: AT_17, table: table({ now: AT_17 }), thread: { retry: true } })).rule).toBe('stay')
  })
  it('engines.json lists only engines of its own machine', () => {
    const t = table({ quotas: { 'claude:a3f9c1': q(10, 10) } })
    const forged = { ...t, machines: [{ ...t.machines[1], engines: [...t.machines[1].engines, { engine: 'claude:a3f9c1@laptop', signedIn: true }] }] }
    expect(decide(input({ table: forged })).engine).not.toBe('claude:a3f9c1@laptop')
  })
})

describe('the reservation ledger', () => {
  it('spread: two threads that fail in the same second pick different accounts', () => {
    const quotas = { 'claude:a3f9c1': q(100, 41), 'claude:7b20d4': q(50, 41), 'claude:e91f55': q(55, 41) }
    const signed = table({ quotas, server: { engines: [{ engine: 'claude:7b20d4@server', signedIn: true }, { engine: 'claude:e91f55@server', signedIn: true }] } })
    const t = { retry: true, last: 'claude:a3f9c1@server', sessions: { claude: 'claude:a3f9c1@server' } }
    const first = decide(input({ ledger: [], table: signed, thread: { ...t, thread: 'A' } }))
    const after = reserve([], first, 'A', 2, NOW)
    const second = decide(input({ ledger: after, table: signed, thread: { ...t, thread: 'B' } }))
    expect([first.engine, second.engine]).toEqual(['claude:7b20d4@server', 'claude:e91f55@server'])
  })
  it('the reservation ends when the turn ends, or with a reading taken a minute after it', () => {
    let l = reserve([], { rule: 'stay', engine: 'x', rung: 1, reason: '', reserve: { account: 'claude:a3f9c1', points: 10 } }, 'A', 1, NOW)
    l = reserve(l, { rule: 'stay', engine: 'x', rung: 1, reason: '', reserve: { account: 'claude:a3f9c1', points: 10 } }, 'B', 1, NOW + 50_000)
    expect(reservedOn(l, 'claude:a3f9c1')).toBe(20)
    expect(reservedOn(settle(l, 'claude:a3f9c1', NOW + 59_000), 'claude:a3f9c1')).toBe(20)
    expect(reservedOn(settle(l, 'claude:a3f9c1', NOW + 60_000), 'claude:a3f9c1')).toBe(10)
    expect(release(l, 'B').map((r) => r.thread)).toEqual(['A'])
  })
  it('DISP-6: a reservation never takes an account past 100 %', () => {
    const d = decide(input({ ledger: [], table: table({ quotas: { 'claude:a3f9c1': q(96, 41) } }) }))
    expect(d).toMatchObject({ rule: 'stay', reserve: { points: 4 } })
  })
})

describe('properties over random tables (seeded)', () => {
  const ACCOUNTS = ['claude:a3f9c1', 'claude:7b20d4', 'claude:e91f55', 'codex:c81d2e']
  function random(rng: Rng): DecideInput {
    const machines = ['laptop', 'server'].map((m) => ({
      machine: m,
      seen: NOW - rng.int(0, 400_000),
      ...(rng.chance(0.2) ? { answers: rng.chance(0.5) } : {}),
      projects: rng.chance(0.8) ? ['shop-app'] : [],
      engines: ACCOUNTS.filter(() => rng.chance(0.7)).map((a) => ({ engine: `${a}@${m}`, signedIn: rng.chance(0.85) })),
    }))
    const quotas = Object.fromEntries(ACCOUNTS.map((a) => [a, q(rng.int(0, 105), rng.int(0, 100), rng.chance(0.3) ? NOW - 1 : AT_17)]))
    const ledger = ACCOUNTS.filter(() => rng.chance(0.3)).map((a, i) => ({ account: a, thread: `R${i}`, turn: 1, points: rng.pick([10, 20]), at: NOW }))
    const engines = machines.flatMap((m) => m.engines.map((e) => e.engine))
    const last = rng.chance(0.15) || !engines.length ? null : rng.pick(engines)
    const p = last ? (last.split(':')[0] as 'claude' | 'codex') : null
    const first = p && rng.chance(0.3) ? (p === 'claude' ? 'codex' : 'claude') : p
    return {
      now: NOW, table: { machines, quotas }, ledger, preferred: rng.pick(['claude', 'codex'] as const),
      thread: facts({ last, first, sessions: last ? { [p!]: last, ...(first !== p ? { [first!]: `${first}:${first === 'claude' ? 'a3f9c1' : 'c81d2e'}@laptop` } : {}) } : {}, doneHere: rng.int(0, 3), checkpoint: rng.pick(['git', 'none', null] as const), retry: rng.chance(0.4), cloneable: rng.chance(0.5) }),
    }
  }
  const THRESHOLD: Record<string, number> = { new: ENTER_UNDER, back: BACK_UNDER, stay: STAY_UNDER, account: ENTER_UNDER, machine: ENTER_UNDER, provider: ENTER_UNDER }
  it('DISP-1, DISP-3, DISP-6 over 3000 random inputs', () => {
    const rng = new Rng(20261120)
    for (let n = 0; n < 3000; n++) {
      const i = random(rng)
      const copy = structuredClone(i)
      const d = decide(i)
      // DISP-1: pure. The same input gives the same decision, and the input is left as it was.
      expect(decide(copy)).toEqual(d)
      expect(i).toEqual(copy)
      if (!d.engine) {
        expect(d.rule).toBe('hold')
        expect(d.hold).toBeTruthy()
        continue
      }
      // DISP-3: alive, signed in on its machine, room at the row's threshold (both windows, reservations included).
      const machine = d.engine.split('@')[1]
      const m = i.table.machines.find((x) => x.machine === machine)!
      expect(m.answers === true || (m.answers !== false && NOW - m.seen < ALIVE_FOR)).toBe(true)
      expect(m.engines.find((e) => e.engine === d.engine)?.signedIn).toBe(true)
      const quota = i.table.quotas[accountOf(d.engine)]
      const five = (quota.fiveHour.resetsAt !== null && NOW >= quota.fiveHour.resetsAt ? 0 : quota.fiveHour.used) + reservedOn(i.ledger, accountOf(d.engine))
      expect(five).toBeLessThan(THRESHOLD[d.rule])
      expect(quota.week.used).toBeLessThan(THRESHOLD[d.rule])
      // DISP-6: with its reservation, the account stays at or under 100 %.
      expect(five + (d.reserve?.points ?? 0)).toBeLessThanOrEqual(100)
      // DISP-5: a voluntary return to the first provider only after 2 turns, between turns, under 50 %.
      if (d.rule === 'back') expect(i.thread.doneHere >= 2 && !i.thread.retry && five < BACK_UNDER).toBe(true)
    }
  })
})

describe('the facts of a thread, from its journal', () => {
  const BOOK = path.resolve(import.meta.dirname, '../../examples/weevbook/projects')
  const sample = (part: string): JournalEvent[] => {
    for (const project of fs.readdirSync(BOOK)) for (const month of fs.readdirSync(path.join(BOOK, project))) {
      for (const t of fs.readdirSync(path.join(BOOK, project, month))) if (t.includes(part)) return parseJournal(fs.readFileSync(path.join(BOOK, project, month, t, 'events.jsonl'), 'utf8')).events
    }
    throw new Error(part)
  }
  it('the Codex thread: on codex since turn 2, two turns done there, first provider claude', () => {
    const f = threadFacts(sample('add-csv-export-to-orders'), { project: 'shop-app', cloneable: true, retry: false, turn: 4 })
    expect(f).toMatchObject({ last: 'codex:c81d2e@laptop', first: 'claude', doneHere: 2, checkpoint: 'git', sessions: { claude: 'claude:a3f9c1@laptop', codex: 'codex:c81d2e@laptop' } })
  })
  it('the chat from ChatGPT had messages before its first turn: rung 3', () => {
    const f = threadFacts(sample('offline-maps'), { project: 'trip-planner', cloneable: true, retry: false, turn: 1 })
    expect(f.history).toBe(true)
    expect(threadFacts(sample('fix-the-login-redirect'), { project: 'shop-app', cloneable: true, retry: false, turn: 1 }).history).toBe(false)
  })
})
