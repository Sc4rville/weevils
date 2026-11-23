// Which projects the side bar shows (factory.tsx): switched off in Your factory, never (at once, whatever its
// conversations do); pinned, always; the others while they have conversations. A flip shows at once and holds until
// the server agrees. Your factory's Projects keeps an off project listed, in place, to switch it back on.
import { afterEach, expect, it } from 'vitest'
import type { Project, Snapshot } from '../../shared/api.ts'
import { factoryProjects, flipProject, inSideBar, mothersOf, shownNow } from './factory.tsx'

const p = (id: string, repos = [id]): Project => ({ id, name: id, kind: 'repo', repos, where: {}, lastActivityAt: 0 })
const snap = (over: Partial<Snapshot>) => ({ pinnedRepos: [], hiddenProjects: [], sessions: [], projects: [], ...over }) as unknown as Snapshot
afterEach(() => { flipProject('shop', null) })

it('shows a pinned project even with no conversation', () => {
  expect(inSideBar(snap({ pinnedRepos: ['shop'] }), p('shop'))).toBe(true)
  expect(inSideBar(snap({}), p('shop'))).toBe(false)
})
it('switched off, a project leaves at once, even while its conversation works or needs you', () => {
  const s = { id: 's', projectId: 'shop', status: 'done', archived: false }
  expect(inSideBar(snap({ sessions: [s] as never }), p('shop', ['shop-web']))).toBe(true)
  for (const status of ['done', 'working', 'needs_user', 'interrupted'])
    expect(inSideBar(snap({ sessions: [{ ...s, status }] as never, hiddenProjects: ['shop'] }), p('shop', ['shop-web']))).toBe(false)
})
it('a flipped switch shows at once and is not undone by a snapshot that does not know it yet', () => {
  const s = snap({ sessions: [{ id: 's', projectId: 'shop', status: 'working', archived: false }] as never })
  flipProject('shop', false)
  expect(shownNow(s, p('shop'))).toBe(false)
  flipProject('shop', true)
  expect(shownNow(snap({ hiddenProjects: ['shop'] }), p('shop'))).toBe(true)
})
it('keeps an off project listed in Projects, in a fixed order, even once its last pin is gone', () => {
  const rows = factoryProjects(snap({ projects: [p('weevils'), p('shop', ['shop-web']), p('auto')], hiddenProjects: ['shop', 'notes'] }))
  expect(rows.map((r) => r.id)).toEqual(['notes', 'shop', 'weevils'])
})
it('Projects never lists an automation folder, even one switched off', () => {
  const rows = factoryProjects(snap({ projects: [p('auto', ['auto-084b98e88f'])], hiddenProjects: ['auto-2061533ece', 'auto', 'ants'] }))
  expect(rows.map((r) => r.id)).toEqual(['ants'])
})
it('an older machine’s plain folder list still comes out as one band per product', () => {
  expect(mothersOf(['game', 'game-gpu', 'game-v3-drop-fin', 'auto-2061533ece', 'automations', 'shop-site'])).toEqual([
    { id: 'game', name: 'game', repos: ['game', 'game-gpu', 'game-v3-drop-fin'] },
    { id: 'shop', name: 'shop', repos: ['shop-site'] },
  ])
})

it('on demand: switching a provider on, off or first renumbers the fallback order at once, in the server’s order', async () => {
  const { reorder } = await import('./factory.tsx')
  const od = (id: string, rank: number | null, connected = true) => ({ id, name: id, key: `${id.toUpperCase()}_API_KEY`, connected, rank, credit: null, perHour: null, console: '' }) as never
  const list = [od('runpod', 1), od('vast', 2), od('lambda', null, false)]
  const ids = (l: { id: string; rank: number | null }[]) => l.map((x) => [x.id, x.rank])
  expect(ids(reorder(list, 'vast', 'first'))).toEqual([['vast', 1], ['runpod', 2], ['lambda', null]])
  expect(ids(reorder(list, 'runpod', 'off'))).toEqual([['vast', 1], ['runpod', null], ['lambda', null]])
  expect(ids(reorder(reorder(list, 'runpod', 'off'), 'runpod', 'on'))).toEqual([['vast', 1], ['runpod', 2], ['lambda', null]])
})
