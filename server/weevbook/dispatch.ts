// The dispatcher's decision: which engine takes a turn. Specified in docs/spec/06-dispatch.md.
//
// A table read top to bottom over the engine table that machines publish, the reservation ledger and the time. Pure:
// no model, no randomness, the same input always gives the same decision (DISP-1), and the decision says which row
// matched and the facts it used (DISP-2). Nothing in the app imports this module yet.

import { parseEngine, type JournalEvent, type Provider, type TurnEvent } from './journal.ts'

// ---------------------------------------------------------------- the numbers (docs/spec/README.md, constants)

/** A thread stays on its engine while the account is under this (percent of a window). */
export const STAY_UNDER = 97
/** A thread enters an account only under this. */
export const ENTER_UNDER = 85
/** A thread goes back to its first provider only under this, on both windows. */
export const BACK_UNDER = 50
/** …and after this many turns done where it is. */
export const BACK_AFTER = 2
/** Points of the 5-hour window reserved for a turn; on a change of account, the engine rereads the thread. */
export const RESERVE = 10
export const RESERVE_MOVE = 20
/** A machine is alive when it wrote engines.json less than this ago (or answers the dispatcher). */
export const ALIVE_FOR = 180_000
/** A quota reading older than this is read again before the table is used. */
export const QUOTA_FRESH = 300_000
/** A reading taken this long after a reservation reflects the turn's spend: the reservation ends. */
export const RESERVATION_SETTLES = 60_000

// ---------------------------------------------------------------- the engine table

export type Rule = 'new' | 'back' | 'stay' | 'account' | 'machine' | 'provider' | 'hold'
/** Why nothing matched. (`attempts`, the fifth reason of the spec, is decided by turn.ts before the table is read.) */
export type HoldReason = 'no-machine' | 'no-room' | 'not-signed-in' | 'only-there'

export interface Window {
  /** Percent used. */
  used: number
  /** When the window starts again (ms); after that, `used` counts as 0. */
  resetsAt: number | null
}
export interface Quota {
  readAt: number
  fiveHour: Window
  week: Window
}

/** One machine's engines.json, as the dispatcher reads it (times already in ms). */
export interface MachineFacts {
  machine: string
  /** When the machine last wrote its engines.json. */
  seen: number
  /** The dispatcher's latest direct call: true it answered, false it failed after `seen`; absent: none since `seen`. */
  answers?: boolean
  /** Projects present on the machine. */
  projects: readonly string[]
  /** The engines of this machine; an account is an engine only where it is signed in. */
  engines: readonly { engine: string; signedIn: boolean }[]
}
export interface Table {
  machines: readonly MachineFacts[]
  /** Per account, `<provider>:<account>`: quota belongs to the account, whatever machine read it. */
  quotas: Readonly<Record<string, Quota>>
}

/** One line of the reservation ledger: points of an account's 5-hour window held for one turn of one thread. */
export interface Reservation {
  account: string
  thread: string
  turn: number
  points: number
  at: number
}

/** What the decision needs to know about the thread. `threadFacts` reads it from a journal. */
export interface ThreadFacts {
  thread: string
  /** null: the thread has no project (`_unsorted`); any machine counts as having it. */
  project: string | null
  /** The project has an origin a machine can clone (row `machine` only). */
  cloneable: boolean
  /** E: the engine of the thread's last leg; null when it has none (row `new`). */
  last: string | null
  /** The provider of the first leg. */
  first: Provider | null
  /** Per provider, the engine of its last leg in this thread: where its provider session lives. */
  sessions: Readonly<Partial<Record<Provider, string>>>
  /** Turns done since the thread last changed provider (or since its first leg). */
  doneHere: number
  /** The kind of the thread's last checkpoint, if any. `none`: the code cannot travel. */
  checkpoint: 'git' | 'shadow' | 'none' | null
  /** The thread had messages before the turn being placed (a chat from the connector). */
  history: boolean
  /** The table is read after a failure of this turn (true) or for a turn just accepted (false). */
  retry: boolean
}

export interface DecideInput {
  now: number
  thread: ThreadFacts
  table: Table
  ledger: readonly Reservation[]
  /** The install's preferred provider (row `new`). */
  preferred: Provider
}

export interface Decision {
  rule: Rule
  engine: string | null
  rung: 0 | 1 | 2 | 3 | null
  /** The facts used, in one sentence; for `hold`, the event's reason is `hold`. */
  reason: string
  hold?: HoldReason
  /** What to put in the ledger if this decision is written. */
  reserve?: { account: string; points: number }
}

// ---------------------------------------------------------------- helpers

interface Engine {
  engine: string
  provider: Provider
  account: string
  machine: string
  signedIn: boolean
}
/** `claude:a3f9c1@laptop` → `claude:a3f9c1`, the key of quotas and reservations. */
export const accountOf = (engine: string) => engine.slice(0, engine.lastIndexOf('@'))
const pct = (n: number) => `${Math.round(n)} %`
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

/** Turns done, per window, with resets applied: a window past its `resetsAt` counts as 0. */
function usedNow(w: Window, now: number): number {
  return w.resetsAt !== null && now >= w.resetsAt ? 0 : w.used
}
/** Points reserved on an account. */
export const reservedOn = (ledger: readonly Reservation[], account: string) => ledger.reduce((s, r) => (r.account === account ? s + r.points : s), 0)

class View {
  readonly engines: Engine[]
  private readonly machines: Map<string, MachineFacts>
  private readonly i: DecideInput
  constructor(i: DecideInput) {
    this.i = i
    this.machines = new Map(i.table.machines.map((m) => [m.machine, m]))
    this.engines = i.table.machines
      .flatMap((m) => m.engines.map((e) => ({ ...e, p: parseEngine(e.engine) })))
      .filter((e) => e.p && e.p.machine === e.engine.slice(e.engine.lastIndexOf('@') + 1))
      .map((e) => ({ engine: e.engine, provider: e.p!.provider, account: e.p!.account, machine: e.p!.machine, signedIn: e.signedIn }))
      .sort((a, b) => (a.engine < b.engine ? -1 : a.engine > b.engine ? 1 : 0))
  }
  alive(machine: string): boolean {
    const m = this.machines.get(machine)
    if (!m) return false
    return m.answers === true || (m.answers !== false && this.i.now - m.seen < ALIVE_FOR)
  }
  silentSince(machine: string): string {
    const m = this.machines.get(machine)
    return m ? `${machine} has been silent since ${hhmm(m.seen)}` : `${machine} is unknown`
  }
  has(machine: string, project: string | null): boolean {
    return project === null || !!this.machines.get(machine)?.projects.includes(project)
  }
  /** 5-hour use with this account's reservations, and week use, now. Null: never read. */
  usage(account: string): { five: number; week: number; resetsAt: number | null } | null {
    const q = this.i.table.quotas[account]
    if (!q) return null
    return { five: usedNow(q.fiveHour, this.i.now) + reservedOn(this.i.ledger, account), week: usedNow(q.week, this.i.now), resetsAt: q.fiveHour.resetsAt }
  }
  /** "Has room": both windows, reservations included, under the row's threshold. */
  room(account: string, under: number): boolean {
    const u = this.usage(account)
    return !!u && u.five < under && u.week < under
  }
  /** Lower is more room: the busier of the two windows. */
  load(account: string): number {
    const u = this.usage(account)
    return u ? Math.max(u.five, u.week) : Infinity
  }
  /** « claude a3f9c1 is at 41 % » (reservations included), the week only when it is what stands in the way. */
  describe(account: string, long = false): string {
    const u = this.usage(account)
    const who = account.replace(':', ' ')
    if (!u) return `${who} has no quota reading`
    if (u.five >= 100) return `${who} is at its 5-hour limit${u.resetsAt !== null ? ` until ${hhmm(u.resetsAt)} UTC` : ''}`
    const week = u.week >= ENTER_UNDER ? `, ${pct(u.week)} of its week` : ''
    return `${who} is at ${pct(u.five)}${long ? ' of its 5-hour window' : ''}${week}`
  }
  /** Engines that may take the turn: alive, signed in on their machine, with room under `under`. Most room first, then id. */
  pick(filter: (e: Engine) => boolean, under: number, first?: (e: Engine) => number): Engine[] {
    return this.engines
      .filter((e) => e.signedIn && this.alive(e.machine) && filter(e) && this.room(accountOf(e.engine), under))
      .map((e, i) => ({ e, i, k: first?.(e) ?? 0, l: this.load(accountOf(e.engine)) }))
      .sort((a, b) => a.k - b.k || a.l - b.l || a.i - b.i)
      .map((x) => x.e)
  }
}

/** The points a decision reserves: 10, or 20 on a change of account; never past 100 % of the window (DISP-6). */
function reservation(v: View, chosen: string, points: number): { account: string; points: number } {
  const u = v.usage(accountOf(chosen))
  const left = u ? Math.max(0, 100 - u.five) : 0
  return { account: accountOf(chosen), points: Math.min(points, left) }
}

// ---------------------------------------------------------------- the decision table

/**
 * The decision table of docs/spec/06-dispatch.md, first matching row wins: new, back, stay, account, machine,
 * provider, hold. Ties go to the engine id in alphabetical order.
 */
export function decide(i: DecideInput): Decision {
  const v = new View(i)
  const t = i.thread
  const kindNone = t.checkpoint === 'none'

  // new: the thread has no leg yet.
  if (!t.last) {
    const c = v.pick((e) => v.has(e.machine, t.project), ENTER_UNDER, (e) => (e.provider === i.preferred ? 0 : 1))[0]
    if (c) {
      const where = t.project ? `${t.project} is on ${c.machine}` : `the thread has no project; ${c.machine} is alive`
      return { rule: 'new', engine: c.engine, rung: t.history ? 3 : 0, reason: `${where}; ${v.describe(accountOf(c.engine), true)}`, reserve: reservation(v, c.engine, t.history ? RESERVE_MOVE : RESERVE) }
    }
    return hold(v, t, null)
  }

  const E = parseEngine(t.last)!
  const eAccount = accountOf(t.last)
  const eHere = (m: string) => !kindNone || m === E.machine
  const resumeRung = (e: Engine): 1 | 2 | 3 => {
    const s = t.sessions[e.provider]
    if (!s) return 3
    return parseEngine(s)!.machine === e.machine ? 1 : 2
  }

  // back: a thread that left its first provider returns to it, between turns only, once it has room to spare.
  if (!t.retry && t.first && E.provider !== t.first && t.doneHere >= BACK_AFTER) {
    const home = t.sessions[t.first]
    const homeAccount = home ? accountOf(home) : null
    const c = v.pick((e) => e.provider === t.first && v.has(e.machine, t.project) && eHere(e.machine), BACK_UNDER, (e) => (e.engine === home ? 0 : accountOf(e.engine) === homeAccount ? 1 : 2))[0]
    if (c) {
      const u = v.usage(accountOf(c.engine))!
      return {
        rule: 'back', engine: c.engine, rung: resumeRung(c),
        reason: `the thread did ${t.doneHere} turns on ${E.provider}; ${accountOf(c.engine).replace(':', ' ')} is back under ${BACK_UNDER} % (${pct(Math.max(u.five, u.week))})`, // i18n-ignore: journal data (DISP-2)
        reserve: reservation(v, c.engine, RESERVE_MOVE),
      }
    }
  }

  // stay: its engine is alive, signed in, and under 97 %.
  const eSigned = v.engines.some((e) => e.engine === t.last && e.signedIn)
  if (v.alive(E.machine) && eSigned && v.room(eAccount, STAY_UNDER)) {
    return { rule: 'stay', engine: t.last, rung: 1, reason: `the engine of the last leg is alive; ${v.describe(eAccount, true)}`, reserve: reservation(v, t.last, RESERVE) } // i18n-ignore: journal data (DISP-2)
  }
  const why = !v.alive(E.machine) ? v.silentSince(E.machine) : !eSigned ? `${eAccount.replace(':', ' ')} is signed out on ${E.machine}` : v.describe(eAccount)

  // account: another account of the same provider on the same machine.
  if (v.alive(E.machine)) {
    const c = v.pick((e) => e.machine === E.machine && e.provider === E.provider && accountOf(e.engine) !== eAccount, ENTER_UNDER)[0]
    if (c) return { rule: 'account', engine: c.engine, rung: 1, reason: `${why}; ${v.describe(accountOf(c.engine))} on ${c.machine}`, reserve: reservation(v, c.engine, RESERVE_MOVE) } // i18n-ignore: journal data (DISP-2)
  }

  // machine: the same provider on another machine that has the project (or can clone it); the code must travel.
  if (!kindNone) {
    const c = v.pick((e) => e.machine !== E.machine && e.provider === E.provider && (v.has(e.machine, t.project) || t.cloneable), ENTER_UNDER, (e) => (accountOf(e.engine) === eAccount ? 0 : 1))[0]
    if (c) {
      const same = accountOf(c.engine) === eAccount
      const has = v.has(c.machine, t.project) ? `has ${t.project ?? 'the thread'}` : `can clone ${t.project}`
      return { rule: 'machine', engine: c.engine, rung: 2, reason: `${why}; ${c.machine} ${has} and ${same ? 'the same account: ' : ''}${v.describe(accountOf(c.engine))}`, reserve: reservation(v, c.engine, same ? RESERVE : RESERVE_MOVE) } // i18n-ignore: journal data (DISP-2)
    }
  }

  // provider: another provider, on a machine that has the project; E's machine first.
  {
    const c = v.pick((e) => e.provider !== E.provider && v.has(e.machine, t.project) && eHere(e.machine), ENTER_UNDER, (e) => (e.machine === E.machine ? 0 : 1))[0]
    if (c) return { rule: 'provider', engine: c.engine, rung: resumeRung(c), reason: `${why}; no other ${E.provider} engine has room; ${v.describe(accountOf(c.engine))}`, reserve: reservation(v, c.engine, RESERVE_MOVE) } // i18n-ignore: journal data (DISP-2)
  }

  return hold(v, t, E.machine)
}

/** No row matched: which of the four reasons, in this order: only-there, no-machine, not-signed-in, no-room. */
function hold(v: View, t: ThreadFacts, eMachine: string | null): Decision {
  const out = (h: HoldReason, reason: string): Decision => ({ rule: 'hold', engine: null, rung: null, reason, hold: h })
  if (eMachine && t.checkpoint === 'none' && !v.alive(eMachine)) return out('only-there', `the code of this thread can only continue on ${eMachine}; ${v.silentSince(eMachine)}`)
  const machines = [...new Set(v.engines.map((e) => e.machine))]
  const usable = (m: string) => v.alive(m) && (v.has(m, t.project) || (t.cloneable && t.checkpoint !== 'none' && eMachine !== null)) && (t.checkpoint !== 'none' || m === eMachine)
  const on = machines.filter(usable)
  if (!on.length) return out('no-machine', `no machine that has ${t.project ?? 'the thread'} is on`)
  const signed = v.engines.filter((e) => on.includes(e.machine) && e.signedIn)
  if (!signed.length) return out('not-signed-in', `no account is signed in on ${on.join(', ')}`)
  const resets = signed.map((e) => v.usage(accountOf(e.engine))?.resetsAt).filter((r): r is number => typeof r === 'number')
  const until = resets.length ? ` until ${hhmm(Math.min(...resets))} UTC` : ''
  return out('no-room', `every account that can take it is at its limit${until}`)
}

// ---------------------------------------------------------------- the ledger

/** The ledger after a decision is written: its reservation added. */
export function reserve(ledger: readonly Reservation[], d: Decision, thread: string, turn: number, now: number): Reservation[] {
  if (!d.reserve || d.reserve.points <= 0) return [...ledger]
  return [...ledger, { account: d.reserve.account, thread, turn, points: d.reserve.points, at: now }]
}
/** The ledger after a thread's turn ended (done, failed or held): its reservation is gone. */
export function release(ledger: readonly Reservation[], thread: string): Reservation[] {
  return ledger.filter((r) => r.thread !== thread)
}
/** The ledger after a quota reading of an account: reservations it already reflects (taken over a minute before) end. */
export function settle(ledger: readonly Reservation[], account: string, readAt: number): Reservation[] {
  return ledger.filter((r) => r.account !== account || readAt < r.at + RESERVATION_SETTLES)
}

// ---------------------------------------------------------------- the thread's facts, from its journal

/**
 * The facts of `ThreadFacts` that the journal holds: E, the first provider, each provider's last leg, the turns done
 * since the last change of provider, the last checkpoint, and whether the turn being placed has earlier messages.
 */
export function threadFacts(events: readonly JournalEvent[], o: { project: string | null; cloneable: boolean; retry: boolean; turn: number }): ThreadFacts {
  let last: string | null = null
  let first: Provider | null = null
  const sessions: Partial<Record<Provider, string>> = {}
  let doneHere = 0
  let checkpoint: ThreadFacts['checkpoint'] = null
  let messages = 0
  let history = false
  const thread = (events[0] as { thread?: string } | undefined)?.thread ?? ''
  for (const e of events) {
    if (e.type === 'leg.start') {
      const p = parseEngine(e.engine)!.provider
      if (last && parseEngine(last)!.provider !== p) doneHere = 0
      first ??= p
      last = e.engine
      sessions[p] = e.engine
    } else if (e.type === 'turn' && (e as TurnEvent).state === 'done') doneHere++
    else if (e.type === 'checkpoint') checkpoint = e.kind
    else if (e.type === 'message') messages++
    else if (e.type === 'turn' && e.state === 'accepted' && e.turn === o.turn) history = messages > (e.message ? 1 : 0)
  }
  return { thread, project: o.project, cloneable: o.cloneable, last, first, sessions, doneHere, checkpoint, history, retry: o.retry }
}
