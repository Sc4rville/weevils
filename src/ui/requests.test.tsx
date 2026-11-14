// @vitest-environment happy-dom
// Requests page: a request sent to a session whose name was never recorded says « a session », never a raw session id;
// the page title carries no glyph.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LedgerView } from '../../shared/ledger.ts'
import type { Snapshot } from '../../shared/api.ts'

const NOW = 1_800_000_000_000
const view: LedgerView = {
  goals: [],
  asks: [{ id: 'r7', text: 'Fix the login page', quote: 'fix the login', src: 'm1', from: 'user', at: NOW - 60_000, kind: 'task', status: 'dispatched', dispatches: [{ session: '0a1b2c3d4e5f6789', at: NOW - 50_000 }], progressAt: NOW - 50_000, stale: false }],
  pending: [],
  trace: [],
  knowledge: [],
  digestTokens: 0,
}
vi.mock('../api', () => ({ api: { ledger: async () => view, askAction: async () => ({}) } }))
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const { setLang } = await import('../i18n')
const { RequestsPage } = await import('./requests')
const { Ctx } = await import('./app-context')

const snap = { version: 1, now: NOW, machines: [], projects: [], sessions: [], h24: [], conversations: [], conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false, mainHasScreen: true, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [], config: { userName: '', exposeDomain: '', publicHost: '' } } as unknown as Snapshot

let root: Root
let host: HTMLElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
})

it('a request sent to an unnamed session says « a session », never its id; no glyph in the title', async () => {
  const ctx = { snap, now: NOW, offline: false, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} }
  await act(async () => root.render(<Ctx.Provider value={ctx as never}><RequestsPage /></Ctx.Provider>))
  await act(async () => {})
  const text = host.textContent ?? ''
  expect(text).toContain('sent to a session')
  expect(text).not.toContain('0a1b2c3d')
  expect(text).not.toContain('! requests')
})
