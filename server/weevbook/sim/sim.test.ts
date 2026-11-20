// The simulator of docs/spec (README step 4): the reference scenario told step by step, a seed replayed exactly,
// thousands of random seeds against every invariant, and the checks themselves caught on purpose.

import { describe, expect, test } from 'vitest'
import type { JournalEvent } from '../journal.ts'
import { STEAL_BOUND } from '../lease.ts'
import { check } from './check.ts'
import { runSeeds } from './pool.ts'
import { A, B, X } from './scenario.ts'
import { simulate, simulateReference, summarize } from './simulate.ts'

const journalOf = (r: ReturnType<typeof simulateReference>, thread: string): readonly JournalEvent[] => r.world.hub.thread(r.world.hub.refs.get(`refs/threads/${thread}`)!).journal

describe('the reference scenario', () => {
  const r = simulateReference()
  const w = r.world
  const [t0, t1, , t3] = w.starting

  test('keeps every invariant, and every turn ends done', () => {
    expect(r.violations).toEqual([])
    expect(w.quiet).toBe(true)
    expect(r.stats.held).toEqual({})
    expect(r.stats.turnsDone).toBe(13)
  })

  test('several threads work at once on different accounts, one of them on Codex', () => {
    const first = w.starting.map((t) => w.runs.find((x) => x.thread === t)!)
    expect(first.map((x) => x.engine)).toEqual([`${A}@laptop`, `${B}@server`, 'claude:e91f55@server', `${X}@laptop`])
    const t = Math.max(...first.map((x) => x.start))
    expect(first.every((x) => x.start <= t && (x.stop ?? Infinity) > t)).toBe(true)
  })

  test('the laptop dies in the middle of a turn: the server steals the lease within the bound and resumes', () => {
    const died = w.runs.find((x) => x.thread === t0 && x.machine === 'laptop' && x.why === 'off')!
    expect(died.taken).toBe(2)
    const steal = w.steals.find((s) => s.thread === t0)!
    expect(steal.t - steal.set).toBeLessThanOrEqual(STEAL_BOUND)
    const next = w.runs.find((x) => x.thread === t0 && x.start >= steal.t)!
    expect(next).toMatchObject({ machine: 'server', engine: `${A}@server`, attempt: 2, request: 'preface' })
    const events = journalOf(r, t0)
    expect(events.find((e) => e.type === 'turn' && e.state === 'failed')).toMatchObject({ reason: 'machine-lost', effect: 'some' })
    expect(events.find((e) => e.type === 'turn' && e.state === 'assigned' && e.attempt === 2)).toMatchObject({ rule: 'machine', resume: true })
  })

  test('an account reaches zero in the middle of a turn: the turn goes on with another account, resumed', () => {
    const stopped = w.runs.find((x) => x.thread === t1 && x.why === 'quota')!
    expect(stopped.engine).toBe(`${B}@server`)
    expect(stopped.taken).toBeGreaterThan(0)
    const next = w.runs.find((x) => x.thread === t1 && x.start >= stopped.stop!)!
    expect(next.machine).toBe('server')
    expect(next.engine).not.toBe(stopped.engine)
    expect(next.request).toBe('preface')
    expect(journalOf(r, t1).find((e) => e.type === 'turn' && e.state === 'assigned' && e.attempt === 2)).toMatchObject({ rule: 'account', resume: true })
  })

  test('the laptop comes back while the server answers: its unpushed step comes back as a late note only', () => {
    const answering = w.runs.find((x) => x.thread === t0 && x.machine === 'server')!
    const back = w.changes.find((c) => c.machine === 'laptop' && c.on && c.t > answering.start)!
    expect(back.t).toBeLessThan(answering.stop!)
    expect(w.losts).toContainEqual(expect.objectContaining({ machine: 'laptop', thread: t0 }))
    const events = journalOf(r, t0)
    const note = events.find((e) => e.type === 'note' && e.kind === 'late')!
    const data = (note as { data: { from: string; events: { type: string; call?: string }[] } }).data
    expect(data.from).toMatch(new RegExp(`^refs/orphans/${t0}/laptop-\\d+$`))
    expect(data.events.filter((e) => e.type === 'tool')).toHaveLength(1)
    // What the note keeps is not part of the thread.
    const calls = new Set(events.flatMap((e) => (e.type === 'tool' ? [e.call] : [])))
    expect(data.events.some((e) => calls.has(e.call!))).toBe(false)
    expect([...w.hub.refs.keys()].some((ref) => ref.startsWith('refs/orphans/'))).toBe(false)
  })

  test('the thread that was on Codex continues on Claude when the laptop is gone', () => {
    const moved = w.runs.find((x) => x.thread === t3 && x.machine === 'server')!
    expect(moved.engine.startsWith('claude:')).toBe(true)
    expect(journalOf(r, t3).find((e) => e.type === 'turn' && e.state === 'assigned' && e.engine === moved.engine)).toMatchObject({ rule: 'provider' })
  })
})

describe('random seeds', () => {
  test('a seed is replayed exactly from its number', () => {
    for (const seed of [7, 4242, 31337]) {
      const a = simulate(seed, { trace: true })
      const b = simulate(seed, { trace: true })
      expect(b.world.trace).toEqual(a.world.trace)
      expect(b.world.hub.log).toEqual(a.world.hub.log)
      expect(b.violations).toEqual(a.violations)
    }
  })

  test('2000 seeds keep every invariant', { timeout: 120_000 }, async () => {
    const s = summarize(await runSeeds(1, 2000))
    const failed = s.failed.map((f) => `seed ${f.seed} (npm run sim -- --seed ${f.seed} --trace): ${f.violations.map((v) => `${v.invariant} ${v.info}`).join('; ')}`)
    expect(failed).toEqual([])
    // The runs did meet what they are for.
    expect(s.seeds).toBe(2000)
    expect(s.totals.steals).toBeGreaterThan(1000)
    expect(s.totals.orphans).toBeGreaterThan(500)
    expect(s.totals.lateNotes).toBeGreaterThan(500)
    expect(s.totals.quotaStops).toBeGreaterThan(1000)
    expect(s.totals.held.attempts).toBeGreaterThan(0)
    expect(s.wideClockRuns).toBeGreaterThan(200)
    expect(s.maxStealDelay).toBeLessThanOrEqual(STEAL_BOUND)
  })
})

describe('the checks catch what they are for', () => {
  test('an accepted message missing from its thread', () => {
    const r = simulateReference()
    r.world.accepted.push({ key: 'm9-9', thread: r.world.starting[2], t: 1000 })
    expect(check(r.world).violations).toContainEqual(expect.objectContaining({ invariant: 'lost-message' }))
  })

  test('an engine that runs on after another took the thread over', () => {
    const r = simulateReference()
    const died = r.world.runs.find((x) => x.machine === 'laptop' && x.why === 'off' && x.thread === r.world.starting[0])!
    died.stop = null
    expect(check(r.world).violations).toContainEqual(expect.objectContaining({ invariant: 'zombie' }))
  })

  test('a push to a thread by a machine that does not hold its lease', () => {
    const r = simulateReference()
    const thread = r.world.starting[1]
    const tip = r.world.hub.refs.get(`refs/threads/${thread}`)!
    const forged = r.world.hub.threadCommit(tip, r.world.hub.thread(tip).journal)
    r.world.hub.push('laptop', [{ ref: `refs/threads/${thread}`, to: forged }], r.world.end)
    expect(check(r.world).violations).toContainEqual(expect.objectContaining({ invariant: 'SYNC-3' }))
  })

  test('a resumed attempt given the user message again', () => {
    const r = simulateReference()
    r.world.runs.find((x) => x.request === 'preface')!.request = 'message'
    expect(check(r.world).violations).toContainEqual(expect.objectContaining({ invariant: 'RESUME-8' }))
  })
})
