// The invariants a simulated run must keep, checked on everything the world recorded: the hub's push log, the final
// journals, the engines' runs, the dispatcher's decisions, the machines' power and links. Each failure names the
// invariant of the spec it breaks (SYNC-*, DISP-*, RESUME-*, THREAD-*) or one of the simulator's own:
//
//   lost-message  an accepted message is not in its thread (DISP-7)
//   overlap       two engines answered one thread at once: their spans in the hub overlap (SYNC-12)
//   zombie        an engine kept running more than one renewal after its machine could know it had lost (SYNC-12)
//   steal-late    a dead holder's lease was not stolen within the bound of docs/spec/03-sync-and-lease.md (SYNC-11)
//   steal-live    a holder that renewed all along, clocks within 30 s, had its lease stolen (SYNC-5)
//   switch        a change of engine the decision table does not justify (no ping-pong)
//   hold          a turn held while an engine could take it
//   unsettled     the run did not become quiet once every machine was back (DISP-9)

import { parseEngine, validateJournal, type JournalEvent } from '../journal.ts'
import { GRACE, OBSERVE_EVERY, RENEW_EVERY, SKEW, STEAL_BOUND, UNCHANGED, lateEvents, type Lease } from '../lease.ts'
import { turnsOf } from '../turn.ts'
import { ALIVE_FOR, BACK_AFTER, BACK_UNDER, ENTER_UNDER, STAY_UNDER, accountOf, decide, reservedOn, type DecideInput, type Decision } from '../dispatch.ts'
import type { MachineId } from './scenario.ts'
import { BASE, type World } from './world.ts'

export interface Violation {
  invariant: string
  info: string
}
/** Figures of one run, for the summary. */
export interface Stats {
  messages: number
  turnsDone: number
  held: Record<string, number>
  runs: number
  steals: number
  /** Longest time from a dead holder's last renewal to the steal, ms. */
  stealDelay: number
  orphans: number
  lateNotes: number
  /** Steals from a holder that could renew all along: only with clocks more than 30 s apart. */
  liveSteals: number
  switches: number
  maxSwitches: number
  quotaStops: number
  wideClocks: boolean
  simulated: number
}

/** Slack for clock drift (±0.1 %) and whole-second timestamps in lease.json. */
const SLACK = 3_000

export function check(w: World): { violations: Violation[]; stats: Stats } {
  const out: Violation[] = []
  const bad = (invariant: string, info: string) => out.push({ invariant, info })
  const short = (thread: string) => thread.slice(-4)
  const finals = new Map<string, readonly JournalEvent[]>()
  for (const thread of w.registry.keys()) {
    const tip = w.hub.refs.get(`refs/threads/${thread}`)
    finals.set(thread, tip ? w.hub.thread(tip).journal : [])
  }
  const reach = reachability(w)

  // ---------------------------------------------------------------- the journals (THREAD-*, DISP-7, DISP-8, DISP-9, RESUME-8)
  let turnsDone = 0
  let lateNotes = 0
  const held: Record<string, number> = {}
  for (const [thread, journal] of finals) {
    for (const v of validateJournal(journal)) bad(v.invariant, `${short(thread)} seq ${v.seq ?? '-'}: ${v.info}`)
    try {
      for (const t of turnsOf(journal)) {
        if (t.state === 'done') turnsDone++
        else if (t.state === 'held' && t.held?.reason) held[t.held.reason] = (held[t.held.reason] ?? 0) + 1
        else if (w.quiet) bad('DISP-9', `${short(thread)} turn ${t.turn} ends ${t.state}${t.state === 'held' ? ' without a reason' : ''}`)
      }
    } catch (e) {
      bad('THREAD-10', `${short(thread)}: ${(e as Error).message}`)
    }
    // DISP-8: one answer per turn, from one engine.
    const answers = new Map<number, Set<string>>()
    let turn = 0
    let engine = ''
    for (const e of journal) {
      if (e.type === 'turn' && e.state === 'running') turn = e.turn
      if (e.type === 'leg.start') engine = e.engine
      if (e.type === 'message' && e.role === 'assistant' && e.leg !== null) {
        const s = answers.get(turn) ?? new Set()
        s.add(`${engine}#${s.size}`)
        answers.set(turn, s)
      }
      if (e.type === 'note' && e.kind === 'late') lateNotes++
    }
    for (const [t, s] of answers) if (s.size > 1) bad('DISP-8', `${short(thread)} turn ${t} has ${s.size} answers`)
    // RESUME-8 in the journal: once a turn failed with an effect, every later attempt resumes.
    // A failure never claims less effect than the journal shows: a step or an answer since `running` is an effect.
    const some = new Set<number>()
    let acted = false
    for (const e of journal) {
      if (e.type === 'tool' || (e.type === 'message' && e.role === 'assistant' && e.leg !== null)) acted = true
      if (e.type !== 'turn') continue
      if (e.state === 'running') acted = false
      if (e.state === 'failed' && e.effect !== 'some' && acted) bad('RESUME-8', `${short(thread)} turn ${e.turn} failed with effect none after steps`)
      if (e.state === 'failed' && e.effect === 'some') some.add(e.turn)
      if (e.state === 'assigned' && some.has(e.turn) && e.resume !== true) bad('RESUME-8', `${short(thread)} turn ${e.turn} attempt ${e.attempt} after an effect without resume`)
    }
  }
  // RESUME-8 at the engines: a resumed attempt got the preface, never the message again.
  for (const r of w.runs) if (r.effectBefore === 'some' && r.request !== 'preface') bad('RESUME-8', `run ${r.id} (${short(r.thread)} turn ${r.turn}.${r.attempt}) was given the message again`)

  // DISP-7: every accepted message is in its thread, once (THREAD-9 catches twice), and opens a turn.
  for (const a of w.accepted) {
    const journal = finals.get(a.thread) ?? []
    const msg = journal.find((e) => e.type === 'message' && e.key === a.key)
    if (!msg) bad('lost-message', `${a.key}, accepted at ${s(a.t)} for ${short(a.thread)}, is not in the thread`)
    else if (!journal.some((e) => e.type === 'turn' && e.state === 'accepted' && e.message === msg.id)) bad('DISP-7', `${a.key} opens no turn`)
  }
  const acceptedBy = new Map(w.accepted.map((a) => [a.key, a]))
  for (const [thread, journal] of finals) {
    for (const e of journal) {
      if (e.type !== 'message' || !e.key || e.key.startsWith('boot-')) continue
      const a = acceptedBy.get(e.key)
      if (!a) bad('DISP-7', `${short(thread)} has ${e.key}, which was never accepted`)
      else if (a.thread !== thread) bad('DISP-7', `${e.key} is in ${short(thread)}, accepted for ${short(a.thread)}`)
    }
  }

  // ---------------------------------------------------------------- the hub (SYNC-1..5)
  const tipOf = new Map<string, string | null>()
  const leaseOf = new Map<string, { lease: Lease; commit: string; t: number }>()
  // Each ref as it was before the first push: the starting threads.
  const firstFrom = new Map<string, string | null>()
  for (const p of w.hub.log) for (const u of p.updates) if (!firstFrom.has(u.ref)) firstFrom.set(u.ref, u.from)
  const initial = (ref: string) => (firstFrom.has(ref) ? firstFrom.get(ref)! : w.hub.refs.get(ref) ?? null)
  for (const thread of w.registry.keys()) {
    tipOf.set(thread, initial(`refs/threads/${thread}`))
    const l = initial(`refs/leases/${thread}`)
    if (l) leaseOf.set(thread, { lease: w.hub.lease(l), commit: l, t: -1 })
  }
  const pushedAt = new Map<string, number>()
  const working: { thread: string; lease: Lease; from: number; to: number }[] = []
  for (const p of w.hub.log) {
    const byRef = new Map(p.updates.map((u) => [u.ref, u]))
    // Thread refs first: a lease pushed with its thread names the new tip.
    const updates = [...p.updates].sort((a, b) => Number(b.ref.startsWith('refs/threads/')) - Number(a.ref.startsWith('refs/threads/')))
    for (const u of updates) {
      if (u.ref.startsWith('refs/threads/')) {
        const thread = u.ref.slice(13)
        const l = byRef.get(`refs/leases/${thread}`)
        const lease = l?.to ? w.hub.lease(l.to) : null
        // SYNC-1, SYNC-3: the pusher holds the lease pushed with the thread, and it names the new tip.
        if (!lease || lease.holder !== p.by) bad('SYNC-3', `${p.by} pushed ${short(thread)} at ${s(p.t)} without holding its lease`)
        else if (lease.tip !== u.to) bad('SYNC-3', `lease of ${short(thread)} names ${lease.tip}, pushed ${u.to}`)
        // SYNC-2: forward only.
        if (u.from && u.to && !w.hub.ancestor(u.from, u.to)) bad('SYNC-2', `${short(thread)} moved back at ${s(p.t)}`)
        const before = u.from ? w.hub.thread(u.from).journal.length : 0
        for (const e of u.to ? w.hub.thread(u.to).journal.slice(before) : []) if (!pushedAt.has(e.id)) pushedAt.set(e.id, p.t)
        tipOf.set(thread, u.to)
      }
      if (u.ref.startsWith('refs/leases/') && u.to) {
        const thread = u.ref.slice(12)
        const lease = w.hub.lease(u.to)
        const prev = leaseOf.get(thread)
        if (lease.holder !== p.by) bad('SYNC-3', `${p.by} wrote a lease of ${short(thread)} naming ${lease.holder}`)
        if (!byRef.has(`refs/threads/${thread}`) && lease.tip !== (tipOf.get(thread) ?? null)) bad('SYNC-3', `lease of ${short(thread)} at ${s(p.t)} names ${lease.tip}, the thread is at ${tipOf.get(thread)}`)
        if (prev) {
          // SYNC-4: epoch never decreases, and changes (by one) exactly when the holder changes.
          const changed = prev.lease.holder !== lease.holder
          if (changed ? lease.epoch !== prev.lease.epoch + 1 : lease.epoch !== prev.lease.epoch) bad('SYNC-4', `${short(thread)} ${prev.lease.holder}#${prev.lease.epoch} → ${lease.holder}#${lease.epoch} at ${s(p.t)}`)
          // SYNC-5: a working lease goes to another holder only after 60 s unchanged and past expires + 30 s.
          if (changed && prev.lease.state === 'working') {
            const local = BASE + p.t + clock(w, p.by as MachineId, p.t)
            if (p.t - prev.t < UNCHANGED - SLACK || local < Date.parse(prev.lease.expires) + GRACE) bad('SYNC-5', `${short(thread)} taken from ${prev.lease.holder} ${s(p.t - prev.t)} after its last renewal`)
          }
          if (prev.lease.state === 'working' && prev.t >= 0) working.push({ thread, lease: prev.lease, from: prev.t, to: p.t })
        }
        leaseOf.set(thread, { lease, commit: u.to, t: p.t })
      }
    }
  }
  for (const [thread, l] of leaseOf) {
    if (l.lease.state === 'working' && l.t >= 0) working.push({ thread, lease: l.lease, from: l.t, to: w.end })
    if (w.quiet && l.lease.state !== 'idle') bad('DISP-9', `${short(thread)} ends with a working lease`)
  }

  // steal-late: a lease whose holder stopped renewing is stolen within the bound, while the dispatcher is up.
  let stealDelay = 0
  let liveSteals = 0
  // The dispatcher's clock runs at 1 + drift: its 10 s between looks and its 60 s of "unchanged" are that much longer
  // or shorter in real time, and `expires` + 30 s is reached when its clock says so.
  const sv = w.machines.server
  const real = (ms: number) => ms / (1 + sv.drift)
  const tick = real(OBSERVE_EVERY)
  for (const x of working) {
    if (x.lease.holder === 'server') continue
    const expired = (Date.parse(x.lease.expires) - BASE + GRACE - sv.offset) / (1 + sv.drift)
    for (const [a, b] of reach.on.server) {
      const a2 = Math.max(a, x.from)
      const b2 = Math.min(b, x.to)
      if (a2 >= b2) continue
      const deadline = Math.max(a2 + tick + real(UNCHANGED), expired) + tick + SLACK
      if (b2 > deadline) bad('steal-late', `${short(x.thread)}: ${x.lease.holder}'s lease of ${s(x.from)} still there at ${s(deadline)}`)
    }
  }
  for (const st of w.steals) {
    const d = st.t - st.set
    if (Math.abs(clock(w, st.holder as MachineId, st.t) - clock(w, 'server', st.t)) <= SKEW) {
      // With the dispatcher up all along, the delay is within the bound of the spec (the check above is the exact one).
      if (reach.on.server.some(([a, b]) => a <= st.set && b >= st.t)) {
        stealDelay = Math.max(stealDelay, d)
        if (d > real(STEAL_BOUND) + SLACK) bad('steal-late', `${short(st.thread)} stolen ${s(d)} after the last renewal`)
      }
    }
    // steal-live: within the clock assumption, only a holder that could not renew loses its lease. Beyond it, counted.
    const up = reach.reach[st.holder as MachineId].some(([a, b]) => a <= st.set && b >= st.t)
    if (up && Math.abs(clock(w, st.holder as MachineId, st.t) - clock(w, 'server', st.t)) <= SKEW) bad('steal-live', `${short(st.thread)} stolen at ${s(st.t)} from ${st.holder}, reachable since ${s(st.set)}`)
    else if (up) liveSteals++
  }

  // ---------------------------------------------------------------- engines at work (overlap, zombie)
  const runsOf = new Map<string, typeof w.runs>()
  for (const r of w.runs) runsOf.set(r.thread, [...(runsOf.get(r.thread) ?? []), r])
  const spanEnd = new Map<number, number>()
  for (const [id, b] of w.born) if (b.run !== null && pushedAt.has(id)) spanEnd.set(b.run, Math.max(spanEnd.get(b.run) ?? 0, pushedAt.get(id)!))
  for (const [thread, runs] of runsOf) {
    const sorted = [...runs].sort((a, b) => a.start - b.start)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const r1 = sorted[i]
        const r2 = sorted[j]
        // overlap: in the hub, r2 starts after the last event r1 got in.
        if (r2.start < (spanEnd.get(r1.id) ?? r1.start)) bad('overlap', `${short(thread)}: run ${r2.id} on ${r2.engine} started at ${s(r2.start)} while run ${r1.id} on ${r1.engine} still wrote to the hub until ${s(spanEnd.get(r1.id)!)}`)
        // zombie: r1 still runs after r2 started; its machine must stop it at its first renewal once it is reachable.
        const stop = r1.stop ?? w.end
        if (stop <= r2.start) continue
        const limit = RENEW_EVERY * 1.01 + SLACK
        for (const [a, b] of reach.reach[r1.machine]) {
          const a2 = Math.max(a, r2.start)
          if (a2 >= Math.min(b, stop)) continue
          if (Math.min(b, stop) > a2 + limit) bad('zombie', `${short(thread)}: run ${r1.id} on ${r1.machine} ran until ${s(stop)}, reachable from ${s(a2)}, after run ${r2.id} started at ${s(r2.start)}`)
        }
      }
    }
    // In the final journal, the events of one run are never split by another's.
    const order: number[] = []
    for (const e of finals.get(thread) ?? []) {
      const run = w.born.get(e.id)?.run
      if (run != null && order[order.length - 1] !== run) order.push(run)
    }
    if (new Set(order).size !== order.length) bad('overlap', `${short(thread)}: runs interleaved in the journal: ${order.join(' ')}`)
  }

  // SYNC-7: every commit a machine could not push is in the thread or named by a note.
  for (const o of w.orphansPushed) {
    const journal = finals.get(o.thread) ?? []
    const late = lateEvents(journal, w.hub.thread(o.commit).journal)
    const known = new Set(journal.map((e) => e.id))
    const missing = late.filter((e) => !known.has(e.id))
    const noted = journal.some((e) => e.type === 'note' && e.kind === 'late' && (e.data as { from?: string } | undefined)?.from === o.ref)
    if (missing.length && !noted) bad('SYNC-7', `${o.ref.split('/').slice(3).join('/')} (${missing.length} events) is not in a note`)
  }
  for (const [ref] of w.hub.refs) if (w.quiet && ref.startsWith('refs/orphans/')) bad('SYNC-7', `${ref} is still there`)

  // ---------------------------------------------------------------- the decisions (DISP-1, DISP-3, DISP-5, DISP-6, switch)
  let switches = 0
  let maxSwitches = 0
  const perThread = new Map<string, number>()
  for (const d of w.decisions) {
    // DISP-1: the same input (frozen: decide cannot write to it) gives the same decision.
    try {
      if (key(decide(d.input)) !== key(d.output)) bad('DISP-1', `${short(d.thread)} turn ${d.turn}: same input, another decision`)
    } catch (e) {
      bad('DISP-1', `${short(d.thread)} turn ${d.turn}: ${(e as Error).message}`)
    }
    const o = d.output
    // hold: no engine at all could take the turn under the rows' conditions.
    if (!o.engine) {
      const taker = couldTake(d.input)
      if (taker) bad('hold', `${short(d.thread)} turn ${d.turn} held (${o.hold}) though ${taker} could take it`)
      continue
    }
    const t = d.input.thread
    const under = o.rule === 'stay' ? STAY_UNDER : o.rule === 'back' ? BACK_UNDER : ENTER_UNDER
    const m = d.input.table.machines.find((x) => x.machine === parseEngine(o.engine!)?.machine)
    if (!m || !m.engines.some((e) => e.engine === o.engine && e.signedIn) || !alive(d.input, m.machine) || !room(d.input, accountOf(o.engine), under)) bad('DISP-3', `${short(d.thread)} turn ${d.turn}: ${o.engine} (${o.rule}) is not alive, signed in and under ${under} %`)
    if (o.rule === 'new' ? t.last !== null : o.rule === 'stay' ? o.engine !== t.last : false) bad('switch', `${short(d.thread)} turn ${d.turn}: rule ${o.rule} with last ${t.last}`)
    if (o.engine !== t.last && t.last) {
      // A change of engine is either forced (the last engine cannot stay) or the return of the `back` row.
      if (o.rule === 'back') {
        const lastP = parseEngine(t.last)!.provider
        if (t.retry || t.first === null || lastP === t.first || parseEngine(o.engine)!.provider !== t.first || t.doneHere < BACK_AFTER) bad('DISP-5', `${short(d.thread)} turn ${d.turn}: back to ${o.engine} after ${t.doneHere} turns`)
      } else if (canStay(d.input)) bad('switch', `${short(d.thread)} turn ${d.turn}: left ${t.last} for ${o.engine} (${o.rule}) though it could stay`)
    }
  }
  // Changes of engine as the journals have them: an `assigned` to another engine than the turn before.
  for (const [thread, journal] of finals) {
    let last: string | null = null
    for (const e of journal) {
      if (e.type !== 'turn' || e.state !== 'assigned' || !e.engine) continue
      if (last !== null && e.engine !== last && w.born.get(e.id)?.t !== -1) {
        switches++
        perThread.set(thread, (perThread.get(thread) ?? 0) + 1)
      }
      last = e.engine
    }
  }
  for (const n of perThread.values()) maxSwitches = Math.max(maxSwitches, n)
  for (const r of w.reservations) if (r.five + r.reserved > 100 + 1e-9) bad('DISP-6', `${r.account} at ${r.five} % with ${r.reserved} reserved at ${s(r.t)}`)

  if (!w.quiet) bad('unsettled', `not quiet ${s(w.end - w.sc.chaos)} after every machine came back: ${pending(w, finals).join('; ')}`)

  const wideClocks = (['laptop'] as const).some((m) => [0, w.end].some((t) => Math.abs(clock(w, m, t) - clock(w, 'server', t)) > SKEW))
  return {
    violations: out,
    stats: {
      messages: w.accepted.length, turnsDone, held, runs: w.runs.length, steals: w.steals.length, stealDelay, orphans: w.orphansPushed.length, lateNotes,
      liveSteals, switches, maxSwitches, quotaStops: w.runs.filter((r) => r.why === 'quota').length, wideClocks, simulated: w.end,
    },
  }
}

const key = (d: Decision) => `${d.rule}|${d.engine}|${d.rung}|${d.reason}|${d.hold}|${d.reserve?.account}|${d.reserve?.points}`

/** What keeps a run from being quiet, in words. */
function pending(w: World, finals: Map<string, readonly JournalEvent[]>): string[] {
  const out: string[] = []
  for (const [thread, journal] of finals) {
    const open = turnsOf(journal).filter((t) => t.state !== 'done' && t.state !== 'held')
    if (open.length) out.push(`${thread.slice(-4)} turn ${open.map((t) => `${t.turn} ${t.state}`).join(', ')}`)
    const l = w.hub.refs.get(`refs/leases/${thread}`)
    if (l && w.hub.lease(l).state === 'working') out.push(`${thread.slice(-4)} lease working (${w.hub.lease(l).holder})`)
  }
  for (const m of Object.values(w.machines)) if (m.work.size || m.unsure.size || m.pendingOrphans.size) out.push(`${m.id} busy`)
  return out.length ? out : ['messages still on their way']
}

/** A machine's clock minus real time, at real time t. */
function clock(w: World, m: MachineId, t: number): number {
  const x = w.machines[m]
  return x.offset + Math.round(t * x.drift)
}
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** When each machine could reach the hub, and when the server (the hub and the dispatcher) was on: [from, to) spans. */
function reachability(w: World): { reach: Record<MachineId, [number, number][]>; on: { server: [number, number][] } } {
  const state = { laptop: { on: true, link: true }, server: { on: true, link: true } }
  const flags = () => ({ laptop: state.laptop.on && state.laptop.link && state.server.on, server: state.server.on })
  const spans = { laptop: [] as [number, number][], server: [] as [number, number][] }
  const since: Record<MachineId, number | null> = { laptop: 0, server: 0 }
  const flip = (t: number) => {
    const f = flags()
    for (const m of ['laptop', 'server'] as const) {
      if (f[m] && since[m] === null) since[m] = t
      if (!f[m] && since[m] !== null) {
        spans[m].push([since[m]!, t])
        since[m] = null
      }
    }
  }
  for (const c of w.changes) {
    if (c.machine === 'phone') continue
    state[c.machine] = { on: c.on, link: c.link }
    flip(c.t)
  }
  for (const m of ['laptop', 'server'] as const) if (since[m] !== null) spans[m].push([since[m]!, Infinity])
  return { reach: spans, on: { server: spans.server } }
}

// The decision table's own notions, written again here so that the checks do not trust the code they check.
function alive(i: DecideInput, machine: string): boolean {
  const m = i.table.machines.find((x) => x.machine === machine)
  return !!m && (m.answers === true || (m.answers !== false && i.now - m.seen < ALIVE_FOR))
}
function room(i: DecideInput, account: string, under: number): boolean {
  const q = i.table.quotas[account]
  if (!q) return false
  const now = (u: { used: number; resetsAt: number | null }) => (u.resetsAt !== null && i.now >= u.resetsAt ? 0 : u.used)
  return now(q.fiveHour) + reservedOn(i.ledger, account) < under && now(q.week) < under
}
/** An engine some row of the table would give the turn to, ignoring which row: the hold checks against it. */
function couldTake(i: DecideInput): string | null {
  if (canStay(i)) return i.thread.last
  const t = i.thread
  const E = t.last ? parseEngine(t.last)! : null
  const none = t.checkpoint === 'none'
  for (const m of i.table.machines) {
    if (!alive(i, m.machine)) continue
    const has = t.project === null || m.projects.includes(t.project)
    for (const e of m.engines) {
      const p = parseEngine(e.engine)
      if (!e.signedIn || !p || p.machine !== m.machine || !room(i, accountOf(e.engine), ENTER_UNDER)) continue
      const ok = !E
        ? has
        : p.provider === E.provider
          ? accountOf(e.engine) !== accountOf(t.last!) && m.machine === E.machine || (!none && m.machine !== E.machine && (has || t.cloneable))
          : has && (!none || m.machine === E.machine)
      if (ok) return e.engine
    }
  }
  return null
}
function canStay(i: DecideInput): boolean {
  const last = i.thread.last
  if (!last) return false
  const p = parseEngine(last)!
  const m = i.table.machines.find((x) => x.machine === p.machine)
  return alive(i, p.machine) && !!m?.engines.some((e) => e.engine === last && e.signedIn) && room(i, accountOf(last), STAY_UNDER)
}

