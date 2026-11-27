// A « decisions » post (server/foryou.ts publishDecisions, decide): the choices that are the person's alone, in one
// post. Each is answered with a tap, which records the answer and sends it back to where it waits: into its session as
// the person's own message, or to weevboss with what the pick asks for. Only the person's own tap answers.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Session, Snapshot } from '../shared/api.ts'
import { ForYou, arrange, openDecisions } from './foryou.ts'
import { setLang } from './i18n.ts'

const T0 = new Date('2026-11-10T09:00:00Z').getTime()
const MIN = 60_000
const S1 = 'aaaaaaaa-1111-4111-8111-111111111111'
const S2 = 'bbbbbbbb-2222-4222-8222-222222222222'
const session = (over: Partial<Session> = {}): Session =>
  ({ id: S1, projectId: 'shop', repo: 'shop', machineId: 'test', tool: 'claude', title: '[from:weevboss] Ad batches', status: 'done', cwd: '/home/u/projects/shop', lastActivityAt: T0, origin: 'weevils', controllable: true, live: false, background: 0, subagents: [], ...over }) as unknown as Session

let dir: string
let now: number
let snap: Snapshot
const newHost = () => ({
  snapshot: () => snap,
  bump: vi.fn(() => {}),
  detailAny: async () => undefined,
  send: vi.fn(async (id: string, _text: string, _from?: string, _thread?: string, _origin?: string) => ({ id })),
  sendMain: vi.fn(async (_text: string, _brief?: string) => ({ id: 'boss' })),
  resume: vi.fn(async (id: string) => ({ id })),
  close: vi.fn(async (): Promise<unknown> => ({ ok: true })),
  question: vi.fn(async (_id: string, _how: 'settled'): Promise<unknown> => ({ ok: true })),
  orchestratorId: 'boss' as string | null,
})
let host: ReturnType<typeof newHost>
const make = () => new ForYou(host, { file: path.join(dir, 'foryou.json'), now: () => now, dataDir: '/home/u/.local/share/weevils', machineId: 'test', later: () => undefined })

const AD = { id: 'ad-factory', from: 'Ad factory', question: 'Resume the ad factory?', note: 'About $0.25 an hour while it runs.', session: S1.slice(0, 8), to: 'session', choices: [{ label: 'Yes, resume', brief: 'Save the new world and start one batch.' }, { label: 'Keep it stopped', brief: 'Pause the automation too.' }] }
const IDEAS = { id: 'night-ideas', from: 'Night lens', question: 'Which of the three ideas should be built?', many: true, session: S2, ask: 'r12', choices: [{ label: 'Actions behind a message', brief: 'Build idea one.' }, { label: 'Proof under the last report', brief: 'Build idea two.' }, 'Memory summarised'] }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foryou-decisions-'))
  now = T0
  setLang('en')
  snap = { machines: [{ id: 'test', name: 'vps', online: true }], projects: [], sessions: [session(), session({ id: S2, title: 'Auditing the app', cwd: '/home/u/projects/.auto/shop/a1' })], optimizers: [], conversationCounts: { pending: 0 } } as unknown as Snapshot
  host = newHost()
})

it('one post for all of them: a counted title, each question with its answers, nothing of where the answers go', () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [AD, IDEAS] })
  expect(item).toMatchObject({ kind: 'boss', tone: 'question', who: 'weevboss', title: '2 decisions for you', text: 'Tap an answer and it goes straight back to where it waits.' })
  expect(item.decisions).toEqual([
    { id: 'ad-factory', from: 'Ad factory', question: 'Resume the ad factory?', note: 'About $0.25 an hour while it runs.', choices: [{ id: 'c1', label: 'Yes, resume' }, { id: 'c2', label: 'Keep it stopped' }], open: { page: 'session', id: S1 } },
    { id: 'night-ideas', from: 'Night lens', question: 'Which of the three ideas should be built?', many: true, choices: [{ id: 'c1', label: 'Actions behind a message' }, { id: 'c2', label: 'Proof under the last report' }, { id: 'c3', label: 'Memory summarised' }], open: { page: 'session', id: S2 } },
  ])
  expect(JSON.stringify(item)).not.toMatch(/Save the new world|Build idea|r12/)
  // In the stream, kept across a restart, and on top of the news.
  expect(fy.feed().items[0].id).toBe(item.id)
  expect(make().feed().items[0].decisions).toHaveLength(2)
  fy.post('A newer word from weevboss about something else entirely.')
  expect(fy.feed(now + MIN).items[0].id).toBe(item.id)
})

it('plain words only, a name when none is given, and what is not a decision is refused', () => {
  const fy = make()
  // Nothing to post, and no open post to tidy: refused.
  expect(() => fy.publishDecisions({ decisions: [] })).toThrow('no decision to post')
  const item = fy.publishDecisions({ text: '**Three** things only you can say.', decisions: [{ id: 'code', session: S1, question: '## Make a `new` access code?', choices: ['**Yes**', 'Not now'] }] })
  expect(item).toMatchObject({ title: '1 decision for you', text: 'Three things only you can say.' })
  expect(item.decisions![0]).toMatchObject({ from: 'Ad batches', question: 'Make a new access code?', choices: [{ id: 'c1', label: 'Yes' }, { id: 'c2', label: 'Not now' }] })
  for (const bad of [
    { id: 'Bad Id', question: 'A question?', choices: ['a', 'b'] },
    { id: 'no-question', question: ' ', choices: ['a', 'b'] },
    { id: 'one-answer', question: 'A question?', choices: ['a'] },
    { id: 'unknown', question: 'A question?', session: 'cccccccc', choices: ['a', 'b'] },
  ]) expect(() => fy.publishDecisions({ decisions: [bad] }), bad.id).toThrow()
  expect(() => fy.publishDecisions({ decisions: [AD, AD] })).toThrow()
})

it('a tap goes into the session that waits, as the person\'s own answer, and is recorded', async () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [AD, IDEAS] })
  await fy.decide(item.id, 'ad-factory', ['c2'], 'en', 'user')
  expect(host.send).toHaveBeenCalledWith(S1, 'You asked: "Resume the ad factory?"\nMy answer: Keep it stopped\n\nPause the automation too.', undefined, undefined, 'user')
  expect(host.sendMain).not.toHaveBeenCalled()
  const after = fy.feed().items.find((i) => i.id === item.id)!
  expect(after.title).toBe('1 decision for you')
  expect(after.decisions![0].answer).toEqual({ choices: ['c2'], at: now })
  expect(after.decisions![1].answer).toBeUndefined()
  // Answered once: a second tap changes nothing and sends nothing.
  await expect(fy.decide(item.id, 'ad-factory', ['c1'], 'en', 'user')).rejects.toThrow('already answered')
  expect(host.send).toHaveBeenCalledTimes(1)
})

it('a ticked list goes to weevboss with what each pick asks for, and the session that asked stops asking', async () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [IDEAS] })
  await fy.decide(item.id, 'night-ideas', ['c2', 'c1'], 'en', 'user')
  expect(host.send).not.toHaveBeenCalled()
  const [said, brief] = host.sendMain.mock.calls[0]
  expect(said).toBe('Which of the three ideas should be built?\n\n- Actions behind a message\n- Proof under the last report')
  expect(brief).toContain('it was waiting in: Night lens')
  expect(brief).toContain(`session ${S2}`)
  expect(brief).toContain('request r12')
  expect(brief).toContain('Build idea one.\nBuild idea two.')
  expect(host.question).toHaveBeenCalledWith(S2, 'settled')
  // All answered: a record, no longer on top, and the title says so.
  const done = fy.feed().items.find((i) => i.id === item.id)!
  expect(done).toMatchObject({ title: 'All answered' })
  expect(openDecisions(done)).toBe(false)
})

it('« none of these » is an answer too, for a list only', async () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [AD, IDEAS] })
  await fy.decide(item.id, 'night-ideas', [], 'en', 'user')
  expect(host.sendMain.mock.calls[0][0]).toBe('Which of the three ideas should be built?\nNone of these')
  await expect(fy.decide(item.id, 'ad-factory', [], 'en', 'user')).rejects.toThrow()
  await expect(fy.decide(item.id, 'ad-factory', ['c1', 'c2'], 'en', 'user')).rejects.toThrow()
  await expect(fy.decide(item.id, 'ad-factory', ['c9'], 'en', 'user')).rejects.toThrow()
  expect(host.send).not.toHaveBeenCalled()
})

it('only the person answers: never an agent, a script or the command line', async () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [AD] })
  await expect(fy.decide(item.id, 'ad-factory', ['c1'], 'en', undefined)).rejects.toThrow('only the person can answer')
  expect(host.send).not.toHaveBeenCalled()
  expect(fy.feed().items[0].decisions![0].answer).toBeUndefined()
})

it('not delivered, not recorded: the choices stay to tap; a session out of reach is answered through weevboss', async () => {
  const fy = make()
  const item = fy.publishDecisions({ decisions: [AD] })
  host.send.mockRejectedValueOnce(new Error('the session could not be reached'))
  await expect(fy.decide(item.id, 'ad-factory', ['c1'], 'en', 'user')).rejects.toThrow('could not be reached')
  expect(fy.feed().items[0].decisions![0].answer).toBeUndefined()
  snap = { ...snap, sessions: snap.sessions.map((s) => (s.id === S1 ? { ...s, controllable: false } : s)) }
  await fy.decide(item.id, 'ad-factory', ['c1'], 'en', 'user')
  expect(host.sendMain.mock.calls[0][0]).toBe('Resume the ad factory?\nYes, resume')
  expect(host.sendMain.mock.calls[0][1]).toContain('Save the new world and start one batch.')
})

it('publishing again adds to the open post, rewords what is unanswered, keeps what is answered; drop and replaces tidy up', async () => {
  const fy = make()
  const card = fy.post('Shall I resume the ad factory?', [{ label: 'Yes, resume', brief: 'resume it' }])
  const first = fy.publishDecisions({ decisions: [AD, IDEAS], replaces: [card.id] })
  // The card these decisions stand for is gone: one place to answer.
  expect(fy.feed().items.map((i) => i.id)).toEqual([first.id])
  await fy.decide(first.id, 'ad-factory', ['c1'], 'en', 'user')
  now += 10 * MIN
  const again = fy.publishDecisions({
    decisions: [
      { ...AD, question: 'Changed after the answer?' },
      { ...IDEAS, question: 'Which ideas do you want built?' },
      { id: 'code', question: 'Make a new access code?', choices: ['Yes', 'Not now'] },
    ],
  })
  expect(again.id).toBe(first.id)
  expect(again.title).toBe('2 decisions for you')
  expect(again.decisions!.map((d) => [d.id, d.question, !!d.answer])).toEqual([
    ['ad-factory', 'Resume the ad factory?', true],
    ['night-ideas', 'Which ideas do you want built?', false],
    ['code', 'Make a new access code?', false],
  ])
  expect(again.seen).toBeUndefined()
  expect(fy.decisions().map((d) => [d.id, d.answer])).toEqual([['ad-factory', ['Yes, resume']], ['night-ideas', undefined], ['code', undefined]])
  // Dropped: only what is still unanswered leaves.
  const less = fy.publishDecisions({ drop: ['code', 'ad-factory'] })
  expect(less.decisions!.map((d) => d.id)).toEqual(['ad-factory', 'night-ideas'])
  // All answered: the next publication is a new post.
  await fy.decide(first.id, 'night-ideas', ['c3'], 'en', 'user')
  now += MIN
  const next = fy.publishDecisions({ decisions: [{ id: 'code', question: 'Make a new access code?', choices: ['Yes', 'Not now'] }] })
  expect(next.id).not.toBe(first.id)
  expect(fy.feed().items.map((i) => i.id)).toEqual([next.id, first.id])
})

it('open decisions sit above the news, under what blocks; answered ones take their place in time', () => {
  const base = { kind: 'boss' as const, tone: 'neutral' as const, who: 'weevboss', text: 'x' }
  const open = { ...base, id: 'q:1', at: 10, decisions: [{ id: 'a', question: 'q', choices: [] }] }
  const done = { ...base, id: 'q:0', at: 5, decisions: [{ id: 'a', question: 'q', choices: [], answer: { choices: [], at: 6 } }] }
  const news = { ...base, id: 'b:1', at: 20 }
  const alert = { ...base, id: 'a:1', kind: 'alert' as const, at: 1 }
  expect(arrange([done, news, open, alert], 100).map((i) => i.id)).toEqual(['a:1', 'q:1', 'b:1', 'q:0'])
})
