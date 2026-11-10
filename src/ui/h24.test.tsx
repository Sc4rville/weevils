// @vitest-environment happy-dom
// The « auto » band: proposals as flush columns (✓ accepts, × refuses, the column leaves), the closed head counts,
// categories and groups fold with a tap, a task with a session opens it (drawer closed first), a timer toggles.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H24Activity, Optimizer, Snapshot } from '../../shared/api.ts'

const calls = vi.hoisted(() => [] as string[])
/** The pending answer of a talk turn: the test releases it. */
const talk = vi.hoisted(() => ({ release: null as null | ((r: unknown) => void) }))
vi.mock('../api', () => ({
  api: {
    acceptOptimizer: async (id: string, rev?: number) => void calls.push(rev === undefined ? `accept ${id}` : `accept ${id} rev ${rev}`),
    talkOptimizer: (id: string, text: string) => {
      calls.push(`talk ${id} ${text}`)
      return new Promise((r) => (talk.release = r))
    },
    refuseOptimizer: async (id: string) => void calls.push(`refuse ${id}`),
    toggleH24: async (id: string) => void calls.push(`toggle ${id}`),
  },
}))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { H24Rail } = await import('./h24')
const { Ctx } = await import('./app-context')

const NOW = Date.now()
const opt = (o: Partial<Optimizer>): Optimizer => ({ id: 'o', title: 't', why: '', repo: null, kind: 'tests', heavy: false, state: 'proposed', createdAt: NOW, ...o })

const snap = (optimizers: Optimizer[], h24: H24Activity[] = []): Snapshot => ({
  version: 1,
  now: NOW,
  machines: [{ id: 'm', name: 'm' }],
  projects: [{ id: 'mygame', name: 'mygame', kind: 'repo', repos: ['mygame'], where: {}, lastActivityAt: 0 }],
  sessions: [],
  h24,
  conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} },
  classifier: { running: false, queued: 0 },
  main: [],
  mainWorking: false,
  mainHasScreen: false,
  mainQueued: 0,
  devil: { enabled: false, working: false },
  pinnedRepos: [],
  optimizers,
  autoMachine: { load: 0.4, cpus: 4, freeGb: 6, wait: null },
  config: { userName: '', exposeDomain: '', publicHost: '' },
})

let root: Root
let host: HTMLElement
let pushed: unknown[]
let drawer: boolean[]

function render(s: Snapshot) {
  const ctx = {
    snap: s,
    now: NOW,
    offline: false,
    colors: { mygame: 'p3' },
    push: (p: unknown) => pushed.push(p),
    replace: () => {},
    back: () => {},
    home: () => {},
    expanded: null,
    setExpanded: () => {},
    h24Open: true,
    setH24Open: (v: boolean) => drawer.push(v),
    theme: 'light' as const,
    setTheme: () => {},
    refresh: () => {},
    logout: () => {},
  }
  act(() =>
    root.render(
      <Ctx.Provider value={ctx}>
        <H24Rail />
      </Ctx.Provider>,
    ),
  )
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const click = (el: Element | null) => act(async () => void (el as HTMLElement).click())
const label = (re: RegExp) => [...host.querySelectorAll('[aria-label]')].find((e) => re.test(e.getAttribute('aria-label')!))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('weevils-lang', 'en')
  calls.length = 0
  pushed = []
  drawer = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('auto band', () => {
  it('proposals sit side by side; ✓ accepts, × refuses, and the column leaves', async () => {
    render(snap([opt({ id: 'a', title: 'Harden tests', why: 'ship it' }), opt({ id: 'b', title: 'Watch fairs', kind: 'watch' }), opt({ id: 'c', title: 'Draft page', kind: 'content' })]))
    expect([...host.querySelectorAll('.auto-prop .t')].map((n) => n.textContent)).toEqual(['Harden tests', 'Watch fairs', 'Draft page'])
    expect(host.querySelector('.h24-head')!.getAttribute('aria-label')).toContain('3 to approve')
    await click(label(/^run "Harden tests"/)!)
    await click(label(/^refuse "Watch fairs"/)!)
    await flush()
    expect(calls).toEqual(['accept a rev 0', 'refuse b'])
    expect([...host.querySelectorAll('.auto-prop .t')].map((n) => n.textContent)).toEqual(['Draft page'])
  })

  it('a tap on a column unfolds it (others become strips), never accepts; ✓ waits for the finger to settle', async () => {
    let clock = 10_000
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    render(snap([opt({ id: 'a', title: 'Harden the save parser tests', why: 'broken saves cost you hours' }), opt({ id: 'b', title: 'Watch fairs', kind: 'watch' }), opt({ id: 'c', title: 'Draft page', kind: 'content' })]))
    const state = () => [...host.querySelectorAll('.auto-prop')].map((n) => (n.classList.contains('open') ? 'open' : n.classList.contains('slim') ? 'slim' : '-'))
    expect(host.querySelector('.auto-prop-strip')).toBeNull()
    await click(host.querySelector('.auto-prop .auto-prop-body'))
    expect(state()).toEqual(['open', 'slim', 'slim'])
    expect(host.querySelector('.auto-prop.open .auto-prop-body')!.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.auto-prop.open .w')!.textContent).toBe('broken saves cost you hours')
    // The slim ones: their ✓ and × are out of reach; a tap on the strip unfolds that one.
    expect(host.querySelector('.auto-prop.slim .auto-prop-in')!.hasAttribute('inert')).toBe(true)
    // A second tap right away (the finger that unfolded) does nothing.
    await click(label(/^run "Harden the save parser tests"/)!)
    expect(calls).toEqual([])
    clock += 500
    await click(label(/^run "Harden the save parser tests"/)!)
    await flush()
    expect(calls).toEqual(['accept a rev 0'])
    expect(state()).toEqual(['-', '-'])
    await click(host.querySelector('.auto-prop:last-child .auto-prop-body'))
    expect(state()).toEqual(['slim', 'open'])
    await click(label(/^Watch fairs$/)!)
    expect(state()).toEqual(['open', 'slim'])
    clock += 100
    await click(label(/^refuse "Watch fairs"/)!)
    expect(calls).toEqual(['accept a rev 0'])
    // A tap on the open column folds it back.
    await click(host.querySelector('.auto-prop.open .auto-prop-body'))
    expect(state()).toEqual(['-', '-'])
    clock += 500
    await click(label(/^refuse "Watch fairs"/)!)
    await flush()
    expect(calls).toEqual(['accept a rev 0', 'refuse b'])
    now.mockRestore()
  })

  it('the « tests » kind never wears the accept ✓', () => {
    render(snap([opt({ id: 'a', title: 'Harden tests' })]))
    const d = (sel: string) => host.querySelector(`${sel} path:last-child`)!.getAttribute('d')
    expect(d('.auto-prop .k')).not.toBe(d('.auto-prop .ok'))
    expect(d('.auto-prop .k')).not.toBe(d('.auto-prop .no'))
  })

  it('no proposal: no band at all', () => {
    render(snap([opt({ id: 'r', state: 'running', repo: 'mygame', startedAt: NOW - 5 * 60_000, sessionId: 's1' })]))
    expect(host.querySelector('.auto-props')).toBeNull()
    expect(host.querySelector('.h24-head')!.getAttribute('aria-label')).toContain('1 running')
  })

  it('folds a category and a group with a tap; a folded level keeps its count', async () => {
    render(
      snap(
        [opt({ id: 'r', state: 'running', repo: 'mygame', title: 'Profile loader', startedAt: NOW, sessionId: 's1' }), opt({ id: 'q', state: 'queued', waiting: 'queue', repo: 'mygame', title: 'Fix save' })],
        [{ id: 'job:mygame-build', title: 'mygame-build', kind: 'job', projectId: 'mygame', schedule: '', enabled: true, runState: 'running', runStartedAt: NOW, lastEvent: 'linking', canToggle: false }],
      ),
    )
    const titles = () => [...host.querySelectorAll('.auto-title')].map((n) => n.textContent)
    expect(titles()).toEqual(['Profile loader', 'Fix save', 'mygame-build'])
    await click(label(/^tasks: 2 tasks, 1 running\. collapse/)!)
    await flush()
    expect(titles()).toEqual(['mygame-build'])
    await click(label(/^mygame: 3 tasks, 2 running\. collapse/)!)
    await flush()
    expect(titles()).toEqual([])
    expect(host.querySelector('.auto-cat-head .auto-agg')!.textContent).toContain('3')
  })

  it('a task with a session opens it, drawer closed first; a timer toggles', async () => {
    render(
      snap(
        [opt({ id: 'r', state: 'running', repo: 'mygame', title: 'Profile loader', startedAt: NOW, sessionId: 's1' })],
        [{ id: 'timer:wv-sync.timer', title: 'sync', kind: 'timer', projectId: null, schedule: '', enabled: true, runState: 'waiting', runStartedAt: null, lastEvent: '', canToggle: true, nextRunAt: NOW + 14 * 60_000, everyMs: 6 * 3600_000 }],
      ),
    )
    await click(label(/^Profile loader, running/)!)
    expect(drawer).toEqual([false])
    expect(pushed).toEqual([{ kind: 'session', id: 's1' }])
    const timer = label(/^sync, scheduled/)!
    expect(timer.getAttribute('aria-label')).toContain('next in 14m')
    expect(timer.getAttribute('aria-label')).toContain('every 6h')
    await click(label(/^pause sync/)!)
    expect(calls).toEqual(['toggle timer:wv-sync.timer'])
  })

  it('talks a proposal over: the bubble opens a field under the card, the reply shows in it, the card is rewritten, ✓ waits then takes that version', async () => {
    let clock = 10_000
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const p = opt({ id: 'a', title: 'Harden tests', why: 'ship it', priority: 2, est: 40 })
    render(snap([p, opt({ id: 'b', title: 'Watch fairs', kind: 'watch' })]))
    // Folded: no bubble; unfolded: one.
    expect(label(/^talk about "Harden tests"/)).toBeUndefined()
    await click(host.querySelector('.auto-prop .auto-prop-body'))
    await click(label(/^talk about "Harden tests"/)!)
    const input = host.querySelector<HTMLInputElement>('.auto-prop-say input')!
    expect(input.getAttribute('aria-label')).toBe('your question about "Harden tests"')
    expect(host.querySelector('.auto-prop-say .voice-logo')).not.toBeNull()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'at night, weekly, e2e only')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => void host.querySelector<HTMLFormElement>('.auto-prop-say form')!.requestSubmit())
    expect(calls).toEqual(['talk a at night, weekly, e2e only'])
    // In flight: the question shows in the card, ✓ is off.
    expect(host.querySelector('.auto-prop.open .auto-line.user')!.textContent).toBe('at night, weekly, e2e only')
    clock += 1000
    expect(label(/^"Harden tests" is being rewritten/)!.hasAttribute('disabled')).toBe(true)
    const item = { ...p, title: 'E2E tests', est: 50, window: { from: 60, to: 360 }, every: 7 * 86_400_000, rev: 1, changed: { at: NOW, fields: ['title', 'est', 'window', 'every'] }, talk: [{ who: 'user', text: 'at night, weekly, e2e only', at: NOW }, { who: 'auto', text: 'Done: nights, every week, e2e only.', at: NOW, changed: ['title'] }] }
    await act(async () => talk.release!({ reply: 'Done: nights, every week, e2e only.', item, changed: ['title', 'est', 'window', 'every'] }))
    await flush()
    const card = host.querySelector('.auto-prop.open')!
    expect(card.querySelector('.t')!.textContent).toBe('E2E tests')
    expect(card.querySelector('.t')!.classList.contains('auto-chg')).toBe(true)
    expect(card.querySelector('.auto-line.auto.last')!.textContent).toBe('Done: nights, every week, e2e only.')
    expect([...card.querySelectorAll('.auto-cond')].map((n) => n.textContent)).toEqual(['night 01:00–06:00', '/7d'])
    await click(label(/^run "E2E tests"/)!)
    await flush()
    expect(calls).toEqual(['talk a at night, weekly, e2e only', 'accept a rev 1'])
    now.mockRestore()
  })

  it('an accepted task keeps where it came from: one line under its row, unfolded with a tap; its bubble opens the field there', async () => {
    const lines = [
      { who: 'user' as const, text: 'only e2e', at: NOW },
      { who: 'auto' as const, text: 'Only the e2e tests now.', at: NOW, changed: ['prompt' as const] },
      { who: 'user' as const, text: 'at night', at: NOW },
      { who: 'auto' as const, text: 'Nights it is, 01:00 to 06:00.', at: NOW, changed: ['window' as const] },
    ]
    render(snap([opt({ id: 'q', state: 'queued', waiting: 'time', startAt: NOW + 14 * 60_000, window: { from: 60, to: 360 }, every: 86_400_000, repo: 'mygame', title: 'E2E tests', talk: lines })]))
    const row = label(/^E2E tests, scheduled/)!
    expect(row.getAttribute('aria-label')).toContain('next in 14m')
    expect(row.getAttribute('aria-label')).toContain('every day between 01:00 and 06:00')
    expect(row.getAttribute('aria-label')).toContain('every 1d')
    const one = label(/^where "E2E tests" comes from: 4 lines/)!
    expect(one.textContent).toContain('Nights it is, 01:00 to 06:00.')
    await click(one)
    expect([...host.querySelectorAll('.auto-hist .auto-line')].map((n) => n.textContent)).toEqual(lines.map((l) => l.text))
    await click(label(/^fold the exchange/)!)
    expect(host.querySelectorAll('.auto-hist .auto-line')).toHaveLength(0)
    await click(label(/^talk about "E2E tests"/)!)
    expect(host.querySelector('.auto-hist input')).not.toBeNull()
    expect(host.querySelectorAll('.auto-hist .auto-line')).toHaveLength(2)
  })
})
