// The lease of a thread: which single machine may write to it. Specified in docs/spec/03-sync-and-lease.md.
//
// Two layers. The rules are pure functions of what a machine has seen of the hub and of its own clock: which
// operation it may do, the lease it would push, whether it may steal, what a late note holds. `LeaseClient` runs them
// as real git commands against the hub, through an injected git runner and clock. The simulator (sim/) runs the same
// rules over an in-memory hub. Nothing in the app imports this module yet.

import { execFile } from 'node:child_process'
import type { JournalEvent, LegId, NoteEvent } from './journal.ts'

// ---------------------------------------------------------------- the numbers (docs/spec/README.md, constants)

/** A holder pushes its working leases this often. */
export const RENEW_EVERY = 20_000
/** `expires` is `renewed` plus this. */
export const LIFETIME = 60_000
/** A steal waits until `expires` plus this, by the stealer's clock. */
export const GRACE = 30_000
/** A steal needs the same lease commit seen for this long, by the stealer's clock. */
export const UNCHANGED = 60_000
/** Clocks are assumed to agree within this. Safety never depends on it; only the bound below does. */
export const SKEW = 30_000
/** The dispatcher's machine reads every working lease this often (docs/spec/03-sync-and-lease.md, "The steal"). */
export const OBSERVE_EVERY = 10_000
/**
 * Longest time from a holder's last renewal to the steal, when clocks agree within SKEW and the stealer reads the
 * lease every OBSERVE_EVERY: both conditions of a steal hold by then, plus one reading to notice. 130 s.
 */
export const STEAL_BOUND = Math.max(LIFETIME + GRACE + SKEW, OBSERVE_EVERY + UNCHANGED) + OBSERVE_EVERY

// ---------------------------------------------------------------- lease.json

export type LeaseState = 'working' | 'idle'
export interface Lease {
  v: 1
  thread: string
  /** The machine that may write. */
  holder: string
  /** The engine and leg at work; null when the holder only files content. */
  engine: string | null
  leg: LegId | null
  /** 1 at the first take; grows by 1 exactly when the holder changes (SYNC-4). */
  epoch: number
  state: LeaseState
  /** The turn at work, when working. */
  turn?: number
  /** UTC times by the holder's clock. */
  taken: string
  renewed: string
  expires: string
  /** The commit of refs/threads/<id> pushed together with this lease; null while the thread has none. */
  tip: string | null
}
const LEASE_FIELDS = ['v', 'thread', 'holder', 'engine', 'leg', 'epoch', 'state', 'turn', 'taken', 'renewed', 'expires', 'tip'] as const
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** A time as lease.json writes it: UTC, whole seconds. */
export const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')

/** The one way a lease is written: fixed field order, one line, final newline. */
export function serializeLease(l: Lease): string {
  const o = l as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of LEASE_FIELDS) if (o[k] !== undefined) out[k] = o[k]
  return `${JSON.stringify(out)}\n`
}

/** lease.json → the lease, or null when it is not one (a hub never holds such a file; a broken one is not trusted). */
export function parseLease(text: string): Lease | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || o.v !== 1) return null
  const str = (v: unknown) => typeof v === 'string' && v.length > 0
  if (!str(o.thread) || !str(o.holder) || !Number.isInteger(o.epoch) || (o.epoch as number) < 1) return null
  if (o.state !== 'working' && o.state !== 'idle') return null
  if (o.engine !== null && !str(o.engine)) return null
  if (o.leg !== null && !(typeof o.leg === 'string' && /^L[1-9]\d*$/.test(o.leg))) return null
  if (o.turn !== undefined && !Number.isInteger(o.turn)) return null
  if (o.state === 'working' && o.turn === undefined) return null
  for (const k of ['taken', 'renewed', 'expires'] as const) if (typeof o[k] !== 'string' || !AT.test(o[k] as string)) return null
  if (o.tip !== null && !str(o.tip)) return null
  return o as unknown as Lease
}

// ---------------------------------------------------------------- the rules (pure)

/** What one machine knows of one thread's lease in the hub. */
export interface Seen {
  /** The lease commit in the hub; null when the thread has no lease yet. */
  commit: string | null
  lease: Lease | null
  /** The commit of refs/threads/<id> in the hub; null when there is none. */
  tip: string | null
  /** By this machine's clock, when it first saw `commit` (a lease it pushed itself: when it pushed it). */
  since: number
}

/** A new reading of the hub. `since` only moves when the commit changes: that is the steal's observation rule. */
export function observe(prev: Seen | undefined, commit: string | null, lease: Lease | null, tip: string | null, now: number): Seen {
  return prev && prev.commit === commit ? { commit, lease, tip, since: prev.since } : { commit, lease, tip, since: now }
}

/** What a machine wants the lease to say after its push. */
export interface Intent {
  engine: string | null
  leg: LegId | null
  state: LeaseState
  turn?: number
  /** The thread commit pushed with the lease (null: none yet). Omitted: the thread ref is not pushed. */
  tip?: string | null
}

/** The five operations of the spec. "Go idle" is a renewal with `state: idle`. */
export type Op = 'take' | 'take-idle' | 'renew' | 'steal'
export interface Plan {
  op: Op
  lease: Lease
  /** The lease commit the hub must still have (`--force-with-lease`); null: the ref must not exist. */
  expect: string | null
}
export interface Refusal {
  op: null
  /** `held`: another machine holds it working. `not-yet`: a steal, but the clock rules say wait. */
  why: 'held' | 'not-yet'
  /** By this machine's clock, how long until a steal would be allowed (Infinity: never without a new reading). */
  wait: number
}

/** May this machine steal the working lease it sees? Both conditions of the spec, on its own clock. */
export function stealable(seen: Seen, now: number): { ok: boolean; wait: number } {
  const l = seen.lease
  if (!l || l.state !== 'working' || !seen.commit) return { ok: false, wait: Infinity }
  const expired = Date.parse(l.expires) + GRACE - now
  const unchanged = seen.since + UNCHANGED - now
  const wait = Math.max(expired, unchanged, 0)
  return { ok: wait === 0, wait }
}

/**
 * The lease this machine may push now, and the value the hub must still have; or why not. A steal is only planned
 * when asked for, because its thread commit must carry `turn failed` and `leg.end`.
 */
export function plan(machine: string, thread: string, seen: Seen, intent: Intent, now: number, opts: { steal?: boolean } = {}): Plan | Refusal {
  const old = seen.lease
  const fresh = (epoch: number, taken: string): Lease => ({
    v: 1,
    thread,
    holder: machine,
    engine: intent.engine,
    leg: intent.leg,
    epoch,
    state: intent.state,
    ...(intent.state === 'working' ? { turn: intent.turn } : {}),
    taken,
    renewed: iso(now),
    expires: iso(now + LIFETIME),
    tip: intent.tip !== undefined ? intent.tip : (seen.tip ?? null),
  })
  if (!seen.commit || !old) return { op: 'take', lease: fresh(1, iso(now)), expect: null }
  if (old.holder === machine) return { op: 'renew', lease: fresh(old.epoch, old.taken), expect: seen.commit }
  if (old.state === 'idle') return { op: 'take-idle', lease: fresh(old.epoch + 1, iso(now)), expect: seen.commit }
  const s = stealable(seen, now)
  if (!opts.steal) return { op: null, why: 'held', wait: s.wait }
  if (!s.ok) return { op: null, why: 'not-yet', wait: s.wait }
  return { op: 'steal', lease: fresh(old.epoch + 1, iso(now)), expect: seen.commit }
}

/**
 * After a rejected push and a new reading: does this machine still hold the thread? A lease naming it was written by
 * it (no other machine ever writes a lease naming someone else): its earlier push landed although the answer was lost,
 * and it goes on from there. Any other holder: it lost (spec: **lose**).
 */
export function standing(machine: string, seen: Seen): 'holder' | 'lost' | 'free' {
  if (!seen.lease) return 'free'
  return seen.lease.holder === machine ? 'holder' : 'lost'
}

/** Where a machine that lost puts the commits it could not push. Created once. */
export const orphanRef = (thread: string, machine: string, epoch: number) => `refs/orphans/${thread}/${machine}-${epoch}`

/** The events of an orphan that are not in the thread: everything after the two journals part. */
export function lateEvents(thread: readonly JournalEvent[], orphan: readonly JournalEvent[]): JournalEvent[] {
  let i = 0
  while (i < thread.length && i < orphan.length && thread[i].id === orphan[i].id) i++
  return orphan.slice(i)
}

export type LateNote = Pick<NoteEvent, 'type' | 'leg' | 'kind' | 'text' | 'data'>
/**
 * The `note` the holder appends for one orphan ref: the late events (without the envelope fields that only made sense
 * in the losing copy) and the last checkpoint among them. Null when the orphan holds nothing the thread lacks.
 */
export function lateNote(thread: readonly JournalEvent[], orphan: readonly JournalEvent[], from: string): LateNote | null {
  const late = lateEvents(thread, orphan)
  if (!late.length) return null
  const name = from.slice(from.lastIndexOf('/') + 1)
  const machine = name.slice(0, name.lastIndexOf('-')) || name
  const started = new Set(thread.filter((e) => e.type === 'leg.start').map((e) => e.leg))
  const legs = [...new Set(late.map((e) => e.leg).filter((l): l is LegId => l !== null))]
  const leg = legs.find((l) => started.has(l)) ?? null
  const checkpoint = late.findLast((e) => e.type === 'checkpoint' && e.commit)
  const n = late.length
  const of = legs.length ? legs.join(', ') : 'no leg'
  return {
    type: 'note',
    leg,
    kind: 'late',
    text: `${machine} came back with ${n} event${n === 1 ? '' : 's'} of ${of} it had not pushed; kept here, not part of the thread`, // i18n-ignore
    data: {
      from,
      events: late.map(({ v: _v, seq: _seq, id: _id, leg: _leg, ...rest }) => rest),
      ...(checkpoint && checkpoint.type === 'checkpoint' ? { checkpoint: checkpoint.commit } : {}),
    },
  }
}

// ---------------------------------------------------------------- the same rules as git commands

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}
/** Runs one git command in one repository. Injected, so that a test can cut the network or lose an answer. */
export type GitRunner = (args: readonly string[], opts?: { input?: string; env?: Record<string, string> }) => Promise<GitResult>

/** The real runner: `git -C <dir> …`, English messages, never a prompt. */
export function gitIn(dir: string): GitRunner {
  return (args, opts = {}) =>
    new Promise((resolve) => {
      const env = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', ...opts.env }
      const child = execFile('git', ['-C', dir, ...args], { env, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
        resolve({ code, stdout, stderr })
      })
      child.stdin?.on('error', () => {}) // a command that exits without reading its input
      child.stdin?.end(opts.input)
    })
}

export type Outcome =
  | { ok: true; op: Op; lease: Lease; commit: string }
  /** The hub could not be reached. Nothing changed there. */
  | { ok: false; why: 'unreachable' }
  /** The rules forbid it now: another machine holds the lease working (`wait`: by this clock, until a steal is allowed). */
  | { ok: false; why: 'refused'; wait: number }
  /** The hub refused the push: the lease moved. `lost`: this machine held it and another holds it now. */
  | { ok: false; why: 'rejected' | 'lost'; holder: string | null }

export interface Fetched {
  seen: Seen
  /** refs/orphans/<id>/… in the hub, with their commits. */
  orphans: { ref: string; commit: string }[]
}

export interface Renewal {
  thread: string
  intent: Intent
  /** Orphan refs to delete in the same atomic push (after their `note` is in `intent.tip`). */
  drop?: { ref: string; commit: string }[]
}

interface PushItem extends Renewal {
  plan: Plan
  leaseCommit: string
}

export interface LeaseClientOptions {
  /** This machine's weevils id: `holder` in the leases it writes. */
  machine: string
  git: GitRunner
  /** This machine's clock, in ms. */
  now: () => number
  /** The hub's remote name in this repository. */
  remote?: string
}

/**
 * The lease protocol of one machine against the hub, as git commands. Remembers, per thread, the last lease commit it
 * fetched or pushed (`$old` of the spec) and since when it has seen it. Fetched refs are kept under refs/hub/.
 */
export class LeaseClient {
  readonly machine: string
  private readonly git: GitRunner
  private readonly now: () => number
  private readonly remote: string
  private readonly known = new Map<string, Seen>()

  constructor(o: LeaseClientOptions) {
    this.machine = o.machine
    this.git = o.git
    this.now = o.now
    this.remote = o.remote ?? 'hub'
  }

  /** What this machine last saw of the thread's lease, without asking the hub. */
  seen(thread: string): Seen | undefined {
    return this.known.get(thread)
  }

  /** Reads the thread ref, the lease ref and the orphan refs of one thread from the hub. Null: unreachable. */
  async fetch(thread: string): Promise<Fetched | null> {
    const f = await this.git(['fetch', '--quiet', '--prune', '--no-tags', this.remote,
      `+refs/leases/${thread}*:refs/hub/leases/${thread}*`,
      `+refs/threads/${thread}*:refs/hub/threads/${thread}*`,
      `+refs/orphans/${thread}/*:refs/hub/orphans/${thread}/*`])
    if (f.code !== 0) return null
    const refs = await this.git(['for-each-ref', '--format=%(objectname) %(refname)', `refs/hub/leases/${thread}`, `refs/hub/threads/${thread}`, `refs/hub/orphans/${thread}/`])
    let commit: string | null = null
    let tip: string | null = null
    const orphans: Fetched['orphans'] = []
    for (const line of refs.stdout.split('\n')) {
      const [sha, ref] = line.split(' ')
      if (!ref) continue
      if (ref === `refs/hub/leases/${thread}`) commit = sha
      else if (ref === `refs/hub/threads/${thread}`) tip = sha
      else if (ref.startsWith(`refs/hub/orphans/${thread}/`)) orphans.push({ ref: ref.replace('refs/hub/', 'refs/'), commit: sha })
    }
    const lease = commit ? parseLease((await this.git(['cat-file', 'blob', `${commit}:lease.json`])).stdout) : null
    const seen = observe(this.known.get(thread), commit, lease, tip, this.now())
    this.known.set(thread, seen)
    return { seen, orphans }
  }

  /** take, take over idle, or renew (go idle included), whichever the rules allow. Fetches first if it knows nothing. */
  async take(thread: string, intent: Intent): Promise<Outcome> {
    return this.single(thread, intent, false)
  }

  /** The steal: only when the lease is working, expired by `GRACE`, and unchanged for `UNCHANGED` on this clock. */
  async steal(thread: string, intent: Intent): Promise<Outcome> {
    return this.single(thread, intent, true)
  }

  private async single(thread: string, intent: Intent, steal: boolean): Promise<Outcome> {
    if (!this.known.has(thread) && !(await this.fetch(thread))) return { ok: false, why: 'unreachable' }
    const p = plan(this.machine, thread, this.known.get(thread)!, intent, this.now(), { steal })
    if (!p.op) return { ok: false, why: 'refused', wait: p.wait }
    if (p.op === 'renew' && !steal) return (await this.renew([{ thread, intent }])).get(thread)!
    return (await this.pushAll([{ thread, intent, plan: p, leaseCommit: await this.leaseCommit(p.lease) }])).get(thread)!
  }

  /**
   * Renews leases this machine holds, in one atomic push (SYNC-10): each lease is checked on its own; when one is
   * rejected, the batch is pushed again without it. `intent.state: idle` is "go idle".
   */
  async renew(items: readonly Renewal[]): Promise<Map<string, Outcome>> {
    const out = new Map<string, Outcome>()
    const ready: PushItem[] = []
    for (const r of items) {
      const seen = this.known.get(r.thread)
      if (!seen || seen.lease?.holder !== this.machine) {
        // Not held as far as this machine knows: never written to (SYNC-6).
        out.set(r.thread, { ok: false, why: 'lost', holder: seen?.lease?.holder ?? null })
        continue
      }
      const p = plan(this.machine, r.thread, seen, r.intent, this.now()) as Plan
      ready.push({ ...r, plan: p, leaseCommit: await this.leaseCommit(p.lease) })
    }
    for (const [t, o] of await this.pushAll(ready)) out.set(t, o)
    return out
  }

  /** Pushes, drops what the hub rejects on its own account, pushes the rest again; then reads the rejected leases. */
  private async pushAll(items: PushItem[]): Promise<Map<string, Outcome>> {
    const out = new Map<string, Outcome>()
    const retried = new Set<string>()
    let rest = items
    while (rest.length) {
      const r = await this.push(rest)
      if (r === 'ok') {
        for (const it of rest) {
          this.known.set(it.thread, { commit: it.leaseCommit, lease: it.plan.lease, tip: it.plan.lease.tip, since: this.now() })
          out.set(it.thread, { ok: true, op: it.plan.op, lease: it.plan.lease, commit: it.leaseCommit })
        }
        break
      }
      if (r === 'unreachable') {
        for (const it of rest) out.set(it.thread, { ok: false, why: 'unreachable' })
        break
      }
      const culprits = rest.filter((it) => r.has(it.thread))
      // A rejection that names no thread of the batch: nothing can be pushed safely this time.
      if (!culprits.length) {
        for (const it of rest) out.set(it.thread, { ok: false, why: 'rejected', holder: null })
        break
      }
      rest = rest.filter((it) => !r.has(it.thread))
      for (const it of culprits) {
        const f = await this.fetch(it.thread)
        if (!f) {
          out.set(it.thread, { ok: false, why: 'unreachable' })
          continue
        }
        const where = standing(this.machine, f.seen)
        // This machine's own earlier push landed (its answer was lost): go on from that lease, once.
        if (where === 'holder' && it.plan.op !== 'take' && !retried.has(it.thread)) {
          retried.add(it.thread)
          const p = plan(this.machine, it.thread, f.seen, it.intent, this.now()) as Plan
          rest.push({ ...it, plan: p, leaseCommit: await this.leaseCommit(p.lease) })
          continue
        }
        // Only a holder can lose; a take or a steal that was beaten is just rejected.
        const why = it.plan.op === 'renew' && where === 'lost' ? 'lost' : 'rejected'
        out.set(it.thread, { ok: false, why, holder: f.seen.lease?.holder ?? null })
      }
    }
    return out
  }

  /** One atomic push. 'ok', 'unreachable', or the threads whose own update the hub refused. */
  private async push(items: readonly PushItem[]): Promise<'ok' | 'unreachable' | Set<string>> {
    const args = ['push', '--porcelain', '--atomic', this.remote]
    for (const it of items) {
      const t = it.thread
      if (it.intent.tip) args.push(`${it.intent.tip}:refs/threads/${t}`)
      args.push(`${it.leaseCommit}:refs/leases/${t}`, `--force-with-lease=refs/leases/${t}:${it.plan.expect ?? ''}`)
      for (const d of it.drop ?? []) args.push(`:${d.ref}`, `--force-with-lease=${d.ref}:${d.commit}`)
    }
    const r = await this.git(args)
    if (r.code === 0) return 'ok'
    const rejected = r.stdout.split('\n').filter((l) => l.startsWith('!'))
    if (!rejected.length) return 'unreachable'
    const culprits = new Set<string>()
    for (const line of rejected) {
      if (/\(atomic push failed\)\s*$/.test(line)) continue
      const ref = line.split('\t')[1]?.split(':').pop() ?? ''
      const m = /^refs\/(?:leases|threads|orphans)\/([^/]+)/.exec(ref)
      if (m) culprits.add(m[1])
    }
    return culprits
  }

  /**
   * lose: puts the commits this machine made and could not push under refs/orphans/<id>/<machine>-<epoch>. Created
   * once; pushing the same commit again is a no-op. Then this machine writes nothing more to the thread.
   */
  async orphan(thread: string, tip: string, epoch: number): Promise<{ ok: true; ref: string } | { ok: false; why: 'unreachable' | 'rejected' }> {
    const ref = orphanRef(thread, this.machine, epoch)
    const r = await this.git(['push', '--porcelain', this.remote, `${tip}:${ref}`, `--force-with-lease=${ref}:`])
    if (r.code === 0) return { ok: true, ref }
    return { ok: false, why: r.stdout.split('\n').some((l) => l.startsWith('!')) ? 'rejected' : 'unreachable' }
  }

  /** A lease commit: one file, lease.json, no parent. Dated by this machine's clock. */
  private async leaseCommit(l: Lease): Promise<string> {
    const blob = (await this.git(['hash-object', '-w', '--stdin'], { input: serializeLease(l) })).stdout.trim()
    const tree = (await this.git(['mktree'], { input: `100644 blob ${blob}\tlease.json\n` })).stdout.trim()
    const date = `${Math.floor(this.now() / 1000)} +0000`
    const env = {
      GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: `${this.machine}@weevils.invalid`, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: `${this.machine}@weevils.invalid`, GIT_COMMITTER_DATE: date,
    }
    const subject = `lease · ${l.holder} · epoch ${l.epoch} · ${l.state}`
    const c = await this.git(['commit-tree', tree, '-m', subject], { env })
    if (c.code !== 0) throw new Error(`commit-tree: ${c.stderr.trim()}`) // i18n-ignore
    return c.stdout.trim()
  }
}
