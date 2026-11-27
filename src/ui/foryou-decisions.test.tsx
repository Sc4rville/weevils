// @vitest-environment happy-dom
// A « decisions » post in the stream: one post, each decision a short question with what to tap as links, a list to
// tick and send, and an answered one that says so. A tap calls the decide route with the picked ids.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import type { ForYouItem } from '../../shared/foryou.ts'

const srv = vi.hoisted(() => ({ calls: [] as string[], fail: '' }))
vi.mock('../api', () => ({
  api: {
    foryou: async () => ({ rev: 1, items: [], pulse: { working: 0, waiting: 0, delivered: 0, auto: 0 } }),
    foryouSeen: async () => ({ ok: true }),
    foryouDecide: async (id: string, decision: string, choices: string[]) => {
      srv.calls.push(`decide ${id} ${decision} ${choices.join('+') || '-'}`)
      if (srv.fail) throw new Error(srv.fail)
      return { ok: true as const }
    },
  },
}))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { ForYouItemView } = await import('./foryou')
const { formatOf, streamOf } = await import('./foryou-format')
const { resetForYou } = await import('./foryou-store')
const { Ctx } = await import('./app-context')
const { setLang } = await import('../i18n')

const NOW = Date.now()
const POST: ForYouItem = {
  id: 'q:1', kind: 'boss', tone: 'question', who: 'weevboss', at: NOW - 60_000, title: '2 decisions for you', text: 'Tap an answer and it goes straight back to where it waits.', reply: 'boss', open: { page: 'boss' },
  decisions: [
    { id: 'ad-factory', from: 'Ad factory', question: 'Resume the ad factory?', note: 'About $0.25 an hour while it runs.', choices: [{ id: 'c1', label: 'Yes, resume' }, { id: 'c2', label: 'Keep it stopped' }], open: { page: 'session', id: 's1' } },
    { id: 'night-ideas', from: 'Night lens', question: 'Which of the three ideas should be built?', many: true, choices: [{ id: 'c1', label: 'Actions behind a message' }, { id: 'c2', label: 'Proof under the last report' }, { id: 'c3', label: 'Memory summarised' }] },
  ],
}
const snap = (): Snapshot => ({
  version: 1, now: NOW, machines: [{ id: 'm', name: 'm' }], projects: [], sessions: [{ id: 's1', projectId: 'shop', title: 'Ad batches', status: 'done', machineId: 'm' }], h24: [], conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false, mainHasScreen: false, mainQueued: 0,
  devil: { enabled: false, working: false }, pinnedRepos: [], config: { userName: '', exposeDomain: '', publicHost: 'app.example', authors: [] }, foryou: { rev: 1, unseen: 0 },
}) as unknown as Snapshot

let root: Root
let host: HTMLElement
let pushed: unknown[]
function render(item: ForYouItem) {
  const ctx = { snap: snap(), now: NOW, offline: false, colors: {}, push: (p: unknown) => pushed.push(p), replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} }
  act(() => root.render(<Ctx.Provider value={ctx as never}><ForYouItemView item={item} /></Ctx.Provider>))
}
const section = (name: string) => host.querySelector(`section[aria-label="${name}"]`)!
const button = (within: Element, name: string) => [...within.querySelectorAll('button')].find((b) => b.textContent === name)!
/** What an answered decision says: one line per pick. */
const said = (within: Element) => [...within.querySelectorAll('.fy-dec-said li')].map((li) => li.textContent)
const tap = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  resetForYou()
  srv.calls = []
  srv.fail = ''
  pushed = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('one post: its counted title, then each decision with where it waits, its question and its answers as links', () => {
  render(POST)
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.querySelector('.fy-post-t')?.textContent).toBe('2 decisions for you')
  const ad = section('Resume the ad factory?')
  expect(ad.querySelector('.fy-dec-from')?.textContent).toBe('Ad factory')
  expect(ad.querySelector('.fy-dec-note')?.textContent).toBe('About $0.25 an hour while it runs.')
  expect([...ad.querySelectorAll('.fy-dec-pick')].map((b) => b.textContent)).toEqual(['Yes, resume', 'Keep it stopped'])
  const ideas = section('Which of the three ideas should be built?')
  expect([...ideas.querySelectorAll('input[type=checkbox]')]).toHaveLength(3)
  expect([...ideas.querySelectorAll('.fy-dec-pick')].map((b) => b.textContent)).toEqual(['Send my pick', 'None of these'])
  // No raw markdown, no id, no technical word in what is read.
  expect(host.textContent).not.toMatch(/\*\*|`|ad-factory|c1|session/)
})

it('a tap on an answer sends it and the line says what was answered, with nothing left to tap', async () => {
  render(POST)
  await tap(button(section('Resume the ad factory?'), 'Keep it stopped'))
  expect(srv.calls).toEqual(['decide q:1 ad-factory c2'])
  const ad = section('Resume the ad factory?')
  expect(said(ad)).toEqual(['✓ Keep it stopped'])
  expect(ad.querySelectorAll('.fy-dec-pick')).toHaveLength(0)
  expect(ad.querySelector('.fy-dec-note')).toBeNull()
  // The other decision is untouched.
  expect(section('Which of the three ideas should be built?').querySelectorAll('input[type=checkbox]')).toHaveLength(3)
})

it('a list is ticked, then sent together; nothing ticked, nothing to send but « none of these »', async () => {
  render(POST)
  const ideas = section('Which of the three ideas should be built?')
  expect(button(ideas, 'Send my pick').disabled).toBe(true)
  const boxes = [...ideas.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
  await tap(boxes[2])
  await tap(boxes[0])
  expect(button(ideas, 'Send my 2 picks').disabled).toBe(false)
  await tap(button(ideas, 'Send my 2 picks'))
  expect(srv.calls).toEqual(['decide q:1 night-ideas c3+c1'])
  expect(said(section('Which of the three ideas should be built?'))).toEqual(['✓ Actions behind a message', '✓ Memory summarised'])
})

it('« none of these » is sent as an empty answer', async () => {
  render(POST)
  await tap(button(section('Which of the three ideas should be built?'), 'None of these'))
  expect(srv.calls).toEqual(['decide q:1 night-ideas -'])
  expect(said(section('Which of the three ideas should be built?'))).toEqual(['✓ None of these'])
})

it('refused by the server: the answers come back to tap, with the reason', async () => {
  srv.fail = 'the session could not be reached'
  render(POST)
  await tap(button(section('Resume the ad factory?'), 'Yes, resume'))
  const ad = section('Resume the ad factory?')
  expect(ad.querySelector('[role=alert]')?.textContent).toBe('the session could not be reached')
  expect(ad.querySelectorAll('.fy-dec-pick')).toHaveLength(2)
})

it('where it waits opens that conversation', async () => {
  render(POST)
  await tap(section('Resume the ad factory?').querySelector('button.fy-dec-from')!)
  expect(pushed).toEqual([{ kind: 'session', id: 's1' }])
  // No conversation to open: its name is plain words.
  expect(section('Which of the three ideas should be built?').querySelector('button.fy-dec-from')).toBeNull()
})

it('answered on the server: shown as answered; an open post never goes stale, an answered one is a short record', () => {
  const answered: ForYouItem = { ...POST, title: 'All answered', text: 'Each answer went back to where it was waited for.', decisions: POST.decisions!.map((d) => ({ ...d, answer: { choices: d.many ? [] : ['c1'], at: NOW } })) }
  render(answered)
  expect([...host.querySelectorAll('.fy-dec-said li')].map((p) => p.textContent)).toEqual(['✓ Yes, resume', '✓ None of these'])
  expect(host.querySelectorAll('.fy-dec-pick, input')).toHaveLength(0)
  expect(formatOf(POST)).toBe('action')
  expect(formatOf(answered)).toBe('note')
  const old = NOW - 10 * 86_400_000
  expect(streamOf([{ ...POST, at: old }], 60, true, NOW).map((i) => i.id)).toEqual(['q:1'])
  expect(streamOf([{ ...answered, at: old }], 60, true, NOW)).toEqual([])
})
