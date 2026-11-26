// The side bar shows what is pinned (2026-11-26); a repo or a conversation started with no repo is pinned once, the
// first time it shows up in use, so a fresh install's side bar is never empty; unpinned, it stays out.
import { expect, it } from 'vitest'
import type { Project, Session } from '../shared/api.ts'
import { autoPins, RECENT } from './auto-pins.ts'

const NOW = 1_800_000_000_000
const p = (id: string, ago: number, repos = [id]): Project => ({ id, name: id, kind: 'repo', repos, where: {}, lastActivityAt: NOW - ago }) as Project
const s = (id: string, ago: number, status = 'idle'): Session => ({ id, projectId: 'divers', status, archived: false, lastActivityAt: NOW - ago }) as unknown as Session
const none = { repos: [], sessions: [] }

it('a fresh install pins the repos and the open loose conversations it meets in use, not the old or finished ones', () => {
  const r = autoPins([p('shop', 3600_000), p('old', RECENT + 1)], [s('a', 60_000), s('b', 60_000, 'done'), s('c', RECENT + 1)], { repos: [], sessions: [], firstRun: true }, none, NOW)
  expect(r.pinRepos).toEqual(['shop'])
  expect(r.pinSessions).toEqual(['a'])
  expect(r.met).toEqual({ repos: ['shop', 'old'], sessions: ['a', 'b', 'c'], firstRun: false })
})

it('an install where repos were already pinned keeps that choice: what was there is not pinned on the first run', () => {
  const r = autoPins([p('hendrix', 60_000), p('pli', 60_000)], [s('a', 60_000)], { repos: [], sessions: [], firstRun: true }, { repos: ['pli'], sessions: [] }, NOW)
  expect(r.pinRepos).toEqual([])
  expect(r.pinSessions).toEqual(['a'])
})

it('something met once is never pinned again (unpinned, it stays out); a new one is', () => {
  const r = autoPins([p('hendrix', 60_000), p('fresh', 60_000)], [s('a', 60_000)], { repos: ['hendrix'], sessions: ['a'], firstRun: false }, { repos: ['pli'], sessions: [] }, NOW)
  expect(r.pinRepos).toEqual(['fresh'])
  expect(r.pinSessions).toEqual([])
})
