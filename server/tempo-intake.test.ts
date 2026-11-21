// Tempo's starts end to end on the server side: from the request ledger to weevboss's wake-up inbox.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session } from '../shared/api.ts'
import type { Ask } from '../shared/ledger.ts'
import { BossWakeups, DAILY_LIMIT, wakeContext } from './boss-wakeups.ts'
import { queuesOf, NO_REPO, retryAfter } from './tempo-service.ts'
import { rollUp, weekUsdOf, figureOf, SpendLedger } from './spend-ledger.ts'

const T = Date.UTC(2026, 10, 21, 10)
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-intake-'))
const session = (x: Partial<Session> = {}): Session => ({ id: 's1', machineId: 'main', projectId: 'weevils', cwd: '/w', status: 'idle', lastActivityAt: T - 1000, subagents: [], background: 0, queued: 0, controllable: true, live: false, ...x } as Session)
const ask = (x: Partial<Ask> = {}): Ask => ({ id: 'r1', kind: 'task', status: 'open', at: T - 5000, progressAt: T - 5000, text: 'Fix the weevils header', quote: 'fix the header', src: 'm1', from: 'user', dispatches: [], ...x } as Ask)
const projects = [{ id: 'weevils', name: 'weevils' }, { id: 'pli', name: 'pli' }]

describe('each repo’s queue, read from the request ledger', () => {
  it('a request never sent waits in its repo; « later » in the user’s words never enters the queue', () => {
    const q = queuesOf([ask(), ask({ id: 'r2', why: 'you-said-later' }), ask({ id: 'r3', text: 'a question about the VPS', quote: '' })], [], projects, () => 'cruise')
    expect(q.find((r) => r.id === 'weevils')!.queued.map((x) => x.ask)).toEqual(['r1'])
    expect(q.find((r) => r.id === NO_REPO)!.queued.map((x) => x.ask)).toEqual(['r3'])
  })
  it('a cut session puts its request back in the queue; a working one counts as running; done requests never queue', () => {
    const cut = session({ id: 'cut', status: 'interrupted', interrupted: { at: T - 60_000, reason: 'died' } as Session['interrupted'] })
    const busy = session({ id: 'busy', status: 'working' })
    const asks = [ask({ id: 'a', status: 'dispatched', dispatches: [{ session: 'cut', at: T - 1e6 }] }), ask({ id: 'b', status: 'dispatched', dispatches: [{ session: 'busy', at: T - 1e6 }] }), ask({ id: 'c', status: 'done' })]
    const r = queuesOf(asks, [cut, busy], projects, () => 'cruise').find((x) => x.id === 'weevils')!
    expect(r.queued).toEqual([{ ask: 'a', since: T - 60_000 }])
    expect(r.running).toBe(1)
    expect(r.freeSince).toBeNull()
  })
})

describe('asking weevboss again', () => {
  it('a start it did not make is asked again later and later, at most once a day', () => {
    const H = 3600_000
    expect([1, 2, 3, 4, 5, 6].map((n) => retryAfter('cruise', n) / H)).toEqual([1, 2, 4, 8, 16, 24])
    expect(retryAfter('standby', 1) / H).toBe(4)
    expect(retryAfter('max', 1) / H).toBe(1)
  })
})

describe('the wake-up inbox lets Tempo’s starts through in every mode but Pause', () => {
  const start = (w: BossWakeups, id = 'r1') => w.intake({ key: `intake:${id}:1`, at: T, request: id, summary: `start ${id}` })
  it('Standby: starts go at once, follow-ups stay off', () => {
    const w = new BossWakeups(dir())
    w.observe([], [ask()], T)
    start(w)
    expect(w.ready('veille', T)).toBe(true)
    const got = w.claim('turn-1', true, T, 'veille')
    expect(got.map((e) => e.kind)).toEqual(['intake'])
    expect(w.ready('pause', T)).toBe(false)
  })
  it('Pause: nothing goes', () => {
    const w = new BossWakeups(dir())
    start(w)
    expect(w.ready('pause', T)).toBe(false)
    expect(w.claim('turn-1', true, T, 'pause')).toEqual([])
  })
  it('the daily cap of follow-ups never holds a start back', () => {
    const w = new BossWakeups(dir())
    for (let i = 0; i < DAILY_LIMIT; i++) {
      w.selfCheck([{ key: `k${i}`, summary: 'x' }], T + i * 3 * 3600_000)
      w.claim(`f${i}`, true, T + i * 3 * 3600_000)
      w.reserveLaunch(`f${i}`, T + i * 3 * 3600_000)
    }
    const now = T + 23 * 3600_000
    start(w)
    expect(w.ready('cruise', now)).toBe(true)
    expect(w.canLaunch(now)).toBe(true)
    expect(w.claim('turn-x', true, now, 'cruise').map((e) => e.kind)).toEqual(['intake'])
    expect(w.reserveLaunch('turn-x', now)).toBe(true)
  })
  it('the turn is told what a start means', () => {
    expect(wakeContext([{ key: 'k', kind: 'intake', at: T, summary: 's' }], 'veille')).toMatch(/In Standby act only on Tempo starts/)
  })
})

describe('the spend ledger', () => {
  const e = (at: number, sid: string, cost = 1, tokens = 1000) => ({ at, sid, model: 'claude-opus-5-5', tokens, cost, tool: 'claude' as const })
  it('counts agent-hours as 5-minute slices a session worked in, per repo', () => {
    const d = rollUp([e(T, 'a'), e(T + 60_000, 'a'), e(T + 6 * 60_000, 'a'), e(T, 'b')], (sid) => (sid === 'a' ? 'weevils' : 'pli'))
    const day = d['2026-11-21']
    expect(day.repos.weevils).toMatchObject({ usd: 3, answers: 3, agentHours: 0.167 })
    expect(day.repos.pli.agentHours).toBe(0.083)
    expect(day.sessions!.a.repo).toBe('weevils')
  })
  it('keeps old days once their transcripts are gone, and drops session detail after 90 days', () => {
    const d = dir()
    const l = new SpendLedger(d)
    l.record([e(T - 100 * 86400_000, 'a')], () => 'weevils', T - 100 * 86400_000)
    l.record([e(T, 'b')], () => 'pli', T)
    const again = new SpendLedger(d)
    const days = Object.keys(again.data.days).sort()
    expect(days).toHaveLength(2)
    expect(again.data.days[days[0]].sessions).toBeUndefined()
    expect(again.data.days[days[0]].repos.weevils.usd).toBe(1)
  })
  it('the plan’s size from the meter: the latest week, the range across weeks, rough until 3 weeks', () => {
    const W = 7 * 86400_000
    const f = weekUsdOf([{ quotaAt: T, weekPct: 80, weekResets: T + W, weekCost: 1200 }, { quotaAt: T, weekPct: 30, weekResets: T + 2 * W, weekCost: 540 }], T)!
    expect(f.value).toBe(1800)
    expect(f.lo).toBe(1350)
    expect(f.hi).toBe(2250)
    expect(f.confidence).toBe('rough')
    expect(weekUsdOf([{ quotaAt: T, weekPct: 5, weekResets: T, weekCost: 100 }], T)).toBeNull()
  })
  it('a figure says how sure it is: default with no history, rough with little, measured with a week', () => {
    expect(figureOf([], 's', T, 13).confidence).toBe('default')
    expect(figureOf([10, 12], 's', T, 13).confidence).toBe('rough')
    const m = figureOf([10, 11, 12, 13, 14, 15, 16], 's', T, 13)
    expect([m.confidence, m.value, m.lo, m.hi]).toEqual(['measured', 13, 12, 15])
  })
  it('a meter reading is kept once per change', () => {
    const l = new SpendLedger(dir())
    l.quota({ at: T, tool: 'claude', weekPct: 30, source: 's' })
    l.quota({ at: T + 60_000, tool: 'claude', weekPct: 30, source: 's' })
    l.quota({ at: T + 120_000, tool: 'claude', weekPct: 31, source: 's' })
    expect(l.data.quotas.map((q) => q.weekPct)).toEqual([30, 31])
  })
})
