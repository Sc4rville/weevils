// A session that is over and whose last message still ends on a real « Needs you: » line carries `asksYou` (what it
// asks), and stays done or idle: never needs_user, which notifies, makes a For you card and wakes weevboss.
// Same harness as lifecycle.test.ts: tmux is simulated, the timers are fake.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session, Tool } from '../shared/api.ts'

const mux = vi.hoisted(() => ({
  sendText: vi.fn(async (_name: string, _text: string) => {}),
  sendKey: vi.fn(async (_name: string, _key: string) => {}),
  capture: vi.fn(async (_name: string) => ''),
  spawnWv: vi.fn(async (..._args: unknown[]) => {}),
  killWv: vi.fn(async (_name: string) => {}),
  listWv: vi.fn(async () => [] as unknown[]),
  setOpt: vi.fn(async (..._args: unknown[]) => {}),
}))
vi.mock('./mux.ts', async (orig) => ({ ...(await orig<typeof import('./mux.ts')>()), ...mux }))
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
vi.mock('./fast.ts', () => ({ setCartesiaVoice() {} }))
// The question judge (Haiku) is replaced: here it refuses every candidate, so nothing becomes needs_user by itself.
vi.mock('./asks-judge.ts', () => ({ judgeAsk: async () => null }))
vi.mock('./titles.ts', async (orig) => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))

const { Weevils } = await import('./core.ts')
const { DATA_DIR, HOME } = await import('./config.ts')
const { offlineRow } = await import('./offline-machines.ts')
const { pageData } = await import('./page-band.ts')
const { rowState } = await import('./threads-app.ts')
const { ASK_MAX } = await import('../shared/asks.ts')
type Transcript = import('./transcripts.ts').Transcript
type Message = Transcript['messages'][number]

const NOW = Date.parse('2026-11-09T12:00:00Z')
const MIN = 60_000
const PANE = 'wv-shop-abc123'
const cwd = path.join(HOME, 'projects', 'shop-app')
fs.mkdirSync(cwd, { recursive: true })
const DEAD = spawnSync('true').pid

let w: InstanceType<typeof Weevils>

const said = (text: string, role: Message['role'] = 'assistant'): Message[] => [
  { id: 'u', role: 'user', text: 'check the prices', at: NOW - 2 * MIN },
  { id: 'a', role, text, at: NOW - MIN },
]
function transcript(over: Partial<Transcript> = {}): Transcript {
  const id = over.id ?? 's1'
  return { id, tool: 'claude', file: `/nowhere/${id}.jsonl`, cwd, openedAt: NOW - 2 * MIN, lastActivityAt: NOW - MIN, workStartedAt: null, phase: 'idle', firstPrompt: 'check the prices', messages: said('**Done:** nothing new.'), subagents: [], offset: 0, partial: '', queued: [], ...over }
}
const add = (t: Transcript) => (w.store.byFile.set(t.file, t), t)
/** Its process is gone (the pane closed after the run): the session is over, not assumed alive in some terminal. */
const over = (t: Transcript) => (w.hooks.set(t.id, { event: 'Stop', at: t.lastActivityAt, pid: DEAD }), add(t))
const pane = (over: Partial<(typeof w.panes)[number]> = {}) => ({ name: PANE, tool: 'claude' as Tool, sessionId: 's1', title: 't', cwd, createdAt: NOW - MIN, ...over })
const one = (id = 's1'): Session | undefined => w.sessions(Date.now()).find((s) => s.id === id)

const STOPPED = '**Stopped:** the budget for this run is spent.\n\n- 3 prices checked, 2 left.\n\n**Needs you:** tap Yes to resume, or Keep it stopped.'

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  for (const f of Object.values(mux)) f.mockReset()
  mux.capture.mockResolvedValue('')
  mux.listWv.mockResolvedValue([])
  fs.rmSync(path.join(DATA_DIR, 'state.json'), { force: true })
  w = new Weevils()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('a finished run whose last word is « Needs you: … » says what it asks, and stays done', () => {
  over(transcript({ messages: said(STOPPED) }))
  expect(one()).toMatchObject({ status: 'done', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
  expect(one()?.attention).toBeUndefined()
  expect(one()?.noticeId).toBeUndefined()
  expect(one()?.ask).toBeUndefined()
})

it('an idle one too (its screen still open, the question not confirmed as a live one)', () => {
  add(transcript({ messages: said(STOPPED) }))
  w.panes = [pane()]
  expect(one()).toMatchObject({ status: 'idle', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
})

it('nothing asked: no line, a line that says « nothing », or the person spoke last', () => {
  over(transcript({ messages: said('**Done:** the prices are in the table.') }))
  expect(one()).toMatchObject({ status: 'done' })
  expect(one()).not.toHaveProperty('asksYou')
  w.store.byFile.clear()
  over(transcript({ messages: said('**Done:** 2 prices updated.\n\n**Needs you:** nothing.') }))
  expect(one()).not.toHaveProperty('asksYou')
  w.store.byFile.clear()
  over(transcript({ messages: said(STOPPED, 'user') }))
  expect(one()).not.toHaveProperty('asksYou')
})

it('an event after the agent\'s message (a tool line) does not hide what it asked', () => {
  over(transcript({ messages: [...said(STOPPED), { id: 'e', role: 'event', text: 'session ended', at: NOW - MIN }] }))
  expect(one()).toMatchObject({ status: 'done', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
})

it('never while it works, and never once it was cut mid-work', () => {
  add(transcript({ messages: said(STOPPED), phase: 'working' }))
  w.panes = [pane({ screenWorking: true })]
  expect(one()).toMatchObject({ status: 'working' })
  expect(one()).not.toHaveProperty('asksYou')
  w.panes = []
  w.store.byFile.clear()
  over(transcript({ messages: said(STOPPED), phase: 'working' }))
  expect(one()).toMatchObject({ status: 'interrupted' })
  expect(one()).not.toHaveProperty('asksYou')
})

it('a long question is cut on a word, like every question shown', () => {
  const long = `please read ${'the report of the night and its numbers '.repeat(20)}then answer`
  over(transcript({ messages: said(`**Done:** checked.\n\n**Needs you:** ${long}`) }))
  const asks = one()?.asksYou ?? ''
  expect(asks.length).toBeLessThanOrEqual(ASK_MAX)
  expect(asks.endsWith('…')).toBe(true)
  expect(asks.startsWith('Please read the report')).toBe(true)
})

it('a row that takes its thread\'s state (working, paused) no longer asks: only a row left done or idle does', () => {
  over(transcript({ messages: said(STOPPED) }))
  const s = one()!
  expect(s).toMatchObject({ status: 'done', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
  /** The row as the app is sent it (JSON keeps no empty field). */
  const row = (state: Parameters<typeof rowState>[1]) => JSON.parse(JSON.stringify({ ...s, ...rowState(s, state) })) as Session
  // Its thread works: the row is a working one, and « asks » is only for a row that is over.
  expect(row('working')).toMatchObject({ status: 'working' })
  expect(row('working')).not.toHaveProperty('asksYou')
  // Its thread is paused: the row waits live (needs_user), which says more than a line of its last message.
  expect(row('paused')).toMatchObject({ status: 'needs_user' })
  expect(row('paused')).not.toHaveProperty('asksYou')
  // Its thread only waits for its turn, or it is in no thread: the row stays as it is, question included.
  expect(row('waiting')).toMatchObject({ status: 'done', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
  expect(row(undefined)).toMatchObject({ status: 'done', asksYou: 'Tap Yes to resume, or Keep it stopped.' })
})

it('a made page reads it; a machine that does not answer never shows it as waiting', () => {
  over(transcript({ messages: said(STOPPED) }))
  const s = one()!
  const d = pageData({ projects: [], sessions: [s], optimizers: [] } as never, []) as { sessions: { asksYou?: string }[] }
  expect(d.sessions[0].asksYou).toBe('Tap Yes to resume, or Keep it stopped.')
  expect(offlineRow(s).asksYou).toBeUndefined()
})

it('told settled from outside (answered elsewhere): the mark goes without a word to the agent, until its next message asks again', async () => {
  const t = over(transcript({ messages: said(STOPPED) }))
  expect(await w.question('s1', 'settled')).toEqual({ ok: true })
  expect(one()).toMatchObject({ status: 'done' })
  expect(one()).not.toHaveProperty('asksYou')
  expect(mux.sendText).not.toHaveBeenCalled()
  expect(mux.spawnWv).not.toHaveBeenCalled()
  // Kept across a restart.
  w = new Weevils()
  over(t)
  expect(one()).not.toHaveProperty('asksYou')
  // Its own words again.
  expect(await w.question('s1', 'reset')).toEqual({ ok: true, asksYou: 'Tap Yes to resume, or Keep it stopped.' })
  expect(one()).toMatchObject({ asksYou: 'Tap Yes to resume, or Keep it stopped.' })
  // Settled, then it speaks again and asks something new: that question is its own.
  await w.question('s1', 'settled')
  t.messages = [...t.messages, { id: 'u2', role: 'user', text: 'yes', at: NOW }, { id: 'a2', role: 'assistant', text: '**Done:** resumed.\n\n**Needs you:** pick the next shop to check.', at: NOW }]
  expect(one()).toMatchObject({ asksYou: 'Pick the next shop to check.' })
})

it('told in one plain sentence: the row shows it instead, cut like every question', async () => {
  over(transcript({ messages: said('**Verdict:** the code is short.\n\n**Needs you:** generating a new access code is the quickest fix.') }))
  expect(one()).toMatchObject({ asksYou: 'Generating a new access code is the quickest fix.' })
  expect(await w.question('s1', { text: '  Make a new access code?\nIt signs every device out. ' })).toEqual({ ok: true, asksYou: 'Make a new access code? It signs every device out.' })
  expect(one()).toMatchObject({ status: 'done', asksYou: 'Make a new access code? It signs every device out.' })
  await w.question('s1', { text: `Read ${'the long report '.repeat(40)}` })
  expect(one()!.asksYou!.length).toBeLessThanOrEqual(ASK_MAX)
})

it('nothing to tell of a session that asks nothing, or that is not known', async () => {
  over(transcript({ messages: said('**Done:** the prices are in the table.') }))
  await expect(w.question('s1', 'settled')).rejects.toMatchObject({ status: 409 })
  await expect(w.question('s1', { text: 'A question of my own?' })).rejects.toMatchObject({ status: 409 })
  await expect(w.question('nobody', 'settled')).rejects.toMatchObject({ status: 404 })
  expect(one()).not.toHaveProperty('asksYou')
})
