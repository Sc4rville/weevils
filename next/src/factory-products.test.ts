// Your factory's Projects (factory.tsx productGroups): one row per product, its other repos folded inside it, never
// weevils' own storage, the most recently active first.
import { expect, it } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import { productGroups } from './factory.tsx'

const NOW = 1_800_000_000_000
const H = 3600_000
const self = { id: 'app', name: 'app', kind: 'repo', repos: ['app'], where: {}, lastActivityAt: NOW, installation: true }
const snap = { projects: [self, { id: 'notes', name: 'notes', kind: 'repo', repos: ['notes'], where: {}, lastActivityAt: NOW - 50 * H }] } as unknown as Snapshot
const gh = (name: string, hours: number, description = '') => ({ name, pushedAt: NOW - hours * H, description })

it('folds a product\'s other repos inside its mother, under the app\'s own block too', () => {
  const g = productGroups(snap, [{ id: 'notes', name: 'notes', repos: ['notes'], project: snap.projects[1] }],
    [gh('app-private', 1), gh('app-stats', 2), gh('shop-site', 3), gh('shop', 30), gh('notes', 40), gh('blog', 5)])
  expect(g.map((x) => [x.name, x.parts.join(',')])).toEqual([['app', 'private,stats'], ['shop', 'site'], ['blog', ''], ['notes', '']])
  expect(g.find((x) => x.name === 'shop')!.repos[0]).toBe('shop')
  expect(g[0].self).toBe(true)
})

it('never lists weevils\' own storage repos', () => {
  const g = productGroups(snap, [], [gh('weevbook-vault', 0, 'Encrypted copy kept by weevils'), gh('weevbook-raw-001', 0), gh('blog', 5)])
  expect(g.flatMap((x) => x.repos)).not.toContain('weevbook-vault')
  expect(g.map((x) => x.name)).toEqual(['app', 'blog'])
})

it('a product with no mother repo of its name still reads as one row', () => {
  const g = productGroups({ projects: [] } as unknown as Snapshot, [], [gh('game-web', 1), gh('game-api', 2)])
  expect(g.map((x) => [x.name, x.repos.join(','), x.parts.join(',')])).toEqual([['game', 'game-web,game-api', 'web,api']])
})

it('a product of one repo reads as that repo, never cut into a name and a part', () => {
  const g = productGroups({ projects: [] } as unknown as Snapshot, [], [gh('cash-tempo', 1), gh('site.com', 2)])
  expect(g.map((x) => [x.name, x.parts.length])).toEqual([['cash-tempo', 0], ['site.com', 0]])
})
