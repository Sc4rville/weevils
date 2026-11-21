// @vitest-environment happy-dom
// A new install opens straight into weevboss's conversation (src/ui/setup.tsx startsInChat): the home is never
// rendered first, the conversation does not slide in, and back leaves it for the home. An install that is set up, a
// machine without weevboss, and a launch that asks for something else (a notification's session) are unchanged.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useApp, type Page } from './ui/app-context'
type Setup = { welcomed: boolean; ready?: boolean }
const live = vi.hoisted(() => ({ snap: { version: 1, now: 1, sessions: [], projects: [], h24: [], main: [], config: {}, devil: { enabled: false }, setup: undefined as unknown }, authed: true, refresh: () => {}, setAuthed: () => {} }))
vi.mock('./api', () => ({ useLive: () => live, api: {} }))
vi.mock('./push', () => ({ ensurePush: async () => {} }))
vi.mock('./ui/hints', () => ({ loadHints: async () => {}, HintBubble: () => null, markSeen: () => {} }))
vi.mock('./ui/relay', () => ({ RelayBand: () => null }))
vi.mock('./ui/h24', () => ({ H24Rail: () => null }))
vi.mock('./ui/tips', () => ({ Tips: () => null }))
vi.mock('./ui/coach', () => ({ GestureCoach: () => null }))
vi.mock('./ui/auto-talk', () => ({ TalkProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./ui/bands', () => ({ AgentBand: () => <Probe />, ProjectBand: () => null, FootBand: () => null }))
vi.mock('./ui/pages', () => ({ PageView: ({ page }: { page: Page }) => <div className="page" data-kind={page.kind} data-target={'id' in page ? page.id : undefined} /> }))
import App from './App'

/** Every state the weevboss band was rendered in, in order: a home shown first, even for one frame, would be here. */
let rendered: (string | null)[]
function Probe() {
  const c = useApp()
  rendered.push(c.expanded)
  return <section className="band agent" data-open={c.expanded === 'agent'}><form className="composer"><textarea aria-label="message to weevboss" /></form></section>
}
let host: HTMLDivElement, root: Root, entries: unknown[], cursor: number
const flush = () => act(() => new Promise(r => setTimeout(r, 30)))
const open = () => host.querySelector('section')?.getAttribute('data-open') === 'true'
const finePointer = (fine: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: fine && q === '(pointer: fine)', media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
async function launch(setup: Setup | undefined, hash = '') {
  live.snap = { ...live.snap, setup }
  location.hash = hash
  await act(async () => root.render(<App />))
  await flush()
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  MotionGlobalConfig.skipAnimations = true
  rendered = []; entries = [{ w: 0 }]; cursor = 0
  vi.spyOn(history, 'replaceState').mockImplementation(state => { entries[cursor] = state })
  vi.spyOn(history, 'pushState').mockImplementation(state => { entries.splice(cursor + 1); entries.push(state); cursor++ })
  const go = (delta = 0) => { cursor = Math.max(0, cursor + delta); window.dispatchEvent(new PopStateEvent('popstate', { state: entries[cursor] })) }
  vi.spyOn(history, 'go').mockImplementation(go)
  vi.spyOn(history, 'back').mockImplementation(() => go(-1))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  finePointer(false)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); location.hash = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('a new install opens straight into weevboss’s conversation: the home is never shown first, back leaves for it', async () => {
  await launch({ welcomed: false, ready: false })
  expect(open()).toBe(true)
  expect(rendered.length).toBeGreaterThan(0)
  expect(new Set(rendered)).toEqual(new Set(['agent']))
  // One history entry for the conversation, like a conversation opened by hand: back closes it onto the home.
  expect(entries).toEqual([{ w: 0 }, { w: 0, agent: true }])
  await act(async () => history.back()); await flush()
  expect(open()).toBe(false); expect(cursor).toBe(0)
  expect(host.querySelector('main')!.inert).toBe(false)
})

it('still there at every launch until a subscription is signed in, then the app opens on the home again', async () => {
  await launch({ welcomed: true, ready: false })
  expect(open()).toBe(true)
  await act(async () => root.unmount())
  root = createRoot(host); rendered = []; entries = [{ w: 0 }]; cursor = 0
  await launch({ welcomed: true, ready: true })
  expect(open()).toBe(false)
  expect(new Set(rendered)).toEqual(new Set([null]))
  expect(entries).toEqual([{ w: 0 }])
})

it('a machine without weevboss has no first run', async () => {
  await launch(undefined)
  expect(open()).toBe(false); expect(entries).toEqual([{ w: 0 }])
})

it('ready to type: the field has the focus where a keyboard is at hand, and waits for a tap on a phone', async () => {
  await launch({ welcomed: false })
  expect(document.activeElement?.tagName).not.toBe('TEXTAREA')
  await act(async () => root.unmount())
  root = createRoot(host); entries = [{ w: 0 }]; cursor = 0
  finePointer(true)
  await launch({ welcomed: false })
  expect(document.activeElement).toBe(host.querySelector('textarea'))
})

it('a launch from a notification keeps its destination: the session, not the conversation', async () => {
  await launch({ welcomed: false, ready: false }, '#s=abc')
  expect(open()).toBe(false)
  expect(host.querySelector('.page')?.getAttribute('data-kind')).toBe('session')
  expect(host.querySelector('.page')?.getAttribute('data-target')).toBe('abc')
})
