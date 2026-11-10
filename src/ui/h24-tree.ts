// The « auto » band's content, as a tree the drawer folds: category (a project, or the machine) → group (proposed
// tasks the user accepted, timers, jobs) → task. Pure: built from the snapshot, tested in h24-tree.test.ts.
import type { H24Activity, Optimizer, Snapshot } from '../../shared/api.ts'
import { tr } from '../i18n'
import F from '../i18n/format'

/** What a task is doing, as one colour. waiting: accepted, held until the machine is free; queued: behind another one. */
export type TaskState = 'running' | 'waiting' | 'queued' | 'scheduled' | 'paused' | 'done' | 'failed'
export type TaskKind = 'optimizer' | 'timer' | 'job'

export interface AutoTask {
  id: string
  kind: TaskKind
  title: string
  state: TaskState
  /** waiting: what holds it (busy, load, ram); queued: its place in the line (2 = next after the running one). */
  waiting?: Optimizer['waiting']
  place?: number
  nextAt?: number | null
  every?: number | null
  startedAt?: number | null
  endedAt?: number | null
  since?: number | null
  priority?: 1 | 2 | 3
  est?: number
  heavy?: boolean
  sessionId?: string
  /** A timer: paused or resumed with one tap. */
  toggle?: boolean
  demo?: boolean
  note?: string
}

export interface AutoGroup {
  id: string
  kind: TaskKind
  tasks: AutoTask[]
}

export interface AutoCategory {
  id: string
  /** The project (its colour, its name); null: the machine itself. */
  projectId: string | null
  groups: AutoGroup[]
}

const ORDER: Record<TaskState, number> = { running: 0, waiting: 1, queued: 2, scheduled: 3, paused: 4, failed: 5, done: 6 }
const KIND_ORDER: Record<TaskKind, number> = { optimizer: 0, timer: 1, job: 2 }
/** Active: something happens now or soon (a category or group holding one opens by default). */
export const ACTIVE = new Set<TaskState>(['running', 'waiting', 'queued'])

export function fromOptimizer(o: Optimizer): AutoTask | null {
  if (o.state === 'proposed' || o.state === 'refused') return null
  const state: TaskState = o.state === 'queued' ? (o.waiting === 'queue' || !o.waiting ? 'queued' : 'waiting') : o.state
  return {
    id: o.id,
    kind: 'optimizer',
    title: o.title,
    state,
    waiting: o.waiting,
    startedAt: o.startedAt ?? null,
    endedAt: o.endedAt ?? null,
    since: o.createdAt,
    priority: o.priority,
    est: o.est,
    heavy: o.heavy,
    sessionId: o.sessionId,
    note: o.lastEvent,
  }
}

export function fromActivity(a: H24Activity): AutoTask {
  const state: TaskState =
    a.runState === 'running' ? 'running' : a.runState === 'paused' ? 'paused' : a.kind === 'timer' ? 'scheduled' : 'done'
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    state,
    nextAt: a.kind === 'timer' && a.runState !== 'paused' ? (a.nextRunAt ?? null) : null,
    every: a.everyMs ?? null,
    startedAt: a.runState === 'running' ? a.runStartedAt : null,
    endedAt: a.kind === 'job' && a.runState !== 'running' ? (a.lastRunAt ?? a.runStartedAt) : null,
    since: a.since ?? null,
    toggle: a.canToggle,
    demo: a.demo,
    note: a.lastEvent,
  }
}

const byState = (a: AutoTask, b: AutoTask) =>
  ORDER[a.state] - ORDER[b.state] ||
  (a.state === 'scheduled' ? (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) : 0) ||
  (b.endedAt ?? 0) - (a.endedAt ?? 0) ||
  a.title.localeCompare(b.title)

/** The tree of the drawer: categories with something running first, the machine last. */
export function autoTree(snap: Pick<Snapshot, 'projects' | 'h24' | 'optimizers'>): AutoCategory[] {
  const known = new Set(snap.projects.map((p) => p.id))
  const projectOfRepo = (repo: string | null) => (repo ? (snap.projects.find((p) => p.repos.includes(repo))?.id ?? null) : null)
  const cats = new Map<string, AutoCategory>()
  const add = (projectId: string | null, t: AutoTask) => {
    const cid = projectId ?? ''
    let c = cats.get(cid)
    if (!c) cats.set(cid, (c = { id: cid || '__machine', projectId, groups: [] }))
    let g = c.groups.find((x) => x.kind === t.kind)
    if (!g) c.groups.push((g = { id: `${c.id}:${t.kind}`, kind: t.kind, tasks: [] }))
    g.tasks.push(t)
  }
  // Accepted tasks: their place in the line (the running one is first).
  const line = (snap.optimizers ?? []).filter((o) => o.state === 'queued')
  for (const o of snap.optimizers ?? []) {
    const t = fromOptimizer(o)
    if (!t) continue
    if (o.state === 'queued') t.place = line.indexOf(o) + 1 + Number((snap.optimizers ?? []).some((x) => x.state === 'running'))
    add(projectOfRepo(o.repo), t)
  }
  for (const a of snap.h24) {
    const pid = a.projectId && known.has(a.projectId) ? a.projectId : a.group && known.has(a.group) ? a.group : null
    add(pid, fromActivity(a))
  }
  const out = [...cats.values()]
  for (const c of out) {
    c.groups.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    for (const g of c.groups) g.tasks.sort(byState)
  }
  const score = (c: AutoCategory) => {
    const all = c.groups.flatMap((g) => g.tasks)
    return [all.filter((t) => t.state === 'running').length, all.filter((t) => ACTIVE.has(t.state)).length]
  }
  return out.sort((a, b) => {
    if (!a.projectId !== !b.projectId) return a.projectId ? -1 : 1
    const [ra, aa] = score(a)
    const [rb, ab] = score(b)
    return rb - ra || ab - aa || (a.projectId ?? '').localeCompare(b.projectId ?? '')
  })
}

export const tasksOf = (x: AutoCategory | AutoGroup): AutoTask[] => ('groups' in x ? x.groups.flatMap((g) => g.tasks) : x.tasks)

/** Count per state, for the folded aggregate (mini bar) and the head. */
export function counts(tasks: AutoTask[]): Record<TaskState, number> {
  const out = { running: 0, waiting: 0, queued: 0, scheduled: 0, paused: 0, done: 0, failed: 0 }
  for (const t of tasks) out[t.state]++
  return out
}

export const STATES = Object.keys(ORDER) as TaskState[]

/** Compact duration for bold numbers: 14m, 2h, 1h30, 3j (3d); coarse: whole hours (« 6h ago », not « 6h01 »). */
export function short(ms: number, coarse = false): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h < 24) return r && h < 10 && !coarse ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
  return tr(F).days(Math.round(h / 24))
}

/** Folded or not, remembered per category and group; by default open when it holds something active or little. */
export function openByDefault(tasks: AutoTask[]): boolean {
  return tasks.some((t) => ACTIVE.has(t.state)) || tasks.length <= 3
}
