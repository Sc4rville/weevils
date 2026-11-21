// @vitest-environment happy-dom
// From automation to factory, in the app (docs/automations/PROTOCOL.md): the quiet line and its unlock on an eligible
// automation's page, nothing on the others; a factory's own page drawn from the panels it declares; its standard page
// one tap away; the factory icon in the drawer. English and French, every theme.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoDetail, AutoRunDetail, Optimizer, Snapshot } from '../../shared/api.ts'
import { setLang } from '../i18n'
import type { Theme } from './app-context'

const calls = vi.hoisted(() => [] as string[])
const fixtures = vi.hoisted(() => ({ detail: new Map<string, AutoDetail>(), runs: new Map<string, AutoRunDetail>(), unlockFail: false }))
vi.mock('../api', () => ({
  ApiError: class extends Error {},
  api: {
    auto: async (id: string) => { const d = fixtures.detail.get(id); if (!d) throw new Error('404'); return d },
    autoRun: async (id: string, at: number) => { const d = fixtures.runs.get(`${id}@${at}`); if (!d) throw new Error('404'); return d },
    autoBlob: (id: string, path: string) => `/api/auto/${id}/blob?path=${path}`,
    autoSeen: async (id: string, what: string) => void calls.push(`seen ${id} ${what}`),
    unlockFactory: async (id: string) => { calls.push(`unlock ${id}`); if (fixtures.unlockFail) throw new Error('its source has uncommitted changes'); return { item: {} } },
    laterFactory: async (id: string) => { calls.push(`later ${id}`); return { item: {} } },
    pauseOptimizer: async (id: string, paused: boolean) => void calls.push(`pause ${id} ${paused}`),
    runOptimizer: async (id: string) => void calls.push(`run ${id}`),
    main: async (text: string) => { calls.push(`main ${text}`); return { id: 'm' } },
    autoTrigger: async () => ({ item: {} }),
    deleteAutomation: async () => ({ ok: true, running: false }),
    talkOptimizer: async () => ({ reply: 'ok', changed: [] }),
  },
}))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { AutoPage } = await import('./auto-page')
const { FactoryPage, metricValues } = await import('./factory-page')
const { glyphOf } = await import('./h24')
const { fromOptimizer } = await import('./auto-model')
const { Ctx } = await import('./app-context')

const NOW = Date.now()
const HOUR = 3_600_000
const runs = [1, 2, 3, 4].map((i) => ({ at: NOW - i * 3 * HOUR, startedAt: NOW - i * 3 * HOUR - 8 * 60_000, ok: i !== 3, note: `run ${i}`, summary: i === 1 ? '12 leads, 3 worth a reply' : undefined, metrics: i === 4 ? undefined : { leads: 15 - i * 3 } }))
const opt = (o: Partial<Optimizer>): Optimizer => ({ id: 'o', title: 'Opportunity hunter', why: 'Finds leads worth a reply.', repo: null, kind: 'watch', heavy: false, state: 'queued', createdAt: NOW - 9 * 86_400_000, acceptedAt: NOW - 9 * 86_400_000, every: 3 * HOUR, waiting: 'time', startAt: NOW + HOUR, runs, runCount: 37, tokens: 13_500_000, ...o })
const eligible = opt({ promotion: { reasons: [{ kind: 'proven', runs: 37, ok: 10, of: 10 }] } })
const factory = opt({ name: 'opportunity-hunter', resultsPage: 'opportunities/opportunity-hunter-leads', scope: 'Reads public pages and lists leads; publishes nothing.', factory: { name: 'opportunity-hunter', unlockedAt: NOW - 1000, remote: 'pushed', repository: 'someone/opportunity-hunter' } })

const snap = (optimizers: Optimizer[]): Snapshot => ({ version: 1, now: NOW, machines: [{ id: 'm', name: 'm' }], projects: [], sessions: [], h24: [], conversations: [], conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false, mainHasScreen: false, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [], optimizers, config: { userName: '', exposeDomain: '', publicHost: '' } }) as unknown as Snapshot

let root: Root
let host: HTMLElement
let pushed: any[]
let refreshed: number
function render(s: Snapshot, page: React.ReactNode, theme: Theme = 'light') {
  document.documentElement.dataset.theme = theme
  const ctx = { snap: s, now: NOW, offline: false, colors: {}, push: (p: unknown) => pushed.push(p), replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme, setTheme: () => {}, refresh: () => void refreshed++, logout: () => {} }
  act(() => root.render(<Ctx.Provider value={ctx as never}>{page}</Ctx.Provider>))
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))
const click = (el: Element | null | undefined) => act(async () => void (el as HTMLElement).click())
const button = (re: RegExp) => [...host.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  setLang('en')
  calls.length = 0
  fixtures.detail.clear()
  fixtures.runs.clear()
  fixtures.unlockFail = false
  fixtures.detail.set('o', { id: 'o', runs, machine: 'm' })
  fixtures.runs.set(`o@${runs[0].at}`, { run: runs[0], report: '# 12 leads\n\nThree are worth a reply today.', files: [], links: [], images: ['shots/a.png', 'shots/b.png'] })
  pushed = []
  refreshed = 0
  // A living link asks the server for its page's title: no server here.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('the quiet line on an automation that earned it', () => {
  it('says why in measured words, unlocks on the person’s tap, and explains what the unlock does', async () => {
    render(snap([eligible]), <AutoPage id="o" />)
    await flush()
    const line = host.querySelector('[data-factory-ready="o"]')!
    expect(line.textContent).toContain('Ready to become a factory')
    expect(line.textContent).toContain('37 runs, 10 of the last 10 good')
    // One quiet line: what the unlock does, and its button, come only when the person opens it.
    expect(host.querySelector('.factory-unlock')).toBeNull()
    await click(line.querySelector('button.row'))
    expect(line.textContent).toContain('Its schedule and its rules stay exactly as they are.')
    await click(button(/^make "Opportunity hunter" a factory$/))
    await flush()
    expect(calls).toContain('unlock o')
    expect(refreshed).toBe(1)
    // The snapshot comes back with a factory: its page, and the moment said once, with everything else in place.
    render(snap([factory]), <AutoPage id="o" />)
    await flush()
    expect(host.querySelector('[data-factory="o"] [role="status"]')!.textContent).toBe('"Opportunity hunter" is now a factory')
    expect(host.querySelector('.factory-hero-icon .factory-moment-icon')).not.toBeNull()
    expect(host.querySelector('.factory-hero-what')).not.toBeNull()
    expect(host.querySelectorAll('.factory-metric')).toHaveLength(3)
  })

  it('a factory unlocked some time ago, or from another device, opens with no moment', async () => {
    render(snap([{ ...factory, id: 'other' }]), <AutoPage id="other" />)
    await flush()
    expect(host.querySelector('[data-factory="other"]')).not.toBeNull()
    expect(host.querySelector('.factory-moment-icon')).toBeNull()
    expect(host.querySelector('.factory-moment-line')).toBeNull()
  })

  it('« not now » puts it off and the line leaves; a refusal is said in place and nothing is hidden', async () => {
    render(snap([eligible]), <AutoPage id="o" />)
    await flush()
    await click(host.querySelector('[data-factory-ready] button.row'))
    fixtures.unlockFail = true
    await click(button(/^make "Opportunity hunter" a factory$/))
    await flush()
    expect(host.querySelector('[data-factory-ready] [role="alert"]')?.textContent).toBe('its source has uncommitted changes')
    await click(button(/^Not now$/))
    await flush()
    expect(calls).toContain('later o')
    expect(host.querySelector('[data-factory-ready]')).toBeNull()
  })

  it('an automation that is not eligible shows nothing about factories: no line, no badge, no counter', async () => {
    render(snap([opt({})]), <AutoPage id="o" />)
    await flush()
    expect(host.querySelector('[data-factory-ready]')).toBeNull()
    expect(host.textContent).not.toMatch(/factory/i)
    expect(calls).toContain('seen o page')
  })

  for (const lang of ['en', 'fr'] as const)
    it(`reads in ${lang}`, async () => {
      setLang(lang)
      render(snap([eligible]), <AutoPage id="o" />)
      await flush()
      expect(host.querySelector('[data-factory-ready]')!.textContent).toContain(lang === 'fr' ? 'Prête à devenir une usine' : 'Ready to become a factory')
      await click(host.querySelector('[data-factory-ready] button.row'))
      expect(host.querySelector('.factory-unlock')!.textContent).toBe(lang === 'fr' ? 'Débloquer' : 'Unlock')
    })
})

describe('a factory has its own page', () => {
  it('opens on it, with the default panels: who it is, how it does, what it made, its runs, what to do', async () => {
    render(snap([factory]), <AutoPage id="o" />)
    await flush()
    const page = host.querySelector('[data-factory="o"]')!
    expect(page).not.toBeNull()
    expect(page.querySelector('.factory-hero-what')!.textContent).toBe('Reads public pages and lists leads; publishes nothing.')
    expect(page.querySelector('.factory-hero-result a')!.getAttribute('href')).toBe('/p/opportunities/opportunity-hunter-leads')
    expect([...page.querySelectorAll('.factory-metric')].map((m) => m.textContent)).toEqual(['37runs', '3good of 10', '2good in a row'])
    expect([...page.querySelectorAll('.factory-fact dt')].map((d) => d.textContent)).toEqual(['next run', 'schedule'])
    expect(page.querySelector('.factory-facts')!.textContent).toContain('every 3h')
    expect(page.textContent).toContain('12 leads, 3 worth a reply')
    expect(page.querySelectorAll('.factory-bars button')).toHaveLength(4)
    expect(page.querySelectorAll('.factory-bars .bad')).toHaveLength(1)
    expect(button(/^run now$/)).toBeTruthy()
    expect(button(/^repository · someone\/opportunity-hunter$/)).toBeTruthy()
    expect(calls).toContain('seen o page')
    await click(page.querySelector('.factory-bars button'))
    expect(pushed.at(-1)).toMatchObject({ kind: 'autorun', id: 'o' })
  })

  it('keeps the standard page one tap away, and comes back: nothing an automation could do is lost', async () => {
    render(snap([factory]), <AutoPage id="o" />)
    await flush()
    await click(button(/^schedule and talk$/))
    await flush()
    expect(host.querySelector('[data-factory]')).toBeNull()
    expect(host.querySelector('.auto-kpis')).not.toBeNull()
    expect(host.querySelector('form')).not.toBeNull()
    await click(button(/^the factory’s page$/))
    await flush()
    expect(host.querySelector('[data-factory="o"]')).not.toBeNull()
  })

  it('draws the panels its manifest declares, in order, with its own numbers and labels', async () => {
    const own = { ...factory, factory: { ...factory.factory!, metrics: [{ key: 'leads', label: { en: 'Leads', fr: 'Pistes' } }], panels: [
      { type: 'metrics', items: [{ key: 'leads' }, { key: 'runs.total', label: 'All runs' }, { key: 'missing' }] },
      { type: 'chart', metric: 'leads' },
      { type: 'gallery', limit: 1 },
      { type: 'text', title: 'Rule', body: { en: 'Only public pages.', fr: 'Pages publiques seulement.' } },
      { type: 'actions', items: [{ do: 'pause' }, { label: 'Stricter', ask: 'Make Opportunity hunter stricter.' }] },
    ] } } as Optimizer
    render(snap([own]), <FactoryPage id="o" />)
    await flush()
    const page = host.querySelector('[data-factory="o"]')!
    expect(page.querySelector('.factory-hero')).toBeNull()
    expect([...page.querySelectorAll('.factory-metric')].map((m) => m.textContent)).toEqual(['12+3Leads', '37All runs'])
    expect(page.querySelectorAll('.factory-bars span')).toHaveLength(4)
    expect(page.querySelectorAll('.factory-bars .none')).toHaveLength(1)
    expect(page.querySelectorAll('.factory-gallery img')).toHaveLength(1)
    expect(page.querySelector('.factory-text')!.textContent).toBe('RuleOnly public pages.')
    await click(button(/^pause$/))
    await click(button(/^Stricter$/))
    await flush()
    expect(calls).toEqual(expect.arrayContaining(['pause o true', 'main Make Opportunity hunter stricter.']))
    expect(page.textContent).toContain('sent to weevboss')
    setLang('fr')
    render(snap([own]), <FactoryPage id="o" />)
    await flush()
    expect(host.querySelector('.factory-metric .k')!.textContent).toBe('Pistes')
    expect(host.querySelector('.factory-text')!.textContent).toBe('RulePages publiques seulement.')
  })

  it('says in one line what its repository waits for, and offers to try again only when that can help', async () => {
    const waiting = (note: NonNullable<Optimizer['factory']>['note'], detail?: string) => ({ ...factory, factory: { name: 'opportunity-hunter', unlockedAt: NOW, remote: 'pending', note, detail } }) as Optimizer
    render(snap([waiting('github')]), <FactoryPage id="o" />)
    await flush()
    expect(host.querySelector('.factory-note')!.textContent).toBe('repository: waiting for GitHubtry again')
    await click(button(/^try again$/))
    expect(calls).toContain('unlock o')
    render(snap([waiting('secret', 'private key')]), <FactoryPage id="o" />)
    await flush()
    expect(host.querySelector('.factory-note')!.textContent).toBe('repository not published: its source holds what looks like a secret (private key)')
  })

  it('is nothing for an automation that is not a factory', async () => {
    render(snap([eligible]), <FactoryPage id="o" />)
    await flush()
    expect(host.textContent).toBe('')
  })
})

describe('numbers and icons', () => {
  it('the factory icon belongs to the set: one closed outline, straight lines only; its mark is the loop mark’s own class', async () => {
    const { FactoryMark, Icon } = await import('./icons')
    act(() => root.render(<><Icon name="factory" /><FactoryMark /></>))
    const [icon, mark] = [...host.querySelectorAll('svg')]
    const d = icon.querySelector('path')!.getAttribute('d')!
    expect(d).toMatch(/^M[\d. ]+[VvHhLlMm\d. -]+z$/)
    expect(d).not.toMatch(/[CcSsQqTtAa]/)
    expect(icon.getAttribute('stroke-width')).toBe('2.5')
    // Same class as AutoMark: every theme's colour, track and ink outline apply to it with no rule of its own.
    expect(mark.classList.contains('auto-mark')).toBe(true)
    expect([...mark.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['halo', 'track', 'run'])
    expect(new Set([...mark.querySelectorAll('path')].map((p) => p.getAttribute('d'))).size).toBe(1)
  })


  it('reads built-in numbers and the ones the runs reported, with the value before', () => {
    expect(metricValues('runs.total', factory, runs)).toEqual({ now: 37 })
    expect(metricValues('runs.ok', factory, runs)).toEqual({ now: 3 })
    expect(metricValues('runs.streak', factory, runs)).toEqual({ now: 2 })
    expect(metricValues('tokens.total', factory, runs)).toEqual({ now: 13_500_000 })
    expect(metricValues('leads', factory, runs)).toEqual({ now: 12, before: 9 })
    expect(metricValues('nope', factory, runs)).toEqual({ now: undefined, before: undefined })
  })

  it('a factory shows the factory icon at rest and its own mark at work; what matters more still shows first', () => {
    const item = (o: Partial<Optimizer>) => fromOptimizer(opt({ factory: factory.factory, ...o }), null, NOW)!
    expect(glyphOf(item({}))).toEqual({ name: 'factory' })
    expect(glyphOf(item({ onSleep: true }))).toEqual({ name: 'factory' })
    expect(glyphOf(item({ state: 'running', startedAt: NOW }))).toEqual({ name: 'factory-mark' })
    expect(glyphOf(item({ paused: true }))).toEqual({ name: 'pause' })
    expect(glyphOf(fromOptimizer(opt({}), null, NOW)!).name).not.toBe('factory')
    expect(glyphOf(fromOptimizer(opt({ state: 'running', startedAt: NOW }), null, NOW)!)).toEqual({ name: 'mark' })
  })
})
