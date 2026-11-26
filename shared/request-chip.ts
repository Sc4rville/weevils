// Where a request stands, read from facts: its ledger row and the real state of the session it was last sent to.
// One rule for every reader: the requests list (src/ui/requests.tsx re-exports it) and the server, which counts with
// it how many requests wait on the person. Pure, tested in request-chip.test.ts.

import type { SessionStatus } from './api.ts'
import type { AskStatus, Outcome } from './ledger.ts'

export type Chip = 'queued' | 'running' | 'blocked' | 'needs' | 'check' | 'paused' | 'done' | 'dropped'

/** What the rule reads of a request: a row of the ledger's view fits, and so does the server's own ask (which has no
 *  `stale` of its own: staleness never decides « needs you », read before it). */
export interface ChipAsk {
  status: AskStatus
  dispatches: readonly { session: string; at: number; outcome?: Outcome }[]
  stale?: boolean
}

/** What the rule reads of a session. */
export interface ChipSession {
  id: string
  status: SessionStatus
  workStartedAt?: number | null
}

/** A session's state as a request reads it: 'gone' when it no longer exists, undefined when nothing was sent. */
export type ChipState = SessionStatus | 'gone' | undefined

/**
 * The one word that says where a request stands, read from the real session it was sent to (never from the ledger's
 * « dispatched » alone: a session gone for days is not running). `session`: its state, 'gone' when it no longer
 * exists, undefined when nothing was sent.
 */
export function chipOf(a: ChipAsk, session?: SessionStatus | 'gone'): Chip {
  if (a.status === 'done') return 'done'
  if (a.status === 'dropped') return 'dropped'
  const d = a.dispatches.at(-1)
  if (!d) return 'queued'
  if (session === 'working') return 'running'
  // What is left is the user's (an answer, a restart, a merge): it waits on them however long ago, session gone or not.
  if (session === 'needs_user' || d.outcome === 'question') return 'needs'
  // Its session finished long ago, or no longer exists, and nobody closed it: nothing is happening, said plainly
  // (a failure days old included: it opens with the report).
  if (a.stale || session === 'gone') return 'paused'
  if (session === 'interrupted' || d.outcome === 'failed') return 'blocked'
  return 'check'
}

/** Requests sent to one session within this long of its latest one came in the same brief: one job. */
const SAME_BRIEF_MS = 2 * 60_000

/**
 * The state of the session a request was last sent to, as the list reads it. A working session works on what it was
 * sent last (the latest brief, or anything sent since its current turn began): an older request on that same session
 * is not « running » any more, its turn ended, so it reads as a session at rest (it came back, to check).
 */
export function stateIn(asks: readonly ChipAsk[], sessions: readonly ChipSession[]): (a: ChipAsk) => ChipState {
  const byId = new Map(sessions.map((x) => [x.id, x]))
  const latest = new Map<string, number>()
  for (const a of asks) {
    const d = a.dispatches.at(-1)
    if (d) latest.set(d.session, Math.max(latest.get(d.session) ?? 0, d.at))
  }
  return (a) => {
    const d = a.dispatches.at(-1)
    if (!d) return undefined
    const s = byId.get(d.session)
    if (!s) return 'gone'
    if (s.status !== 'working') return s.status
    const current = d.at >= (latest.get(d.session) ?? 0) - SAME_BRIEF_MS || (!!s.workStartedAt && d.at >= s.workStartedAt - 60_000)
    return current ? 'working' : 'idle'
  }
}

/**
 * How many requests wait on the person: the open ones (open or sent) whose row reads « needs you » in the list. Give
 * it the same requests as the list, closed ones included: a session's latest brief may be a request closed since, and
 * that is what tells an older question on a working session from the work in hand. One pass over the list to find
 * each session's latest brief, then one word read per open request; nothing is read for a closed one.
 */
export function waitingCount(asks: readonly ChipAsk[], sessions: readonly ChipSession[]): number {
  const state = stateIn(asks, sessions)
  let n = 0
  for (const a of asks) {
    if (a.status !== 'open' && a.status !== 'dispatched') continue
    if (chipOf(a, state(a)) === 'needs') n++
  }
  return n
}
