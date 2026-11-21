import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '../shared/api.ts'
import type { Ask } from '../shared/ledger.ts'
import { BossWakeups, DAILY_LIMIT, MAX_DELAY_MS, QUIET_MS, SELF_CHECK_MS, wakeContext, safeToResume, schedulerOwnsStop, SILENT_OUTCOME, silentOutcome } from './boss-wakeups.ts'
import { BossTurns } from './boss-turns.ts'
import { BossJournal, entriesOfLine } from './boss-view.ts'
import { setSpeedModeSource, speedMode } from './request-handling.ts'
import { isSetupKey } from '../shared/setup.ts'

const T = Date.UTC(2026, 10, 17, 10)
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wakeups-'))
const session = (extra: Partial<Session> = {}): Session => ({ id: 's1', machineId: 'main', projectId: 'demo', cwd: '/demo', status: 'working', lastActivityAt: T, subagents: [], background: 0, queued: 0, controllable: true, live: false, ...extra } as Session)
const ask = (extra: Partial<Ask> = {}): Ask => ({ id: 'r1', status: 'open', progressAt: T, text: 'Check the preview', src: 'message-1', from: 'codex', dispatches: [], ...extra } as Ask)
afterEach(() => { delete process.env.WEEVILS_BOSS_PROACTIVE; delete process.env.WEEVILS_SPEED_MODE; setSpeedModeSource(() => undefined) })

describe('durable wake-up batching', () => {
  it('baselines history, detects short completed turns and replays only once after restart', () => {
    const root = dir(), w = new BossWakeups(root)
    w.observe([session({ status: 'idle', lastMessage: 'old result' })], [], T)
    expect(w.pending).toHaveLength(0)
    w.observe([session({ status: 'idle', lastActivityAt: T + 1, lastMessage: 'new result' })], [], T + 1)
    expect(w.pending.map((e) => e.kind)).toEqual(['completion'])
    expect(w.ready('cruise', T + QUIET_MS)).toBe(false)
    expect(w.ready('cruise', T + QUIET_MS + 1)).toBe(true)
    const again = new BossWakeups(root)
    expect(again.pending).toHaveLength(1)
    again.claim('turn-1', true, T + QUIET_MS + 1)
    const restarted = new BossWakeups(root)
    restarted.observe([session({ status: 'done', lastActivityAt: T + 1, lastMessage: 'new result' })], [], T + QUIET_MS + 2)
    expect(restarted.pending).toHaveLength(0)
    expect(restarted.claims[0].id).toBe('turn-1')
  })
  it('never wakes historical questions or interruptions on the second scan, but catches newly discovered work', () => {
    const w = new BossWakeups(dir())
    const historical = [session({ id: 'question', status: 'needs_user', attention: 'Old question', noticeId: 'old-q' }), session({ id: 'cut', status: 'interrupted', noticeId: 'old-cut', interrupted: { at: T, reason: 'died' } })]
    w.observe(historical, [], T)
    w.observe(historical, [], T + 5000)
    expect(w.pending).toHaveLength(0)
    w.observe([...historical, session({ id: 'new', status: 'needs_user', attention: 'New question', lastActivityAt: T + 1000, noticeId: 'new-q' })], [], T + 10_000)
    expect(w.pending.map((e) => e.key)).toEqual(['new-q'])
  })
  it('batches a burst with a ten-minute ceiling, rather than extending forever', () => {
    const w = new BossWakeups(dir())
    w.observe([session()], [], T)
    for (let i = 1; i <= 6; i++) w.observe([session({ status: 'needs_user', noticeId: `q${i}`, attention: 'Which colour?', lastActivityAt: T + i })], [], T + (i - 1) * 120_000)
    expect(w.pending).toHaveLength(1) // older questions are superseded
    // Separate sessions keep separate current observations in a continuous burst.
    const x = new BossWakeups(dir()), sessions = Array.from({ length: 7 }, (_, i) => session({ id: `s${i}` }))
    x.observe(sessions, [], T)
    for (let i = 0; i < 6; i++) { sessions[i] = { ...sessions[i], status: 'idle', lastMessage: 'Preview ready', lastActivityAt: T + i + 1 }; x.observe(sessions, [], T + i * 120_000) }
    expect(x.ready('cruise', T + MAX_DELAY_MS - 1)).toBe(false)
    expect(x.ready('cruise', T + MAX_DELAY_MS)).toBe(true)
    expect(x.claim('batch', true, T + MAX_DELAY_MS)).toHaveLength(6)
  })
  it('confirms questions, drops answered events, retains interruption identity and stale source/author', () => {
    const w = new BossWakeups(dir())
    w.observe([session()], [], T)
    w.observe([session({ status: 'needs_user' })], [], T + 1)
    expect(w.pending).toHaveLength(0)
    w.observe([session({ status: 'needs_user', attention: 'Approve the draft?', noticeId: 'question-1' })], [], T + 2)
    expect(w.pending[0].key).toBe('question-1')
    w.observe([session({ status: 'working' })], [], T + 3)
    expect(w.pending).toHaveLength(0)
    w.observe([session({ status: 'interrupted', noticeId: 'cut-1', interrupted: { reason: 'api', at: T + 4 } })], [ask()], T + 86400_000)
    expect(w.pending.map((e) => e.kind)).toEqual(['interruption', 'stale'])
    expect(w.pending[1]).toMatchObject({ request: 'r1', source: 'message-1', author: 'codex' })
    w.claim('one', false, T + 86400_000)
    w.observe([session({ status: 'interrupted', noticeId: 'cut-1', interrupted: { reason: 'api', at: T + 4 } })], [ask()], T + 86400_001)
    expect(w.pending).toHaveLength(0)
  })
  it('enforces the persisted cap, UTC reset, disabled switch and both mode gates', () => {
    const root = dir(), w = new BossWakeups(root)
    w.observe([session()], [], T)
    for (let i = 0; i < DAILY_LIMIT; i++) {
      w.observe([session({ status: 'needs_user', attention: 'Choose', noticeId: `q${i}`, lastActivityAt: T + i })], [], T + i)
      expect(w.claim(`t${i}`, true, T + i)).toHaveLength(1)
    }
    const again = new BossWakeups(root)
    again.observe([session({ status: 'needs_user', attention: 'Choose', noticeId: 'next', lastActivityAt: T + 10 })], [], T + 10)
    expect(again.ready('cruise', T + QUIET_MS + 10)).toBe(false)
    expect(again.claim('over-cap', true, T + QUIET_MS + 10)).toEqual([])
    expect(again.ready('cruise', T + 86400_000)).toBe(true)
    expect(again.ready('pause', T + 86400_000)).toBe(false)
    expect(again.ready('veille', T + 86400_000)).toBe(false)
    process.env.WEEVILS_BOSS_PROACTIVE = '0'
    expect(again.ready('cruise', T + 86400_000)).toBe(false)
    expect(isSetupKey('WEEVILS_BOSS_PROACTIVE')).toBe(true)
    expect(isSetupKey('WEEVILS_SPEED_MODE')).toBe(true)
    process.env.WEEVILS_SPEED_MODE = 'pause'
    expect(speedMode()).toBe('pause')
    setSpeedModeSource(() => 'veille')
    expect(speedMode()).toBe('veille')
  })
  it('retains failed pre-launch triage with backoff, and fails closed on corrupt state', () => {
    const root = dir(), w = new BossWakeups(root)
    w.observe([session()], [], T)
    w.observe([session({ status: 'idle', lastMessage: 'Ready' })], [], T + 1)
    w.claim('triage', true, T + QUIET_MS + 1)
    w.defer('triage', T + QUIET_MS + 1)
    expect(w.ready('cruise', T + QUIET_MS + 2)).toBe(false)
    expect(w.used(T)).toBe(1)
    expect(new BossWakeups(root).pending).toHaveLength(1)
    fs.writeFileSync(path.join(root, 'wakeups.json'), '{broken')
    expect(() => new BossWakeups(root)).toThrow()
  })
})

describe('safe follow-through', () => {
  const cut = () => session({ status: 'interrupted', interrupted: { at: T, reason: 'died' }, noticeId: 'cut' })
  it('permits only a stopped authorized ordinary session without conflicts or surviving jobs', () => {
    expect(safeToResume(cut(), [], 'cruise', false)).toBe(true)
    for (const extra of [{ live: true }, { queued: 1 }, { background: 1 }, { controllable: false }, { status: 'needs_user' }, { relayOf: 'source' }, { relayedBy: 'target' }, { sourceAccess: { canExecute: false } }, { subagents: [{ status: 'working' }] }])
      expect(safeToResume({ ...cut(), ...extra } as Session, [], 'cruise', false)).toBe(false)
    for (const reason of ['quota', 'auth', 'dirty'] as const) expect(safeToResume({ ...cut(), interrupted: { at: T, reason } }, [], 'cruise', false)).toBe(false)
    expect(safeToResume(cut(), [session({ id: 'conflict' })], 'cruise', false)).toBe(false)
    expect(safeToResume(cut(), [], 'pause', false)).toBe(false)
    expect(safeToResume(cut(), [], 'veille', false)).toBe(false)
    expect(safeToResume(cut(), [], 'cruise', true)).toBe(false)
    process.env.WEEVILS_BOSS_PROACTIVE = '0'
    expect(safeToResume(cut(), [], 'cruise', false)).toBe(false)
  })
  it('ties automation restrictions to a proven run and permits later ordinary human work', () => {
    const s = cut()
    expect(schedulerOwnsStop(s, [{ sessionId: s.id, state: 'running', runs: [] }])).toBe(true)
    const history = [{ sessionId: s.id, state: 'done', runs: [{ sessionId: s.id, startedAt: T - 1000, at: T + 1000 }] }]
    expect(schedulerOwnsStop(s, history)).toBe(true)
    expect(schedulerOwnsStop({ ...s, lastActivityAt: T + 5000, interrupted: { reason: 'died', at: T + 5000 } }, history)).toBe(false)
  })
  it('never repeats a reserved resumption after uncertain delivery or restart', () => {
    const root = dir()
    expect(new BossWakeups(root).reserveResume('cut-1')).toBe(true)
    expect(new BossWakeups(root).reserveResume('cut-1')).toBe(false)
    expect(new BossWakeups(root).reserveResume('cut-2')).toBe(true)
    const launches = new BossWakeups(root)
    for (let i = 0; i < DAILY_LIMIT; i++) expect(launches.reserveLaunch(`launch-${i}`, T)).toBe(true)
    expect(new BossWakeups(root).reserveLaunch('ninth', T)).toBe(false)
    expect(new BossWakeups(root).reserveLaunch('next-day', T + 86400_000)).toBe(true)
  })
})

it('keeps synthetic context and silent outcomes out of remembered history without deleting raw messages', async () => {
  expect(silentOutcome(SILENT_OUTCOME)).toBe(true)
  expect(silentOutcome(`Nothing useful remains.\n\n${SILENT_OUTCOME}`)).toBe(true)
  expect(silentOutcome('```\n' + SILENT_OUTCOME + '\n```')).toBe(false)
  expect(silentOutcome(`Use ${SILENT_OUTCOME} when quiet`)).toBe(false)
  const line = { uuid: 'm1', timestamp: new Date(T).toISOString(), type: 'assistant', message: { content: [{ type: 'text', text: SILENT_OUTCOME }] } }
  expect(entriesOfLine(line)).toEqual([])
  expect(line.message.content[0].text).toBe(SILENT_OUTCOME)
  const root = dir(), w = new BossWakeups(root)
  w.observe([session()], [], T)
  w.observe([session({ status: 'idle', lastMessage: 'Ready' })], [], T + 1)
  const events = w.claim('batch', true, T + QUIET_MS + 1)
  const turns = new BossTurns(async () => '{}', root, path.join(root, 'transcripts'))
  turns.choose('opus', 'high')
  turns.enqueue('', undefined, events, true)
  const p = await turns.prepare({ id: 'proactive', claude: ['claude'], memory: '', instructions: 'Review results.' })
  expect(p.command.slice(p.command.indexOf('--model'), p.command.indexOf('--model') + 2)).toEqual(['--model', 'sonnet'])
  expect(p.command.slice(p.command.indexOf('--effort'), p.command.indexOf('--effort') + 2)).toEqual(['--effort', 'low'])
  const prompt = fs.readFileSync(p.command[p.command.indexOf('weevboss-turn') + 1], 'utf8')
  expect(entriesOfLine({ ...line, type: 'user', message: { content: prompt } })).toEqual([])
  turns.enqueue('Show me the preview', 'capture-1')
  expect(turns.preferUser()).toBe(true)
  expect(turns.queue).toHaveLength(1)
  expect(turns.queue[0]).toMatchObject({ text: 'Show me the preview', cid: 'capture-1', events })
  const user = await turns.prepare({ id: 'user', claude: ['claude'], memory: '', instructions: '' })
  expect(user.command.slice(user.command.indexOf('--model'), user.command.indexOf('--model') + 2)).toEqual(['--model', 'opus'])
  const again = new BossTurns(async () => '{}', root, path.join(root, 'transcripts'))
  expect(again.queue[0].events).toEqual(events)
})

it('omits an already-cached silent outcome when rebuilding remembered history after restart', () => {
  const root = dir()
  const raw = JSON.stringify({ id: 'old', at: T, role: 'assistant', text: `No useful result.\n\n${SILENT_OUTCOME}` }) + '\n'
  fs.writeFileSync(path.join(root, 'journal.jsonl'), raw)
  const journal = new BossJournal(path.join(root, 'transcripts'), root)
  journal.sync()
  expect(journal.entries()).toHaveLength(0)
  expect(fs.readFileSync(path.join(root, 'journal.jsonl'), 'utf8')).toBe(raw)
})

describe('what wakes weevboss, and the self-check', () => {
  it('wakes on results and questions of its own dispatched sessions only, on cuts of any session, never on automation runs', () => {
    const w = new BossWakeups(dir())
    const all = [session({ id: 'mine' }), session({ id: 'yours' }), session({ id: 'auto' })]
    const scope = { dispatched: new Set(['mine']), automated: (id: string) => id === 'auto' }
    w.observe(all, [], T, scope)
    const done = (id: string) => session({ id, status: 'idle', lastActivityAt: T + 1, lastMessage: 'Finished.' })
    w.observe([done('mine'), done('yours'), done('auto')], [], T + 1, scope)
    expect(w.pending.map((e) => e.session)).toEqual(['mine'])
    w.observe([done('mine'), session({ id: 'yours', status: 'interrupted', lastActivityAt: T + 2, noticeId: 'cut-1', interrupted: { at: T + 2, reason: 'died' } }), session({ id: 'auto', status: 'interrupted', lastActivityAt: T + 2, interrupted: { at: T + 2, reason: 'died' } })], [], T + 2, scope)
    expect(w.pending.map((e) => `${e.kind}:${e.session}`)).toEqual(['completion:mine', 'interruption:yours'])
  })
  it('asks itself at most every 2 hours, queues an event only when something new waits, and never brings the same item twice', () => {
    const root = dir(), w = new BossWakeups(root)
    const merge = { key: 'fy:b:1', summary: 'For you · Tonight\'s cleanup [buttons: Merge the cleanup]' }
    expect(w.selfCheck([merge], T)).toBe(true)
    expect(w.pending[0]).toMatchObject({ kind: 'selfcheck' })
    expect(w.pending[0].summary).toContain('[new] For you · Tonight\'s cleanup [buttons: Merge the cleanup]')
    w.claim('turn', true, T)
    // Too soon, then nothing new: no event, no model.
    expect(w.selfCheck([merge, { key: 'x', summary: 'x' }], T + SELF_CHECK_MS - 1)).toBe(false)
    expect(new BossWakeups(root).selfCheck([merge], T + SELF_CHECK_MS)).toBe(false)
    expect(new BossWakeups(root).pending).toHaveLength(0)
    const later = new BossWakeups(root)
    expect(later.selfCheck([merge, { key: 'fy:c:2', summary: 'For you · Land it' }], T + 2 * SELF_CHECK_MS)).toBe(true)
    expect(later.pending[0].summary).toBe('For you · Tonight\'s cleanup [buttons: Merge the cleanup] · [new] For you · Land it')
  })
  it('remembers which event-only turns were pushed to the phone', () => {
    const root = dir(), w = new BossWakeups(root)
    w.selfCheck([{ key: 'k', summary: 'Waiting' }], T)
    w.claim('turn-1', true, T)
    expect(w.untold(T)).toEqual([])
    w.reserveLaunch('turn-1', T)
    expect(w.untold(T + 1)).toEqual(['turn-1'])
    w.markTold('turn-1')
    expect(new BossWakeups(root).untold(T + 2)).toEqual([])
  })
  it('puts the waiting items in the turn context with the self-check questions', () => {
    const text = wakeContext([], 'cruise', [{ key: 'k', summary: 'For you · Repo Hygienist [buttons: Land it]' }])
    expect(text).toContain('Self-check, what is waiting on the person right now')
    expect(text).toContain('[buttons: Land it]')
  })
})
