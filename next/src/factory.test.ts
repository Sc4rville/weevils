// Which projects the side bar shows (factory.tsx inSideBar): pinned always; the others while they have conversations;
// taken out in Your factory, only while one of them works or needs you.
import { expect, it } from 'vitest'
import type { Project, Snapshot } from '../../shared/api.ts'
import { inSideBar } from './factory.tsx'

const p = (id: string): Project => ({ id, name: id, kind: 'repo', repos: [id], where: {}, lastActivityAt: 0 })
const snap = (over: Partial<Snapshot>) => ({ pinnedRepos: [], hiddenProjects: [], sessions: [], ...over }) as unknown as Snapshot

it('shows a pinned project even with no conversation', () => {
  expect(inSideBar(snap({ pinnedRepos: ['shop'] }), p('shop'))).toBe(true)
  expect(inSideBar(snap({}), p('shop'))).toBe(false)
})
it('shows a project with conversations unless taken out, and brings it back while it works', () => {
  const done = { id: 's', projectId: 'shop', status: 'done', archived: false }
  expect(inSideBar(snap({ sessions: [done] as never }), p('shop'))).toBe(true)
  expect(inSideBar(snap({ sessions: [done] as never, hiddenProjects: ['shop'] }), p('shop'))).toBe(false)
  expect(inSideBar(snap({ sessions: [{ ...done, status: 'working' }] as never, hiddenProjects: ['shop'] }), p('shop'))).toBe(true)
})
