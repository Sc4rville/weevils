// @vitest-environment happy-dom
// The first run is a conversation with weevboss: the app asks weevilsd for the welcome (src/ui/setup.tsx useWelcome),
// weevboss's thread opens on its hello, and there is nothing else: no tour, no card, no button, no step to tick. The
// person answers in the ordinary composer.
import { act } from 'react'
import { MotionGlobalConfig } from 'motion/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Message, Snapshot } from '../../shared/api.ts'

const server = vi.hoisted(() => ({ welcome: [] as unknown[], main: [] as string[] }))
vi.mock('../api', () => ({
  api: {
    setupWelcome: async (device: unknown) => {
      server.welcome.push(device)
      return { ok: true, mid: 'setup-hello' }
    },
    main: async (text: string) => void server.main.push(text),
    usageRate: async () => ({ step: 15_000, end: Date.now(), buckets: [] }),
    foryou: async () => ({ rev: 1, items: [], pulse: { working: 0, waiting: 0, delivered: 0, auto: 0 } }),
    foryouSeen: async () => ({ ok: true }),
  },
}))
vi.mock('../push', () => ({ ensurePush: async () => {} }))
vi.mock('../outbox', async (orig) => ({ ...(await orig<typeof import('../outbox')>()), useOutbox: () => [] }))
vi.mock('./voice', () => ({ VoiceLogo: () => null }))

const { AgentBand } = await import('./bands')
const { Ctx } = await import('./app-context')
const { FOCUS_BOSS } = await import('./follow')
const { resetForYou } = await import('./foryou-store')

const HELLO =
  'Hi Sam, I’m weevboss. I can already see your 3 projects (weevils, notes and site). To think, I use your own Claude subscription. Open [Claude’s sign-in page](https://claude.ai/oauth/authorize?code=abc), accept, then paste the code it shows here.'

const snap = (main: Message[], welcomed: boolean): Snapshot =>
  ({
    version: 1, now: Date.now(), machines: [], projects: [], sessions: [], h24: [], conversations: [],
    conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 },
    main, mainWorking: false, mainHasScreen: false, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [],
    config: { userName: 'Sam', exposeDomain: '', publicHost: '' },
    setup: { provider: 'claude', ready: false, claude: false, voice: false, dictation: false, github: false, welcomed },
  }) as Snapshot

let root: Root
let host: HTMLElement
let focused: { mid?: string }[]
const onFocus = (e: Event) => void focused.push((e as CustomEvent<{ mid?: string }>).detail)

function render(s: Snapshot, open: boolean) {
  const ctx = {
    snap: s, now: Date.now(), offline: false, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {},
    expanded: open ? 'agent' : null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {},
    refresh: () => {}, logout: () => {},
  }
  act(() =>
    root.render(
      <Ctx.Provider value={ctx}>
        <AgentBand />
      </Ctx.Provider>,
    ),
  )
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 30)))

const animate = Element.prototype.animate
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true
  ;(Element.prototype as { animate?: unknown }).animate = undefined
})
afterAll(() => void (Element.prototype.animate = animate))
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  server.welcome = []
  server.main = []
  focused = []
  localStorage.clear()
  resetForYou()
  window.addEventListener(FOCUS_BOSS, onFocus)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  window.removeEventListener(FOCUS_BOSS, onFocus)
})

it('opens weevboss’s thread on its hello, with nothing else to read, tap or tick', async () => {
  render(snap([], false), false)
  await flush()
  // Asked once, and the thread is opened on the hello weevilsd wrote.
  expect(server.welcome).toHaveLength(1)
  expect(focused).toEqual([{ mid: 'setup-hello' }])
  // What the app shows next (App opens the band on that event; the snapshot carries the hello).
  render(snap([{ id: 'setup-hello', role: 'assistant', text: HELLO, at: Date.now() }], true), true)
  await flush()
  expect(document.body.textContent).toContain('Hi Sam, I’m weevboss.')
  expect(document.body.textContent).toContain('paste the code it shows here')
  expect(document.body.querySelector('a[href="https://claude.ai/oauth/authorize?code=abc"]')).not.toBeNull()
  for (const sel of ['.setup-chip', '.setup-chips', '.setup-form', '.setup-qr', '.tip', '.hint', '[role=dialog]']) expect([sel, document.body.querySelector(sel)]).toEqual([sel, null])
  expect(document.body.textContent).not.toMatch(/step \d|étape \d/i)
  // The answer goes through the ordinary composer, like any message to weevboss.
  expect(document.body.querySelector('form.composer:not(.setup-form) textarea, form.composer:not(.setup-form) input:not([type=file])')).not.toBeNull()
})

it('a device that comes after the welcome opens nothing and asks nothing', async () => {
  render(snap([{ id: 'setup-hello', role: 'assistant', text: HELLO, at: 1 }], true), false)
  await flush()
  expect(server.welcome).toEqual([])
  expect(focused).toEqual([])
})
