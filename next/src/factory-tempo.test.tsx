// @vitest-environment happy-dom
// Your factory's Tempo (factory.tsx TempoCells): six cells, no glyph and no caption, the colour alone says the mode;
// a tap on a cell sets it, a tap on the mode in use pauses, a locked cell changes nothing and says what opens it.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AGENTS, TEMPO_MODES, type TempoMode, type TempoView } from '../../shared/tempo.ts'

const OPEN: TempoMode[] = ['pause', 'standby', 'cruise', 'turbo', 'max']
const fig = (value: number) => ({ value, lo: value, hi: value, confidence: 'rough' as const, source: 's', at: 1, days: 6 })
const view = (global: TempoMode): TempoView => ({
  global, effective: global, repos: {}, split: {}, at: 1,
  modes: TEMPO_MODES.map((id) => ({
    id, agents: AGENTS[id], unlocked: OPEN.includes(id), missing: [], needHours: 0,
    ...(OPEN.includes(id) ? {} : { unlock: { subscriptions: 2, cores: 8, ramGb: 15 } }),
    band: { tokensPerDay: fig(32e6), pctIntelligence: fig(10), memGb: fig(1), memPct: 6 },
  })),
  capacity: {} as TempoView['capacity'],
})
const state: { v: TempoView; sets: TempoMode[] } = { v: view('turbo'), sets: [] }
vi.mock('../../src/api', () => ({
  api: {
    tempo: async () => state.v,
    setTempo: async (mode: TempoMode) => {
      state.sets.push(mode)
      state.v = { ...state.v, global: mode, effective: mode }
      return state.v
    },
  },
}))
localStorage.setItem('weevils-language', 'en')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { TempoCells } = await import('./factory.tsx')
const { resetTempo } = await import('../../src/ui/tempo.tsx')
const { Ctx } = await import('../../src/ui/app-context.tsx')

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  resetTempo()
  state.v = view('turbo')
  state.sets = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const ctx = { snap: { sessions: [], projects: [], machines: [], version: 1 }, colors: {}, now: 1, push: () => {}, back: () => {} } as never
const mount = async () => {
  await act(async () => root.render(<Ctx.Provider value={ctx}><TempoCells step={1} /></Ctx.Provider>))
  await act(async () => new Promise((r) => setTimeout(r, 0)))
}
const cells = () => [...host.querySelectorAll<HTMLButtonElement>('.nx-fx-cell')]
const click = async (el: HTMLElement) => act(async () => void el.click())

it('six cells with nothing drawn in them, filled up to the mode in use, and no mode name under « Tempo »', async () => {
  await mount()
  expect(cells()).toHaveLength(6)
  expect(host.querySelector('.nx-fx-cell svg, .nx-fx-mode, [role="slider"]')).toBeNull()
  expect(cells().map((c) => c.classList.contains('on'))).toEqual([true, true, true, false, false, false])
  expect(cells().map((c) => c.getAttribute('aria-label'))).toEqual(['Standby', 'Cruise', 'Turbo', 'Max', 'Fleet', 'Swarm'])
  expect(host.querySelector('.nx-fx-tempo-name')!.textContent).toBe('Tempo')
})
it('a tap on a cell sets that mode; a tap on the mode in use pauses', async () => {
  await mount()
  await click(cells()[3])
  expect(state.sets).toEqual(['max'])
  expect(cells()[3].getAttribute('aria-checked')).toBe('true')
  await click(cells()[0])
  expect(state.sets).toEqual(['max', 'standby'])
  await click(cells()[0])
  expect(state.sets).toEqual(['max', 'standby', 'pause'])
  expect(cells().some((c) => c.classList.contains('on'))).toBe(false)
})
it('a locked cell changes nothing and says what opens it', async () => {
  await mount()
  await click(cells()[5])
  expect(state.sets).toEqual([])
  expect(host.querySelector('.nx-fx-hint')!.textContent).toMatch(/2/)
})
