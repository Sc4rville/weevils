// The lease of a thread on the vault (docs/spec/07-vault.md, step 4): the lease of 03-sync-and-lease.md over the
// vault's remote, for machines that share a vault and no hub. The rules and the pushes are lease.ts's, as they are
// (atomic multi-ref push, compare-and-swap); what differs is here:
//
// - what GitHub holds is sealed like the rest (VAULT-1): refs/leases/<thread id> → a commit with one file, `l`, the
//   lease encrypted under the vault key, in a commit with the vault's neutral author, date and message;
// - it is slow: renewed every 5 minutes while a turn runs, and by each push of the thread; taken for silent after 10;
// - it is never stolen by itself (VAULT-6): a working lease that stopped being renewed is only reported (`silent`),
//   and weevboss proposes the move. The steal runs on the person's agreement or order (resume.ts).

import path from 'node:path'
import { hubRunner } from './gitrun.ts'
import { intentOf } from './hub.ts'
import { parseEngine, parseJournal, type JournalEvent } from './journal.ts'
import { LeaseClient, parseLease, serializeLease, stealable, type Intent, type Lease, type LeaseFormat, type Outcome, type Seen, type Timing } from './lease.ts'
import { Locked } from './store.ts'
import { machinePart } from './sync.ts'
import { NEUTRAL, git, lockStaging, open, openStaging, seal, type VaultOptions } from './vault.ts'

/** A working lease on the vault is renewed this often (at most 12 pushes an hour per working thread). */
export const VAULT_RENEW_EVERY = 5 * 60_000
/** `expires` is `renewed` + 10 minutes (one renewal may be missed); silent 30 s after, once the same lease commit was
 *  seen for 10 minutes on the watcher's own clock. */
export const VAULT_TIMING: Timing = { lifetime: 10 * 60_000, grace: 30_000, unchanged: 10 * 60_000 }
/** The machine that serves the app reads the vault's leases this often while another machine has a turn at work, and
 *  this often otherwise (to learn that one started). */
export const VAULT_OBSERVE_EVERY = 2 * 60_000
export const VAULT_DISCOVER_EVERY = 10 * 60_000

type LeaseOptions = Pick<VaultOptions, 'staging' | 'remote' | 'key' | 'machine' | 'ssh' | 'netMs' | 'now'>

const sealedFormat = (key: Buffer): LeaseFormat => ({
  file: 'l',
  // Base64 on one line: the lease client reads its files as text.
  encode: (l) => `${seal(key, l.thread, 'l', Buffer.from(serializeLease(l))).toString('base64')}\n`,
  decode(text, thread) {
    try {
      const l = parseLease(open(key, thread, 'l', Buffer.from(text.trim(), 'base64')).toString())
      return l && l.thread === thread ? l : null
    } catch {
      return null
    }
  },
  commit: () => ({ env: NEUTRAL, subject: 'vault' }),
})

/** The lease client of this machine on the vault: lease.ts's, sealed and slow. */
export function vaultLeases(o: LeaseOptions): LeaseClient {
  return new LeaseClient({
    machine: o.machine,
    git: hubRunner(o.staging, { ssh: o.ssh, netMs: o.netMs ?? 120_000 }),
    now: o.now ?? Date.now,
    remote: o.remote,
    tracking: 'refs/vault-remote',
    format: sealedFormat(o.key),
    timing: VAULT_TIMING,
  })
}

/** The lease a thread's journal asks of this machine: `working` only while a turn runs on an engine of its own. */
export function vaultIntent(events: readonly JournalEvent[], machine: string): Omit<Intent, 'tip'> {
  const { tip: _tip, ...i } = intentOf(events, null)
  if (i.state === 'working' && parseEngine(i.engine ?? '')?.machine !== machinePart(machine)) return { engine: i.engine, leg: i.leg, state: 'idle' }
  return i
}

/** The same, from the weevbook's own commit of the thread. */
export async function intentAt(book: string, commit: string, machine: string): Promise<Omit<Intent, 'tip'>> {
  const r = await git(book, ['cat-file', 'blob', `${commit}:events.jsonl`], { allowFail: true })
  return r.code ? { engine: null, leg: null, state: 'idle' } : vaultIntent(parseJournal(r.out.toString()).events, machine)
}

/** One vault command at a time on the staging repository, waited for a moment (weevilsd's pusher holds it while it
 *  pushes). Throws `Locked` when it stays taken. */
export async function withStaging<T>(staging: string, fn: () => Promise<T>, waitMs = 20_000): Promise<T> {
  await openStaging(staging)
  const until = Date.now() + waitMs
  for (;;) {
    let unlock: (() => Promise<void>) | null = null
    try {
      unlock = await lockStaging(staging)
    } catch (e) {
      if (!(e instanceof Locked) || Date.now() >= until) throw e
      await new Promise((r) => setTimeout(r, 250))
      continue
    }
    try {
      return await fn()
    } finally {
      await unlock()
    }
  }
}

/**
 * The working leases this machine holds whose last renewal is `VAULT_RENEW_EVERY` old, renewed in one push (no thread
 * ref goes with it: a thread that moved is pushed, and renewed, by the pusher). A lease whose turn the journal no
 * longer shows at work is left to that push. Returns the threads renewed, and those another machine took meanwhile.
 */
export async function renewVaultLeases(o: Pick<VaultOptions, 'dir' | 'staging' | 'machine' | 'now'>, leases: LeaseClient): Promise<{ renewed: string[]; lost: { thread: string; to: string | null }[] }> {
  const now = (o.now ?? Date.now)()
  const book = path.join(path.resolve(o.dir), '.git')
  const working = leases.mine().filter((m) => m.lease.state === 'working')
  const out = { renewed: [] as string[], lost: [] as { thread: string; to: string | null }[] }
  if (!working.some((m) => now - Date.parse(m.lease.renewed) >= VAULT_RENEW_EVERY)) return out
  // One is due: every working lease renewed more than a minute ago goes in the same push, so that a machine with
  // several turns at work pushes its renewals together (about 12 pushes an hour, not 12 per thread).
  const due = working.filter((m) => now - Date.parse(m.lease.renewed) >= 60_000)
  return withStaging(o.staging, async () => {
    const items: { thread: string; intent: Intent }[] = []
    for (const m of due) {
      const tip = await git(book, ['rev-parse', '-q', '--verify', `refs/threads/${m.thread}^{commit}`], { allowFail: true })
      const intent = tip.code ? null : await intentAt(book, tip.out.toString().trim(), o.machine)
      if (intent?.state === 'working') items.push({ thread: m.thread, intent })
    }
    for (const [thread, r] of await leases.renew(items)) {
      if (r.ok) out.renewed.push(thread)
      else if (r.why === 'lost') out.lost.push({ thread, to: r.holder })
    }
    return out
  })
}

/** A working lease of another machine that stopped being renewed: what the watcher reports, never what it takes. */
export interface Silent {
  thread: string
  /** The lease commit: a new silence of the same thread (its holder came back, then went again) is another one. */
  commit: string
  lease: Lease
  /** How long since its last renewal, by this machine's clock. */
  silentMs: number
}

/** Reads every lease of the vault (`fetch`: asks the remote first): the silent ones, and every lease commit as it is
 *  now. Null: unreachable, or the staging repository is busy. Nothing is written to the vault. */
export async function silentLeases(o: LeaseOptions, leases: LeaseClient, fetch = true): Promise<{ silent: Silent[]; commits: Map<string, string>; others: number } | null> {
  const now = o.now ?? Date.now
  let all: Map<string, Seen> | null
  try {
    all = await withStaging(o.staging, () => leases.readAll(fetch), 2_000)
  } catch (e) {
    if (e instanceof Locked) return null
    throw e
  }
  if (!all) return null
  const silent: Silent[] = []
  const commits = new Map<string, string>()
  /** Working leases of other machines: while there are some, the watch looks often. */
  let others = 0
  for (const [thread, seen] of all) {
    const l = seen.lease
    if (seen.commit) commits.set(thread, seen.commit)
    if (!l || !seen.commit || l.state !== 'working' || l.holder === o.machine) continue
    others++
    if (stealable(seen, now(), VAULT_TIMING).ok) silent.push({ thread, commit: seen.commit, lease: l, silentMs: now() - Date.parse(l.renewed) })
  }
  return { silent, commits, others }
}

export type Claim =
  | { ok: true; stole: boolean; epoch: number }
  | { ok: false; why: 'unreachable' | 'rejected' }
  /** Another machine holds it at work and renewed it `agoMs` ago: only `force` (the person said so) takes it. */
  | { ok: false; why: 'held'; holder: string; turn?: number; agoMs: number; wait: number }

/**
 * The lease of a thread taken by this machine on the person's order or agreement (the only callers: a move, an
 * agreed proposal, `resume`). Free or idle: taken. Working elsewhere and silent (past `expires` + grace by this
 * clock): stolen. Working elsewhere and still renewed: refused, unless `force`. The lease is taken `working` (turn
 * 0: a resume is under way here), so that no machine takes it over meanwhile; the push of the resumed thread gives it
 * its real state, and `releaseLease` lets it go when the resume did not happen.
 */
export async function claimLease(o: LeaseOptions, thread: string, force = false): Promise<Claim> {
  const now = o.now ?? Date.now
  const leases = vaultLeases(o)
  let out: Outcome | null = null
  let stole = false
  try {
    const held = await withStaging(o.staging, async (): Promise<Claim | null> => {
      const f = await leases.fetch(thread)
      if (!f) return { ok: false, why: 'unreachable' }
      const l = f.seen.lease
      const intent: Intent = { engine: null, leg: null, state: 'working', turn: 0 }
      if (l && l.holder !== o.machine && l.state === 'working') {
        const wait = Date.parse(l.expires) + VAULT_TIMING.grace - now()
        if (wait > 0 && !force) return { ok: false, why: 'held', holder: l.holder, ...(l.turn !== undefined ? { turn: l.turn } : {}), agoMs: now() - Date.parse(l.renewed), wait }
        stole = true
        out = await leases.steal(thread, intent, { order: true })
      } else out = await leases.take(thread, intent)
      return null
    })
    if (held) return held
  } catch (e) {
    if (e instanceof Locked) return { ok: false, why: 'unreachable' }
    throw e
  }
  const r = out as Outcome | null
  if (r?.ok) return { ok: true, stole, epoch: r.lease.epoch }
  return { ok: false, why: r && r.why === 'unreachable' ? 'unreachable' : 'rejected' }
}

/** A claim given back: the resume did not happen, the lease this machine holds goes idle. */
export async function releaseLease(o: LeaseOptions, thread: string): Promise<void> {
  const leases = vaultLeases(o)
  await withStaging(o.staging, async () => {
    const f = await leases.fetch(thread)
    if (f?.seen.lease?.holder === o.machine && f.seen.lease.state === 'working') await leases.take(thread, { engine: null, leg: null, state: 'idle' })
  })
}
