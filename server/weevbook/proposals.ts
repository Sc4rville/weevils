// Moves of a conversation, agreed (docs/spec/07-vault.md, step 4; VAULT-6): nothing changes machine, account or
// provider by itself. What weevils would have done alone becomes a proposal: stored here, said by weevboss in one line,
// and run only when the person agrees. A direct order ("continue this on the laptop") is the agreement: it runs at once.
//
// - The store: DATA_DIR/weevbook-proposals.json. A cause is asked once: declined, agreed or still open, the same
//   cause never makes a second proposal.
// - The watch (the machine that serves the app, with a vault and no hub): a working lease of the vault that stopped
//   being renewed becomes a proposal to continue the conversation here. The lease itself is not touched.
// - The move: the thread resumed on the machine named (resume.ts), here or through that machine's weevilsd.

import fs from 'node:fs'
import path from 'node:path'
import { parseEngine, parseJournal, ownTask } from './journal.ts'
import type { LeaseClient } from './lease.ts'
import type { ResumeResult } from './resume.ts'
import { machinePart } from './sync.ts'
import { VAULT_DISCOVER_EVERY, VAULT_OBSERVE_EVERY, silentLeases, vaultLeases, type Silent } from './vault-lease.ts'
import { git, type VaultOptions } from './vault.ts'
import { titleOf } from './view.ts'

// ---------------------------------------------------------------- the store

/** `silent`: a machine stopped renewing its lease. The others are the dispatcher's rows (06-dispatch.md). */
export type ProposalKind = 'silent' | 'account' | 'machine' | 'provider'
export interface Proposal {
  /** Short, for weevboss: m1, m2… */
  id: string
  kind: ProposalKind
  /** What made it. Asked once. */
  cause: string
  thread: string
  title: string
  /** The machine (or engine) the conversation would leave, and where it would go: a machine, an account, a provider. */
  from: string
  to: string
  /** The facts, in one sentence: the dispatcher's own reason line, or how long the machine has been silent. */
  reason: string
  at: number
  /** `withdrawn`: its cause went away before an answer (the machine came back, the account has room again). */
  state: 'open' | 'agreed' | 'declined' | 'withdrawn'
  decidedAt?: number
  /** Agreed: what running it gave, in a few words. */
  result?: string
}
interface Store {
  v: 1
  next: number
  proposals: Proposal[]
}
const KEEP = 200

function read(file: string): Store {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Store
    if (s?.v === 1 && Array.isArray(s.proposals)) return s
  } catch {
    /* none yet */
  }
  return { v: 1, next: 1, proposals: [] }
}
function write(file: string, s: Store) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...s, proposals: s.proposals.slice(-KEEP) }), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** Every proposal kept, oldest first. */
export const proposals = (file: string): Proposal[] => read(file).proposals
export const openProposals = (file: string): Proposal[] => read(file).proposals.filter((p) => p.state === 'open')
/** What the person said to this cause, if it was ever asked. */
export const verdictOf = (file: string, cause: string): Proposal['state'] | null => read(file).proposals.findLast((p) => p.cause === cause)?.state ?? null

/** A new proposal, unless its cause was asked before (then null: never twice, whatever the answer was). */
export function propose(file: string, p: Omit<Proposal, 'id' | 'at' | 'state'>, now: number): Proposal | null {
  const s = read(file)
  if (s.proposals.some((x) => x.cause === p.cause)) return null
  const made: Proposal = { ...p, id: `m${s.next}`, at: now, state: 'open' }
  s.proposals.push(made)
  s.next++
  write(file, s)
  return made
}

/** The open proposals (`id`: that one) get their answer. Returns those that changed. */
export function settle(file: string, id: string | undefined, state: Exclude<Proposal['state'], 'open'>, now: number, result?: string): Proposal[] {
  const s = read(file)
  const hit = s.proposals.filter((p) => p.state === 'open' && (id === undefined || p.id === id))
  for (const p of hit) Object.assign(p, { state, decidedAt: now, ...(result ? { result } : {}) })
  if (hit.length) write(file, s)
  return hit
}

/** What running an agreed proposal gave. */
export function noteResult(file: string, id: string, result: string) {
  const s = read(file)
  const p = s.proposals.find((x) => x.id === id)
  if (!p) return
  p.result = result
  write(file, s)
}

// ---------------------------------------------------------------- the move

export interface MachineLine {
  id: string
  name: string
  here: boolean
  online: boolean
}
export interface MoveRequest {
  /** A thread id, or the id of one of its provider sessions (as `weevils sessions` shows them; a prefix is enough). */
  thread: string
  /** A machine's id or name (default: this one). */
  to?: string
  engine?: string
  account?: string
  /** Take it even from a machine that is still at work on it. */
  force?: boolean
}
export type MoveResult =
  | { ok: true; thread: string; machine: string; turn: number | null; engine: string; stole: boolean; launched: boolean }
  | { ok: false; why: string; detail: string; holder?: string; wait?: number }

export interface MoveHost {
  machines: () => MachineLine[]
  /** The thread of a provider session this machine knows (null: none). */
  threadOf: (session: string) => Promise<string | null>
  /** The same question, asked of the other machines that answer. */
  askThread?: (session: string) => Promise<string | null>
  /** The thread resumed on this machine (resume.ts). */
  resume: (r: { thread: string; engine?: string; account?: string; force?: boolean }) => Promise<ResumeResult>
  /** The same move, asked of another machine's weevilsd. */
  forward: (machine: string, r: MoveRequest) => Promise<MoveResult>
}

const THREAD = /^[0-9A-HJKMNP-TV-Z]{26}$/
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() || machinePart(a).toLowerCase() === machinePart(b).toLowerCase()

/** A direct order: the conversation continues on the machine named. Never a proposal: the order is the agreement. */
export async function moveThread(h: MoveHost, r: MoveRequest): Promise<MoveResult> {
  const all = h.machines()
  const target = r.to ? all.find((m) => same(m.id, r.to!) || same(m.name, r.to!)) : all.find((m) => m.here)
  if (!target) return { ok: false, why: 'unknown-machine', detail: `no machine named ${r.to}: ${all.map((m) => m.name).join(', ')}` } // i18n-ignore: a refusal's facts for weevboss, like resume.ts's
  const thread = THREAD.test(r.thread) ? r.thread : ((await h.threadOf(r.thread)) ?? (await h.askThread?.(r.thread)) ?? null)
  if (!thread) return { ok: false, why: 'unknown', detail: `no conversation found for ${r.thread}` } // i18n-ignore: a refusal's facts for weevboss, like resume.ts's
  if (!target.here) {
    if (!target.online) return { ok: false, why: 'unreachable', detail: `${target.name} does not answer` } // i18n-ignore: a refusal's facts for weevboss, like resume.ts's
    return h.forward(target.id, { ...r, thread, to: target.id })
  }
  const done = await h.resume({ thread, engine: r.engine, account: r.account, force: r.force })
  if (!done.ok) return { ok: false, why: done.why, detail: done.detail, ...(done.holder ? { holder: done.holder } : {}), ...(done.wait !== undefined && Number.isFinite(done.wait) ? { wait: done.wait } : {}) }
  return { ok: true, thread, machine: target.name, turn: done.turn, engine: done.engine, stole: done.stole, launched: done.launched }
}

// ---------------------------------------------------------------- the watch

export interface WatchOptions {
  /** This machine's vault now (null: none set up yet). */
  vault: () => VaultOptions | null
  file: string
  /** New proposals of one look, to say in one line (those of one silent machine come together). */
  say: (made: Proposal[], minutes: number) => void
  everyMs?: number
  now?: () => number
  log?: (line: string) => void
}

/** A thread's title, read from this machine's weevbook (the watch brings the journal of a silent thread first). */
async function titleHere(v: VaultOptions, thread: string): Promise<string | null> {
  const book = path.join(path.resolve(v.dir), '.git')
  const r = await git(book, ['cat-file', 'blob', `refs/threads/${thread}:events.jsonl`], { allowFail: true })
  return r.code ? null : titleOf(parseJournal(r.out.toString()).events)
}

/**
 * One look at the vault's leases: each working lease of another machine that went silent becomes a proposal to
 * continue its conversation here; an open proposal whose machine came back is withdrawn. Nothing is pushed.
 */
export async function watchOnce(o: Pick<WatchOptions, 'file' | 'say' | 'log'> & { vault: VaultOptions; leases: LeaseClient; refresh: (thread: string) => Promise<unknown>; fetch?: boolean; others?: (n: number) => void }): Promise<Proposal[]> {
  const now = o.vault.now ?? Date.now
  const read = await silentLeases(o.vault, o.leases, o.fetch ?? true)
  if (!read) return []
  const { silent, commits } = read
  o.others?.(read.others)
  const cause = (s: Pick<Silent, 'thread' | 'commit'>) => `silent:${s.thread}:${s.commit}`
  // Its lease moved (the machine came back and renewed it, or someone took the thread): the question no longer stands.
  for (const p of openProposals(o.file)) if (p.kind === 'silent' && cause({ thread: p.thread, commit: commits.get(p.thread) ?? '' }) !== p.cause) settle(o.file, p.id, 'withdrawn', now())
  const made: Proposal[] = []
  let longest = 0
  for (const s of silent) {
    if (verdictOf(o.file, cause(s)) !== null) continue
    // The conversation's journal, to name it (and so that agreeing finds it here).
    await o.refresh(s.thread).catch((e: Error) => o.log?.(`[vault] ${s.thread}: ${e.message}`))
    const title = await titleHere(o.vault, s.thread)
    if (title === null || ownTask(title)) continue
    const minutes = Math.max(1, Math.round(s.silentMs / 60_000))
    const p = propose(o.file, { kind: 'silent', cause: cause(s), thread: s.thread, title, from: s.lease.holder, to: o.vault.machine, reason: `${s.lease.holder} has not renewed its lease for ${minutes} min` }, now()) // i18n-ignore: facts for weevboss, as the dispatcher's reason lines
    if (!p) continue
    made.push(p)
    longest = Math.max(longest, minutes)
  }
  // One line per silent machine, whatever the number of its conversations.
  for (const from of new Set(made.map((p) => p.from))) o.say(made.filter((p) => p.from === from), longest)
  return made
}

/** The watch, in weevilsd, from the moment this machine has a vault: one look every two minutes while another machine
 *  has a turn at work, every ten otherwise. */
export function startVaultWatch(o: WatchOptions & { refresh: (v: VaultOptions, thread: string) => Promise<unknown> }) {
  let leases: LeaseClient | null = null
  let remote = ''
  let busy = false
  /** Working leases of other machines at the last look, and when it was: with none, a look every ten minutes is enough. */
  let others = 0
  let lookedAt = 0
  const clock = () => (o.now ?? Date.now)()
  const tick = async () => {
    const v = o.vault()
    if (!v || busy || (!others && lookedAt && clock() - lookedAt < VAULT_DISCOVER_EVERY)) return
    busy = true
    lookedAt = clock()
    try {
      // One client for the life of the watch: it remembers since when it has seen each lease unchanged.
      if (!leases || remote !== v.remote) leases = vaultLeases({ ...v, now: o.now ?? v.now })
      remote = v.remote
      await watchOnce({ vault: { ...v, now: o.now ?? v.now }, leases, file: o.file, say: o.say, log: o.log, refresh: (t) => o.refresh(v, t), others: (n) => (others = n) })
    } catch (e) {
      o.log?.(`[vault] watch: ${(e as Error).message}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void tick(), o.everyMs ?? VAULT_OBSERVE_EVERY)
  timer.unref?.()
  return { stop: () => clearInterval(timer), tick }
}

// ---------------------------------------------------------------- the dispatcher's moves (06-dispatch.md)

export const MOVE_RULES: readonly string[] = ['account', 'machine', 'provider']

/**
 * The dispatcher is about to move a turn to another account, machine or provider: was that agreed? The first time it
 * is proposed (`say`), and the turn waits; `agreed` lets this move, and the same one decided again, go.
 */
export function askMove(file: string, m: { thread: string; turn: number; rule: string; from: string; engine: string; reason: string; title: string }, now: number, say: (p: Proposal) => void): 'agreed' | 'open' | 'declined' {
  const cause = `${m.rule}:${m.thread}:${m.turn}`
  const known = verdictOf(file, cause)
  if (known === 'agreed') return 'agreed'
  if (known === 'open') return 'open'
  if (known !== null) return 'declined'
  const e = parseEngine(m.engine)
  const to = m.rule === 'machine' ? (e?.machine ?? m.engine) : m.rule === 'provider' ? (e?.provider ?? m.engine) : (e?.account ?? m.engine)
  const p = propose(file, { kind: m.rule as ProposalKind, cause, thread: m.thread, title: m.title, from: m.from, to, reason: m.reason }, now)
  if (p) say(p)
  return 'open'
}

/** The thread's turn no longer waits for a move (it could stay, or it is done): its open proposals go. */
export function clearMoves(file: string, thread: string, now: number) {
  for (const p of openProposals(file)) if (p.thread === thread && p.kind !== 'silent') settle(file, p.id, 'withdrawn', now)
}
