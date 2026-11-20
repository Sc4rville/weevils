// Which turns the dispatcher may place (live.ts, 06-dispatch.md « Activation »), and the visible state of those it
// never will (view.ts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ulid } from './adapters/adapter.ts'
import { draft } from './hub.ts'
import type { EventDraft, JournalEvent, LegId } from './journal.ts'
import { REQUEST_EXPIRES, RUN_GAP, beginRun, liveness, saveRun } from './live.ts'
import { turnsOf } from './turn.ts'
import { visibleState } from './view.ts'

const T0 = Date.parse('2026-11-20T10:00:00Z')
const roots: string[] = []
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

/** A journal from drafts: seq in order. */
function journal(build: (e: (leg: LegId | null, x: Record<string, unknown>) => EventDraft) => EventDraft[], at = T0): JournalEvent[] {
  let t = at
  return build((leg, x) => draft(t++, leg, x)).map((d, i) => ({ v: 1, seq: i + 1, ...d }) as JournalEvent)
}
const ENGINE = 'claude:abc123@server'
/** A first turn opened by `source` (with a key for weevils and the connector), then what `rest` adds. */
function turn(source: 'claude' | 'weevils' | 'connector', rest: (e: (leg: LegId | null, x: Record<string, unknown>) => EventDraft) => EventDraft[], at = T0) {
  return journal((e) => {
    const leg: LegId | null = source === 'claude' ? 'L1' : null
    const msg = e(leg, { type: 'message', role: 'user', text: 'Fix the export', source, ...(source === 'connector' ? { app: 'chatgpt' } : {}), ...(source === 'claude' ? {} : { key: `${source}:k1` }) })
    return [e(null, { type: 'meta', thread: ulid(at), title: 't', project: 'shop' }), ...(leg ? [e(leg, { type: 'leg.start', engine: ENGINE, session: 's1', cwd: '/home/user/shop', rung: 0, epoch: 1 })] : []), msg, e(leg, { type: 'turn', turn: 1, state: 'accepted', message: msg.id }), ...rest(e)]
  }, at)
}

describe('liveness: only what weevils filed during this run is placed', () => {
  it('a turn typed in the provider’s own session is never the dispatcher’s, failed or waiting', () => {
    const ev = turn('claude', (e) => [e('L1', { type: 'turn', turn: 1, state: 'assigned', engine: ENGINE, attempt: 1, rule: 'shadow', reason: 'r' }), e('L1', { type: 'turn', turn: 1, state: 'running' }), e('L1', { type: 'turn', turn: 1, state: 'failed', reason: 'api', effect: 'some' })])
    expect(liveness(ev, turnsOf(ev)[0], T0 - 1, T0 + 1000)).toBe('theirs')
  })
  it('a turn weevils filed during this run is live; one filed before it is closed: expired if no engine had it, else stopped', () => {
    const waiting = turn('weevils', (e) => [e(null, { type: 'turn', turn: 1, state: 'held', rule: 'hold', reason: 'no-machine' })])
    expect(liveness(waiting, turnsOf(waiting)[0], T0, T0 + 1000)).toBe('live')
    expect(liveness(waiting, turnsOf(waiting)[0], T0 + 60_000, T0 + 61_000)).toBe('expired')
    const ran = turn('connector', (e) => [e(null, { type: 'turn', turn: 1, state: 'assigned', engine: ENGINE, attempt: 1, rule: 'new', reason: 'r' }), e(null, { type: 'turn', turn: 1, state: 'running' }), e(null, { type: 'turn', turn: 1, state: 'failed', reason: 'machine-lost', effect: 'some' })])
    expect(liveness(ran, turnsOf(ran)[0], T0 + 60_000, T0 + 61_000)).toBe('stopped')
  })
  it('an hour without moving closes a turn, unless it waits for room the app said when it comes back', () => {
    const noMachine = turn('weevils', (e) => [e(null, { type: 'turn', turn: 1, state: 'held', rule: 'hold', reason: 'no-machine' })])
    expect(liveness(noMachine, turnsOf(noMachine)[0], T0, T0 + REQUEST_EXPIRES - 1000)).toBe('live')
    expect(liveness(noMachine, turnsOf(noMachine)[0], T0, T0 + REQUEST_EXPIRES + 1000)).toBe('expired')
    const noRoom = turn('weevils', (e) => [e(null, { type: 'turn', turn: 1, state: 'held', rule: 'hold', reason: 'no-room' })])
    expect(liveness(noRoom, turnsOf(noRoom)[0], T0, T0 + 4 * REQUEST_EXPIRES)).toBe('live')
  })
})

describe('the run of the dispatcher', () => {
  it('a restart within the gap goes on with the same run; the first start, or one after a long stop, begins a new one', async () => {
    const dir = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevils-run-'))
    roots.push(dir)
    const file = path.join(dir, 'threads-on.json')
    expect(await beginRun(file, T0)).toBe(T0)
    await saveRun(file, T0, T0 + 3600_000)
    expect(await beginRun(file, T0 + 3600_000 + 60_000)).toBe(T0)
    expect(await beginRun(file, T0 + 3600_000 + 60_000 + RUN_GAP + 1)).toBe(T0 + 3600_000 + 60_000 + RUN_GAP + 1)
  })
})

describe('what the app shows of a turn that will never go on', () => {
  it('the provider’s own failed turn: the person’s move, with one line saying it stopped', () => {
    const ev = turn('claude', (e) => [e('L1', { type: 'turn', turn: 1, state: 'assigned', engine: ENGINE, attempt: 1, rule: 'shadow', reason: 'r' }), e('L1', { type: 'turn', turn: 1, state: 'running' }), e('L1', { type: 'turn', turn: 1, state: 'failed', reason: 'api', effect: 'some' })])
    expect(visibleState(ev)).toEqual({ state: 'waiting', hold: { reason: 'stopped' } })
  })
  it('closed as stopped: the same; a turn of weevils that failed is still working (the dispatcher retries it)', () => {
    const closed = turn('weevils', (e) => [e(null, { type: 'turn', turn: 1, state: 'held', rule: 'hold', reason: 'stopped' })])
    expect(visibleState(closed)).toEqual({ state: 'waiting', hold: { reason: 'stopped' } })
    const retried = turn('weevils', (e) => [e(null, { type: 'turn', turn: 1, state: 'assigned', engine: ENGINE, attempt: 1, rule: 'new', reason: 'r' }), e(null, { type: 'turn', turn: 1, state: 'running' }), e(null, { type: 'turn', turn: 1, state: 'failed', reason: 'quota', effect: 'some' })])
    expect(visibleState(retried)).toEqual({ state: 'working' })
  })
})
