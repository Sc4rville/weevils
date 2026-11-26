// @vitest-environment happy-dom
// A busy weevils (2026-11-26): the snapshot moves faster than a session's thread comes back. One fetch at a time,
// once more if the snapshot moved meanwhile, and every answer is shown: the history appears as soon as one comes back
// (newest.ts), never a pile of fetches each throwing the last one away.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, Session, SessionDetail, Snapshot } from '../../shared/api.ts'

const pending = vi.hoisted(() => [] as ((d: unknown) => void)[])
vi.mock('../api', () => ({
  api: {
    session: () => new Promise((resolve) => pending.push(resolve)),
    modelControls: async () => ({ threadId: 's1', tool: 'claude', models: [], selected: { model: 'opus', effort: 'high' }, active: false, appliesTo: 'next-turn' }),
    transcribeInfo: async () => ({ enabled: false }),
  },
}))
vi.mock('../push', () => ({ ensurePush: async () => {} }))
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const { setLang } = await import('../i18n')
const { PageView } = await import('./pages')
const { Ctx } = await import('./app-context')

const NOW = 1_800_000_000_000
const session: Session = {
  id: 's1', projectId: 'divers', repo: null, machineId: 'laptop', tool: 'claude', title: 'Casting to the TV', status: 'interrupted',
  cwd: '/home/alex', openedAt: NOW - 60_000, lastActivityAt: NOW - 30_000, workStartedAt: null, origin: 'terminal', controllable: true,
  live: false, hasScreen: false, subagents: [], background: 0, messageCount: 2, queued: 0,
} as unknown as Session
const msg = (id: string, role: Message['role'], text: string): Message => ({ id, role, text, at: NOW - 40_000 }) as Message
const detail = (texts: string[]): SessionDetail => ({ session, messages: texts.map((t, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user', t)) }) as SessionDetail
const snap = (version: number): Snapshot => ({
  version, now: NOW, machines: [{ id: 'laptop', name: 'laptop', online: true }], projects: [], sessions: [session], h24: [], conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} }, classifier: { running: false, queued: 0 }, main: [], mainWorking: false,
  mainHasScreen: false, mainQueued: 0, devil: { enabled: false, working: false }, pinnedRepos: [], config: { userName: '', exposeDomain: '', publicHost: '' },
}) as unknown as Snapshot

let root: Root
let host: HTMLElement
const replace = () => {}
function render(version: number) {
  const ctx = { snap: snap(version), now: NOW, offline: false, colors: {}, push: () => {}, replace, back: () => {}, home: () => {}, expanded: null,
    setExpanded: () => {}, h24Open: false, setH24Open: () => {}, theme: 'light' as const, setTheme: () => {}, refresh: () => {}, logout: () => {} }
  act(() => root.render(<Ctx.Provider value={ctx as never}><PageView page={{ kind: 'session', id: 's1' }} /></Ctx.Provider>))
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))
const thread = () => (host.querySelector('.session-thread')?.textContent ?? '').replace(/\s+/g, ' ')

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pending.length = 0
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

describe('a conversation always shows its history', () => {
  it('shows the answer that comes back even though the snapshot moved on meanwhile, then fetches once more', async () => {
    render(1)
    render(2)
    render(3)
    expect(pending).toHaveLength(1)
    await act(async () => pending[0](detail(['put the episode on the TV', 'Pairing the PC with the TV box first.'])))
    await flush()
    expect(thread()).toContain('put the episode on the TV')
    expect(thread()).toContain('Pairing the PC with the TV box first.')
    // The snapshot moved twice during that fetch: exactly one more, and its answer is shown too.
    expect(pending).toHaveLength(2)
    await act(async () => pending[1](detail(['put the episode on the TV', 'Done, it is playing.'])))
    await flush()
    expect(thread()).toContain('Done, it is playing.')
    expect(pending).toHaveLength(2)
  })
})
