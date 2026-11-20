// The dispatcher's memory and its placing of a turn (docs/spec/06-dispatch.md): the engine table as it reads it, the
// reservation ledger, the turns it has sent to an engine and not yet seen start, the holds it does not look at again
// until the table changes. One class for weevilsd (server/weevbook/threads.ts) and for the simulator (sim/world.ts),
// so that what the simulator proves is what runs.
//
// It does no I/O. Its caller reads the thread (lease and journal), calls `place`, and does what the answer says:
// write `held` events, or call the chosen engine's machine with the instruction. `decide` (dispatch.ts) chooses; this
// file only keeps what the choice needs between two looks.

import { accountOf, decide, release, reserve, settle, threadFacts, QUOTA_FRESH, type DecideInput, type Decision, type MachineFacts, type Quota, type Reservation, type Table } from './dispatch.ts'
import { parseEngine, type JournalEvent, type Provider } from './journal.ts'
import { holdAll, next, type Turn, type TurnChange } from './turn.ts'

/** A turn sent to an engine that has not started within this is placed again. */
export const START_TIMEOUT = 30_000
/** A held turn is looked at again when the engine table changes, and at least this often. */
export const HOLD_AGAIN = 60_000

/** What the dispatcher asks the chosen engine's machine: take the lease, start this attempt of this turn. */
export interface Instruction {
  thread: string
  turn: number
  attempt: number
  engine: string
  rule: string
  reason: string
  /** 0: a thread with no leg yet; 1 same machine and provider; 2 another machine, same provider; 3 another provider. */
  rung: number
  request: 'message' | 'preface'
}

export type Placement =
  /** Nothing to do: a turn runs, every turn is done, or one was sent to an engine less than START_TIMEOUT ago. */
  | { kind: 'none' }
  /** Write these `held` events (none: the journal already says it). */
  | { kind: 'hold'; changes: TurnChange[]; decision?: Decision; input?: DecideInput }
  /** Call the machine of `ins.engine` with this. */
  | { kind: 'start'; ins: Instruction; decision: Decision; input: DecideInput }

export interface DecisionRecord {
  thread: string
  turn: number
  attempt: number
  input: DecideInput
  output: Decision
}

/**
 * The engine table as the dispatcher reads it. Each machine's engines.json is kept with the time the dispatcher first
 * read that version, by its own clock: ages are judged like a lease, by the reader (06-dispatch.md).
 */
export class EngineTable {
  private published = new Map<string, { seen: number; at: number; facts: Omit<MachineFacts, 'seen' | 'answers'>; quotas: Record<string, Quota> }>()
  private answers = new Map<string, { t: number; ok: boolean }>()
  private settled = new Map<string, number>()
  private limited = new Map<string, number>()
  /** Grows whenever the table changes: a machine published, or did not answer. */
  version = 0

  /**
   * An engine stopped on its usage limit at `at` (its machine's clock): that is a reading of the account, at its
   * limit, until a machine with the account publishes after it (06-dispatch.md, « stale figures »).
   */
  limit(account: string, at: number) {
    if ((this.limited.get(account) ?? -Infinity) >= at) return
    this.limited.set(account, at)
    this.version++
  }

  /** A machine's engines.json, read now (`at`, the dispatcher's clock); `seen` is the machine's own time of writing. */
  publish(facts: Omit<MachineFacts, 'seen' | 'answers'>, quotas: Record<string, Quota>, seen: number, at: number) {
    this.published.set(facts.machine, { seen, at, facts, quotas })
    this.version++
  }
  /** The `seen` of the version last read from a machine (the caller reads a new version only). */
  seenOf(machine: string): number | undefined {
    return this.published.get(machine)?.seen
  }
  /** The dispatcher called a machine directly: it answered, or not. */
  answered(machine: string, ok: boolean, at: number) {
    this.answers.set(machine, { t: at, ok })
    if (!ok) this.version++
  }
  /** The dispatcher stopped (null) or started again (now): no call has been made since, and what it had read before
   *  counts from its start. */
  restart(now: number | null) {
    if (now !== null) for (const p of this.published.values()) p.at = now
    this.answers.clear()
    if (now === null) this.limited.clear()
  }
  /** The facts last published by each machine (for the app and the logs). */
  machines(): MachineFacts[] {
    return [...this.published.values()].map((p) => ({ ...p.facts, seen: p.at }))
  }

  /**
   * The table, and the ledger with the reservations that a fresh reading settles. A quota older than QUOTA_FRESH is
   * read again (`reread`) through a machine that answers and has the account signed in.
   */
  table(now: number, ledger: Reservation[], o: { direct: (machine: string) => boolean; reread?: (account: string, now: number) => Quota | null; accounts?: Iterable<string> }): { table: Table; ledger: Reservation[] } {
    const machines: MachineFacts[] = []
    const quotas: Record<string, Quota> = {}
    const written = new Map<string, number>()
    for (const p of this.published.values()) {
      const a = this.answers.get(p.facts.machine)
      machines.push({ ...p.facts, seen: p.at, ...(a && a.t > p.at ? { answers: a.ok } : {}) })
      for (const [acc, q] of Object.entries(p.quotas)) {
        if (!quotas[acc] || quotas[acc].readAt < p.at) quotas[acc] = { ...q, readAt: p.at }
        written.set(acc, Math.max(written.get(acc) ?? -Infinity, p.seen))
      }
    }
    // An account that stopped on its limit after its last published reading is at its limit now.
    for (const [acc, at] of this.limited) {
      if ((written.get(acc) ?? -Infinity) > at) continue
      const q = quotas[acc]
      quotas[acc] = { readAt: now, fiveHour: { used: 100, resetsAt: q?.fiveHour.resetsAt ?? null }, week: q?.week ?? { used: 0, resetsAt: null } }
    }
    const accounts = new Set(o.accounts ?? [])
    for (const m of machines) for (const e of m.engines) if (e.signedIn) accounts.add(accountOf(e.engine))
    for (const acc of accounts) {
      if (!o.reread || (quotas[acc] && now - quotas[acc].readAt < QUOTA_FRESH)) continue
      const via = machines.find((m) => o.direct(m.machine) && m.engines.some((e) => e.signedIn && accountOf(e.engine) === acc))
      if (!via) continue
      const q = o.reread(acc, now)
      if (q) quotas[acc] = q
    }
    for (const [acc, q] of Object.entries(quotas)) {
      if ((this.settled.get(acc) ?? -Infinity) < q.readAt) {
        ledger = settle(ledger, acc, q.readAt)
        this.settled.set(acc, q.readAt)
      }
    }
    return { table: { machines, quotas }, ledger }
  }
}

/** Deep-frozen: decide cannot change what it is given (DISP-1); the checks replay it. */
function freeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) freeze(v)
  }
  return o
}

export interface PlaceOptions {
  /** The thread's project, and whether a machine can clone it (row `machine`). */
  project: string | null
  cloneable: boolean
  /** The chosen engine's machine can be called now. False: it is marked as not answering and the table is read again. */
  direct: (machine: string) => boolean
  reread?: (account: string, now: number) => Quota | null
  accounts?: Iterable<string>
  /** Every decision taken, with its input (the simulator checks them; weevilsd logs them). */
  record?: (d: DecisionRecord) => void
}

export class Dispatcher {
  ledger: Reservation[] = []
  readonly engines = new EngineTable()
  private readonly pending = new Map<string, { turn: number; attempt: number; at: number }>()
  private readonly holds = new Map<string, { turn: number; at: number; version: number }>()

  readonly preferred: Provider
  constructor(preferred: Provider) {
    this.preferred = preferred
  }

  /** A turn of the thread runs (its lease is working): nothing is pending for it any more. */
  working(thread: string) {
    this.pending.delete(thread)
  }
  /** The engine's machine did not start the turn (it said why, or did not answer): it is placed again at the next
   *  look, and its reservation ends. */
  unplaced(thread: string) {
    this.pending.delete(thread)
    this.ledger = release(this.ledger, thread)
  }
  /** The dispatcher took the lease from a silent holder: the reservation of that turn ends. */
  stole(thread: string) {
    this.ledger = release(this.ledger, thread)
  }
  /** Turns sent and not yet started (the simulator's quiet check; weevilsd's next look). */
  get pendingCount() {
    return this.pending.size
  }
  /** Power lost: the memory goes; the table counts from the restart. */
  restart(now: number | null) {
    this.ledger = []
    this.pending.clear()
    this.engines.restart(now)
  }

  /** The decision for the thread's oldest waiting turn now, with nothing reserved or remembered (the checks, and the
   *  sentence the app shows for a held turn). */
  decideNow(journal: readonly JournalEvent[], turns: readonly Turn[], now: number, o: Omit<PlaceOptions, 'record'>): Decision | null {
    const n = next(turns)
    if (n.kind !== 'dispatch') return null
    const t = this.engines.table(now, this.ledger, o)
    this.ledger = t.ledger
    return decide({ now, thread: threadFacts(journal, { project: o.project, cloneable: o.cloneable, retry: n.retry, turn: n.turn }), table: t.table, ledger: this.ledger, preferred: this.preferred })
  }

  /**
   * The retry rule, then the decision table (06-dispatch.md). Returns what to write or whom to call; the reservation
   * is made here, before the call (« reserve before leaving »).
   */
  place(thread: string, journal: readonly JournalEvent[], turns: readonly Turn[], now: number, o: PlaceOptions): Placement {
    const n = next(turns)
    if (n.kind === 'busy') return { kind: 'none' }
    const p = this.pending.get(thread)
    if (n.kind === 'quiet' || n.kind === 'hold') {
      this.pending.delete(thread)
      this.ledger = release(this.ledger, thread)
      if (n.kind === 'hold') return { kind: 'hold', changes: [{ turn: n.turn, state: 'held', rule: n.rule, reason: n.reason }] }
      return { kind: 'none' }
    }
    if (p && p.turn === n.turn && p.attempt === n.attempt && now - p.at < START_TIMEOUT) return { kind: 'none' }
    const h = this.holds.get(thread)
    if (turns[n.turn - 1].state === 'held' && h && h.turn === n.turn && h.version === this.engines.version && now - h.at < HOLD_AGAIN) return { kind: 'none' }
    this.pending.delete(thread)
    this.ledger = release(this.ledger, thread)
    // A turn of this thread stopped on a usage limit: its account is at its limit until its machine says otherwise.
    for (const [account, at] of quotaStops(journal)) this.engines.limit(account, at)
    for (let tries = 0; tries < 3; tries++) {
      const t = this.engines.table(now, this.ledger, o)
      this.ledger = t.ledger
      const input: DecideInput = {
        now,
        thread: threadFacts(journal, { project: o.project, cloneable: o.cloneable, retry: n.retry, turn: n.turn }),
        table: t.table,
        ledger: this.ledger,
        preferred: this.preferred,
      }
      const d = decide(freeze(input))
      o.record?.({ thread, turn: n.turn, attempt: n.attempt, input, output: d })
      if (!d.engine) {
        this.holds.set(thread, { turn: n.turn, at: now, version: this.engines.version })
        return { kind: 'hold', changes: holdAll(turns, 'hold', d.hold!), decision: d, input }
      }
      const machine = parseEngine(d.engine)!.machine
      if (!o.direct(machine)) {
        this.engines.answered(machine, false, now)
        continue
      }
      this.engines.answered(machine, true, now)
      this.ledger = reserve(this.ledger, d, thread, n.turn, now)
      this.pending.set(thread, { turn: n.turn, attempt: n.attempt, at: now })
      return { kind: 'start', ins: { thread, turn: n.turn, attempt: n.attempt, engine: d.engine, rule: d.rule, reason: d.reason, rung: d.rung ?? 1, request: n.request }, decision: d, input }
    }
    return { kind: 'none' }
  }
}

/** The accounts of the thread's engines that stopped on their usage limit, and when (the last time each). */
function quotaStops(journal: readonly JournalEvent[]): Map<string, number> {
  const engineOf = new Map<string, string>()
  const out = new Map<string, number>()
  for (const e of journal) {
    if (e.type === 'leg.start') engineOf.set(e.leg!, e.engine)
    else if (e.type === 'turn' && e.state === 'failed' && e.reason === 'quota' && e.leg && engineOf.has(e.leg)) out.set(accountOf(engineOf.get(e.leg)!), Date.parse(e.at))
  }
  return out
}
