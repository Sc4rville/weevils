// @vitest-environment happy-dom
// Requests: one band per request (what runs on top, then the newest first, every state), a star on what runs, a small
// bar for how far it is, « needs you » in words when what is left is the user's; opened in place, a session whose name
// was never recorded says « a session », never a raw id.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerView } from '../../shared/ledger.ts'
import type { Snapshot } from '../../shared/api.ts'

const NOW = 1_800_000_000_000
const view: LedgerView = {
  goals: [],
  asks: [
    { id: 'r8', text: 'Shorten the onboarding', quote: 'refais l onboarding', src: 'm2', from: 'user', at: NOW - 120_000, kind: 'task', status: 'open', dispatches: [], progressAt: NOW - 120_000, stale: false, handling: 'queued', why: 'you-said-later', more: [{ src: 'm3', quote: 'pc', at: NOW - 100_000, from: 'user' }] },
    { id: 'r9', text: 'Pick a colour', quote: 'which colour', src: 'm4', from: 'user', at: NOW - 3 * 86400_000, kind: 'task', status: 'dispatched', dispatches: [{ session: 'bb', at: NOW - 3 * 86400_000, outcome: 'done' }, { session: 'aa', at: NOW - 3 * 86400_000, outcome: 'question', report: 'Blue or green?', reportAt: NOW - 2 * 86400_000 }], progressAt: NOW - 2 * 86400_000, stale: true },
    { id: 'r6', text: 'Old done thing', quote: 'x', src: 'm0', from: 'user', at: NOW - 3600_000, kind: 'task', status: 'done', closedAt: NOW - 600_000, closedBy: 'auto', dispatches: [], progressAt: NOW - 600_000, stale: false },
    { id: 'r7', text: 'Fix the login page', quote: 'fix the login', src: 'm1', from: 'user', at: NOW - 60_000, kind: 'task', status: 'dispatched', dispatches: [{ session: '0a1b2c3d4e5f6789', at: NOW - 50_000 }], progressAt: NOW - 50_000, stale: false }],
  pending: [],
  trace: [],
  knowledge: [],
  digestTokens: 0,
}
vi.mock('../api', () => ({ api: { ledger: async () => view, askAction: async () => ({}) } }))
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const { setLang } = await import('../i18n')
const { RequestsPage, chipOf, columnOf, groupsOf, isModelSwitch, stageOf, stateIn } = await import('./requests')
const { Ctx } = await import('./app-context')

const snap = { version: 1, now: NOW, machines: [], projects: [], sessions: [], h24: [], conversations: [], conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false, mainHasScreen: true, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [], config: { userName: '', exposeDomain: '', publicHost: '' } } as unknown as Snapshot

let root: Root
let host: HTMLElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
})

const ctxOf = (sessions: { id: string; status: string }[]) => ({ snap: { ...snap, sessions } as unknown as Snapshot, now: NOW, offline: false, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} })
const show = async (sessions: { id: string; status: string }[]) => {
  await act(async () => root.render(<Ctx.Provider value={ctxOf(sessions) as never}><RequestsPage /></Ctx.Provider>))
  await act(async () => {})
}

const rows = () => [...host.querySelectorAll<HTMLElement>('.rc-row')]
const titles = () => rows().map((r) => r.querySelector('.rc-title')!.textContent)

it('one band per request: what runs on top, then the newest asked first, every state, nothing folded', async () => {
  await show([{ id: 'aa', status: 'needs_user' }, { id: '0a1b2c3d4e5f6789', status: 'working' }])
  // r7 runs (on top); then r8 (2 min ago), r6 (done, 1 h ago), r9 (3 days ago).
  expect(titles()).toEqual(['Fix the login page', 'Shorten the onboarding', 'Old done thing', 'Pick a colour'])
  expect(rows().map((r) => r.style.getPropertyValue('--step'))).toEqual(['0', '1', '2', '3'])
  const text = host.textContent ?? ''
  expect(text).not.toMatch(/in progress|not started|waiting on you|closed · |paused · /)
  expect(text).not.toMatch(/\br[6-9]\b/)
  expect(host.querySelector('[role=tablist]')).toBeNull()
})

it('a small star only on what runs right now, its place kept on every band; a small bar says how far each one is', async () => {
  await show([{ id: 'aa', status: 'needs_user' }, { id: '0a1b2c3d4e5f6789', status: 'working' }])
  expect(rows().map((r) => !!r.querySelector('.rc-star .ic'))).toEqual([true, false, false, false])
  expect(rows().every((r) => !!r.querySelector('.rc-star'))).toBe(true)
  // running 2 · not started 0 · done 4 · a question came back: no bar, it says « needs you »
  expect(rows().map((r) => r.querySelector('.rc-bar')?.getAttribute('data-stage') ?? null)).toEqual(['2', '0', '4', null])
  expect(rows().map((r) => r.querySelector<HTMLElement>('.rc-bar i')?.style.width ?? null)).toEqual(['50%', '0%', '100%', null])
  expect(rows().map((r) => r.querySelector('.rc-waits')?.textContent ?? null)).toEqual([null, null, null, 'needs you'])
  // The state is still said to a screen reader, on the band.
  expect(rows()[0].querySelector('.rc-line')!.getAttribute('aria-label')).toBe('Fix the login page · in progress')
})

it('a request that waits on the user says so, its session gone and days old included; the commit that shows it is named', async () => {
  const kept = view.asks
  view.asks = [{ ...view.asks[1], dispatches: [{ session: 'gone', at: NOW - 3 * 86400_000, outcome: 'question', report: 'Merged; restart the server to turn it on.', evidence: 'ab12cd34' }] }]
  try {
    await show([])
    expect(rows()[0].querySelector('.rc-bar')).toBeNull()
    expect(rows()[0].querySelector('.rc-waits')!.textContent).toBe('needs you')
    expect(rows()[0].querySelector('.rc-line')!.getAttribute('aria-label')).toBe('Pick a colour · needs you')
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.rc-line')[0].click())
    const text = host.querySelector('.rc-row.open')!.textContent ?? ''
    expect(text).toContain('Merged; restart the server to turn it on.')
    expect(text).toContain('commit ab12cd34')
  } finally {
    view.asks = kept
  }
})

it('a tap opens a request in place: the whole sentence, « a session » (never its id), done and drop', async () => {
  await show([{ id: '0a1b2c3d4e5f6789', status: 'working' }])
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.rc-line')[0].click())
  const open = host.querySelector('.rc-row.open')!
  const text = open.textContent ?? ''
  expect(open.querySelector('.req-whole')!.textContent).toBe('Fix the login page')
  expect(text).toContain('a session')
  expect(text).not.toContain('0a1b2c3d')
  expect(text).toContain('✓ done')
  expect(text).toContain('x drop')
  expect(host.textContent).not.toContain('! requests')
})

it('nothing is ever cut from the list: 40 bands, then the earlier ones on a tap', async () => {
  const many = Array.from({ length: 95 }, (_, i) => ({ ...view.asks[2], id: `d${i}`, text: `Thing ${i}`, at: NOW - i * 60_000 }))
  const kept = view.asks
  view.asks = many
  try {
    await show([])
    expect(rows()).toHaveLength(41)
    expect(rows()[40].textContent).toBe('earlier · 55')
    await act(async () => rows()[40].querySelector('button')!.click())
    await act(async () => rows()[80].querySelector('button')!.click())
    expect(titles()).toHaveLength(95)
    expect(titles()[94]).toBe('Thing 94')
  } finally {
    view.asks = kept
  }
})

it('a working session runs what it was sent last: its older requests are no longer « running »', () => {
  const ask = (id: string, at: number, session: string) => ({ ...view.asks[3], id, at, dispatches: [{ session, at }] }) as never
  const asks = [ask('old', NOW - 5 * 3600_000, 's'), ask('brief-a', NOW - 10 * 60_000, 's'), ask('brief-b', NOW - 9 * 60_000, 's'), ask('other', NOW - 5 * 3600_000, 't'), ask('lost', NOW, 'zz')]
  const state = stateIn(asks, [{ id: 's', status: 'working', workStartedAt: NOW - 8 * 60_000 }, { id: 't', status: 'working', workStartedAt: null }])
  expect(asks.map((a) => state(a))).toEqual(['idle', 'working', 'working', 'working', 'gone'])
  // Sent since the current turn began: running too, even when a later brief exists.
  const late = [ask('first', NOW - 30 * 60_000, 's'), ask('second', NOW - 20 * 60_000, 's'), ask('third', NOW - 60_000, 's')]
  const st = stateIn(late, [{ id: 's', status: 'working', workStartedAt: NOW - 21 * 60_000 }])
  expect(late.map((a) => st(a))).toEqual(['idle', 'working', 'working'])
  expect(columnOf(asks, state).map((x) => `${x.a.id}:${x.chip}`)).toEqual(['brief-b:running', 'brief-a:running', 'other:running', 'lost:paused', 'old:check'])
})

it('the order and the bar come from facts', () => {
  const ask = (id: string, at: number, patch: object = {}) => ({ ...view.asks[3], id, at, ...patch }) as never
  const state = (a: { id: string }) => (a.id === 'old-running' ? 'working' : a.id === 'idle' ? 'idle' : undefined) as never
  const col = columnOf([ask('new', 30, { dispatches: [] }), ask('old-running', 10), ask('idle', 20)], state)
  expect(col.map((x) => x.a.id)).toEqual(['old-running', 'new', 'idle'])
  expect(['queued', 'paused', 'blocked', 'running', 'check', 'needs', 'done', 'dropped'].map((c) => stageOf(c as never))).toEqual([0, 1, 1, 2, 3, null, 4, 0])
})

it('a request on a session that is gone or resting is never « in progress »', () => {
  const ask = (patch: object) => ({ ...view.asks[3], ...patch }) as never
  expect(chipOf(ask({}), 'gone')).toBe('paused')
  expect(chipOf(ask({}), 'interrupted')).toBe('blocked')
  expect(chipOf(ask({}), 'working')).toBe('running')
  expect(chipOf(ask({}), 'idle')).toBe('check')
  expect(chipOf(ask({ stale: true }), 'done')).toBe('paused')
  expect(chipOf(ask({ dispatches: [{ session: 'x', at: 0, outcome: 'failed' }] }), 'done')).toBe('blocked')
  expect(chipOf(ask({ stale: true, dispatches: [{ session: 'x', at: 0, outcome: 'failed' }] }), 'done')).toBe('paused')
  // What is left is the user's: it reads « needs you », however old, its session gone or not; never once it works again.
  expect(chipOf(ask({ dispatches: [{ session: 'x', at: 0, outcome: 'question' }] }), 'gone')).toBe('needs')
  expect(chipOf(ask({ stale: true, dispatches: [{ session: 'x', at: 0, outcome: 'question' }] }), 'idle')).toBe('needs')
  expect(chipOf(ask({ dispatches: [{ session: 'x', at: 0, outcome: 'question' }] }), 'working')).toBe('running')
  expect(chipOf(ask({}), 'needs_user')).toBe('needs')
  expect(chipOf(ask({ dispatches: [] }))).toBe('queued')
})

import { headingOf } from './requests'
describe('request headings', () => {
  it('the words before the first clause break, six at most, never cut with an ellipsis', () => {
    expect(headingOf('Audit the public weevils main branch to separate the public parts')).toBe('Audit the public weevils main branch')
    expect(headingOf('Design a per-repo speed mode with a stylish, ergonomic name')).toBe('Design a per-repo speed mode')
    expect(headingOf('Improve the For you page in the current app and on next: cut the noise')).toBe('Improve the For you page')
    expect(headingOf('Remove the current onboarding page so a new user lands directly in weevboss')).toBe('Remove the current onboarding page')
    expect(headingOf('Fix it')).toBe('Fix it')
    expect(headingOf('Rework the Requests page of each repo, weevils included')).toBe('Rework the Requests page')
    expect(headingOf('Look at the photo of the weevils project page')).toBe('Look at the photo')
  })
})

describe('a repo page groups requests under their sessions', () => {
  type R = Parameters<typeof groupsOf>[0][number]
  const r = (id: string, o: Partial<R> = {}): R => ({ id, text: `text ${id}`, quote: '', src: 'j', from: 'user', at: NOW, kind: 'task', status: 'dispatched', dispatches: [], progressAt: NOW, stale: false, ...o } as R)
  const s = (id: string, lastActivityAt: number, status: 'working' | 'idle' = 'idle') => ({ id, title: `title ${id}`, status, lastActivityAt, projectId: 'p' }) as Parameters<typeof groupsOf>[1][number]
  it('the most recently active session first; a gone session keeps the title of its label and the time it was sent; never sent last', () => {
    const asks = [
      r('a', { dispatches: [{ session: 's1', at: NOW - 50 }] }),
      r('b', { dispatches: [{ session: 's2', at: NOW - 40 }] }),
      r('c', { dispatches: [{ session: 'gone', label: 'weevils · claude · Old work', at: NOW - 5 }] }),
      r('d', { status: 'open' }),
    ]
    const g = groupsOf(asks, [s('s1', NOW - 30), s('s2', NOW - 10)])
    expect(g.map((x) => x.label)).toEqual(['Old work', 'title s2', 'title s1', ''])
    expect(g.at(-1)!.rows.map((x) => x.a.id)).toEqual(['d'])
  })
  it('a request that only switches a model is not product work', () => {
    expect(isModelSwitch({ title: 'Switch For you session Opus', text: '' })).toBe(true)
    expect(isModelSwitch({ title: 'Architecture session top model', text: '' })).toBe(true)
    expect(isModelSwitch({ title: 'Stop Fable overuse', text: '' })).toBe(false)
    expect(isModelSwitch({ title: 'Install page fix', text: '' })).toBe(false)
  })
})
