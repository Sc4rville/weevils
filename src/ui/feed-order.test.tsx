// @vitest-environment happy-dom
// Le flux ne bouge pas sous le doigt : deux sessions (ou deux projets) qui écrivent tour à tour ne permutent pas, seul
// un changement de rang (ce qui t'attend) réordonne, et rien ne bouge pendant un geste. Les « terminées » se replient
// même quand elles sont ouvertes d'office (bande ouverte sans session active).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, Session, Snapshot } from '../../shared/api.ts'

vi.mock('../api', () => ({ api: {} }))
vi.mock('../push', () => ({ ensurePush: async () => {} }))

localStorage.setItem('weevils-lang', 'fr')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { ProjectBand } = await import('./bands')
const { Ctx, stableOrder } = await import('./app-context')

const NOW = 1_800_000_000_000
const MIN = 60_000

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  projectId: 'p',
  repo: 'weevils',
  machineId: 'vps',
  tool: 'claude',
  title: id,
  status: 'working',
  cwd: '/x',
  openedAt: NOW - 60 * MIN,
  lastActivityAt: NOW - MIN,
  workStartedAt: NOW - MIN,
  origin: 'weevils',
  controllable: true,
  live: true,
  hasScreen: false,
  subagents: [],
  background: 0,
  messageCount: 3,
  queued: 0,
  ...over,
})
const project: Project = { id: 'p', name: 'weevils', kind: 'repo', repos: ['weevils'], where: { weevils: 'vps' }, lastActivityAt: NOW - MIN }

const snap = (sessions: Session[]): Snapshot => ({
  version: 1,
  now: NOW,
  machines: [],
  projects: [project],
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

describe('stableOrder', () => {
  const id = (x: { id: string }) => x.id
  const rank = (x: { r: number }) => x.r
  const fresh = (a: { at: number }, b: { at: number }) => b.at - a.at
  const ids = (xs: { id: string }[]) => xs.map(id).join(' ')

  it('premier affichage : rang, puis activité', () => {
    const xs = [
      { id: 'a', r: 1, at: 1 },
      { id: 'b', r: 1, at: 3 },
      { id: 'c', r: 0, at: 2 },
    ]
    expect(ids(stableOrder(xs, id, rank, fresh, []))).toBe('c b a')
  })

  it('l’activité seule ne fait pas permuter ; un changement de rang, si', () => {
    const xs = [
      { id: 'a', r: 1, at: 9 },
      { id: 'b', r: 1, at: 3 },
      { id: 'c', r: 2, at: 1 },
    ]
    expect(ids(stableOrder(xs, id, rank, fresh, ['b', 'a', 'c']))).toBe('b a c')
    xs[2].r = 0
    expect(ids(stableOrder(xs, id, rank, fresh, ['b', 'a', 'c']))).toBe('c b a')
  })

  it('un nouveau venu se place en tête de son rang', () => {
    const xs = [
      { id: 'a', r: 1, at: 1 },
      { id: 'n', r: 1, at: 0 },
      { id: 'z', r: 0, at: 0 },
    ]
    expect(ids(stableOrder(xs, id, rank, fresh, ['z', 'a']))).toBe('z n a')
  })

  it('pendant un geste, rien ne bouge ; les nouveaux venus vont à la fin', () => {
    const xs = [
      { id: 'a', r: 2, at: 1 },
      { id: 'b', r: 0, at: 1 },
      { id: 'n', r: 0, at: 5 },
    ]
    expect(ids(stableOrder(xs, id, rank, fresh, ['a', 'b'], true))).toBe('a b n')
  })
})

let root: Root
let host: HTMLElement

function render(sessions: Session[], expanded: string | null = null) {
  const ctx = {
    snap: snap(sessions),
    now: NOW,
    offline: false,
    colors: {},
    push: () => {},
    replace: () => {},
    back: () => {},
    home: () => {},
    expanded,
    setExpanded: () => {},
    h24Open: false,
    setH24Open: () => {},
    theme: 'light' as const,
    setTheme: () => {},
    refresh: () => {},
    logout: () => {},
  }
  act(() => root.render(<Ctx.Provider value={ctx}><ProjectBand project={project} /></Ctx.Provider>))
}
const order = () =>
  Array.from(host.querySelectorAll('.row'))
    .map((r) => r.getAttribute('aria-label') ?? '')
    .filter((l) => /alpha|beta/.test(l))
    .map((l) => (l.includes('alpha') ? 'alpha' : 'beta'))
    .join(' ')

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.removeItem('weevils-collapsed')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('bande projet', () => {
  it('deux sessions qui écrivent tour à tour gardent leur place ; celle qui t’attend passe en tête', () => {
    const a = session('alpha', { openedAt: NOW - 30 * MIN })
    const b = session('beta', { openedAt: NOW - 20 * MIN })
    render([a, b])
    expect(order()).toBe('beta alpha')
    // Le serveur renvoie alpha en premier (activité plus récente) : rien ne bouge.
    render([{ ...a, lastActivityAt: NOW }, b])
    expect(order()).toBe('beta alpha')
    render([{ ...a, status: 'needs_user', attention: 'ok ?' }, b])
    expect(order()).toBe('alpha beta')
  })

  it('« terminées » ouvertes d’office (bande ouverte, rien d’actif) : un tap les replie', () => {
    const d = session('fini', { status: 'done', live: false, workStartedAt: null })
    render([d], 'p')
    const line = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.row')).find((r) => (r.textContent ?? '').includes('termin'))!
    const arrow = () => line().querySelector('.go')!.innerHTML
    const open = arrow()
    act(() => line().click())
    // Avant : le tap passait showDone à false, mais l'ouverture d'office l'emportait ; la flèche restait « ↑ ».
    expect(arrow()).not.toBe(open)
    act(() => line().click())
    expect(arrow()).toBe(open)
  })
})
