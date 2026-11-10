// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api'
import { setLang, tr } from '../i18n'
import M from '../i18n/tour'
const state = vi.hoisted(() => ({ snap: null as unknown as Snapshot, run: vi.fn(async () => ({ ok: true })), intro: vi.fn(async () => ({})) }))
vi.mock('../api', () => ({ api: { tour: async () => null, tourAct: state.intro } }))
vi.mock('./setup', () => ({ runBrick: state.run, device: () => ({ mobile: false }), useFlow: () => null, PhoneLink: () => null }))
vi.mock('./app-context', async original => ({ ...await original<typeof import('./app-context')>(), useApp: () => ({ snap: state.snap }) }))
import { TourIntro } from './tour'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => {
  setLang('en'); localStorage.clear(); sessionStorage.clear()
  state.run.mockClear(); state.intro.mockClear(); MotionGlobalConfig.skipAnimations = true
  state.snap = { config: { userName: '' }, projects: [], sessions: [], main: [], setup: { claude: false, codex: false, provider: 'claude', ready: false, providers: { claude: true, codex: true }, voice: false, dictation: false, github: false, welcomed: false }, tour: { open: true, intro: false, finished: false, steps: [{ id: 'machine', state: 'ready' }, { id: 'claude', state: 'todo' }, { id: 'codex', state: 'todo' }] } } as unknown as Snapshot
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })
async function show() {
  await act(async () => root.render(<TourIntro />))
  await act(async () => host.querySelector<HTMLElement>('.tr-intro')!.click())
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))
it('offers both real subscription login paths and records the explicitly selected provider', async () => {
  await show()
  expect(button(tr(M).plugClaude)).toBeDefined()
  expect(button(tr(M).plugCodex)).toBeDefined()
  await act(async () => button(tr(M).plugCodex)!.click())
  expect(state.run).toHaveBeenCalledWith('codex', true)
  expect(state.intro).toHaveBeenCalledWith('intro')
})
it('lets a connected Codex user make the first request without requiring Claude', async () => {
  Object.assign(state.snap.setup!, { provider: 'codex', ready: true, codex: true, claude: false })
  await show()
  expect(host.textContent).toContain(tr(M).firstTitle)
  expect(button(tr(M).plugClaude)).toBeUndefined()
  expect(button(tr(M).plugCodex)).toBeUndefined()
})
it('does not advertise Codex when the server has no real connection capability', async () => {
  state.snap.setup!.providers!.codex = false
  await show()
  expect(button(tr(M).plugCodex)).toBeUndefined()
  expect(button(tr(M).plugClaude)).toBeDefined()
})
it('does not treat a connected backup agent as the selected agent being ready', async () => {
  Object.assign(state.snap.setup!, { provider: 'codex', ready: false, codex: false, claude: true })
  await show()
  expect(host.textContent).toContain(tr(M).providerFirst)
  expect(host.textContent).not.toContain(tr(M).firstTitle)
})
