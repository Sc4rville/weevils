// @vitest-environment happy-dom
// The page of an automation: the same six facts for a task, a timer and a job; the newest run unfolded (report,
// files, links, screenshots); the talk only for a task; a proposal's ✓ / × from the page, then back.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import type { AutoDetail, AutoRunDetail, H24Activity, Optimizer, Snapshot } from '../../shared/api.ts'

const calls = vi.hoisted(() => [] as string[])
const fixtures = vi.hoisted(() => ({ detail: new Map<string, AutoDetail>(), runs: new Map<string, AutoRunDetail>(), reads: 0 }))
vi.mock('../api', () => ({
  ApiError: class extends Error {},
  api: {
    auto: async (id: string) => {
      fixtures.reads++
      const d = fixtures.detail.get(id)
      if (!d) throw new Error('404')
      return d
    },
    autoRun: async (id: string, at: number) => {
      const d = fixtures.runs.get(`${id}@${at}`)
      if (!d) throw new Error('404')
      return d
    },
    autoBlob: (id: string, path: string) => `/api/auto/${id}/blob?path=${path}`,
    acceptOptimizer: async (id: string, rev?: number) => void calls.push(`accept ${id} rev ${rev}`),
    refuseOptimizer: async (id: string) => void calls.push(`refuse ${id}`),
    talkOptimizer: async (id: string, text: string) => {
      calls.push(`talk ${id} ${text}`)
      return { reply: 'ok', changed: [] }
    },
    pauseOptimizer: async (id: string, paused: boolean) => void calls.push(`pause ${id} ${paused}`),
    runOptimizer: async (id: string) => void calls.push(`run ${id}`),
    toggleH24: async (id: string) => void calls.push(`toggle ${id}`),
  },
}))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { AutoPage, AutoRunPage } = await import('./auto-page')
const { Ctx } = await import('./app-context')

const NOW = Date.now()
const MIN = 60_000
const DAY = 86_400_000
const opt = (o: Partial<Optimizer>): Optimizer => ({ id: 'o', title: 't', why: '', repo: null, kind: 'tests', heavy: false, state: 'queued', createdAt: NOW, ...o })
const runs = [3, 2, 1].map((i) => ({ at: NOW - i * DAY, startedAt: NOW - i * DAY - 9 * MIN, ok: i !== 2, note: `run ${i}`, tokens: 12_000, files: 3 }))
const daily = opt({ id: 'd', title: 'Daily digest', why: 'every morning, yesterday in one page', repo: 'mygame', every: DAY, window: { from: 420, to: 480 }, waiting: 'time', startAt: NOW + 6 * 3600_000, runs, runCount: 23, tokens: 412_000 })
const timer: H24Activity = { id: 'timer:wv-backup.timer', title: 'Backup', kind: 'timer', projectId: null, schedule: '', enabled: true, runState: 'waiting', runStartedAt: null, lastEvent: '', canToggle: true, nextRunAt: NOW + 3600_000, everyMs: DAY, lastRunAt: NOW - 3600_000, lastDurMs: 6 * MIN, lastOk: true, runCount: 60, description: 'copies the projects' }
const job: H24Activity = { id: 'job:render', title: 'render', kind: 'job', projectId: 'mygame', schedule: '', enabled: true, runState: 'running', runStartedAt: NOW - 3 * MIN, lastEvent: 'step 40/120', canToggle: false }

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
  config: { userName: '', exposeDomain: '', publicHost: '' },
})

let root: Root
let host: HTMLElement
let pushed: unknown[]
let backs: number

function render(s: Snapshot, page: React.ReactNode) {
  const ctx = {
    snap: s,
    now: NOW,
    offline: false,
    colors: { mygame: 'p3' },
    push: (p: unknown) => pushed.push(p),
    replace: () => {},
    back: () => void backs++,
    home: () => {},
    expanded: null,
    setExpanded: () => {},
    h24Open: false,
    setH24Open: () => {},
    theme: 'light' as const,
    setTheme: () => {},
    refresh: () => {},
    logout: () => {},
  }
  act(() => root.render(<Ctx.Provider value={ctx}>{page}</Ctx.Provider>))
}

const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const click = (el: Element | null | undefined) => act(async () => void (el as HTMLElement).click())
const label = (re: RegExp) => [...host.querySelectorAll('[aria-label]')].find((e) => re.test(e.getAttribute('aria-label')!))
const kpis = () => Object.fromEntries([...host.querySelectorAll('.auto-kpi')].map((c) => [c.querySelector('.k')!.textContent, c.querySelector('.v')!.textContent]))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  localStorage.setItem('weevils-lang', 'en')
  calls.length = 0
  fixtures.detail.clear()
  fixtures.runs.clear()
  pushed = []
  backs = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('automation page', () => {
  it('the same six facts for a task (its state is the flow band, where it runs the head); tapping one prefills the talk', async () => {
    render(snap([daily]), <AutoPage id="d" />)
    await flush()
    const k = kpis()
    expect(Object.keys(k)).toEqual(['when', 'next', 'last', 'length', 'runs', 'cost'])
    expect(k).toMatchObject({ when: 'every day 07:00–08:00', last: '1d ago', length: '9 min', runs: '23', cost: '412K' })
    expect(host.querySelector('.auto-flow .meta')!.textContent).toBe('scheduled')
    expect(host.querySelector('.page-head .strong')!.textContent).toBe('mygame')
    expect(host.querySelectorAll('button.auto-kpi')).toHaveLength(6)
    await click(host.querySelector('button.auto-kpi'))
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))))
    expect(host.querySelector<HTMLInputElement>('.composer input')!.value).toBe('when: ')
  })

  it('a timer and a job: the same six facts, not tappable, no talk', async () => {
    render(snap([], [timer]), <AutoPage id="timer:wv-backup.timer" />)
    await flush()
    expect(Object.keys(kpis())).toHaveLength(6)
    expect(kpis().when).toMatch(/^every day \d\d:\d\d$/)
    expect(kpis()).toMatchObject({ runs: '60', cost: '0', length: '6 min' })
    expect(host.querySelectorAll('button.auto-kpi')).toHaveLength(2) // last → its run, runs → the outputs
    expect(host.querySelector('.composer')).toBeNull()
    expect(host.querySelector('[aria-label="pause Backup"]')).not.toBeNull()
    render(snap([], [job]), <AutoPage id="job:render" />)
    await flush()
    // A job runs once: no next run, never « now ».
    expect(kpis()).toMatchObject({ when: 'started by hand', next: 'never', cost: '0' })
    expect(host.querySelector('.auto-flow .meta')!.textContent).toBe('running')
    expect(host.querySelector('.composer')).toBeNull()
    expect(host.querySelector('.auto-flow .auto-rail.run')).not.toBeNull()
  })

  it('outputs, newest first, the newest unfolded: its report, files, links, screenshots', async () => {
    fixtures.detail.set('d', { id: 'd', runs: [...runs].reverse(), machine: 'srv' })
    fixtures.runs.set(`d@${runs[2].at}`, {
      run: runs[2],
      report: '# Fourteen sessions, two to read\n\nYesterday was calm.',
      files: [{ path: 'notes/a.md', abs: '/home/u/notes/a.md', status: 'A', add: 12, del: 3 }],
      links: ['https://example.com/pr/1'],
      images: ['shots/a.png', 'shots/b.png', 'shots/c.png', 'shots/d.png'],
    })
    render(snap([daily]), <AutoPage id="d" />)
    await flush()
    await flush()
    const lines = [...host.querySelectorAll('.page-body .row .stack-text > .ellipsis:first-child')].map((n) => n.textContent)
    expect(lines).toEqual(['Fourteen sessions, two to read', 'everything it wrote', 'notes/a.md', 'example.com/pr/1', 'run 2', 'run 3'])
    expect(host.querySelector('.auto-report')!.textContent).toBe('Yesterday was calm.')
    expect(host.querySelectorAll('img.auto-shot')).toHaveLength(3)
    expect(host.querySelectorAll('.auto-ticks > span:not(.next)')).toHaveLength(3)
    expect(host.querySelectorAll('.auto-ticks > .bad')).toHaveLength(1)
    await click([...host.querySelectorAll('.page-body .row')].find((r) => r.textContent?.includes('notes/a.md')))
    expect(pushed).toEqual([{ kind: 'fsfile', machine: 'srv', path: '/home/u/notes/a.md' }])
  })

  it('a running task: AutoMark on the live line, one tap into its session; pause, no run-now', async () => {
    render(snap([opt({ id: 'r', title: 'Clean deps', state: 'running', startedAt: NOW - 12 * MIN, est: 45, sessionId: 's9', every: 6 * 3600_000 })]), <AutoPage id="r" />)
    await flush()
    expect(host.querySelector('.auto-flow .name')!.textContent).toBe('12 min/ 45 min')
    // Next: the run after this one, never « now ».
    expect(kpis().next).toMatch(/^\d\d:\d\d$/)
    const live = host.querySelector('.page-body .row .st .auto-mark')!.closest('button')!
    await click(live)
    expect(pushed).toEqual([{ kind: 'session', id: 's9' }])
    await click(host.querySelector('[aria-label="pause Clean deps"]'))
    expect(calls).toEqual(['pause r true'])
    expect(label(/^run "Clean deps" now/)).toBeUndefined()
  })

  it('while it runs, the page reads its tokens again (the cost moves with the run), and stops when it leaves', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      fixtures.detail.set('r', { id: 'r', runs: [], liveTokens: 1000, machine: 'srv' })
      render(snap([opt({ id: 'r', title: 'Clean deps', state: 'running', startedAt: NOW - 12 * MIN, sessionId: 's9' })]), <AutoPage id="r" />)
      await flush()
      expect(kpis().cost).toBe('1K')
      const before = fixtures.reads
      fixtures.detail.set('r', { id: 'r', runs: [], liveTokens: 52_000, machine: 'srv' })
      await act(async () => void vi.advanceTimersByTime(20_000))
      await flush()
      expect(fixtures.reads).toBe(before + 1)
      expect(kpis().cost).toBe('52K')
      render(snap([]), <div />)
      const after = fixtures.reads
      await act(async () => void vi.advanceTimersByTime(60_000))
      expect(fixtures.reads).toBe(after)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a scheduled task: pause and run now', async () => {
    render(snap([daily]), <AutoPage id="d" />)
    await click(label(/^run "Daily digest" now/))
    await click(host.querySelector('[aria-label="pause Daily digest"]'))
    expect(calls).toEqual(['run d', 'pause d true'])
  })

  it('a proposal: ✓ takes the version on screen then back; × refuses then back; the talk is there', async () => {
    const p = opt({ id: 'p', state: 'proposed', title: 'Harden tests', rev: 4, talk: [{ who: 'user', text: 'at night', at: NOW - MIN }, { who: 'auto', text: 'Nights it is.', at: NOW }] })
    render(snap([p]), <AutoPage id="p" />)
    expect(host.querySelector('.auto-decide')).not.toBeNull()
    // No past yet: no runs strip, no « last / runs / cost », its trigger only once (the flow band's big value).
    expect(host.querySelector('.auto-ticks')).toBeNull()
    expect(Object.keys(kpis())).toEqual(['next', 'length'])
    expect([...host.querySelectorAll('.auto-talk .msg .text')].map((n) => n.textContent)).toEqual(['at night', 'Nights it is.'])
    expect(host.querySelector('.composer')).not.toBeNull()
    await click(label(/^run "Harden tests"/))
    await flush()
    expect(calls).toEqual(['accept p rev 4'])
    expect(backs).toBe(1)
    render(snap([opt({ id: 'q', state: 'proposed', title: 'Watch' })]), <AutoPage id="q" />)
    await click(label(/^refuse "Watch"/))
    await flush()
    expect(calls).toEqual(['accept p rev 4', 'refuse q'])
    expect(backs).toBe(2)
  })

  it('a run: its report in full, its files, its session', async () => {
    fixtures.runs.set(`d@${runs[0].at}`, { run: { ...runs[0], sessionId: 's1' }, report: 'All of it.', files: [], links: [], images: [], log: undefined })
    render({ ...snap([daily]), sessions: [{ id: 's1' } as never] }, <AutoRunPage id="d" at={runs[0].at} />)
    await flush()
    expect(host.querySelector('.auto-report')!.textContent).toBe('All of it.')
    expect(host.querySelector('h1')!.textContent).toMatch(/\d\d:\d\d/)
    await click([...host.querySelectorAll('.row')].at(-1))
    expect(pushed).toEqual([{ kind: 'session', id: 's1' }])
  })
})
