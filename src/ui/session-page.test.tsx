// @vitest-environment happy-dom
// Session page cleanup: no terminal affordance (screen band, >_ glyph, key names), no raw ids in the header, one way
// to open the settings, plain words everywhere; the real functions (settings, app preview, archive) stay reachable.
import { resetNotices } from './notice-store'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Session, Snapshot } from '../../shared/api.ts'

const calls = vi.hoisted(() => ({ commands: [] as string[], screen: 0 }))

vi.mock('../api', () => ({
  api: {
    session: async () => Promise.reject(new Error('absent')),
    command: async (_id: string, c: string) => (calls.commands.push(c), { ok: true }),
    screen: async () => (calls.screen++, { screen: 'RAW TERMINAL' }),
    transcribeInfo: async () => ({ enabled: false }),
    repos: async () => ({ repos: [] }),
  },
}))
vi.mock('../push', () => ({ ensurePush: async () => {} }))

for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate
globalThis.fetch = (async () => new Response('{}')) as typeof fetch

const { setLang } = await import('../i18n')
const { PageView } = await import('./pages')
const { Ctx } = await import('./app-context')

const NOW = 1_800_000_000_000
const MIN = 60_000

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  projectId: 'p',
  repo: 'weevils',
  machineId: 'vps-machine-42',
  tool: 'claude',
  title: 'refonte',
  status: 'idle',
  cwd: '/home/alex/projects/weevils',
  openedAt: NOW - 60 * MIN,
  lastActivityAt: NOW - 3 * MIN,
  workStartedAt: null,
  origin: 'weevils',
  controllable: true,
  live: true,
  hasScreen: true,
  subagents: [],
  background: 0,
  messageCount: 3,
  queued: 0,
  ...over,
})
const project: Project = { id: 'p', name: 'weevils', kind: 'repo', repos: ['weevils'], where: { weevils: 'vps-machine-42' }, lastActivityAt: NOW - 3 * MIN }

const snap = (sessions: Session[], projects: Project[] = [project]): Snapshot => ({
  version: 1,
  now: NOW,
  machines: [{ id: 'vps-machine-42', name: 'vps', online: true } as never],
  projects,
  sessions,
  h24: [],
  conversations: [],
  conversationCounts: { total: 0, pending: 0, byProject: {} },
  classifier: { running: false, queued: 0 },
  main: [],
  mainWorking: false,
  mainHasScreen: false,
  mainQueued: 0,
  devil: { enabled: false, working: false },
  pinnedRepos: [],
  config: { userName: '', exposeDomain: '', publicHost: '' },
})

let root: Root
let host: HTMLElement

function render(node: React.ReactNode, sessions: Session[], projects?: Project[]) {
  const ctx = {
    snap: snap(sessions, projects),
    now: NOW,
    offline: false,
    colors: {},
    push: () => {},
    replace: () => {},
    back: () => {},
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
  act(() => root.render(<Ctx.Provider value={ctx as never}>{node}</Ctx.Provider>))
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')]
const byText = (s: string) => buttons().find((b) => text(b) === s)

beforeEach(() => {
  resetNotices()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.commands = []
  calls.screen = 0
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

describe('session page: no terminal', () => {
  it('a session running in a weevils pane shows no terminal screen band, glyph or key names, and never polls the screen', async () => {
    render(<PageView page={{ kind: 'session', id: 's1' }} />, [session()])
    await flush()
    const all = text(host)
    expect(all).not.toMatch(/terminal/i)
    expect(all).not.toContain('>_')
    expect(all).not.toMatch(/up arrow|escape|enter\b/)
    expect(host.querySelector('pre.screen')).toBeNull()
    expect(calls.screen).toBe(0)
    // The settings it used to share the page with still open from the header.
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls="session-settings"]')!.click())
    await flush()
    expect(host.querySelector('#session-settings .settings')).not.toBeNull()
    expect(text(host)).not.toMatch(/terminal/i)
  })
})

describe('session page header', () => {
  it('no machine id, no background count, one settings control, plain words for the app preview and queued messages', async () => {
    localStorage.removeItem('weevils-preview:s1')
    render(<PageView page={{ kind: 'session', id: 's1' }} />, [session({ background: 2, queued: 3 })])
    await flush()
    const all = text(host)
    expect(all).not.toContain('vps-machine-42')
    expect(all).not.toContain('in background')
    expect(all).toContain('3 messages waiting')
    expect(byText('settings')).toBeUndefined()
    expect(host.querySelectorAll('button[aria-controls="session-settings"]')).toHaveLength(1)
    expect(byText('browser')).toBeUndefined()
    const see = byText('see the app')!
    await act(async () => see.click())
    expect(byText('close the app')?.getAttribute('aria-pressed')).toBe('true')
    // The header chip opens and closes the settings.
    const chip = host.querySelector<HTMLButtonElement>('button[aria-controls="session-settings"]')!
    await act(async () => chip.click())
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    await act(async () => chip.click())
    expect(chip.getAttribute('aria-pressed')).toBe('false')
  })

  it('an unknown project falls back to "sessions", never to the raw project id', async () => {
    render(<PageView page={{ kind: 'session', id: 's1' }} />, [session({ projectId: 'p-7f3a9c' })], [])
    await flush()
    expect(text(host)).not.toContain('p-7f3a9c')
  })

  it('a session opened outside weevils says so in plain words', async () => {
    render(<PageView page={{ kind: 'session', id: 's1' }} />, [session({ controllable: false })])
    await flush()
    expect(host.querySelector<HTMLInputElement>('.composer input')!.placeholder).toBe('opened outside weevils: read only')
  })
})
