// The snapshot says how many open requests wait on the person (`asksWaiting`, beside `asksOpen`): the side bar of
// weevils next shows it on its requests band. Counted by the requests list's own rule (shared/request-chip.ts)
// against the sessions the snapshot itself lists; absent where there is no ledger.
// Same harness as lifecycle.test.ts: tmux is simulated, the timers are fake.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tool } from '../shared/api.ts'

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
vi.mock('./asks-judge.ts', () => ({ judgeAsk: async () => null }))
vi.mock('./titles.ts', async (orig) => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))

const { Weevils } = await import('./core.ts')
const { DATA_DIR, HOME } = await import('./config.ts')
const { Ledger } = await import('./boss-ledger.ts')
const { chipOf, stateIn } = await import('../shared/request-chip.ts')
type Transcript = import('./transcripts.ts').Transcript

const NOW = Date.parse('2026-11-09T12:00:00Z')
const MIN = 60_000
const cwd = path.join(HOME, 'projects', 'shop-app')
fs.mkdirSync(cwd, { recursive: true })
const ALIVE = process.pid

let w: InstanceType<typeof Weevils>

function transcript(over: Partial<Transcript> = {}): Transcript {
  const id = over.id ?? 's1'
  return { id, tool: 'claude', file: `/nowhere/${id}.jsonl`, cwd, openedAt: NOW - 2 * MIN, lastActivityAt: NOW - MIN, workStartedAt: null, phase: 'idle', firstPrompt: 'check the prices', messages: [{ id: `${id}-m0`, role: 'user', text: 'check the prices', at: NOW - MIN }], subagents: [], offset: 0, partial: '', queued: [], ...over }
}
const add = (t: Transcript) => (w.store.byFile.set(t.file, t), t)
const pane = (sessionId: string) => ({ name: `wv-shop-${sessionId}`, tool: 'claude' as Tool, sessionId, title: 't', cwd, createdAt: NOW - MIN })
/** A ledger of its own, in a folder of its own: the tests run with no orchestrator, so the server has none. */
const ledger = () => new Ledger({
  dir: fs.mkdtempSync(path.join(os.tmpdir(), 'asks-waiting-')),
  model: async () => '{"messages":[],"new_goals":[]}',
  host: { sessions: () => w.sessions(), detail: async () => { throw new Error('not read here') }, turnRunning: () => false, journal: () => [], lang: () => 'en', user: () => 'alex' },
})

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

it('no ledger on this machine: neither count is in the snapshot', () => {
  expect(w.ledger).toBeNull()
  const snap = w.snapshot()
  expect(snap.asksOpen).toBeUndefined()
  expect(snap.asksWaiting).toBeUndefined()
})

it('a ledger with nothing waiting says 0, never nothing', () => {
  w.ledger = ledger()
  w.ledger.add('Write the welcome page')
  expect(w.snapshot()).toMatchObject({ asksOpen: 1, asksWaiting: 0 })
})

it('counts the open requests that need the person, read against the sessions of this very snapshot', () => {
  // s1 waits on a permission, s2 is at work; « gone » was sent to a session that no longer exists.
  add(transcript({ id: 's1' }))
  add(transcript({ id: 's2', phase: 'working' }))
  w.panes = [pane('s1'), pane('s2')]
  w.hooks.set('s1', { event: 'SessionStart', at: NOW - MIN, pid: ALIVE })
  w.hook({ session_id: 's1', hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' })

  const l = (w.ledger = ledger())
  const waits = l.add('Pick a colour for the shop')
  l.link(waits.id, 's1')
  l.link(l.add('Confirm the delivery date').id, 's1')
  // A question on record, but its session is working on it again: running, nobody waited on.
  const running = l.add('Fix the checkout link')
  l.link(running.id, 's2')
  running.dispatches[0].outcome = 'question'
  const lost = l.add('Choose the photo for the home page')
  l.link(lost.id, 'gone')
  lost.dispatches[0].outcome = 'question'
  l.add('Write the welcome page')
  const closed = l.add('Rename the shop')
  l.link(closed.id, 'gone')
  closed.dispatches[0].outcome = 'question'
  l.setStatus(closed.id, 'done', 'user')

  w.bump()
  const snap = w.snapshot()
  expect(snap.sessions.find((s) => s.id === 's1')?.status).toBe('needs_user')
  expect(snap.sessions.find((s) => s.id === 's2')?.status).toBe('working')
  expect(snap).toMatchObject({ asksOpen: 5, asksWaiting: 3 })
  // The same rows the requests list marks « needs you », with the snapshot's own sessions.
  const rows = l.view().asks
  const state = stateIn(rows, snap.sessions)
  expect(rows.filter((a) => chipOf(a, state(a)) === 'needs').map((a) => a.text).sort()).toEqual(['Choose the photo for the home page', 'Confirm the delivery date', 'Pick a colour for the shop'])

  // Answered: the request closes, the next snapshot counts one fewer.
  l.setStatus(waits.id, 'done', 'user')
  w.bump()
  expect(w.snapshot()).toMatchObject({ asksOpen: 4, asksWaiting: 2 })
})
