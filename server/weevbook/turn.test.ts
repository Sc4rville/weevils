import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJournal, type JournalEvent } from './journal.ts'
import { MAX_ATTEMPTS, TurnError, applyTurn, assign, counted, effectOf, holdAll, next, preface, prefaceSign, stolen, turnsOf, type Turn, type TurnChange } from './turn.ts'

const MSG = '01M7M8E6XRZ0FEBHYK2C5GNQF4'
const E1 = 'claude:a3f9c1@laptop'
const E2 = 'claude:a3f9c1@server'
const run = (...changes: TurnChange[]) => changes.reduce<Turn[]>((t, c) => applyTurn(t, c), [])
const accepted = (turn = 1): TurnChange => ({ turn, state: 'accepted', message: MSG })
const assigned = (attempt: number, resume = false, turn = 1, engine = E1): TurnChange => ({ turn, state: 'assigned', engine, attempt, ...(resume ? { resume } : {}), rule: 'stay', reason: 'test' })
const running = (turn = 1): TurnChange => ({ turn, state: 'running' })
const done = (turn = 1): TurnChange => ({ turn, state: 'done' })
const failed = (effect: 'none' | 'some', turn = 1, reason = 'quota'): TurnChange => ({ turn, state: 'failed', reason, effect })
const held = (reason = 'no-room', turn = 1): TurnChange => ({ turn, state: 'held', rule: 'hold', reason })

// A turn brought to each state the machine knows, by legal steps.
const STATES: Record<string, TurnChange[]> = {
  accepted: [accepted()],
  held: [accepted(), held()],
  'held (attempts)': [accepted(), assigned(1), failed('none', 1, 'api'), assigned(2), failed('none', 1, 'auth'), assigned(3), failed('none', 1, 'api'), held('attempts')],
  assigned: [accepted(), assigned(1)],
  running: [accepted(), assigned(1), running()],
  done: [accepted(), assigned(1), running(), done()],
  'failed (none)': [accepted(), assigned(1), running(), failed('none')],
  'failed (some)': [accepted(), assigned(1), running(), failed('some')],
  'failed (3 attempts)': [accepted(), assigned(1), failed('none', 1, 'api'), assigned(2), failed('none', 1, 'api'), assigned(3), failed('none', 1, 'auth')],
}
// Every change tried from every state, with the attempt and resume the turn would need.
const CHANGES: Record<string, (t: Turn) => TurnChange> = {
  held: () => held(),
  'held (attempts)': () => held('attempts'),
  assigned: (t) => assigned(t.attempts.length + 1, t.effect === 'some'),
  running: () => running(),
  done: () => done(),
  'failed (none)': () => failed('none'),
  'failed (some)': () => failed('some'),
}
// What the spec allows (docs/spec/01-thread.md "The turn", docs/spec/04-resume.md "When a turn fails").
const ALLOWED: Record<string, string[]> = {
  accepted: ['held', 'assigned'],
  held: ['held', 'assigned'],
  'held (attempts)': [],
  assigned: ['running', 'failed (none)'],
  running: ['done', 'failed (none)', 'failed (some)'],
  done: [],
  'failed (none)': ['held', 'assigned'],
  'failed (some)': ['held', 'assigned'],
  'failed (3 attempts)': ['held (attempts)'],
}

describe('the state machine, every state against every change', () => {
  for (const [from, steps] of Object.entries(STATES)) {
    for (const [change, make] of Object.entries(CHANGES)) {
      const ok = ALLOWED[from].includes(change)
      it(`${from} → ${change}: ${ok ? 'allowed' : 'refused'}`, () => {
        const turns = run(...steps)
        const attempt = () => applyTurn(turns, make(turns[0]))
        if (ok) expect(attempt()[0].state).toBe(change.split(' ')[0])
        else expect(attempt).toThrow(TurnError)
      })
    }
  }
  it('turns are accepted in order, one number after the other', () => {
    expect(() => run({ turn: 2, state: 'accepted', message: MSG })).toThrow(TurnError)
    expect(() => run(accepted(), running(2))).toThrow(/never accepted/)
    expect(run(accepted(), accepted(2)).map((t) => t.turn)).toEqual([1, 2])
    expect(() => run({ turn: 1, state: 'accepted' })).toThrow(/message/)
    expect(run({ turn: 1, state: 'accepted', message: null })[0].message).toBeNull()
  })
  it('THREAD-11: one turn at a time is in an engine\'s hands', () => {
    expect(() => run(accepted(), accepted(2), held('no-room', 1), assigned(1, false, 2))).toThrow(/older/)
    expect(() => run(accepted(), assigned(1), accepted(2), assigned(1, false, 2))).toThrow(/still assigned/)
  })
  it('the oldest waiting turn is served first; a turn held for attempts does not block the next', () => {
    const t = run(...STATES['held (attempts)'], accepted(2))
    expect(applyTurn(t, assigned(1, false, 2))[1].state).toBe('assigned')
  })
  it('the attempt number follows from the attempts before', () => {
    expect(() => run(accepted(), assigned(2))).toThrow(/attempt 2, expected 1/)
    expect(() => run(accepted(), assigned(1), failed('none'), assigned(1))).toThrow(/expected 2/)
  })
  it('after three api or auth failures, a fourth assignment is refused: held for attempts', () => {
    const t = run(...STATES['failed (3 attempts)'])
    expect(counted(t[0])).toBe(MAX_ATTEMPTS)
    expect(() => applyTurn(t, assigned(4))).toThrow(new RegExp(`${MAX_ATTEMPTS} times on api or auth`))
    expect(() => applyTurn(t, held('no-room'))).toThrow(/attempts/)
    expect(() => run(accepted(), held('attempts'))).toThrow(/attempts after 0/)
  })
  it('only api and auth failures count: a quota that ran out or a machine that went away does not', () => {
    // Five attempts lost to quotas and machines, then two api failures: still assigned again.
    const t = run(accepted(),
      assigned(1), failed('none', 1, 'quota'), assigned(2), running(), failed('some', 1, 'machine-lost'),
      assigned(3, true), failed('none', 1, 'quota'), assigned(4, true), running(), failed('some', 1, 'machine-lost'),
      assigned(5, true), failed('none', 1, 'lease-lost'), assigned(6, true), failed('none', 1, 'api'), assigned(7, true), failed('none', 1, 'auth'))
    expect(counted(t[0])).toBe(2)
    expect(next(t)).toMatchObject({ kind: 'dispatch', attempt: 8, resume: true, request: 'preface' })
    expect(() => applyTurn(t, held('attempts'))).toThrow(/attempts after 2/)
    // The third that counts holds it, whatever came between.
    const out = applyTurn(applyTurn(t, assigned(8, true)), failed('none', 1, 'api'))
    expect(next(out)).toEqual({ kind: 'hold', turn: 1, rule: 'hold', reason: 'attempts' })
    expect(() => applyTurn(out, assigned(9, true))).toThrow(/api or auth/)
  })
})

describe('the retry rule', () => {
  it('a new turn goes to the dispatcher with the user\'s message', () => {
    expect(next(run(accepted()))).toEqual({ kind: 'dispatch', turn: 1, attempt: 1, resume: false, request: 'message', retry: false, open: [1] })
  })
  it('no effect: assigned again at once, with the message as it was (nothing is resumed)', () => {
    const n = next(run(accepted(), assigned(1), running(), failed('none')))
    expect(n).toMatchObject({ kind: 'dispatch', attempt: 2, resume: false, request: 'message', retry: true })
  })
  it('some effect: the next attempt resumes with the preface, never the message again', () => {
    const t = run(accepted(), assigned(1), running(), failed('some'))
    expect(next(t)).toMatchObject({ kind: 'dispatch', attempt: 2, resume: true, request: 'preface' })
    expect(assign(t, 1, E2, 'machine', 'laptop is silent')).toEqual({ turn: 1, state: 'assigned', engine: E2, attempt: 2, resume: true, rule: 'machine', reason: 'laptop is silent' })
    expect(() => applyTurn(t, assigned(2, false))).toThrow(/must resume/)
  })
  it('RESUME-8: once an attempt had an effect, every later one resumes, even after a failure without effect', () => {
    const t = run(accepted(), assigned(1), running(), failed('some'), assigned(2, true), failed('none'))
    expect(next(t)).toMatchObject({ kind: 'dispatch', attempt: 3, resume: true, request: 'preface' })
  })
  it('resume without an earlier effect is refused', () => {
    expect(() => run(accepted(), assigned(1, true))).toThrow(/without an earlier effect/)
  })
  it('three api or auth failures, then held for attempts, without asking the dispatcher', () => {
    expect(next(run(...STATES['failed (3 attempts)']))).toEqual({ kind: 'hold', turn: 1, rule: 'hold', reason: 'attempts' })
    expect(next(run(...STATES['held (attempts)']))).toEqual({ kind: 'quiet' })
  })
  it('RESUME-9 never stuck: from every reachable state, a failed turn leads to dispatch or hold', () => {
    for (const steps of Object.values(STATES)) {
      const t = run(...steps)
      if (t[0].state === 'failed') expect(['dispatch', 'hold']).toContain(next(t).kind)
    }
  })
  it('a turn in an engine\'s hands makes the thread busy', () => {
    expect(next(run(accepted(), assigned(1)))).toEqual({ kind: 'busy', turn: 1, state: 'assigned' })
    expect(next(run(accepted(), assigned(1), running(), accepted(2)))).toEqual({ kind: 'busy', turn: 1, state: 'running' })
  })
  it('a held turn is offered again whenever the table changes; later turns wait behind it', () => {
    const t = run(accepted(), held('no-room'), accepted(2))
    expect(next(t)).toMatchObject({ kind: 'dispatch', turn: 1, attempt: 1, open: [1, 2] })
  })
  it('holdAll: every waiting turn, except those that already say the same', () => {
    const t = run(accepted(), held('no-room'), accepted(2))
    expect(holdAll(t, 'hold', 'no-room')).toEqual([{ turn: 2, state: 'held', rule: 'hold', reason: 'no-room' }])
    expect(holdAll(t, 'hold', 'no-machine').map((c) => c.turn)).toEqual([1, 2])
    expect(holdAll(run(...STATES.done), 'hold', 'no-room')).toEqual([])
  })
  it('the steal: failed machine-lost, no effect before running, some after', () => {
    expect(stolen(run(accepted(), assigned(1)))).toEqual({ turn: 1, state: 'failed', reason: 'machine-lost', effect: 'none' })
    expect(stolen(run(accepted(), assigned(1), running()))).toEqual({ turn: 1, state: 'failed', reason: 'machine-lost', effect: 'some' })
    expect(stolen(run(...STATES.done))).toBeNull()
  })
})

// ---------------------------------------------------------------- against the sample weevbook

const BOOK = path.resolve(import.meta.dirname, '../../examples/weevbook/projects')
const sample = (part: string): JournalEvent[] => {
  for (const project of fs.readdirSync(BOOK)) for (const month of fs.readdirSync(path.join(BOOK, project))) {
    for (const t of fs.readdirSync(path.join(BOOK, project, month))) {
      if (t.includes(part)) return parseJournal(fs.readFileSync(path.join(BOOK, project, month, t, 'events.jsonl'), 'utf8')).events
    }
  }
  throw new Error(part)
}

describe('the sample threads', () => {
  it('follow the state machine; every turn ends done', () => {
    for (const part of ['fix-the-login-redirect', 'add-csv-export-to-orders', 'offline-maps']) {
      const turns = turnsOf(sample(part))
      expect(turns.map((t) => t.state).every((s) => s === 'done')).toBe(true)
      expect(next(turns)).toEqual({ kind: 'quiet' })
    }
  })
  it('the machine-lost turn resumed on the server, and the quota turn resumed on Codex', () => {
    const lost = turnsOf(sample('fix-the-login-redirect'))[1]
    expect(lost.attempts.map((a) => [a.engine, a.resume, a.end?.state])).toEqual([[E1, false, 'failed'], [E2, true, 'done']])
    const quota = turnsOf(sample('add-csv-export-to-orders'))[1]
    expect(quota.attempts.map((a) => [a.rule, a.resume])).toEqual([['stay', false], ['provider', true]])
    expect(quota.effect).toBe('some')
  })
  it('effectOf: the quota failure of the sample had an effect (two steps since running)', () => {
    const events = sample('add-csv-export-to-orders')
    const before = events.slice(0, events.findIndex((e) => e.type === 'turn' && e.turn === 2 && e.state === 'failed'))
    expect(effectOf(before, 2)).toBe('some')
    const justRunning = events.slice(0, events.findIndex((e) => e.type === 'turn' && e.turn === 2 && e.state === 'running') + 1)
    expect(effectOf(justRunning, 2)).toBe('none')
  })
  it('the preface is signed, says what was asked and the steps, and warns about steps outside the folder', () => {
    const events = sample('add-csv-export-to-orders')
    const upTo = events.slice(0, events.findIndex((e) => e.type === 'turn' && e.turn === 2 && e.state === 'assigned' && e.attempt === 2))
    const thread = (events[0] as { thread: string }).thread
    const text = preface(thread, upTo, 2)
    expect(text.startsWith(`${prefaceSign(thread)} You are continuing turn 2`)).toBe(true)
    expect(text).toContain('(quota)')
    const asked = upTo.find((e) => e.type === 'turn' && e.turn === 2 && e.state === 'accepted') as { message: string }
    expect(text).toContain((upTo.find((e) => e.id === asked.message) as { text: string }).text)
    expect(text).toContain('- Read · src/orders/export.ts')
    expect(text).toContain('Do not repeat a step that acts outside this folder')
  })
})
