// @vitest-environment happy-dom
// Threads in the app (WEEVILS_THREADS): one conversation whatever engines carried it, three states, the sentence of a
// paused thread and its action, the weevbook page; and with threads on, nothing of the relay anywhere.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, RelayView, Session, Snapshot } from '../../shared/api.ts'
import type { ThreadList, ThreadView } from '../../shared/threads.ts'
import { resetNotices } from './notice-store'

const calls = vi.hoisted(() => ({ view: null as unknown, list: null as unknown, sent: [] as unknown[][], listed: [] as unknown[], continued: [] as string[], pushed: [] as unknown[], relay: [] as unknown[] }))
vi.mock('../api', () => ({
  api: {
    thread: async () => calls.view,
    threads: async (o: unknown) => (calls.listed.push(o), calls.list),
    threadSend: async (...a: unknown[]) => (calls.sent.push(a), { thread: a[0], key: a[2] }),
    threadContinue: async (id: string) => (calls.continued.push(id), calls.view),
    relaySet: async (o: unknown) => (calls.relay.push(o), { ok: true }),
    relayRequest: async () => ({ ok: true }),
    session: async () => Promise.reject(new Error('absent')),
    transcribeInfo: async () => ({ enabled: false }),
  },
}))
vi.mock('../push', () => ({ ensurePush: async () => {} }))

localStorage.setItem('weevils-language', 'en')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate
globalThis.fetch = (async () => new Response('{}')) as typeof fetch
Element.prototype.scrollTo ??= () => {}

const { ThreadPage, WeevbookPage } = await import('./threads')
const { RelayBand, ThreadPlans, SessionRelay } = await import('./relay')
const { SessionRow } = await import('./bits')
const { PageView } = await import('./pages')
const { Ctx } = await import('./app-context')

const NOW = new Date(2026, 10, 20, 15, 0).getTime()
const T = '01M7M8E6XRZ0FEBHYK2C5GNQF4'
const session = (over: Partial<Session> = {}): Session => ({ id: 'c1', projectId: 'p', repo: 'shop', machineId: 'vps', tool: 'codex', title: 'Prices with the currency', status: 'working', cwd: '/home/user/projects/shop', openedAt: NOW, lastActivityAt: NOW, workStartedAt: NOW, origin: 'weevils', controllable: true, live: true, hasScreen: true, subagents: [], background: 0, messageCount: 1, queued: 0, ...over })
const relay: RelayView = { mode: 'ask', codex: true, switchAt: 97, limit: { kind: 'limit', since: NOW - 60_000, until: NOW + 3 * 3600_000 }, boss: true, plans: [{ sessionId: 'c1', title: 'Prices', projectId: 'p', state: 'ready', text: 'plan', at: NOW }] }
const snap = (threads: boolean, sessions: Session[] = [], r: RelayView | undefined = undefined): Snapshot => ({
  version: 1,
  now: NOW,
  machines: [],
  projects: [{ id: 'p', name: 'shop', kind: 'repo', repos: ['shop'], where: { shop: 'vps' }, lastActivityAt: NOW }],
  sessions,
  h24: [],
  conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} },
  classifier: { running: false, queued: 0 },
  main: [],
  mainWorking: false,
  mainHasScreen: false,
  mainQueued: 0,
  devil: { enabled: false, working: false },
  pinnedRepos: [],
  config: { userName: '', exposeDomain: '', publicHost: '', ...(threads ? { threads: true } : {}) },
  relay: r,
})
/** A thread carried by Claude, then another Claude account, then Codex: the journal's legs, the app's one conversation. */
const messages: Message[] = [
  { id: 'm1', role: 'user', text: 'Show prices with the currency', at: NOW - 600_000 },
  { id: 'm2', role: 'event', text: 'Write · src/money.ts', at: NOW - 590_000 },
  { id: 'm3', role: 'event', text: 'Write · src/money.ts', at: NOW - 300_000 },
  { id: 'm4', role: 'event', text: 'exec_command · npm test', at: NOW - 120_000 },
  { id: 'm5', role: 'assistant', text: 'The cart shows the currency too; the tests pass.', at: NOW - 60_000 },
]
const view = (over: Partial<ThreadView> = {}): ThreadView => ({ thread: T, title: 'Prices with the currency', project: 'shop', updated: NOW, state: 'waiting', messages, ...over })

let root: Root
let host: HTMLElement
function render(node: React.ReactNode, s: Snapshot) {
  const ctx = { snap: s, now: NOW, offline: false, colors: {}, push: (p: unknown) => void calls.pushed.push(p), replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} }
  act(() => root.render(<Ctx.Provider value={ctx as never}>{node}</Ctx.Provider>))
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const text = (el: Element | null = host) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => text(b) === label)

/** No engine, account, provider or relay in what the person reads. */
function noRelayTrace() {
  const all = `${text()} ${[...host.querySelectorAll('[aria-label],[title]')].map((e) => `${e.getAttribute('aria-label')} ${e.getAttribute('title')}`).join(' ')}`
  for (const w of ['relay', 'Relay', 'relais', 'Codex', 'Claude', '⇄', 'quota', 'limit', 'took over', 'another agent']) expect(all).not.toContain(w)
  expect(host.querySelector('.tool-svg, .relay-sign, .relay-band, .relay-plan, .relay-link')).toBeNull()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  resetNotices()
  Object.assign(calls, { view: view(), list: null, sent: [], listed: [], continued: [], pushed: [], relay: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('the conversation view of a thread', () => {
  it('one thread across engine changes reads as one conversation, with no relay trace', async () => {
    const s = session({ thread: T, relayOf: 'old-claude-session' })
    render(<PageView page={{ kind: 'session', id: 'c1' }} />, snap(true, [s], relay))
    await flush()
    expect(host.querySelector(`[data-thread="${T}"]`)).not.toBeNull()
    expect(text()).toContain('Show prices with the currency')
    expect(text()).toContain('The cart shows the currency too; the tests pass.')
    expect(text()).toContain('your move')
    noRelayTrace()
  })

  it('the row of a thread in a list: its title and state, no tool and no relay sign', () => {
    render(<SessionRow session={session({ thread: T, relayOf: 'old-claude-session' })} />, snap(true))
    expect(text()).toContain('Prices with the currency')
    noRelayTrace()
  })

  it('with threads on, the relay band, plans and session links are gone, and no relay setting is sent', () => {
    const s = session({ relayOf: 'x', relayedBy: 'y' })
    render(
      <>
        <RelayBand />
        <ThreadPlans />
        <SessionRelay session={s} onError={() => {}} />
      </>,
      snap(true, [s], relay),
    )
    expect(host.innerHTML).toBe('')
  })

  it('with threads off, a session opens its own page and the relay is as it was', async () => {
    const s = session({ relayOf: 'x' })
    render(<SessionRow session={s} />, snap(false, [s], relay))
    expect(host.querySelector('.relay-sign')).not.toBeNull()
    expect(host.querySelector('.tool-svg')).not.toBeNull()
  })
})

describe('the three states', () => {
  it('working: a turn is under way, even while the dispatcher retries it elsewhere', async () => {
    calls.view = view({ state: 'working' })
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    expect(text()).toContain('working')
    expect(host.querySelector('.thread-hold')).toBeNull()
  })

  it('your move: every turn is done', async () => {
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    expect(text()).toContain('your move')
    expect(host.querySelector('.thread-hold')).toBeNull()
  })

  it('paused with nothing to do: no sentence, only when it goes on', async () => {
    calls.view = view({ state: 'paused', hold: { reason: 'no-room', until: NOW + 2 * 3600_000 } })
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    expect(text()).toContain('paused')
    expect(text()).toMatch(/goes on at \d\d:\d\d/)
    expect(host.querySelector('.thread-hold')).toBeNull()
    noRelayTrace()
  })

  it('paused for the person: one plain sentence and its action (turn a machine on, then continue)', async () => {
    calls.view = view({ state: 'paused', hold: { reason: 'no-machine', machine: 'laptop' } })
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    expect(text(host.querySelector('.thread-hold'))).toBe('Turn on laptop to continue. continue')
    await act(async () => button('continue')!.click())
    expect(calls.continued).toEqual([T])
  })

  it('a request that expired: « ask again » sends the same words again', async () => {
    calls.view = view({ state: 'paused', hold: { reason: 'expired', request: 'Summarise the open pull requests' } })
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    expect(text(host.querySelector('.thread-hold'))).toContain('waited more than an hour')
    await act(async () => button('ask again')!.click())
    await flush()
    expect(calls.sent).toHaveLength(1)
    expect(calls.sent[0].slice(0, 2)).toEqual([T, 'Summarise the open pull requests'])
  })
})

describe('the weevbook page', () => {
  const list: ThreadList = {
    projects: ['blog', 'shop'],
    threads: [
      { thread: T, title: 'Prices with the currency', project: 'shop', updated: NOW - 3600_000, state: 'waiting' },
      { thread: '01M7M8E6XRZ0FEBHYK2C5GNQF5', title: 'Offline maps', project: 'shop', updated: NOW - 7200_000, state: 'paused', snippet: 'tile cache with a cap' },
    ],
  }

  it('lists the project\'s threads, searches them, and opens one to reread and continue it', async () => {
    calls.list = list
    render(<WeevbookPage projectId="p" />, snap(true))
    await flush()
    expect(calls.listed[0]).toEqual({ project: 'shop' })
    expect(text()).toContain('Prices with the currency')
    expect(text()).toContain('Offline maps')
    expect(text()).toContain('tile cache with a cap')
    expect(text()).toContain('paused')
    const input = host.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'maps')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(calls.listed.at(-1)).toEqual({ project: 'shop', q: 'maps' })
    await act(async () => button('all projects')!.click())
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(calls.listed.at(-1)).toEqual({ q: 'maps' })
    await act(async () => [...host.querySelectorAll('button.row')].find((b) => text(b).includes('Offline maps'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(calls.pushed).toEqual([{ kind: 'thread', id: '01M7M8E6XRZ0FEBHYK2C5GNQF5' }])
    noRelayTrace()
  })

  it('writing in a reread thread continues it: the message goes to the thread, once, with its key', async () => {
    render(<ThreadPage id={T} />, snap(true))
    await flush()
    const box = host.querySelector('.composer input') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(box, 'And on the invoices?')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => box.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await flush()
    expect(calls.sent).toHaveLength(1)
    expect(calls.sent[0][0]).toBe(T)
    expect(calls.sent[0][1]).toBe('And on the invoices?')
    expect(calls.sent[0][2]).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })
})
