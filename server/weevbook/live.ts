// Which turns the dispatcher may place (docs/spec/06-dispatch.md, « Activation »). Switching threads on in an install
// with history must start nothing: the weevbook already holds thousands of turns the shadow writer recorded (failed on
// a provider error, cut short, held by the connector before a dispatcher existed). Only a turn weevils filed itself
// (the app, the connector), while the dispatcher ran, is live; every other turn is closed for good and never reaches
// an engine.

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { JournalEvent, TurnEvent } from './journal.ts'
import { WAITS_FOR_YOU, type Turn } from './turn.ts'

/** A request that waited this long without an engine is dropped: it ends as « expired, ask again » (05-connector.md). */
export const REQUEST_EXPIRES = 3600_000
/** The dispatcher stopped longer than this (threads off, weevilsd down): what waited across the gap is closed. */
export const RUN_GAP = 10 * 60_000

/** What the dispatcher does with a turn that waits for an engine. */
export type Liveness =
  /** Its to place. */
  | 'live'
  /** Never its to place: closed (`stopped`) when weevils next writes to the thread, never sent to an engine. */
  | 'theirs'
  /** Its, but it waited too long, or across a time the dispatcher was not running: closed now. */
  | 'expired'
  | 'stopped'

/** The turn waits for an engine: accepted, failed, or held for a reason the table can lift. */
export const waitsForEngine = (t: Turn) => t.state === 'accepted' || t.state === 'failed' || (t.state === 'held' && !WAITS_FOR_YOU.includes(t.held?.reason ?? ''))

/** Weevils has a turn of its own waiting in the thread: the dispatcher takes the thread over from its provider sessions. */
export const oursWaiting = (events: readonly JournalEvent[], turns: readonly Turn[], since: number, now: number) => turns.some((t) => waitsForEngine(t) && liveness(events, t, since, now) === 'live')

/** The message that opened the turn was filed by weevils (the app, the connector): a source of its own and a key. */
export function filedByWeevils(events: readonly JournalEvent[], t: Turn): boolean {
  if (!t.message) return false
  const m = events.find((e) => e.id === t.message)
  return m?.type === 'message' && (m.source === 'weevils' || m.source === 'connector') && !!m.key
}

/** When the turn last moved by itself: its last event that is not a hold (a hold only says why it still waits). */
export function movedAt(events: readonly JournalEvent[], turn: number): number {
  const e = events.findLast((x): x is TurnEvent => x.type === 'turn' && x.turn === turn && x.state !== 'held')
  return e ? Date.parse(e.at) : 0
}

/**
 * A turn that waits for an engine (accepted, failed, or held for a reason the table can lift), judged at `now` by a
 * dispatcher that has been running without a gap since `since`.
 *
 * - Not filed by weevils (typed in the provider's own session, or a step-1 backfill): `theirs`.
 * - Filed by weevils, but it last moved before this run of the dispatcher began (it came before threads were on, or
 *   waited while the dispatcher was off): closed, `expired` when no engine ever had it, else `stopped`.
 * - Filed by weevils, and it has waited more than an hour since it last moved, unless it is held for `no-room` (the
 *   app promised a time for that one): `expired` when no engine ever had it, else `stopped`.
 */
export function liveness(events: readonly JournalEvent[], t: Turn, since: number, now: number): Liveness {
  if (!filedByWeevils(events, t)) return 'theirs'
  const ran = t.attempts.some((a) => a.ran)
  const moved = movedAt(events, t.turn)
  if (moved < since) return ran ? 'stopped' : 'expired'
  if (t.state === 'held' && t.held?.reason === 'no-room') return 'live'
  if (now - moved > REQUEST_EXPIRES) return ran ? 'stopped' : 'expired'
  return 'live'
}

/** DATA_DIR/threads-on.json: when the dispatcher's current run began, and when it was last seen running. */
interface RunFile {
  v: 1
  since: number
  seen: number
}

/**
 * The start of the dispatcher's current run, kept on disk: a restart within RUN_GAP goes on with the same run; the
 * first start ever, or one after a longer stop, begins a new one at `now`.
 */
export async function beginRun(file: string, now: number): Promise<number> {
  let prev: RunFile | null = null
  try {
    const j = JSON.parse(await fsp.readFile(file, 'utf8')) as RunFile
    if (j?.v === 1 && Number.isFinite(j.since) && Number.isFinite(j.seen)) prev = j
  } catch {
    /* none yet */
  }
  const since = prev && now - prev.seen <= RUN_GAP && prev.since <= now ? prev.since : now
  await saveRun(file, since, now)
  return since
}

/** The run goes on (written about once a minute). */
export async function saveRun(file: string, since: number, now: number) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify({ v: 1, since, seen: now } satisfies RunFile)}\n`, { mode: 0o600 })
  await fsp.rename(tmp, file)
}
