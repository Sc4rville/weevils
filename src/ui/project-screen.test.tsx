// @vitest-environment happy-dom
// The open project: its request column (every request of the project, whatever its state), then its sessions.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../shared/api.ts'
import type { LedgerView } from '../../shared/ledger.ts'

const ledger: { v: LedgerView } = { v: { goals: [], asks: [], pending: [], trace: [], knowledge: [], digestTokens: 0 } }
vi.mock('../api', () => ({ api: { ledger: async () => ledger.v, tempo: async () => { throw new Error('none') } } }))
localStorage.setItem('weevils-language', 'en')
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { ProjectPage, requestsOf } = await import('./project-screen')
const { Ctx } = await import('./app-context')

const NOW = 1_800_000_000_000
const MIN = 60_000
const project = { id: 'p', name: 'weevils' }

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, projectId: 'p', repo: 'weevils', machineId: 'vps', tool: 'claude', title: `title ${id}`, status: 'working', cwd: '/x',
  openedAt: NOW - 60 * MIN, lastActivityAt: NOW - MIN, workStartedAt: NOW - MIN, origin: 'weevils', controllable: true,
  live: true, hasScreen: true, subagents: [], background: 0, messageCount: 1, queued: 0, ...over,
})
type Row = LedgerView['asks'][number]
const ask = (id: string, over: Partial<Row> = {}): Row => ({
  id, text: `text ${id}`, quote: `words ${id}`, src: 'j1', from: 'user', at: NOW - 10 * MIN, kind: 'task', status: 'dispatched',
  dispatches: [], progressAt: NOW, stale: false, ...over,
})
const sent = (sessionId: string, label?: string) => [{ session: sessionId, label, at: NOW - 5 * MIN }]

describe('a project\'s requests', () => {
  const others = session('other', { projectId: 'q' })
  it('belong by the session they were sent to, by its label when that session is gone, by name when never sent; closed ones stay', () => {
    const asks = [
      ask('mine', { dispatches: sent('a') }),
      ask('theirs', { dispatches: sent('other') }),
      ask('gone', { dispatches: sent('zz', 'weevils · claude · old work') }),
      ask('goneElse', { dispatches: sent('zz', 'content · claude · episode') }),
      ask('named', { status: 'open', text: 'make the weevils install page calmer' }),
      ask('unnamed', { status: 'open', text: 'buy milk' }),
      ask('closed', { status: 'done', dispatches: sent('a') }),
    ]
    expect(requestsOf(asks, project, [session('a'), others]).map((x) => x.id).sort()).toEqual(['closed', 'gone', 'mine', 'named'])
  })
})

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

describe('page', () => {
  it('the request column (what runs on top, short titles, done ones kept), then every session: open ones first, finished ones newest first, 6 then the rest on a tap', async () => {
    ledger.v = { ...ledger.v, asks: [ask('old', { status: 'done', title: 'Old thing', at: NOW - 90 * MIN, dispatches: sent('d0') }), ask('q', { status: 'open', text: 'make the weevils page calmer', title: 'Calmer weevils page', at: NOW - 5 * MIN }), ask('r', { title: 'Install page fix', at: NOW - 30 * MIN, dispatches: sent('w') }), ask('else', { dispatches: sent('other') })] }
    const done = Array.from({ length: 8 }, (_, i) => session(`d${i}`, { status: 'done', title: `done ${i}`, lastActivityAt: NOW - (i + 2) * 60 * MIN }))
    const sessions = [...done, session('w', { now: 'running tests' }), session('other', { projectId: 'q' }), session('a', { status: 'archived' as never, archived: true })]
    const ctx = { snap: { sessions, projects: [{ id: 'p', name: 'weevils', kind: 'repo', repos: ['weevils'], where: {}, lastActivityAt: NOW }], machines: [], version: 1, asksOpen: 1 }, colors: {}, now: NOW, push: () => {}, back: () => {} } as never
    await act(async () => root.render(<Ctx.Provider value={ctx}><ProjectPage projectId="p" /></Ctx.Provider>))
    await act(async () => new Promise((r) => setTimeout(r, 10)))
    expect([...host.querySelectorAll('.rc-title')].map((e) => e.textContent)).toEqual(['Install page fix', 'Calmer weevils page', 'Old thing'])
    expect([...host.querySelectorAll('.rc-row')].map((r) => !!r.querySelector('.rc-star .ic'))).toEqual([true, false, false])
    const names = () => [...host.querySelectorAll('.session-name')].map((e) => e.textContent)
    expect(names()).toEqual(['title w', 'done 0', 'done 1', 'done 2', 'done 3', 'done 4', 'done 5'])
    const older = host.querySelector<HTMLButtonElement>('.pj-older button')!
    expect(older.textContent).toBe('2 older sessions')
    act(() => older.click())
    expect(names()).toHaveLength(9)
  })
})
