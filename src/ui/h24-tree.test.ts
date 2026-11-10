import { describe, expect, it } from 'vitest'
import type { H24Activity, Optimizer, Project } from '../../shared/api.ts'
import { autoTree, counts, fromActivity, fromOptimizer, openByDefault, short, tasksOf } from './h24-tree'

const NOW = 1_800_000_000_000
const project = (id: string, repos: string[]): Project => ({ id, name: id, kind: 'repo', repos, where: {}, lastActivityAt: 0 })
const opt = (o: Partial<Optimizer>): Optimizer => ({ id: 'o', title: 't', why: '', repo: null, kind: 'tests', heavy: false, state: 'queued', createdAt: NOW, ...o })
const act = (a: Partial<H24Activity>): H24Activity => ({ id: 'job:x', title: 'x', kind: 'job', projectId: null, schedule: '', enabled: true, runState: 'waiting', runStartedAt: null, lastEvent: '', canToggle: false, ...a })

describe('auto tree', () => {
  it('maps states: queued with a machine reason waits, behind another is queued; timers are scheduled or paused', () => {
    expect(fromOptimizer(opt({ waiting: 'load' }))!.state).toBe('waiting')
    expect(fromOptimizer(opt({ waiting: 'queue' }))!.state).toBe('queued')
    expect(fromOptimizer(opt({ state: 'proposed' }))).toBeNull()
    expect(fromOptimizer(opt({ state: 'refused' }))).toBeNull()
    expect(fromActivity(act({ kind: 'timer', runState: 'waiting', nextRunAt: NOW + 60_000 }))).toMatchObject({ state: 'scheduled', nextAt: NOW + 60_000 })
    expect(fromActivity(act({ kind: 'timer', runState: 'paused', nextRunAt: NOW }))).toMatchObject({ state: 'paused', nextAt: null })
    expect(fromActivity(act({ runState: 'waiting', lastRunAt: NOW - 1 }))).toMatchObject({ state: 'done', endedAt: NOW - 1 })
  })

  it('category = project (repo or job family), else the machine, last; groups by kind; running first', () => {
    const tree = autoTree({
      projects: [project('mygame', ['mygame', 'mygame-site']), project('notes', ['notes'])],
      optimizers: [
        opt({ id: 'a', repo: 'mygame-site', state: 'done', endedAt: NOW }),
        opt({ id: 'b', repo: null, state: 'queued', waiting: 'busy' }),
        opt({ id: 'c', repo: 'notes', state: 'running', startedAt: NOW }),
        opt({ id: 'p', repo: 'notes', state: 'proposed' }),
      ],
      h24: [act({ id: 'job:mygame-build', projectId: 'mygame' }), act({ id: 'timer:wv-notes-sync.timer', kind: 'timer', group: 'notes' }), act({ id: 'job:misc', projectId: 'misc' })],
    })
    expect(tree.map((c) => c.projectId)).toEqual(['notes', 'mygame', null])
    expect(tree[0].groups.map((g) => g.kind)).toEqual(['optimizer', 'timer'])
    expect(tree[1].groups.map((g) => g.kind)).toEqual(['optimizer', 'job'])
    expect(tasksOf(tree[2]).map((t) => t.id)).toEqual(['b', 'job:misc'])
    expect(tasksOf(tree[0]).some((t) => t.id === 'p')).toBe(false)
  })

  it('a queued task knows its place in line (after the running one)', () => {
    const tree = autoTree({
      projects: [],
      optimizers: [opt({ id: 'r', state: 'running' }), opt({ id: 'q1', waiting: 'queue' }), opt({ id: 'q2', waiting: 'queue' })],
      h24: [],
    })
    const tasks = tasksOf(tree[0])
    expect(tasks.find((t) => t.id === 'q1')!.place).toBe(2)
    expect(tasks.find((t) => t.id === 'q2')!.place).toBe(3)
  })

  it('counts, default folding and compact durations', () => {
    const tasks = [fromOptimizer(opt({ state: 'done' }))!, fromOptimizer(opt({ state: 'done' }))!, fromOptimizer(opt({ state: 'done' }))!, fromOptimizer(opt({ state: 'failed' }))!]
    expect(counts(tasks)).toMatchObject({ done: 3, failed: 1, running: 0 })
    expect(openByDefault(tasks)).toBe(false)
    expect(openByDefault([...tasks, fromOptimizer(opt({ waiting: 'queue' }))!])).toBe(true)
    expect(short(14 * 60_000)).toBe('14m')
    expect(short(90 * 60_000)).toBe('1h30')
    expect(short(6 * 3600_000 + 60_000, true)).toBe('6h')
    expect(short(12 * 3600_000)).toBe('12h')
    expect(short(3 * 24 * 3600_000)).toBe('3d')
  })
})
