// @vitest-environment happy-dom
// The « auto » band: proposals as flush columns (✓ accepts, × refuses, the column leaves), the closed head counts,
// categories and groups fold with a tap, a task with a session opens it (drawer closed first), a timer toggles.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H24Activity, Optimizer, Snapshot } from '../../shared/api.ts'

const calls = vi.hoisted(() => [] as string[])
vi.mock('../api', () => ({
  api: {
    acceptOptimizer: async (id: string) => void calls.push(`accept ${id}`),
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
    expect(calls).toEqual(['accept a', 'refuse b'])
    expect([...host.querySelectorAll('.auto-prop .t')].map((n) => n.textContent)).toEqual(['Draft page'])
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
})
