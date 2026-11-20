// The simulated world: a phone, a laptop and a server that hosts the hub and the dispatcher; fake engines that burn
// quota; clocks that disagree; machines and links that go away and come back. Discrete events on one timeline, all
// drawn from one seed. It runs the real rules: lease.ts (take, renew, steal, lose, late notes), turn.ts (the turn
// transaction and the retry rule) and dispatch.ts (the decision table), over the in-memory hub of hub.ts.
//
// Who writes what is decided in docs/spec/03-sync-and-lease.md ("Who writes what") and is what this file does:
// the dispatcher's machine files messages and holds, steals, and folds orphans; the machine of the chosen engine
// writes `assigned`, `leg.start` and `running` in the push that takes the lease; the engine's machine writes the rest.

import { parseEngine, type JournalEvent, type LegId, type Provider } from '../journal.ts'
import { OBSERVE_EVERY, RENEW_EVERY, lateNote, observe, orphanRef, plan, stealable, standing, type Intent, type Lease, type Seen } from '../lease.ts'
import { assign, next, stolen, turnsOf, type Effect, type Turn, type TurnChange } from '../turn.ts'
import { accountOf, reservedOn, type DecideInput, type Decision, type Quota } from '../dispatch.ts'
import { Dispatcher, type Instruction as Order, type PlaceOptions } from '../dispatcher.ts'
import { Hub } from './hub.ts'
import { Rng, ulid } from './rng.ts'
import { MIN, S, type Control, type MachineId, type RunView, type Scenario } from './scenario.ts'

export const BASE = Date.parse('2026-11-20T08:00:00Z')
const PUBLISH_EVERY = 60 * S
const FORWARD_AGAIN = 30 * S
const PHONE_RETRY = 15 * S
const SETTLE_MAX = 90 * MIN
const QUIET_EVERY = 30 * S

/** An event as a writer prepares it: the envelope (v, seq, at, leg) is added when it is appended. */
type Draft = (JournalEvent extends infer E ? (E extends JournalEvent ? Omit<E, 'v' | 'seq' | 'id' | 'at' | 'leg'> : never) : never) & { id?: string; leg?: LegId | null }
/** A change of turn.ts as the `turn` event it is. */
const turnDraft = (c: TurnChange): Draft => ({ type: 'turn', ...c }) as Draft

// ---------------------------------------------------------------- the timeline

class Loop {
  t = 0
  private h: { at: number; n: number; fn: () => void }[] = []
  private n = 0
  at(at: number, fn: () => void) {
    const h = this.h
    h.push({ at, n: this.n++, fn })
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(h[p], h[i])) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }
  after(ms: number, fn: () => void) {
    this.at(this.t + Math.max(0, Math.round(ms)), fn)
  }
  /** Runs the events up to `until`, in time order (and, at one time, in the order they were scheduled). */
  run(until: number) {
    const h = this.h
    while (h.length && h[0].at <= until) {
      const top = h[0]
      const last = h.pop()!
      if (h.length) {
        h[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1
          const r = l + 1
          let m = i
          if (l < h.length && less(h[l], h[m])) m = l
          if (r < h.length && less(h[r], h[m])) m = r
          if (m === i) break
          ;[h[m], h[i]] = [h[i], h[m]]
          i = m
        }
      }
      this.t = top.at
      top.fn()
    }
    this.t = Math.max(this.t, until)
  }
}
const less = (a: { at: number; n: number }, b: { at: number; n: number }) => a.at < b.at || (a.at === b.at && a.n < b.n)

// ---------------------------------------------------------------- what the world records, for the checks

export interface RunLog extends RunView {
  id: number
  request: 'message' | 'preface'
  /** The turn's effect when this attempt was assigned (some: an earlier attempt did something). */
  effectBefore: Effect
  start: number
  stop: number | null
  why: string | null
}
export interface Born {
  t: number
  machine: string
  run: number | null
}
export interface StealLog {
  t: number
  thread: string
  holder: string
  /** Real time the stolen lease commit entered the hub. */
  set: number
}
export interface DecisionLog {
  t: number
  thread: string
  turn: number
  attempt: number
  input: DecideInput
  output: Decision
}
export interface Change {
  t: number
  machine: MachineId | 'phone'
  on: boolean
  link: boolean
}

interface Machine {
  id: MachineId
  on: boolean
  link: boolean
  offset: number
  drift: number
  boot: number
  projects: string[]
  engines: { engine: string; signedIn: boolean }[]
  /** Down and cut counters: faults overlap. */
  downs: number
  cuts: number
  // disk: survives a power cut
  local: Map<string, string>
  epochs: Map<string, number>
  pendingOrphans: Map<string, { thread: string; commit: string }>
  // memory
  seen: Map<string, Seen>
  work: Map<string, Work>
  unsure: Set<string>
}
interface Work {
  thread: string
  turn: number
  engine: string
  leg: LegId
  legOpen: boolean
  run: RunLog | null
  ending: boolean
  forwards: Inbox[]
}
interface Inbox {
  key: string
  thread: string
  text: string
}
type Instruction = Order
interface Read {
  seen: Seen
  journal: readonly JournalEvent[]
  orphans: { ref: string; commit: string }[]
}
interface TrueQuota {
  five: number
  week: number
  resetsAt: number
  burn: number
}
interface PhoneMessage {
  key: string
  conv: number
}

export class World {
  readonly loop = new Loop()
  readonly hub = new Hub()
  readonly rng: Rng
  readonly sc: Scenario
  readonly machines: Record<MachineId, Machine>
  readonly quota = new Map<string, TrueQuota>()
  /** Thread id → project, for every thread the dispatcher knows. */
  readonly registry = new Map<string, string>()
  readonly starting: string[] = []
  // the dispatcher (on the server): disk
  /** Messages accepted and not yet seen in their thread, by thread; dropped once the hub has them. */
  readonly inbox = new Map<string, Map<string, Inbox>>()
  /** Every key accepted, and its thread: a message the phone sends again is answered, not filed again. */
  private readonly keys = new Map<string, string>()
  private readonly convThread = new Map<number, string>()
  // the dispatcher: memory. The same class as weevilsd's (dispatcher.ts): ledger, engine table, pending turns, holds.
  readonly d: Dispatcher
  private readonly forwarded = new Map<string, number>()
  // the phone
  private readonly outbox = new Map<number, PhoneMessage[]>()
  private phoneCuts = 0
  // records
  readonly accepted: { key: string; thread: string; t: number }[] = []
  readonly born = new Map<string, Born>()
  readonly runs: RunLog[] = []
  readonly steals: StealLog[] = []
  readonly decisions: DecisionLog[] = []
  readonly reservations: { t: number; account: string; five: number; reserved: number }[] = []
  readonly losts: { t: number; machine: string; thread: string; epoch: number }[] = []
  readonly orphansPushed: { t: number; machine: string; thread: string; ref: string; commit: string }[] = []
  readonly changes: Change[] = []
  readonly trace: string[] | null
  quiet = false
  end = 0
  private runs_ = 0
  private readonly turnsCache = new Map<string, Turn[]>()
  private readonly keysCache = new Map<string, Set<string>>()

  constructor(sc: Scenario, seed: number, o: { trace?: boolean } = {}) {
    this.sc = sc
    this.rng = new Rng(seed ^ 0x5eed)
    this.d = new Dispatcher(sc.preferred)
    this.trace = o.trace ? [] : null
    const mk = (id: MachineId): Machine => {
      const s = sc.machines.find((m) => m.id === id)!
      return {
        id, on: true, link: true, offset: s.offset, drift: s.drift, boot: 0, projects: s.projects, engines: s.engines, downs: 0, cuts: 0,
        local: new Map(), epochs: new Map(), pendingOrphans: new Map(), seen: new Map(), work: new Map(), unsure: new Set(),
      }
    }
    this.machines = { laptop: mk('laptop'), server: mk('server') }
    for (const [a, q] of Object.entries(sc.quotas)) this.quota.set(a, { five: q.five, week: q.week, resetsAt: q.resetsAt, burn: q.burn })
    this.bootstrap()
  }

  // ---------------------------------------------------------------- clocks, reachability, trace

  /** A machine's clock: offset and drift from real time. */
  now(m: Machine): number {
    return BASE + this.loop.t + m.offset + Math.round(this.loop.t * m.drift)
  }
  get server() {
    return this.machines.server
  }
  /** The hub is on the server: a machine reaches it when both are on and its link is up. */
  reachable(m: Machine): boolean {
    return m.on && this.server.on && (m.id === 'server' || m.link)
  }
  /** The dispatcher calls a machine directly over the same link. */
  direct(m: Machine): boolean {
    return this.reachable(m)
  }
  private log(who: string, what: string) {
    if (this.trace) this.trace.push(`${(this.loop.t / 1000).toFixed(1).padStart(7)} s  ${who.padEnd(7)} ${what}`)
  }
  machineOf(engine: string): Machine {
    return this.machines[parseEngine(engine)!.machine as MachineId]
  }

  // ---------------------------------------------------------------- journals

  private turnsAt(tip: string | null): Turn[] {
    if (!tip) return []
    let t = this.turnsCache.get(tip)
    if (!t) this.turnsCache.set(tip, (t = turnsOf(this.hub.thread(tip).journal)))
    return t
  }
  private keysAt(tip: string | null): Set<string> {
    if (!tip) return new Set()
    let k = this.keysCache.get(tip)
    if (!k) {
      k = new Set()
      for (const e of this.hub.thread(tip).journal) if (e.type === 'message' && e.key) k.add(e.key)
      this.keysCache.set(tip, k)
    }
    return k
  }
  /** Appends drafts to a journal: seq, id, time by the writer's clock, and the open leg. */
  private extend(journal: readonly JournalEvent[], drafts: readonly Draft[], m: Machine, run: number | null): JournalEvent[] {
    const out = journal.slice()
    let { open, count } = legs(journal)
    const at = this.now(m)
    for (const d of drafts) {
      let leg: LegId | null = open
      if (d.type === 'leg.start') leg = open = `L${++count}`
      else if (d.type === 'note') leg = d.leg ?? null
      const e = { v: 1, seq: out.length + 1, id: d.id ?? ulid(at, this.rng), at: new Date(at).toISOString(), ...d, leg } as JournalEvent
      out.push(e)
      this.born.set(e.id, { t: this.loop.t, machine: m.id, run })
      if (d.type === 'leg.end') open = null
    }
    return out
  }
  /** A new local commit on the machine's own ref of the thread (not pushed). */
  private commitLocal(m: Machine, thread: string, base: string | null, drafts: readonly Draft[], run: number | null): string {
    const journal = base ? this.hub.thread(base).journal : []
    const tip = this.hub.threadCommit(base, this.extend(journal, drafts, m, run))
    m.local.set(thread, tip)
    return tip
  }

  // ---------------------------------------------------------------- the lease, as pushes to the in-memory hub

  read(m: Machine, thread: string): Read | null {
    if (!this.reachable(m)) return null
    const commit = this.hub.refs.get(`refs/leases/${thread}`) ?? null
    const lease = commit ? this.hub.lease(commit) : null
    const tip = this.hub.refs.get(`refs/threads/${thread}`) ?? null
    const seen = observe(m.seen.get(thread), commit, lease, tip, this.now(m))
    m.seen.set(thread, seen)
    return { seen, journal: tip ? this.hub.thread(tip).journal : [], orphans: this.hub.orphans(thread) }
  }

  /**
   * One push of one thread: the lease the rules allow, with a thread commit of `drafts` on top of `base`, and orphan
   * refs to delete, all atomic. `seen` is what the machine read before preparing it.
   */
  private pushOne(m: Machine, thread: string, seen: Seen, base: string | null, drafts: ((epoch: number) => Draft[]) | null, intent: Omit<Intent, 'tip'>, o: { steal?: boolean; drop?: Read['orphans']; run?: number | null } = {}): { ok: true; lease: Lease } | { ok: false; why: 'unreachable' | 'refused' | 'rejected' | 'lost' } {
    if (!this.reachable(m)) return { ok: false, why: 'unreachable' }
    const p = plan(m.id, thread, seen, { ...intent, tip: base }, this.now(m), { steal: o.steal })
    if (!p.op) return { ok: false, why: 'refused' }
    const ds = drafts?.(p.lease.epoch) ?? []
    const tip = ds.length ? this.hub.threadCommit(base, this.extend(base ? this.hub.thread(base).journal : [], ds, m, o.run ?? null)) : base
    const lease: Lease = { ...p.lease, tip }
    const lc = this.hub.leaseCommit(lease)
    const r = this.hub.push(m.id, [
      ...(tip && tip !== seen.tip ? [{ ref: `refs/threads/${thread}`, to: tip, ff: true }] : []),
      { ref: `refs/leases/${thread}`, to: lc, expect: p.expect },
      ...(o.drop ?? []).map((d) => ({ ref: d.ref, to: null, expect: d.commit })),
    ], this.loop.t)
    if (r.ok) {
      m.seen.set(thread, { commit: lc, lease, tip, since: this.now(m) })
      if (tip) m.local.set(thread, tip)
      m.epochs.set(thread, lease.epoch)
      this.log(m.id, `${p.op} ${short(thread)} epoch ${lease.epoch} ${lease.state}${ds.length ? ` +${ds.map((d) => (d.type === 'turn' ? `turn ${d.turn} ${d.state}` : d.type)).join(', ')}` : ''}`)
      return { ok: true, lease }
    }
    const again = this.read(m, thread)
    const where = again ? standing(m.id, again.seen) : 'free'
    return { ok: false, why: p.op === 'renew' && where === 'lost' ? 'lost' : 'rejected' }
  }

  /** Every working lease of a machine, renewed in one atomic push; a rejected one is dropped and the rest pushed again. */
  sync(m: Machine) {
    if (!m.on || !this.reachable(m)) return
    for (const [ref, o] of [...m.pendingOrphans]) this.pushOrphan(m, ref, o.thread, o.commit)
    for (const thread of [...m.unsure]) this.reconcile(m, thread)
    for (const w of m.work.values()) if (w.forwards.length && !w.ending) this.appendForwards(m, w)
    let items = [...m.work.values()]
    const retried = new Set<string>()
    while (items.length) {
      const prepared: { w: Work; lease: Lease; lc: string; seen: Seen }[] = []
      for (const w of items) {
        const seen = m.seen.get(w.thread)
        if (!seen || seen.lease?.holder !== m.id) {
          this.lose(m, w.thread)
          continue
        }
        const intent: Intent = w.ending ? { engine: w.legOpen ? w.engine : null, leg: w.legOpen ? w.leg : null, state: 'idle', tip: m.local.get(w.thread)! } : { engine: w.engine, leg: w.leg, state: 'working', turn: w.turn, tip: m.local.get(w.thread)! }
        const p = plan(m.id, w.thread, seen, intent, this.now(m))
        if (!p.op) continue
        prepared.push({ w, lease: p.lease, lc: this.hub.leaseCommit(p.lease), seen })
      }
      if (!prepared.length) return
      const updates = prepared.flatMap(({ w, lc, lease, seen }) => [
        ...(lease.tip !== seen.tip && lease.tip ? [{ ref: `refs/threads/${w.thread}`, to: lease.tip, ff: true }] : []),
        { ref: `refs/leases/${w.thread}`, to: lc, expect: seen.commit },
      ])
      const r = this.hub.push(m.id, updates, this.loop.t)
      if (r.ok) {
        for (const { w, lease, lc } of prepared) {
          m.seen.set(w.thread, { commit: lc, lease, tip: lease.tip, since: this.now(m) })
          if (w.ending) {
            m.work.delete(w.thread)
            this.log(m.id, `idle ${short(w.thread)}`)
            this.notify(w.thread)
          }
        }
        return
      }
      const culprits = new Set(r.culprits.map((ref) => ref.split('/')[2]))
      items = prepared.filter((x) => !culprits.has(x.w.thread)).map((x) => x.w)
      for (const x of prepared.filter((x) => culprits.has(x.w.thread))) {
        const again = this.read(m, x.w.thread)
        if (again && standing(m.id, again.seen) === 'holder' && !retried.has(x.w.thread)) {
          retried.add(x.w.thread)
          items.push(x.w)
        } else this.lose(m, x.w.thread)
      }
    }
  }

  /** lose: stop the engine, put what was not pushed under an orphan ref, write nothing more to the thread. */
  private lose(m: Machine, thread: string) {
    const w = m.work.get(thread)
    if (w?.run) this.stopRun(w.run, 'lost')
    m.work.delete(thread)
    const epoch = m.epochs.get(thread) ?? 0
    this.losts.push({ t: this.loop.t, machine: m.id, thread, epoch })
    this.log(m.id, `lost ${short(thread)} (epoch ${epoch})`)
    const L = m.local.get(thread)
    const H = this.hub.refs.get(`refs/threads/${thread}`) ?? null
    if (L && L !== H && !(H && this.hub.ancestor(L, H))) {
      const ref = orphanRef(thread, m.id, epoch)
      m.pendingOrphans.set(ref, { thread, commit: L })
      this.pushOrphan(m, ref, thread, L)
    } else if (H) m.local.set(thread, H)
  }
  private pushOrphan(m: Machine, ref: string, thread: string, commit: string) {
    if (!this.reachable(m)) return
    const cur = this.hub.refs.get(ref)
    if (cur !== commit) {
      // Created once. Another value under the same name never happens: a name is one machine and one epoch.
      const r = this.hub.push(m.id, [{ ref, to: commit, expect: null }], this.loop.t)
      if (!r.ok) return
      this.orphansPushed.push({ t: this.loop.t, machine: m.id, thread, ref, commit })
      this.log(m.id, `orphan ${short(thread)} ${ref.split('/').slice(3).join('/')}`)
    }
    m.pendingOrphans.delete(ref)
    const H = this.hub.refs.get(`refs/threads/${thread}`)
    if (H && !m.work.has(thread)) m.local.set(thread, H)
  }

  /**
   * After a restart or a cut: compare the machine's own ref of a thread with the hub. Still the holder: push what it
   * has and close the turn it can no longer run. Not the holder: what was not pushed becomes an orphan.
   */
  private reconcile(m: Machine, thread: string) {
    const r = this.read(m, thread)
    if (!r) return
    m.unsure.delete(thread)
    if (m.work.has(thread)) return
    const L = m.local.get(thread) ?? null
    const H = r.seen.tip
    const ahead = !!L && L !== H && (!H || this.hub.ancestor(H, L))
    const lease = r.seen.lease
    if (lease?.holder === m.id) {
      if (!ahead && lease.state === 'idle') return
      const base = ahead ? L : H
      const journal = base ? this.hub.thread(base).journal : []
      const s = stolen(this.turnsAt(base))
      const open = legs(journal).open
      const res = this.pushOne(m, thread, r.seen, base, () => [...(s ? [turnDraft(s)] : []), ...(open ? [{ type: 'leg.end', reason: 'machine-lost', by: m.id } as Draft] : [])], { engine: null, leg: null, state: 'idle' })
      if (!res.ok && res.why === 'lost') this.lose(m, thread)
      else if (res.ok) this.notify(thread)
    } else if (L && L !== H && !(H && this.hub.ancestor(L, H))) this.lose(m, thread)
    else if (H) m.local.set(thread, H)
  }

  // ---------------------------------------------------------------- engines and turns

  /** The machine of the chosen engine takes the lease and starts the turn: assigned, leg.start, running, in one push. */
  startTurn(m: Machine, ins: Instruction, retry = true) {
    if (!m.on) return
    const r = this.read(m, ins.thread)
    if (!r) return
    const turns = this.turnsAt(r.seen.tip)
    const n = next(turns)
    if (n.kind !== 'dispatch' || n.turn !== ins.turn || n.attempt !== ins.attempt) return
    if (r.seen.lease?.state === 'working' || m.work.has(ins.thread)) return
    const boot = m.boot
    const go = () => {
      if (!m.on || m.boot !== boot || m.work.has(ins.thread)) return
      const journal = r.journal
      const { open, openEngine, count } = legs(journal)
      const same = open !== null && openEngine === ins.engine
      const leg: LegId = same ? open! : `L${count + 1}`
      const provider = parseEngine(ins.engine)!.provider
      const project = this.registry.get(ins.thread)!
      const res = this.pushOne(m, ins.thread, r.seen, r.seen.tip, (epoch) => [
        ...(open && !same ? [{ type: 'leg.end', reason: 'moved', by: m.id } as Draft] : []), // i18n-ignore: simulated content
        turnDraft(assign(turns, ins.turn, ins.engine, ins.rule, ins.reason)),
        ...(same ? [] : [{ type: 'leg.start', engine: ins.engine, session: this.session(journal, provider, ins.rung), cwd: `/home/u/${project}`, rung: ins.rung, epoch } as Draft]),
        { type: 'turn', turn: ins.turn, state: 'running' } as Draft,
      ], { engine: ins.engine, leg, state: 'working', turn: ins.turn })
      if (!res.ok) {
        if (res.why === 'rejected' && retry) this.startTurn(m, ins, false)
        return
      }
      const w: Work = { thread: ins.thread, turn: ins.turn, engine: ins.engine, leg, legOpen: true, run: null, ending: false, forwards: [] }
      m.work.set(ins.thread, w)
      this.startRun(m, w, ins, turns[ins.turn - 1].effect)
    }
    if (m.id === 'server') go()
    else this.loop.after(this.rng.int(50, 800), go)
  }
  /** The provider session: the same provider's last one on rungs 1 and 2; a new one otherwise. */
  private session(journal: readonly JournalEvent[], provider: Provider, rung: number): string {
    if (rung === 1 || rung === 2) {
      const last = journal.findLast((e) => e.type === 'leg.start' && parseEngine(e.engine)?.provider === provider)
      if (last && last.type === 'leg.start') return last.session
    }
    return `${provider}-${ulid(BASE + this.loop.t, this.rng).slice(10)}`
  }

  private startRun(m: Machine, w: Work, ins: Instruction, effectBefore: Effect) {
    const [lo, hi] = this.sc.steps
    const run: RunLog = { id: ++this.runs_, thread: ins.thread, machine: m.id, engine: ins.engine, turn: ins.turn, attempt: ins.attempt, taken: 0, request: ins.request, effectBefore, start: this.loop.t, stop: null, why: null }
    const plan = { steps: this.rng.int(lo, hi), boot: m.boot }
    w.run = run
    this.runs.push(run)
    this.log(m.id, `run ${run.id} ${short(ins.thread)} turn ${ins.turn}.${ins.attempt} on ${ins.engine} (${ins.request})`)
    this.sc.hooks?.onStart?.(this.control, run)
    const step = () => {
      if (run.stop !== null || !m.on || m.boot !== plan.boot || m.work.get(run.thread) !== w) return
      const q = this.trueQuota(accountOf(run.engine))
      const signed = m.engines.find((e) => e.engine === run.engine)?.signedIn
      if (!signed) return this.endRun(m, w, 'auth')
      if (q.five >= 100 || q.week >= 100) return this.endRun(m, w, 'quota')
      if (run.taken > 0 && this.rng.chance(this.sc.apiErrors)) return this.endRun(m, w, 'api')
      const cost = q.burn * this.rng.real(0.5, 1.5)
      q.week = Math.min(100, q.week + cost / 12)
      if (q.five + cost >= 100) {
        q.five = 100
        return this.endRun(m, w, 'quota')
      }
      q.five += cost
      if (run.taken >= plan.steps) return this.endRun(m, w, 'done')
      run.taken++
      const name = this.rng.pick(['Read', 'Edit', 'Bash', 'Grep'])
      this.commitLocal(m, run.thread, m.local.get(run.thread)!, [{ type: 'tool', call: `call_${run.id}_${run.taken}`, name, summary: `${name} · step ${run.taken}` }], run.id) // i18n-ignore: simulated content
      this.sc.hooks?.onStep?.(this.control, run)
      this.loop.after(this.rng.int(...this.sc.stepTime) * S, step)
    }
    this.loop.after(this.rng.int(2, 15) * S, step)
  }

  /** The engine stopped: done, or failed with the effect it had. Its machine writes it and goes idle. */
  private endRun(m: Machine, w: Work, how: 'done' | 'quota' | 'api' | 'auth') {
    const run = w.run!
    const kind = this.sc.projects[this.registry.get(run.thread)!]?.kind ?? 'git'
    const checkpoint = { type: 'checkpoint', turn: run.turn, ...(kind === 'git' ? { kind: 'git', repo: 'git.example.com/u/p', commit: hex40(this.rng), base: hex40(this.rng), branch: 'main', changed: run.taken } : { kind: 'none', reason: 'home folder' }) } as Draft // i18n-ignore: simulated content
    const effect: Effect = run.taken > 0 ? 'some' : 'none'
    const drafts: Draft[] = how === 'done'
      ? [{ type: 'message', role: 'assistant', text: `answer of run ${run.id}` } as Draft, checkpoint, { type: 'turn', turn: run.turn, state: 'done' } as Draft] // i18n-ignore: simulated content
      : [
        ...(effect === 'some' ? [checkpoint] : []),
        { type: 'turn', turn: run.turn, state: 'failed', reason: how, effect } as Draft,
        { type: 'leg.end', reason: how === 'quota' ? 'quota' : 'error', by: m.id } as Draft,
      ]
    this.commitLocal(m, run.thread, m.local.get(run.thread)!, drafts, run.id)
    this.stopRun(run, how)
    w.ending = true
    w.legOpen = how === 'done'
    if (how === 'quota') this.publish(m)
    this.sync(m)
  }
  private stopRun(run: RunLog, why: string) {
    if (run.stop !== null) return
    run.stop = this.loop.t
    run.why = why
    this.log(run.machine, `run ${run.id} stops: ${why}`)
  }
  private trueQuota(account: string): TrueQuota {
    const q = this.quota.get(account)!
    while (this.loop.t >= q.resetsAt) {
      q.five = 0
      q.resetsAt += 5 * 60 * MIN
    }
    return q
  }
  /** A message the dispatcher forwarded while the turn runs: it opens the next turn, which waits in accepted. */
  private appendForwards(m: Machine, w: Work) {
    const base = m.local.get(w.thread)!
    const keys = new Set(this.hub.thread(base).journal.flatMap((e) => (e.type === 'message' && e.key ? [e.key] : [])))
    const fresh = w.forwards.filter((f) => !keys.has(f.key))
    w.forwards = []
    if (!fresh.length) return
    let turn = turnsOf(this.hub.thread(base).journal).length
    const drafts: Draft[] = []
    for (const f of fresh) {
      const id = ulid(this.now(m), this.rng)
      drafts.push({ type: 'message', id, role: 'user', text: f.text, source: 'weevils', key: f.key } as Draft, { type: 'turn', turn: ++turn, state: 'accepted', message: id } as Draft)
    }
    this.commitLocal(m, w.thread, base, drafts, null)
  }

  // ---------------------------------------------------------------- the dispatcher, on the server

  /** The dispatcher looks at one thread: steal what is stale, file what waits, place the oldest waiting turn. */
  step(thread: string) {
    const s = this.server
    if (!s.on) return
    let r = this.read(s, thread)!
    let lease = r.seen.lease
    if (lease?.state === 'working' && lease.holder === s.id && !s.work.has(thread)) {
      this.reconcile(s, thread)
      r = this.read(s, thread)!
      lease = r.seen.lease
    }
    if (lease?.state === 'working') {
      this.d.working(thread)
      this.forward(this.machines[lease.holder as MachineId], thread, r)
      if (lease.holder === s.id || !stealable(r.seen, this.now(s)).ok) return
      const turns = this.turnsAt(r.seen.tip)
      const failed = stolen(turns)
      const open = legs(r.journal).open
      const set = this.setTime(r.seen.commit!)
      const res = this.pushOne(s, thread, r.seen, r.seen.tip, () => [...(failed ? [turnDraft(failed)] : []), ...(open ? [{ type: 'leg.end', reason: 'machine-lost', by: s.id } as Draft] : [])], { engine: null, leg: null, state: 'idle' }, { steal: true })
      if (!res.ok) return
      this.steals.push({ t: this.loop.t, thread, holder: lease.holder, set })
      this.d.stole(thread)
      r = this.read(s, thread)!
    }
    // The lease is idle or absent. File what waits: orphans as late notes, messages as turns.
    const drafts: Draft[] = []
    const project = this.registry.get(thread)!
    if (!r.seen.tip) drafts.push({ type: 'meta', thread, title: `Thread ${short(thread)}`, project } as Draft) // i18n-ignore: simulated content
    for (const o of r.orphans) {
      const note = lateNote(r.journal, this.hub.thread(o.commit).journal, o.ref)
      if (note) drafts.push(note as Draft)
    }
    let turn = this.turnsAt(r.seen.tip).length
    for (const e of this.waiting(thread, r.seen.tip)) {
      const id = ulid(this.now(s), this.rng)
      drafts.push({ type: 'message', id, role: 'user', text: e.text, source: 'weevils', key: e.key } as Draft, { type: 'turn', turn: ++turn, state: 'accepted', message: id } as Draft)
    }
    if (drafts.length || r.orphans.length) {
      const res = this.pushOne(s, thread, r.seen, r.seen.tip, () => drafts, { engine: null, leg: null, state: 'idle' }, { drop: r.orphans })
      if (!res.ok) return
      r = this.read(s, thread)!
    }
    this.place(thread, r)
  }

  /** The retry rule, then the decision table (dispatcher.ts, as in weevilsd); the chosen engine's machine is called
   *  directly. */
  private place(thread: string, r: Read) {
    const s = this.server
    const turns = this.turnsAt(r.seen.tip)
    const now = this.now(s)
    const p = this.d.place(thread, r.journal, turns, now, this.placing(thread))
    if (p.kind === 'none') return
    if (p.kind === 'hold') {
      if (p.changes.length) {
        if (p.decision) this.log('server', `hold ${short(thread)}: ${p.decision.hold}`)
        this.pushOne(s, thread, r.seen, r.seen.tip, () => p.changes.map(turnDraft), { engine: null, leg: null, state: 'idle' })
      }
      return
    }
    const { ins, decision: d, input } = p
    const account = accountOf(d.engine!)
    const q = input.table.quotas[account]
    this.reservations.push({ t: this.loop.t, account, five: q ? (q.fiveHour.resetsAt !== null && input.now >= q.fiveHour.resetsAt ? 0 : q.fiveHour.used) : 0, reserved: reservedOn(this.d.ledger, account) })
    this.log('server', `${d.rule} ${short(thread)} turn ${ins.turn}.${ins.attempt} → ${d.engine}: ${d.reason}`)
    this.startTurn(this.machineOf(d.engine!), ins)
  }

  /** What the dispatcher needs besides the journal: the project, who answers, how to read a quota again. */
  private placing(thread: string): PlaceOptions {
    const project = this.registry.get(thread)!
    return {
      project,
      cloneable: this.sc.projects[project]?.cloneable ?? false,
      direct: (machine) => this.direct(this.machines[machine as MachineId]),
      reread: (account, now) => this.reading(account, now),
      accounts: this.quota.keys(),
      record: (d) => this.decisions.push({ t: this.loop.t, ...d }),
    }
  }

  private reading(account: string, readAt: number): Quota {
    const q = this.trueQuota(account)
    // The provider gives the time of the reset itself, by its own (true) clock.
    return { readAt, fiveHour: { used: Math.round(q.five * 10) / 10, resetsAt: BASE + q.resetsAt }, week: { used: Math.round(q.week * 10) / 10, resetsAt: null } }
  }
  /** A machine writes its engines.json: when it was seen, its quotas read now. */
  publish(m: Machine) {
    if (!this.reachable(m)) return
    const now = this.now(m)
    const quotas: Record<string, Quota> = {}
    for (const e of m.engines) if (e.signedIn) quotas[accountOf(e.engine)] = this.reading(accountOf(e.engine), now)
    this.d.engines.publish({ machine: m.id, projects: m.projects, engines: m.engines }, quotas, now, this.now(this.server))
  }
  /** A machine tells the dispatcher a thread changed (a turn ended): it looks at once. */
  private notify(thread: string) {
    if (this.server.on) this.loop.after(50, () => this.step(thread))
  }
  /** Messages for a thread whose turn runs go to the machine that runs it; they open the next turn there. */
  private forward(m: Machine, thread: string, r: Read) {
    for (const e of this.waiting(thread, r.seen.tip)) {
      if ((this.forwarded.get(e.key) ?? -Infinity) + FORWARD_AGAIN > this.loop.t || !this.direct(m)) continue
      this.forwarded.set(e.key, this.loop.t)
      const deliver = () => {
        const w = m.work.get(thread)
        if (m.on && w && !w.ending && !w.forwards.some((f) => f.key === e.key)) w.forwards.push(e)
      }
      if (m.id === 'server') deliver()
      else this.loop.after(this.rng.int(20, 300), deliver)
    }
  }
  /** The messages of a thread its journal does not have yet, at this tip; the others leave the inbox. */
  private waiting(thread: string, tip: string | null): Inbox[] {
    const box = this.inbox.get(thread)
    if (!box?.size) return []
    const keys = this.keysAt(tip)
    for (const key of box.keys()) if (keys.has(key)) box.delete(key)
    return [...box.values()]
  }
  /** Real time a lease commit entered the hub. */
  private setTime(commit: string): number {
    for (let i = this.hub.log.length - 1; i >= 0; i--) if (this.hub.log[i].updates.some((u) => u.to === commit)) return this.hub.log[i].t
    return 0
  }

  /** The phone's message reaches the dispatcher: kept on its disk, answered, and filed at once. */
  receive(msg: PhoneMessage): string | null {
    if (!this.server.on) return null
    let thread = this.keys.get(msg.key)
    if (!thread) {
      thread = this.convThread.get(msg.conv)
      if (!thread) {
        thread = ulid(this.now(this.server), this.rng)
        this.convThread.set(msg.conv, thread)
        this.registry.set(thread, this.sc.conversations[msg.conv].project)
      }
      const box = this.inbox.get(thread) ?? new Map<string, Inbox>()
      box.set(msg.key, { key: msg.key, thread, text: `message ${msg.key}` }) // i18n-ignore: simulated content
      this.inbox.set(thread, box)
      this.keys.set(msg.key, thread)
      this.accepted.push({ key: msg.key, thread, t: this.loop.t })
      this.log('phone', `sent ${msg.key} → ${short(thread)}`)
    }
    const at = thread
    this.loop.after(10, () => this.step(at))
    return thread
  }

  // ---------------------------------------------------------------- power, links, faults

  private power(m: Machine, on: boolean) {
    if (m.on === on) return
    m.on = on
    this.changes.push({ t: this.loop.t, machine: m.id, on, link: m.link })
    this.log(m.id, on ? 'on' : 'off')
    if (!on) {
      for (const w of m.work.values()) if (w.run) this.stopRun(w.run, 'off')
      m.work.clear()
      m.seen.clear()
      m.unsure.clear()
      if (m.id === 'server') {
        this.d.restart(null)
        this.forwarded.clear()
      }
      return
    }
    m.boot++
    // The dispatcher's memory is gone: it reads every engines.json again, as of now.
    if (m.id === 'server') this.d.engines.restart(this.now(m))
    m.unsure = new Set(m.local.keys())
    this.timers(m)
    this.loop.after(1 * S, () => this.sync(m))
  }
  private setLink(m: Machine, link: boolean) {
    if (m.link === link) return
    m.link = link
    this.changes.push({ t: this.loop.t, machine: m.id, on: m.on, link })
    this.log(m.id, link ? 'link up' : 'link cut')
    if (link) this.loop.after(100, () => this.sync(m))
  }
  private setPhone(link: boolean) {
    this.changes.push({ t: this.loop.t, machine: 'phone', on: true, link })
    if (link) for (const conv of this.outbox.keys()) this.send(conv)
  }
  private down(m: Machine, delta: number) {
    m.downs = Math.max(0, m.downs + delta)
    this.power(m, m.downs === 0)
  }
  private cut(m: Machine, delta: number) {
    m.cuts = Math.max(0, m.cuts + delta)
    this.setLink(m, m.cuts === 0)
  }
  readonly control: Control = {
    off: (id) => this.down(this.machines[id], 1),
    on: (id, after) => this.loop.after(after, () => this.down(this.machines[id], -1)),
    setQuota: (account, five) => void (this.trueQuota(account).five = five),
    threadId: (i) => this.starting[i],
  }

  /** The periodic work of a machine, for as long as it stays up: renewals, engines.json, and the dispatcher. */
  private timers(m: Machine) {
    const boot = m.boot
    const alive = () => m.on && m.boot === boot
    const every = (ms: number, first: number, fn: () => void) => {
      const tick = () => {
        if (!alive()) return
        fn()
        this.loop.after(ms, tick)
      }
      this.loop.after(first, tick)
    }
    every(RENEW_EVERY / (1 + m.drift), this.rng.int(1, 20) * S, () => this.sync(m))
    every(PUBLISH_EVERY, this.rng.int(0, 5) * S, () => this.publish(m))
    if (m.id === 'server') every(OBSERVE_EVERY / (1 + m.drift), this.rng.int(1, 10) * S, () => {
      for (const thread of this.registry.keys()) this.step(thread)
    })
  }

  // ---------------------------------------------------------------- the phone

  private send(conv: number) {
    const q = this.outbox.get(conv)
    if (!q?.length) return
    if (this.phoneCuts > 0) return
    const thread = this.receive(q[0])
    if (!thread) {
      this.loop.after(PHONE_RETRY, () => this.send(conv))
      return
    }
    // The answer can be lost on the way back: the phone sends the same message (same key) again.
    if (this.rng.chance(this.sc.lostAnswers)) {
      this.loop.after(PHONE_RETRY, () => this.send(conv))
      return
    }
    q.shift()
    if (q.length) this.loop.after(this.rng.int(1, 5) * S, () => this.send(conv))
  }

  // ---------------------------------------------------------------- the start, and the run

  /** The threads that exist at the start: their journals and idle leases in the hub, as if pushed before. */
  private bootstrap() {
    this.sc.threads.forEach((spec, i) => {
      const thread = ulid(BASE - 2 * 60 * MIN + i, this.rng)
      this.starting.push(thread)
      this.registry.set(thread, spec.project)
      let journal: JournalEvent[] = []
      let epoch = 1
      let holder = parseEngine(spec.legs[0].engine)!.machine
      let turn = 0
      const add = (m: Machine, ds: Draft[]) => {
        journal = this.extend(journal, ds, m, null)
      }
      spec.legs.forEach((leg, l) => {
        const machine = this.machineOf(leg.engine)
        if (machine.id !== holder) epoch++
        holder = machine.id
        for (let k = 0; k < leg.turns; k++) {
          turn++
          const id = ulid(BASE, this.rng)
          const first = l === 0 && k === 0
          add(machine, [
            ...(first ? [{ type: 'meta', thread, title: `Thread ${i}`, project: spec.project } as Draft] : []), // i18n-ignore: simulated content
            { type: 'message', id, role: 'user', text: `earlier request ${turn}`, source: 'weevils', key: `boot-${i}-${turn}` } as Draft, // i18n-ignore: simulated content
            { type: 'turn', turn, state: 'accepted', message: id } as Draft,
            ...(k === 0 && l > 0 ? [{ type: 'leg.end', reason: 'moved', by: machine.id } as Draft] : []), // i18n-ignore: simulated content
            { type: 'turn', turn, state: 'assigned', engine: leg.engine, attempt: 1, rule: first ? 'new' : k === 0 ? 'provider' : 'stay', reason: 'before the run' } as Draft, // i18n-ignore: simulated content
            ...(k === 0 ? [{ type: 'leg.start', engine: leg.engine, session: `${parseEngine(leg.engine)!.provider}-${i}-${l}`, cwd: `/home/u/${spec.project}`, rung: first ? 0 : 3, epoch } as Draft] : []),
            { type: 'turn', turn, state: 'running' } as Draft,
            { type: 'tool', call: `boot-${i}-${turn}`, name: 'Read', summary: 'Read · README.md' } as Draft, // i18n-ignore: simulated content
            { type: 'message', role: 'assistant', text: `earlier answer ${turn}` } as Draft, // i18n-ignore: simulated content
            { type: 'checkpoint', turn, ...(this.sc.projects[spec.project]?.kind === 'none' ? { kind: 'none', reason: 'home folder' } : { kind: 'git', repo: 'git.example.com/u/p', commit: hex40(this.rng), base: hex40(this.rng), branch: 'main', changed: 1 }) } as Draft, // i18n-ignore: simulated content
            { type: 'turn', turn, state: 'done' } as Draft,
          ])
        }
      })
      const tip = this.hub.threadCommit(null, journal)
      const last = spec.legs[spec.legs.length - 1].engine
      const m = this.machineOf(last)
      const at = BASE - 60 * MIN + m.offset
      const lease: Lease = { v: 1, thread, holder: m.id, engine: last, leg: legs(journal).open, epoch, state: 'idle', taken: iso(at), renewed: iso(at), expires: iso(at + 60 * S), tip }
      this.hub.refs.set(`refs/threads/${thread}`, tip)
      this.hub.refs.set(`refs/leases/${thread}`, this.hub.leaseCommit(lease))
      m.local.set(thread, tip)
      m.epochs.set(thread, epoch)
      for (const e of journal) this.born.set(e.id, { t: -1, machine: m.id, run: null })
    })
  }

  /** Runs the scenario: the faults and messages until `chaos`, then everything back, until quiet (or a limit). */
  run(): this {
    const sc = this.sc
    for (const m of Object.values(this.machines)) {
      this.timers(m)
      this.publish(m)
    }
    sc.conversations.forEach((c, i) => {
      if (c.existing !== null) this.convThread.set(i, this.starting[c.existing])
      this.outbox.set(i, [])
      c.at.forEach((at, k) => this.loop.at(at, () => {
        this.outbox.get(i)!.push({ key: `m${i}-${k}`, conv: i })
        if (this.outbox.get(i)!.length === 1) this.send(i)
      }))
    })
    for (const f of sc.faults) {
      if (f.kind === 'spike') this.loop.at(f.t, () => void (this.trueQuota(f.account).five = Math.min(100, this.trueQuota(f.account).five + f.points)))
      else if (f.kind === 'off') {
        this.loop.at(f.t, () => this.down(this.machines[f.machine], 1))
        this.loop.at(f.t + f.for, () => this.down(this.machines[f.machine], -1))
      } else if (f.machine === 'phone') {
        this.loop.at(f.t, () => void this.phoneCuts++)
        this.loop.at(f.t + f.for, () => {
          this.phoneCuts = Math.max(0, this.phoneCuts - 1)
          if (!this.phoneCuts) this.setPhone(true)
        })
      } else {
        const m = this.machines[f.machine]
        this.loop.at(f.t, () => this.cut(m, 1))
        this.loop.at(f.t + f.for, () => this.cut(m, -1))
      }
    }
    // The end of the faults: every machine back on, every link up.
    this.loop.at(sc.chaos, () => {
      for (const m of Object.values(this.machines)) {
        m.downs = 0
        m.cuts = 0
        this.power(m, true)
        this.setLink(m, true)
      }
      this.phoneCuts = 0
      this.setPhone(true)
    })
    this.loop.run(sc.chaos)
    let calm = 0
    const limit = sc.chaos + SETTLE_MAX
    while (this.loop.t < limit && calm < 2) {
      this.loop.run(this.loop.t + QUIET_EVERY)
      calm = this.isQuiet() ? calm + 1 : 0
    }
    this.quiet = calm >= 2
    this.end = this.loop.t
    return this
  }

  /** Nothing left to do: every message filed, no lease working, no orphan, every turn done or held. */
  isQuiet(): boolean {
    for (const q of this.outbox.values()) if (q.length) return false
    for (const m of Object.values(this.machines)) if (!m.on || m.work.size || m.unsure.size || m.pendingOrphans.size) return false
    if (this.d.pendingCount) return false
    for (const thread of this.registry.keys()) {
      const commit = this.hub.refs.get(`refs/leases/${thread}`)
      if (commit && this.hub.lease(commit).state === 'working') return false
      if (this.hub.orphans(thread).length) return false
      const tip = this.hub.refs.get(`refs/threads/${thread}`) ?? null
      const keys = this.keysAt(tip)
      for (const e of this.inbox.get(thread)?.values() ?? []) if (!keys.has(e.key)) return false
      if (this.turnsAt(tip).some((t) => t.state !== 'done' && t.state !== 'held')) return false
      // A held turn the table can now place is not quiet: it is assigned as soon as the table gives an engine. Nor is
      // one whose reason is no longer the table's: the app would show a sentence that is no longer true.
      const n = next(this.turnsAt(tip))
      if (n.kind === 'dispatch') {
        const d = this.decideNow(thread)
        if (d?.engine || d?.hold !== this.turnsAt(tip)[n.turn - 1].held?.reason) return false
      }
    }
    return true
  }

  /** The decision the dispatcher would take now for a thread's oldest waiting turn (for the checks). */
  decideNow(thread: string): Decision | null {
    const tip = this.hub.refs.get(`refs/threads/${thread}`) ?? null
    return this.d.decideNow(tip ? this.hub.thread(tip).journal : [], this.turnsAt(tip), this.now(this.server), this.placing(thread))
  }
}

/** The open leg of a journal, its engine, and how many legs it has. */
function legs(journal: readonly JournalEvent[]): { open: LegId | null; openEngine: string | null; count: number } {
  let open: LegId | null = null
  let openEngine: string | null = null
  let count = 0
  for (const e of journal) {
    if (e.type === 'leg.start') {
      count++
      open = e.leg
      openEngine = e.engine
    } else if (e.type === 'leg.end') {
      open = null
      openEngine = null
    }
  }
  return { open, openEngine, count }
}
const short = (thread: string) => thread.slice(-4)
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
function hex40(rng: Rng): string {
  let s = ''
  for (let i = 0; i < 40; i++) s += '0123456789abcdef'[rng.int(0, 15)]
  return s
}
