// The turn as a transaction: accepted → held | assigned → running → done | failed, and what follows a failure.
// Specified in docs/spec/01-thread.md ("The turn") and docs/spec/04-resume.md ("When a turn fails").
//
// Pure: a reducer over turn events, the retry rule as a function of the turns, and the signed preface a resumed
// attempt receives instead of the user's message. No clock, no disk. Used by resume.ts (step 3); the dispatcher of
// step 4 will use the rest.

import type { JournalEvent, TurnEvent, TurnState } from './journal.ts'

/** A turn that failed this many times on `api` or `auth` is held with the reason `attempts` (docs/spec/04-resume.md). */
export const MAX_ATTEMPTS = 3

export type Effect = 'none' | 'some'
export type FailReason = 'quota' | 'auth' | 'api' | 'machine-lost' | 'lease-lost'
/** The failures that count toward MAX_ATTEMPTS: the turn broke an engine. A quota that ran out or a machine that went
 *  away is not the turn's doing; the dispatcher's table bounds those (`no-room`, `no-machine`). */
export const COUNTED: readonly FailReason[] = ['api', 'auth']
/** The `reason` of a held turn: the app maps each to one sentence and one action (docs/spec/06-dispatch.md).
 *  `expired`: a request that waited more than an hour without an engine (05-connector.md, step 4). `stopped`: a turn
 *  the dispatcher will never place: weevils did not file it (it was typed in the provider's own session, or came
 *  before threads were on), or it waited too long after it had run (06-dispatch.md, « Activation »).
 *  `agreement`: the table chose another account, machine or provider, and that move waits for the person's yes
 *  (07-vault.md, step 4); it goes on by itself once agreed. */
export type HoldReason = 'no-machine' | 'no-room' | 'not-signed-in' | 'only-there' | 'attempts' | 'expired' | 'stopped' | 'agreement'
/** Held for a reason the table cannot lift: the turn waits for the person (try again, ask again, write again), and the
 *  turns after it are served. */
export const WAITS_FOR_YOU: readonly string[] = ['attempts', 'expired', 'stopped']

export interface Attempt {
  attempt: number
  engine: string
  resume: boolean
  rule: string
  /** The engine had the request (`running` was written). */
  ran: boolean
  end?: { state: 'done' } | { state: 'failed'; reason: FailReason; effect: Effect }
}
export interface Turn {
  turn: number
  state: TurnState
  /** The message that opened the turn; null when the engine opened it itself. */
  message: string | null
  attempts: Attempt[]
  /** `some` once any attempt had an effect. Sticky: every later attempt resumes (RESUME-8). */
  effect: Effect
  held: { rule: string; reason: string } | null
}

/** The fields of one `turn` event, as the journal has them. */
export type TurnChange = Pick<TurnEvent, 'turn' | 'state'> & Partial<Pick<TurnEvent, 'message' | 'engine' | 'attempt' | 'resume' | 'rule' | 'reason' | 'effect'>>

export class TurnError extends Error {}
const fail = (why: string): never => {
  throw new TurnError(why)
}

/** Turns that wait for an engine: accepted, failed, or held for a reason the table can lift. */
const open = (t: Turn) => t.state === 'accepted' || t.state === 'failed' || (t.state === 'held' && !WAITS_FOR_YOU.includes(t.held?.reason ?? ''))
const live = (t: Turn) => t.state === 'assigned' || t.state === 'running'
/** The attempts of a turn that count toward MAX_ATTEMPTS: those that failed on `api` or `auth`. */
export const counted = (t: Turn) => t.attempts.filter((a) => a.end?.state === 'failed' && COUNTED.includes(a.end.reason)).length

/**
 * One step of the state machine. Throws TurnError on a move the spec forbids: a state out of order, a second turn in
 * an engine's hands (THREAD-11), a turn served before an older one, an attempt after three that failed on `api` or
 * `auth`, an attempt number or a `resume`
 * that does not follow from the attempts before (THREAD-10, RESUME-8), an effect before the engine had the request.
 */
export function applyTurn(turns: readonly Turn[], c: TurnChange): Turn[] {
  const out = [...turns]
  if (c.state === 'accepted') {
    if (c.turn !== turns.length + 1) fail(`turn ${c.turn} accepted, expected ${turns.length + 1}`)
    if (c.message === undefined) fail('accepted without its message')
    out.push({ turn: c.turn, state: 'accepted', message: c.message ?? null, attempts: [], effect: 'none', held: null })
    return out
  }
  const t = turns[c.turn - 1] ?? fail(`turn ${c.turn} was never accepted`)
  const next: Turn = { ...t, attempts: [...t.attempts] }
  const last = next.attempts[next.attempts.length - 1]
  switch (c.state) {
    case 'held':
      if (!open(t)) fail(`turn ${t.turn} is ${t.state}${t.held ? ` (${t.held.reason})` : ''}: it cannot be held`)
      if (!c.rule || !c.reason) fail('held without its rule and reason')
      if (c.reason === 'attempts' && counted(t) < MAX_ATTEMPTS) fail(`held for attempts after ${counted(t)} counted failures`)
      if (t.state === 'failed' && counted(t) >= MAX_ATTEMPTS && c.reason !== 'attempts' && c.reason !== 'expired' && c.reason !== 'stopped') fail('a turn out of attempts is held for attempts')
      if (c.reason === 'expired' && t.attempts.some((a) => a.ran)) fail('only a request no engine ever had expires')
      next.held = { rule: c.rule!, reason: c.reason! }
      break
    case 'assigned': {
      if (!open(t)) fail(`turn ${t.turn} is ${t.state}${t.held ? ` (${t.held.reason})` : ''}: it cannot be assigned`)
      if (counted(t) >= MAX_ATTEMPTS) fail(`turn ${t.turn} failed ${MAX_ATTEMPTS} times on api or auth`)
      const busy = turns.find(live)
      if (busy) fail(`turn ${busy.turn} is still ${busy.state}`)
      const older = turns.find((o) => o.turn < t.turn && open(o))
      if (older) fail(`turn ${older.turn} is older and still ${older.state}`)
      if (!c.engine || !c.rule) fail('assigned without its engine and rule')
      const attempt = t.attempts.length + 1
      if (c.attempt !== attempt) fail(`attempt ${c.attempt}, expected ${attempt}`)
      if ((c.resume === true) !== (t.effect === 'some')) fail(t.effect === 'some' ? 'an attempt after an effect must resume' : 'resume without an earlier effect')
      next.attempts.push({ attempt, engine: c.engine!, resume: c.resume === true, rule: c.rule!, ran: false })
      next.held = null
      break
    }
    case 'running':
      if (t.state !== 'assigned') fail(`turn ${t.turn} runs from ${t.state}`)
      next.attempts[next.attempts.length - 1] = { ...last, ran: true }
      break
    case 'done':
      if (t.state !== 'running') fail(`turn ${t.turn} is done from ${t.state}`)
      next.attempts[next.attempts.length - 1] = { ...last, end: { state: 'done' } }
      break
    case 'failed': {
      if (!live(t)) fail(`turn ${t.turn} fails from ${t.state}`)
      if (!c.reason || (c.effect !== 'none' && c.effect !== 'some')) fail('failed without its reason and effect')
      if (t.state === 'assigned' && c.effect !== 'none') fail('an effect before the engine had the request')
      next.attempts[next.attempts.length - 1] = { ...last, end: { state: 'failed', reason: c.reason as FailReason, effect: c.effect! } }
      if (c.effect === 'some') next.effect = 'some'
      break
    }
    default:
      fail(`unknown state ${String(c.state)}`)
  }
  next.state = c.state
  out[t.turn - 1] = next
  return out
}

/** The turns of a journal, in order. Throws TurnError when the journal breaks the state machine. */
export function turnsOf(events: readonly JournalEvent[]): Turn[] {
  let turns: Turn[] = []
  for (const e of events) if (e.type === 'turn' && e.v === 1) turns = applyTurn(turns, e)
  return turns
}

// ---------------------------------------------------------------- what comes next

export type Next =
  /** Every turn is done, or held for a reason only the person lifts (attempts: "Try again"; expired: ask again;
   *  stopped: write again). */
  | { kind: 'quiet' }
  /** A turn is in an engine's hands. */
  | { kind: 'busy'; turn: number; state: 'assigned' | 'running' }
  /** The oldest waiting turn needs an engine: ask the dispatcher. `open`: every waiting turn, oldest first. */
  | { kind: 'dispatch'; turn: number; attempt: number; resume: boolean; request: 'message' | 'preface'; retry: boolean; open: number[] }
  /** The oldest waiting turn has failed three times on `api` or `auth`: hold it, without asking the dispatcher. */
  | { kind: 'hold'; turn: number; rule: 'hold'; reason: 'attempts' }

/**
 * The retry rule. Never stuck: a failed turn always leads to `dispatch` or `hold` (RESUME-9). Turns are served
 * oldest first; a turn held for attempts does not block the ones after it.
 */
export function next(turns: readonly Turn[]): Next {
  const busy = turns.find(live)
  if (busy) return { kind: 'busy', turn: busy.turn, state: busy.state as 'assigned' | 'running' }
  const waiting = turns.filter(open)
  const t = waiting[0]
  if (!t) return { kind: 'quiet' }
  if (counted(t) >= MAX_ATTEMPTS) return { kind: 'hold', turn: t.turn, rule: 'hold', reason: 'attempts' } // i18n-ignore: journal data (DISP-2)
  const resume = t.effect === 'some'
  return {
    kind: 'dispatch',
    turn: t.turn,
    attempt: t.attempts.length + 1,
    resume,
    // RESUME-8: the user's message is a new request only while no attempt had an effect.
    request: resume ? 'preface' : 'message',
    retry: t.attempts.length > 0,
    open: waiting.map((w) => w.turn),
  }
}

/** The `assigned` event for the dispatcher's choice: attempt and resume follow from the turn. */
export function assign(turns: readonly Turn[], turn: number, engine: string, rule: string, reason: string): TurnChange {
  const t = turns[turn - 1]
  return { turn, state: 'assigned', engine, attempt: t.attempts.length + 1, ...(t.effect === 'some' ? { resume: true } : {}), rule, reason }
}

/** The `held` events for a decision that finds no engine: every waiting turn, unless it already says the same. */
export function holdAll(turns: readonly Turn[], rule: string, reason: string): TurnChange[] {
  return turns.filter((t) => open(t) && !(t.state === 'held' && t.held?.rule === rule && t.held.reason === reason)).map((t) => ({ turn: t.turn, state: 'held', rule, reason }))
}

/**
 * The effect of the attempt that is stopping, from the journal: `some` when a tool step or an answer was written
 * since its `running`. (The adapter also compares the folder with the last checkpoint; that is the caller's.)
 */
export function effectOf(events: readonly JournalEvent[], turn: number): Effect {
  let i = events.length - 1
  while (i >= 0 && !(events[i].type === 'turn' && (events[i] as TurnEvent).turn === turn && (events[i] as TurnEvent).state === 'running')) i--
  if (i < 0) return 'none'
  for (const e of events.slice(i + 1)) if (e.type === 'tool' || (e.type === 'message' && e.role === 'assistant')) return 'some'
  return 'none'
}

/**
 * What the machine that steals the lease writes about the turn at work: `failed` with `machine-lost`. Effect `none`
 * when the engine never had the request; `some` once it had it, since what it did after its last push is unknown.
 */
export function stolen(turns: readonly Turn[]): TurnChange | null {
  const t = turns.find(live)
  if (!t) return null
  return { turn: t.turn, state: 'failed', reason: 'machine-lost', effect: t.state === 'running' ? 'some' : 'none' }
}

// ---------------------------------------------------------------- the preface

/** The signature of the preface: the adapter does not take it for a message of the thread (docs/spec/01-thread.md). */
export const prefaceSign = (thread: string) => `[from:weevbook;thread:${thread}]`

/**
 * The first request of an attempt that resumes a turn after an effect (docs/spec/04-resume.md): what was asked, the
 * steps the journal recorded for this turn, where the folder stands, and the warning about steps outside the folder.
 * It is not the user's message given again: it tells the engine that this is a continuation.
 */
export function preface(thread: string, events: readonly JournalEvent[], turn: number): string {
  const accepted = events.find((e): e is TurnEvent => e.type === 'turn' && e.turn === turn && e.state === 'accepted')
  const asked = accepted?.message ? events.find((e) => e.id === accepted.message) : undefined
  let from = accepted ? events.indexOf(accepted) : events.length
  const steps: string[] = []
  const failures: string[] = []
  let checkpoint: string | null = null
  for (; from < events.length; from++) {
    const e = events[from]
    if (e.type === 'tool') steps.push(`- ${e.summary}`)
    else if (e.type === 'turn' && e.turn === turn && e.state === 'failed') failures.push(`${e.reason}`)
    else if (e.type === 'checkpoint' && e.turn === turn) checkpoint = e.kind === 'none' ? null : (e.commit ?? null)
  }
  const lines = [
    `${prefaceSign(thread)} You are continuing turn ${turn} of this thread. An earlier attempt stopped part-way (${failures.join(', ') || 'stopped'}).`,
    '',
    'What was asked:',
    asked && asked.type === 'message' ? asked.text : '(the engine opened this turn itself)',
    '',
    'Steps already recorded in this turn:',
    ...(steps.length ? steps : ['- none recorded']),
    '',
    checkpoint ? `The folder was saved at checkpoint ${checkpoint}; steps after it may be missing from the folder.` : 'No checkpoint of this turn: steps above may be missing from the folder.',
    '',
    'Look before redoing anything. Do not repeat a step that acts outside this folder (a deploy, a payment, an e-mail, a push) without checking that it did not already happen.',
  ]
  return `${lines.join('\n')}\n`
}
