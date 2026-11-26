// @vitest-environment happy-dom
// A session that is over and whose last message still asks something (Session.asksYou) wears the mark of a session
// that waits on its row, never the check of a finished one.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session, Snapshot } from '../../shared/api.ts'

vi.mock('../api', () => ({ api: { session: async () => Promise.reject(new Error('absent')), transcribeInfo: async () => ({ enabled: false }) } }))
vi.mock('../push', () => ({ ensurePush: async () => {} }))

localStorage.setItem('weevils-language', 'en')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { SessionRow } = await import('./bits')
const { Ctx } = await import('./app-context')

const NOW = new Date(2026, 10, 20, 15, 0).getTime()
const session = (over: Partial<Session> = {}): Session => ({ id: 's1', projectId: 'p', repo: 'shop-app', machineId: 'm', tool: 'claude', title: 'Checking prices', status: 'done', cwd: '/home/user/projects/shop-app', openedAt: NOW, lastActivityAt: NOW, workStartedAt: null, origin: 'weevils', controllable: true, live: false, hasScreen: false, subagents: [], background: 0, messageCount: 2, queued: 0, ...over })
const snap = { version: 1, now: NOW, machines: [], projects: [], sessions: [], h24: [], conversations: [], conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false, mainHasScreen: false, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [], config: { userName: '', exposeDomain: '', publicHost: '' } } as unknown as Snapshot

let root: Root
let host: HTMLElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
function row(s: Session) {
  const ctx = { snap, now: NOW, offline: false, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {}, expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} }
  act(() => root.render(<Ctx.Provider value={ctx as never}>{<SessionRow session={s} />}</Ctx.Provider>))
  const button = host.querySelector('button.row')!
  return { mark: button.querySelector('.st')!.innerHTML, label: button.getAttribute('aria-label') ?? '', tone: button.classList.contains('tone') }
}

it('done or idle with a question left: the mark and the state of a session that waits', () => {
  const waits = row(session({ status: 'needs_user', attention: 'Allow the push?', live: true }))
  const plain = row(session())
  expect(plain.mark).not.toBe(waits.mark)
  expect(plain.label).toContain('done')
  for (const status of ['done', 'idle'] as const) {
    const asks = row(session({ status, asksYou: 'Tap Yes to resume, or Keep it stopped.' }))
    expect(asks.mark).toBe(waits.mark)
    expect(asks.label).toContain('your turn')
    // Only the mark: the row keeps its place and its look, and nothing is announced as a live question.
    expect(asks.tone).toBe(false)
  }
})

it('while it works or once it was cut, its own mark stays', () => {
  const waits = row(session({ status: 'needs_user', attention: 'Allow the push?', live: true }))
  for (const status of ['working', 'interrupted'] as const) {
    expect(row(session({ status, asksYou: 'Tap Yes to resume.' })).mark).toBe(row(session({ status })).mark)
    expect(row(session({ status, asksYou: 'Tap Yes to resume.' })).mark).not.toBe(waits.mark)
  }
})
