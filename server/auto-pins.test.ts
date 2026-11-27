// The side bar shows what is pinned (2026-11-26): a repo is pinned once, the first time it shows up in use, so a fresh
// install's side bar is never empty; unpinned, it stays out. A conversation started with no repo is never pinned
// (2026-11-27). A fresh install pins its most recent GitHub repos once.
import { expect, it } from 'vitest'
import type { Project } from '../shared/api.ts'
import { autoPins, firstGithubPins, GITHUB_RECENT, RECENT } from './auto-pins.ts'

const NOW = 1_800_000_000_000
const p = (id: string, ago: number, repos = [id]): Project => ({ id, name: id, kind: 'repo', repos, where: {}, lastActivityAt: NOW - ago }) as Project

it('a fresh install pins the repos it meets in use, not the old ones', () => {
  const r = autoPins([p('shop', 3600_000), p('old', RECENT + 1)], { repos: [], firstRun: true }, [], NOW)
  expect(r.pinRepos).toEqual(['shop'])
  expect(r.met).toEqual({ repos: ['shop', 'old'], firstRun: false })
})

it('an install where repos were already pinned keeps that choice: what was there is not pinned on the first run', () => {
  expect(autoPins([p('hendrix', 60_000), p('pli', 60_000)], { repos: [], firstRun: true }, ['pli'], NOW).pinRepos).toEqual([])
})

it('something met once is never pinned again (unpinned, it stays out); a new one is', () => {
  expect(autoPins([p('hendrix', 60_000), p('fresh', 60_000)], { repos: ['hendrix'], firstRun: false }, ['pli'], NOW).pinRepos).toEqual(['fresh'])
})

const gh = (name: string, days: number, description = '') => ({ name, pushedAt: NOW - days * 86_400_000, description })

it('a fresh install pins its three most recently pushed GitHub repos, one per product, never weevils nor its storage', () => {
  const repos = [gh('weevbook-vault', 0, 'Encrypted copy kept by weevils'), gh('weevils', 0), gh('weevils-extra', 0.1), gh('shop-api', 0.2), gh('shop-web', 0.3), gh('notes', 1), gh('blog', 2), gh('game', 3)]
  expect(firstGithubPins(repos, [], 'weevils', NOW)).toEqual(['shop-api', 'notes', 'blog'])
})

it('never one switched off, never one untouched for a month', () => {
  expect(firstGithubPins([gh('notes', 1), gh('blog', 2), gh('old', GITHUB_RECENT / 86_400_000 + 1)], ['notes'], undefined, NOW)).toEqual(['blog'])
})
