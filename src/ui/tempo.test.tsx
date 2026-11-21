// @vitest-environment happy-dom
// Tempo in the app: a tap sets the next open mode and only the icon changes, a band says what it will use, the panel
// shows all 7 modes with the locked ones, and a locked mode's card says what opens it.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTS, TEMPO_MODES, type Figure, type TempoMode, type TempoView } from '../../shared/tempo.ts'

const NOW = 1_800_000_000_000
const fig = (value: number, confidence: Figure['confidence'] = 'rough', days = 6): Figure => ({ value, lo: value * 0.7, hi: value * 1.3, confidence, source: 's', at: NOW, days })
const OPEN: TempoMode[] = ['pause', 'standby', 'cruise', 'turbo', 'max']
const view = (global: TempoMode, repos: Record<string, TempoMode> = {}): TempoView => ({
  global, effective: global, repos, split: {}, at: NOW,
  modes: TEMPO_MODES.map((id) => ({
    id, agents: AGENTS[id], unlocked: OPEN.includes(id), missing: OPEN.includes(id) ? [] : ['intelligence', 'machine'],
    ...(OPEN.includes(id) ? {} : { unlock: { subscriptions: 2, cores: 8, ramGb: 15, hostPlan: 'KVM 8', hostPrice: '73.99 USD' } }),
    needHours: 0,
    band: { tokensPerDay: fig(AGENTS[id] * 6 * 32e6), pctIntelligence: fig(AGENTS[id] * 10), memGb: fig(AGENTS[id], 'default'), memPct: AGENTS[id] * 6 },
  })),
  capacity: {} as TempoView['capacity'],
})
const state: { v: TempoView; sets: [TempoMode, string | null][] } = { v: view('max'), sets: [] }
vi.mock('../api', () => ({
  api: {
    tempo: async () => state.v,
    setTempo: async (mode: TempoMode, repo: string | null) => {
      state.sets.push([mode, repo])
      state.v = repo ? { ...state.v, repos: { ...state.v.repos, [repo]: mode } } : { ...state.v, global: mode, effective: mode }
      return state.v
    },
  },
}))
localStorage.setItem('weevils-language', 'en')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { TempoIcon, TempoLine, amount, nextOf, resetTempo } = await import('./tempo')
const { Ctx } = await import('./app-context')

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  resetTempo()
  state.v = view('max')
  state.sets = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const ctx = { snap: { sessions: [], projects: [], machines: [], version: 1 }, colors: {}, now: NOW, push: () => {}, back: () => {} } as never
const mount = async (el: React.ReactNode) => {
  await act(async () => root.render(<Ctx.Provider value={ctx}>{el}</Ctx.Provider>))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const click = async (el: Element) => act(async () => void (el as HTMLElement).click())

describe('the Tempo icon', () => {
  it('a tap sets the next mode for this repo; only the icon changes and the side band says what it will use', async () => {
    await mount(<TempoIcon repo="weevils" />)
    const btn = host.querySelector('.tempo-ch')!
    expect(btn.getAttribute('aria-label')).toMatch(/^Tempo: Cruise/)
    await click(btn)
    expect(state.sets).toEqual([['turbo', 'weevils']])
    expect(host.querySelector('.tempo-ch')!.getAttribute('aria-label')).toMatch(/^Tempo: Turbo/)
    const band = host.querySelector('.tempo-band')!
    expect(band.textContent).toMatch(/At this rate weevils will use up to about 768 M tokens a day, at most about 40 % of your active intelligence and 4 GB of your VPS\./)
    expect(band.textContent).toMatch(/rough: 6 days of history/)
    expect(host.querySelector('.tempo-panel')).toBeNull()
  })
  it('past the highest open mode a tap opens the panel: 7 modes, the locked ones shown, their card says what opens them', async () => {
    state.v = view('max', { weevils: 'max' })
    await mount(<TempoIcon repo="weevils" />)
    await click(host.querySelector('.tempo-ch')!)
    expect(state.sets).toEqual([])
    const stops = [...host.querySelectorAll('.tempo-stop')]
    expect(stops).toHaveLength(7)
    expect(stops.filter((s) => s.classList.contains('locked')).map((s) => s.getAttribute('aria-label'))).toEqual(['Fleet', 'Swarm'])
    const card = host.querySelector('.tempo-card')!
    expect(card.textContent).toMatch(/Fleet/)
    expect(card.textContent).toMatch(/Two repos rebuilt side by side\./)
    expect(card.textContent).toMatch(/Opens with 2 subscriptions · a VPS with 8 cores and 15 GB · KVM 8, 73\.99 USD a month/)
    expect(host.querySelector('.tempo-use')).toBeNull()
  })
  it('in the panel, an open mode is one tap to use; Pause is there too', async () => {
    state.v = view('max', { weevils: 'max' })
    await mount(<TempoIcon repo="weevils" />)
    await click(host.querySelector('.tempo-ch')!)
    await click(host.querySelector('.tempo-stop[aria-label="Pause"]')!)
    expect(host.querySelector('.tempo-card')!.textContent).toMatch(/Everything waits\. Nothing is lost\./)
    await click(host.querySelector('.tempo-use')!)
    expect(state.sets).toEqual([['pause', 'weevils']])
  })
  it('the global Tempo is a line in Settings with the same tap; under a lower ceiling a repo says it is capped', async () => {
    state.v = view('cruise')
    await mount(<><TempoLine /><TempoIcon repo="weevils" /></>)
    await click(host.querySelector('.tempo-ch')!)
    expect(state.sets).toEqual([['turbo', 'weevils']])
    expect(host.querySelector('.tempo-band')!.textContent).toMatch(/capped by your global Tempo \(Cruise\)/)
    const row = host.querySelector('.tempo-row')!
    expect(row.textContent).toMatch(/TempoCruise/)
    await click(row)
    expect(state.sets.at(-1)).toEqual(['turbo', null])
  })
})

describe('the numbers in words', () => {
  it('the value when measured, « about » it while rough', () => {
    const unit = (x: number): [string, string] => [String(Math.round(x / 1e6)), 'M']
    expect(amount(fig(100e6, 'measured'), unit, 'about')).toBe('100 M')
    expect(amount(fig(100e6, 'rough'), unit, 'about')).toBe('about 100 M')
  })
  it('after the highest open mode, the next tap opens the panel; after Swarm, Pause', () => {
    expect(nextOf(view('cruise'), 'turbo')).toBe('max')
    expect(nextOf(view('cruise'), 'max')).toBeNull()
    expect(nextOf(view('cruise'), 'swarm')).toBe('pause')
  })
})
