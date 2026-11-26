// The rows of one project band in the side bar (main.tsx ProjectGroup), computed from the snapshot. Two rules live
// here. A session that is over but whose last message still asks something (Session.asksYou) reads as waiting, not as
// finished. And an automation that reruns is one row under its own name: each of its runs is a session with a freshly
// written title, so a job that runs every three hours would otherwise fill the band with rows that all look new.
// Pure (no React), tested in side-rows.test.ts.
import type { AutoRun, Optimizer, Session, Snapshot } from '../../shared/api.ts'
import { runLine } from '../../shared/run-line.ts'
import { at } from '../../src/ui/auto-model.ts'

/** What a row says: a session's status, plus « asks »: over, and its last message still asks you something. */
export type RowState = 'needs_user' | 'working' | 'asks' | 'interrupted' | 'idle' | 'done'

export interface SideRow {
  /** Stable from one snapshot to the next: the session's id, or `auto:<automation id>`. */
  key: string
  /** An automation's row: its id (what the unfolded state is kept under). Absent on an ordinary session's row. */
  autoId?: string
  /** The session's title, or the automation's (the same at every run). Empty when the session has none yet. */
  title: string
  /** What it holds, newest first: the session itself, or the runs of the automation in this band. A tap on a row
   *  holding one opens it; on a row holding several, it unfolds them. */
  runs: Session[]
  state: RowState
  /** The small line under the title: the question, what it is doing, or (an automation) what came out and when. */
  sub?: string
}

/** One run under its unfolded automation: its own title and mark, and when it last moved. */
export interface RunRow {
  session: Session
  state: RowState
  sub: string
}

/** The finished rows a band shows under « N done »: the newest ones. An automation counts for one, whatever its runs. */
export const DONE_SHOWN = 8

/** What a session that is over still asks (its « Needs you: » line), when it does. Never while it works, waits live
 *  or was cut: those states say more. */
export const asksYou = (s: Pick<Session, 'status' | 'asksYou'>): string | undefined =>
  (s.status === 'done' || s.status === 'idle') && s.asksYou ? s.asksYou : undefined

export const sessionState = (s: Pick<Session, 'status' | 'asksYou'>): RowState => (asksYou(s) ? 'asks' : s.status)

/** The line under a session's title: what waits for you, what it is doing, or what its last message still asks. */
export const sessionSub = (s: Pick<Session, 'status' | 'asksYou' | 'attention' | 'now'>): string | undefined =>
  (s.status === 'needs_user' ? s.attention : s.status === 'working' ? s.now : asksYou(s)) || undefined

/** Needs you first, then what works, what still asks, what was cut, what rests. */
const RANK: Record<RowState, number> = { needs_user: 0, working: 1, asks: 2, interrupted: 3, idle: 4, done: 5 }

/** An automation's own work folder: `.auto/<repo>/<automation id>`, or `.auto/.<automation id>` without a repo. */
const WORK_DIR = /\/\.auto\/(?:[^/]+\/([^/]+)|\.([^/]+))\/?$/

interface Jobs {
  byId: Map<string, Optimizer>
  /** Session id to the automation that ran it, and the line that run left in its list. */
  bySession: Map<string, { auto: Optimizer; run?: AutoRun }>
  /** Runs the person took over: ordinary sessions of theirs from then on, never folded. */
  handedOver: Set<string>
}

function jobsOf(snap: Pick<Snapshot, 'optimizers'>): Jobs {
  const jobs: Jobs = { byId: new Map(), bySession: new Map(), handedOver: new Set() }
  for (const auto of snap.optimizers ?? []) {
    // Not accepted, or refused: nothing of it ever ran under its name.
    if (auto.state === 'proposed' || auto.state === 'refused') continue
    jobs.byId.set(auto.id, auto)
    for (const id of auto.handedOver ?? []) jobs.handedOver.add(id)
    for (const run of auto.runs ?? []) {
      if (!run.sessionId) continue
      if (run.handedOver) jobs.handedOver.add(run.sessionId)
      // Newest first: the first line met for a session is the one that tells how it ended.
      else if (!jobs.bySession.has(run.sessionId)) jobs.bySession.set(run.sessionId, { auto, run })
    }
    // The run in progress is not in the list yet.
    if (auto.sessionId && !jobs.bySession.has(auto.sessionId)) jobs.bySession.set(auto.sessionId, { auto })
  }
  return jobs
}

/** The automation a session is a run of: named by a run of its list, else told by the folder it worked in (a run the
 *  list no longer holds). Null for a session of the person's, a run they took over included. */
function jobOf(jobs: Jobs, s: Session): { auto: Optimizer; run?: AutoRun } | null {
  if (jobs.handedOver.has(s.id)) return null
  const listed = jobs.bySession.get(s.id)
  if (listed) return listed
  const dir = WORK_DIR.exec(s.cwd ?? '')
  const auto = dir ? jobs.byId.get(dir[1] ?? dir[2]) : undefined
  return auto ? { auto } : null
}

const newestFirst = (a: Session, b: Session) => b.openedAt - a.openedAt || b.lastActivityAt - a.lastActivityAt
const lastMoved = (r: SideRow) => Math.max(...r.runs.map((s) => s.lastActivityAt))

function sessionRow(s: Session): SideRow {
  const sub = sessionSub(s)
  return { key: s.id, title: s.title, runs: [s], state: sessionState(s), ...(sub ? { sub } : {}) }
}

/** One automation's row over its runs in this band (newest first). Only its newest run can make it ask: a newer run
 *  of the same job replaces what the older ones asked, so they never light the row. */
function autoRow(auto: Optimizer, runs: Session[], lines: Map<string, AutoRun | undefined>, now: number): SideRow {
  const newest = runs[0]
  const waits = runs.find((s) => s.status === 'needs_user')
  const works = runs.find((s) => s.status === 'working')
  const state: RowState = waits ? 'needs_user' : works ? 'working' : asksYou(newest) ? 'asks' : newest.status === 'interrupted' ? 'interrupted' : 'done'
  let sub: string | undefined
  if (waits) sub = waits.attention
  else if (works) sub = works.now
  else if (state === 'asks') sub = asksYou(newest)
  else {
    // What came out: the line its run left (the list's note says how it ended), else the session's last words.
    const line = lines.get(newest.id)
    const said = (line?.note ? runLine(line.note, line.ok) : '') || runLine(newest.lastMessage ?? '')
    sub = [said, at(newest.lastActivityAt, now)].filter(Boolean).join(' · ')
  }
  return { key: `auto:${auto.id}`, autoId: auto.id, title: auto.title, runs, state, ...(sub ? { sub } : {}) }
}

/**
 * The rows of a project's band. `active`: everything that is not plainly finished, the most pressing first.
 * `done`: the finished rows behind « N done », the newest first, DONE_SHOWN at most (N is their number).
 */
export function bandRows(snap: Pick<Snapshot, 'sessions' | 'optimizers'>, projectId: string, now: number): { active: SideRow[]; done: SideRow[] } {
  const jobs = jobsOf(snap)
  const rows: SideRow[] = []
  const folds = new Map<string, { auto: Optimizer; runs: Session[] }>()
  const lines = new Map<string, AutoRun | undefined>()
  for (const s of snap.sessions) {
    if (s.archived || s.projectId !== projectId) continue
    const job = jobOf(jobs, s)
    if (!job) {
      rows.push(sessionRow(s))
      continue
    }
    lines.set(s.id, job.run)
    const fold = folds.get(job.auto.id)
    if (fold) fold.runs.push(s)
    else folds.set(job.auto.id, { auto: job.auto, runs: [s] })
  }
  for (const { auto, runs } of folds.values()) rows.push(autoRow(auto, runs.sort(newestFirst), lines, now))
  const active = rows.filter((r) => r.state !== 'done').sort((a, b) => RANK[a.state] - RANK[b.state] || newestFirst(a.runs[0], b.runs[0]))
  const done = rows.filter((r) => r.state === 'done').sort((a, b) => lastMoved(b) - lastMoved(a)).slice(0, DONE_SHOWN)
  return { active, done }
}

/** The runs under an unfolded automation, newest first: each with its own mark (one that asked keeps saying so
 *  here, where it is looked for) and the time it last moved. */
export function runRows(row: SideRow, now: number): RunRow[] {
  return row.runs.map((s) => ({ session: s, state: sessionState(s), sub: at(s.lastActivityAt, now) }))
}

/** Is the open session this row's, or one of its runs? */
export const holds = (row: SideRow, sessionId: string | null): boolean => !!sessionId && row.runs.some((s) => s.id === sessionId)
