// The ideas on a new page (pages.tsx): drawn from the person's own weevils — their automations (the busiest first),
// their projects (the most recent first) — mixed with two that fit anyone; never a proposal, a draft, weevils itself,
// Misc or automations' own folder.
import { expect, it } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import { ideasFor, pageOf } from './pages.tsx'

const snap = (over: Partial<Snapshot>) => ({ optimizers: [], projects: [], sessions: [], ...over }) as unknown as Snapshot
const project = (id: string, at: number, extra = {}) => ({ id, name: id, kind: 'repo', repos: [id], where: {}, lastActivityAt: at, ...extra })

it('takes ideas from the automations and projects, in turns', () => {
  const ideas = ideasFor(snap({
    optimizers: [
      { id: 'a', title: 'Nightly tests', state: 'done', runCount: 2 },
      { id: 'b', title: 'Funding hunter', state: 'running', runCount: 9 },
      { id: 'c', title: 'An idea', state: 'proposed', runCount: 0 },
      { id: 'd', title: 'Half made', state: 'done', draft: true },
    ] as never,
    projects: [project('blog', 1), project('shop', 5), project('divers', 9, { kind: 'invented' }), project('auto', 9), project('installation:x', 9, { kind: 'installation', installation: {} })] as never,
  }))
  expect(ideas.slice(0, 6)).toEqual([
    'A visualizer for Funding hunter',
    'A studio for shop',
    'A live map of what my agents are doing right now',
    'A live board of every run of Nightly tests',
    'A map of everything happening in blog',
    'My week of requests, as a timeline',
  ])
  expect(ideas.join(' ')).not.toMatch(/An idea|Half made|divers|installation/)
})

it('still has ideas on a blank install', () => {
  expect(ideasFor(snap({}))).toEqual(['A live map of what my agents are doing right now', 'My week of requests, as a timeline'])
})

it('opens a page made in the band in its studio, any other as a living link', () => {
  expect(pageOf({ slug: 'a', title: 'A', kind: 'preview', path: '/p/preview/a', session: 's' })).toEqual({ kind: 'page-studio', slug: 'a' })
  expect(pageOf({ slug: 'b', title: 'B', kind: 'report', path: '/p/report/b' })).toEqual({ kind: 'webpage', path: '/p/report/b', title: 'B', pageKind: 'report' })
})
