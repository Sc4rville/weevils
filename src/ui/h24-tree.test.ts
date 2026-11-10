import { describe, expect, it } from 'vitest'
import type { H24Activity, Optimizer, Project } from '../../shared/api.ts'
import { DRAWER_SLOT, PROP_PALETTE, autoTree, counts, failedLine, fromActivity, fromOptimizer, hueGap, openByDefault, propColors, short, tasksOf } from './h24-tree'

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
    // Held by its own time (negotiated: not before, a window, its next run): planned, with when and how often.
    expect(fromOptimizer(opt({ waiting: 'time', startAt: NOW + 3600_000, every: 7 * 86_400_000, window: { from: 60, to: 360 } }))).toMatchObject({ state: 'scheduled', nextAt: NOW + 3600_000, every: 7 * 86_400_000, window: { from: 60, to: 360 } })
    expect(fromOptimizer(opt({ waiting: 'later', retryAt: NOW + 60_000 }))).toMatchObject({ state: 'waiting', nextAt: NOW + 60_000 })
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

  it('a task held by its time (or a retry) is not in the line: the one-off behind it is next', () => {
    const tree = autoTree({
      projects: [],
      optimizers: [opt({ id: 'daily', waiting: 'time', every: 86_400_000 }), opt({ id: 'late', waiting: 'later' }), opt({ id: 'now', waiting: undefined })],
      h24: [],
    })
    const tasks = tasksOf(tree[0])
    expect(tasks.find((t) => t.id === 'now')!.place).toBe(1)
    expect(tasks.find((t) => t.id === 'daily')!.place).toBeUndefined()
    expect(tasks.find((t) => t.id === 'late')!.place).toBeUndefined()
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

  it('a finished job whose last line says it failed is failed; a running one, a clean end or a timer is not', () => {
    for (const line of ['✗ 3 failed — exit 1', 'npm ERR! code ELIFECYCLE', 'Command failed with exit code 2', 'exited with status 127', 'Error: ENOENT', 'FATAL: out of memory', 'Traceback (most recent call last):', 'build aborted'])
      expect(failedLine(line), line).toBe(true)
    for (const line of ['✓ 1203 files, 0 errors', 'no errors found', 'exit 0', 'errors: 0', 'Tests 12 passed, 0 failed', 'linking', '—', ''])
      expect(failedLine(line), line).toBe(false)
    expect(fromActivity(act({ runState: 'waiting', lastEvent: 'npm ERR! code 1', lastRunAt: NOW })).state).toBe('failed')
    expect(fromActivity(act({ runState: 'waiting', lastEvent: 'done, 0 errors' })).state).toBe('done')
    expect(fromActivity(act({ runState: 'running', lastEvent: 'error: retrying' })).state).toBe('running')
    expect(fromActivity(act({ kind: 'timer', runState: 'waiting', lastEvent: 'failed' })).state).toBe('scheduled')
  })

  it('proposal colours: far from the head amber and the band below, apart from each other, kept while they stay', () => {
    expect(hueGap('p2', 'p3')).toBe(1)
    expect(hueGap('p0', 'p15')).toBe(1)
    expect(hueGap('p1', 'p14')).toBe(3)
    const first = propColors(['a', 'b', 'c'], new Map(), null)
    expect([...first.values()]).toEqual(PROP_PALETTE.slice(0, 3))
    // Whatever band sits below: three colours, none close to it nor to the drawer, none next to another.
    for (let i = 0; i < 16; i++) {
      const c = [...propColors(['a', 'b', 'c'], new Map(), `p${i}`).values()]
      for (const x of c) expect(Math.min(hueGap(x, `p${i}`), hueGap(x, DRAWER_SLOT)), `${x} on p${i}`).toBeGreaterThanOrEqual(3)
      for (const [j, x] of c.entries()) for (const y of c.slice(j + 1)) expect(hueGap(x, y), `${x} by ${y}`).toBeGreaterThanOrEqual(2)
    }
    // The band below turns to the first column's hue: that one changes, the others stay.
    const below = propColors(['a', 'b', 'c'], first, first.get('a')!)
    expect(below.get('a')).not.toBe(first.get('a'))
    expect(below.get('b')).toBe(first.get('b'))
    expect(below.get('c')).toBe(first.get('c'))
    // One leaves: the others keep their colour, the newcomer takes a free one.
    const next = propColors(['b', 'c', 'd'], below, null)
    expect(next.get('b')).toBe(first.get('b'))
    expect(next.get('c')).toBe(first.get('c'))
    expect(new Set(next.values()).size).toBe(3)
  })
})
