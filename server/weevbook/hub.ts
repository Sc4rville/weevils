// The weevbook's hub, as one machine syncs with it (docs/spec/03-sync-and-lease.md, step 2): its threads pushed with
// their lease every 20 s, the code's checkpoints in their own lane, the threads it lost handed over as orphans, late
// notes filed where it holds the lease, and, on the dispatcher's machine, the steal of a silent holder's lease.
//
// The rules are lease.ts's, used as they are; this file only decides what to push when. Transport: git, to a bare
// repository on the main machine, over the SSH a secondary machine already uses for its tunnel (no new port, no new
// endpoint). Never blocks the app: everything runs in child processes, bounded in time, and an error is logged once.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { ulid } from './adapters/adapter.ts'
import { hubRef, keepInWeevbook, takeCheckpoint, type CheckpointFields } from './checkpoint.ts'
import { gitOk, hubRunner, runGit, sshCommand } from './gitrun.ts'
import { parseJournal, type EventDraft, type JournalEvent, type LegId } from './journal.ts'
import { LeaseClient, OBSERVE_EVERY, RENEW_EVERY, lateNote, orphanRef as orphanRefOf, parseLease, stealable, type GitRunner, type Intent, type Lease, type Outcome, type Seen } from './lease.ts'
import { Weevbook, composeMain, writeAtomic } from './store.ts'
import { Sessions, machinePart } from './sync.ts'
import { stolen, turnsOf, type Turn } from './turn.ts'

/** The hub's remote name in the weevbook's repository. */
export const REMOTE = 'hub'
/** Threads taken for the first time in one round, at most, and the time they may take: a machine that comes back with
 *  many catches up over several rounds, and its renewals are never late for it. */
export const TAKES_PER_ROUND = 50
const TAKE_BUDGET_MS = 8_000
/** How often a holder looks for orphan refs of its threads, and the hub's machine composes `main`. */
export const ORPHANS_EVERY = 60_000
export const COMPOSE_EVERY = 60_000
/** A checkpoint push may take this long (the first one of a big project). */
const CHECKPOINT_PUSH_MS = 15 * 60_000
/** The checkpoint of a turn is taken only when its end was read within this: a session read again long after (a
 *  backfill, a restart) is not the folder as it was then. */
export const CHECKPOINT_FRESH = 10 * 60_000
const LOCK_WAIT = 15_000

/** What `weevils weevbook sync status` prints (DATA_DIR/weevbook-hub.json, written by weevilsd after each round). */
export interface HubStatus {
  v: 1
  machine: string
  hub: string
  here: boolean
  /** This machine steals the leases of silent holders (the dispatcher's machine). */
  steals: boolean
  state: 'starting' | 'ok' | 'offline' | 'refused' | 'stopped'
  /** The last round, and the last one that reached the hub. */
  at: string | null
  reached: string | null
  error: string | null
  /** Threads ahead of the hub, and checkpoints not pushed yet. */
  pending: number
  checkpoints: number
  /** Threads whose lease this machine renews while a turn runs. */
  working: string[]
  /** Leases this machine holds, with their epoch (the orphan ref's name if it loses one). */
  held: Record<string, { epoch: number; state: 'working' | 'idle' }>
  lost: { thread: string; at: string; to: string | null; orphan: string | null }[]
  stolen: { thread: string; from: string; at: string; delayMs: number }[]
  notes: number
  composed: string | null
}

const iso = (ms: number) => new Date(ms).toISOString()
const short = (s: string) => s.slice(0, 12)

/** The leg at work (the last leg.start without its leg.end), if any. */
export function openLeg(events: readonly JournalEvent[]): { leg: LegId; engine: string; session: string; cwd: string } | null {
  let open: { leg: LegId; engine: string; session: string; cwd: string } | null = null
  for (const e of events) {
    if (e.type === 'leg.start' && e.leg) open = { leg: e.leg, engine: e.engine, session: e.session, cwd: e.cwd }
    else if (e.type === 'leg.end' && open && e.leg === open.leg) open = null
  }
  return open
}
export const legCount = (events: readonly JournalEvent[]) => events.reduce((n, e) => (e.type === 'leg.start' ? n + 1 : n), 0)

/** The turns of a journal; a journal the reducer refuses (it should not happen: the weevbook checks every event) is
 *  read as having no turn at work. */
export function safeTurns(events: readonly JournalEvent[]): Turn[] {
  try {
    return turnsOf(events)
  } catch {
    return []
  }
}

/** The lease a thread's journal asks for: `working` while a turn is assigned or running, with its engine and leg. */
export function intentOf(events: readonly JournalEvent[], tip: string | null): Intent {
  const live = safeTurns(events).find((t) => t.state === 'assigned' || t.state === 'running')
  const open = openLeg(events)
  if (live && open) return { engine: open.engine, leg: open.leg, state: 'working', turn: live.turn, tip }
  return { engine: open?.engine ?? null, leg: open?.leg ?? null, state: 'idle', tip }
}

/** The subject of a thread commit the sync makes (03-sync-and-lease.md): the last turn and its state. */
export function subjectOf(events: readonly JournalEvent[], machine: string, what?: string): string {
  const turns = safeTurns(events)
  const t = turns.at(-1)
  const open = openLeg(events)
  const provider = open?.engine.split(':')[0] ?? ''
  if (what) return `${what} · ${machine}`
  if (!t) return `meta · ${machine}`
  const running = t.state === 'assigned' || t.state === 'running'
  return `turn ${t.turn}${running ? ' (running)' : t.state === 'done' ? '' : ` (${t.state})`}${provider ? ` · ${provider}` : ''} · ${machine}`
}

/** A draft as the weevbook appends it: an id, this machine's time, the leg it belongs to. */
export function draft(now: number, leg: LegId | null, e: Record<string, unknown>): EventDraft {
  return { id: ulid(now), at: iso(now), leg, ...e } as EventDraft
}

// ---------------------------------------------------------------- the hub's own repository

/**
 * The pre-receive hook of a hub weevils keeps: thread refs, checkpoint refs and `main` only move forward and are never
 * deleted; an orphan ref is created or deleted, never moved; leases and engines are compare-and-swap (the pusher's
 * `--force-with-lease`). Anything else is refused: the hub is not a place for other refs.
 */
export const HUB_HOOK = `#!/bin/sh
# weevils hub (docs/spec/03-sync-and-lease.md): what may move, and how.
zero() { case "$1" in *[!0]*) return 1 ;; esac; return 0; }
while read -r old new ref; do
  case "$ref" in
    refs/leases/*|refs/engines/*|refs/weevils-probe/*) ;;
    refs/orphans/*)
      zero "$old" || zero "$new" || { echo "weevils hub: $ref is created or deleted, never moved" >&2; exit 1; } ;;
    refs/threads/*|refs/checkpoints/*|refs/heads/main)
      if zero "$new"; then echo "weevils hub: $ref is never deleted" >&2; exit 1; fi
      zero "$old" || git merge-base --is-ancestor "$old" "$new" || { echo "weevils hub: $ref only moves forward" >&2; exit 1; } ;;
    *) echo "weevils hub: $ref is not a weevbook ref" >&2; exit 1 ;;
  esac
done
exit 0
`

/** The hub of this machine (`WEEVILS_WEEVBOOK_HUB=here`): a bare repository with its hook, made the first time. */
export async function ensureHubRepo(dir: string) {
  if (!(await fsp.access(path.join(dir, 'HEAD')).then(() => true, () => false))) {
    await fsp.mkdir(path.dirname(dir), { recursive: true })
    await gitOk(['init', '-q', '--bare', '--initial-branch=main', dir])
  }
  await gitOk(['--git-dir', dir, 'config', 'receive.advertiseAtomic', 'true'])
  await gitOk(['--git-dir', dir, 'config', 'core.logAllRefUpdates', 'false'])
  const hook = path.join(dir, 'hooks', 'pre-receive')
  if ((await fsp.readFile(hook, 'utf8').catch(() => '')) !== HUB_HOOK) {
    await fsp.mkdir(path.dirname(hook), { recursive: true })
    await fsp.writeFile(hook, HUB_HOOK, { mode: 0o755 })
  }
}

/** The weevbook's remote `hub` points at `url`. */
export async function ensureRemote(gitDir: string, url: string) {
  const cur = (await runGit(['--git-dir', gitDir, 'config', '--get', `remote.${REMOTE}.url`])).stdout.trim()
  if (cur !== url) await gitOk(['--git-dir', gitDir, 'config', `remote.${REMOTE}.url`, url])
}

/**
 * The check of 03 at setup: the hub takes atomic pushes and refs outside refs/heads. Two throwaway refs in one atomic
 * push, then deleted. `refused`: the hub answered no (a hub to refuse); `unreachable`: no answer.
 */
export async function probeHub(git: GitRunner, machine: string): Promise<{ ok: true } | { ok: false; why: 'unreachable' | 'refused'; detail: string }> {
  const tree = (await git(['mktree'], { input: '' })).stdout.trim()
  const env = { GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: 'weevils@weevbook.invalid', GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: 'weevils@weevbook.invalid', GIT_AUTHOR_DATE: '0 +0000', GIT_COMMITTER_DATE: '0 +0000' }
  const commit = (await git(['commit-tree', tree, '-m', 'probe'], { env })).stdout.trim()
  const ref = `refs/weevils-probe/${machinePart(machine)}`
  const r = await git(['push', '--porcelain', '--atomic', REMOTE, `+${commit}:${ref}`, `+${commit}:${ref}-atomic`])
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')
    const answered = r.stdout.split('\n').some((l) => l.startsWith('!')) || /atomic|rejected|denied|hook/i.test(r.stderr)
    return { ok: false, why: answered ? 'refused' : 'unreachable', detail }
  }
  await git(['push', '--porcelain', '--atomic', REMOTE, `:${ref}`, `:${ref}-atomic`])
  return { ok: true }
}

// ---------------------------------------------------------------- the sync of one machine

export interface HubOptions {
  /** The weevbook (DATA_DIR/weevbook). */
  dir: string
  dataDir: string
  /** DATA_DIR/weevbook-sessions.jsonl: the sessions this machine reads into threads. */
  sessions: string
  machine: string
  hub: { url: string; here: boolean }
  /** The dispatcher's machine: it reads every working lease every 10 s and steals a silent holder's. */
  steals: boolean
  now?: () => number
  log?: (line: string) => void
  /** GIT_SSH_COMMAND for the hub; default: sshCommand() with a control socket in DATA_DIR. */
  ssh?: string
  /** Default DATA_DIR/weevbook-hub.json. */
  statusFile?: string
}

export class HubSync {
  readonly o: HubOptions
  readonly now: () => number
  book!: Weevbook
  client!: LeaseClient
  git!: GitRunner
  private ckGit!: GitRunner
  private sessions: Sessions
  readonly status: HubStatus
  private readonly logged = new Set<string>()
  private ready = false
  private mtimes: Map<string, number> | null = null
  private orphansAt = 0
  private composeKey = ''
  private composedAt = 0
  private leaseCommits = new Map<string, string>()
  private lastWorking = new Set<string>()
  private leases = new Map<string, Lease>()
  private chain: Promise<unknown> = Promise.resolve()
  private opening: Promise<boolean> | null = null

  constructor(o: HubOptions) {
    this.o = o
    this.now = o.now ?? Date.now
    this.sessions = new Sessions(o.sessions)
    this.status = { v: 1, machine: o.machine, hub: o.hub.url, here: o.hub.here, steals: o.steals, state: 'starting', at: null, reached: null, error: null, pending: 0, checkpoints: 0, working: [], held: {}, lost: [], stolen: [], notes: 0, composed: null }
  }

  get statusFile() {
    return this.o.statusFile ?? path.join(this.o.dataDir, 'weevbook-hub.json')
  }

  /** A line in the log once per distinct message (a hub that stays offline does not fill the log). */
  once(key: string, e: unknown) {
    const line = `[weevbook hub] ${key}: ${(e as Error)?.message ?? e}`
    if (this.logged.has(line)) return
    if (this.logged.size > 500) this.logged.clear()
    this.logged.add(line)
    ;(this.o.log ?? ((l: string) => console.error(l)))(line)
  }
  private info(line: string) {
    ;(this.o.log ?? ((l: string) => console.error(l)))(`[weevbook hub] ${line}`)
  }

  /** One thing at a time on the lease client and the book (rounds, observations, resumes in this process). */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Ready to talk to the hub (started, and the hub passed its check). */
  async ensure(): Promise<boolean> {
    return this.ready || this.init()
  }

  /** One opening at a time: the round, the dispatcher and Threads may all ask at start. */
  init(): Promise<boolean> {
    return (this.opening ??= this.open().finally(() => (this.opening = null)))
  }

  private async open(): Promise<boolean> {
    try {
      this.book ??= await Weevbook.open(this.o.dir, this.o.machine)
      if (this.o.hub.here) await ensureHubRepo(this.o.hub.url)
      await ensureRemote(this.book.gitDir, this.o.hub.url)
      const ssh = this.o.hub.here ? undefined : (this.o.ssh ?? sshCommand(this.o.dataDir))
      this.git = hubRunner(this.book.gitDir, { ssh, netMs: 60_000 })
      this.ckGit = hubRunner(this.book.gitDir, { ssh, netMs: CHECKPOINT_PUSH_MS })
      this.client = new LeaseClient({ machine: this.o.machine, git: this.git, now: this.now })
      const saved = JSON.parse(await fsp.readFile(this.statusFile, 'utf8').catch(() => 'null')) as HubStatus | null
      if (saved?.held && saved.hub === this.o.hub.url) Object.assign(this.status, { held: saved.held, lost: saved.lost ?? [], stolen: saved.stolen ?? [], notes: saved.notes ?? 0 })
      const p = await probeHub(this.git, this.o.machine)
      if (!p.ok) {
        this.status.state = p.why === 'refused' ? 'refused' : 'offline'
        this.status.error = p.detail
        this.once(p.why === 'refused' ? 'hub refused (atomic push, refs outside refs/heads)' : 'hub unreachable', p.detail)
        return false
      }
      this.ready = true
      this.status.state = 'ok'
      this.status.error = null
      return true
    } catch (e) {
      this.status.state = 'offline'
      this.status.error = (e as Error).message
      this.once('start', e)
      return false
    }
  }

  async save() {
    this.status.at = iso(this.now())
    await writeAtomic(this.statusFile, `${JSON.stringify(this.status, null, 2)}\n`).catch((e) => this.once('status', e))
  }

  /** Under the book's lock (another writer of this machine may hold it for a moment). Undefined: it stayed locked. */
  async withBook<T>(fn: () => Promise<T>, wrote: (r: T) => boolean = () => true): Promise<T | undefined> {
    if (!(await this.book.lockWait(LOCK_WAIT))) {
      this.once('lock', 'the weevbook stayed locked; next round')
      return undefined
    }
    let r: T | undefined
    try {
      r = await fn()
      return r
    } finally {
      await this.book.unlock(r !== undefined && wrote(r)).catch((e) => this.once('unlock', e))
    }
  }

  private async refMap(...prefixes: string[]): Promise<Map<string, string>> {
    const out = await this.git(['for-each-ref', '--format=%(objectname) %(refname)', ...prefixes])
    const m = new Map<string, string>()
    for (const l of out.stdout.split('\n')) {
      const [sha, ref] = l.split(' ')
      if (ref) m.set(ref, sha)
    }
    return m
  }
  private async isAncestor(a: string, b: string) {
    return (await this.git(['merge-base', '--is-ancestor', a, b])).code === 0
  }
  private async setHubRef(kind: 'threads' | 'checkpoints', id: string, commit: string | null) {
    if (commit) await this.git(['update-ref', `refs/hub/${kind}/${id}`, commit])
  }
  private reached() {
    this.status.reached = iso(this.now())
    if (this.status.state !== 'refused') this.status.state = 'ok'
    this.status.error = null
  }
  private offline(detail: string) {
    this.status.state = 'offline'
    this.status.error = detail
    this.once('hub unreachable', detail)
  }

  /**
   * Under the book's lock: folders ahead of their ref are committed (the hub then has everything up to the last
   * round), and what differs from the hub is listed with the lease each thread asks for.
   */
  private async local(): Promise<{ tips: Map<string, string>; hub: Map<string, string>; intents: Map<string, Intent> } | undefined> {
    return this.withBook(async () => {
      const out = await this.git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/threads/', 'refs/hub/threads/'])
      const tips = new Map<string, string>()
      const hub = new Map<string, string>()
      for (const line of out.stdout.split('\n')) {
        const [sha, ref] = line.split(' ')
        if (!ref) continue
        if (ref.startsWith('refs/threads/')) tips.set(ref.slice('refs/threads/'.length), sha)
        else hub.set(ref.slice('refs/hub/threads/'.length), sha)
      }
      // A journal longer than its ref's (it only grows): the folder is ahead of the ref. Looked at for every thread at
      // the first round, then for those whose journal was written since the round before.
      const mtimes = new Map<string, number>()
      const sizes = new Map<string, number>()
      for (const t of this.book.threads()) {
        const st = await fsp.stat(path.join(this.book.abs(t.path), 'events.jsonl')).catch(() => null)
        if (!st) continue
        mtimes.set(t.id, st.mtimeMs)
        if (this.mtimes?.get(t.id) !== st.mtimeMs) sizes.set(t.id, st.size)
      }
      const changed = new Set<string>()
      const known = [...sizes.keys()].filter((id) => tips.has(id))
      for (const id of sizes.keys()) if (!tips.has(id)) changed.add(id)
      if (known.length) {
        const out = await this.git(['cat-file', '--batch-check'], { input: known.map((id) => `${tips.get(id)}:events.jsonl\n`).join('') })
        out.stdout.split('\n').slice(0, known.length).forEach((line, i) => {
          const size = Number(line.split(' ')[2])
          if (size !== sizes.get(known[i])) changed.add(known[i])
        })
      }
      this.mtimes = mtimes
      const working = Object.entries(this.status.held).filter(([, h]) => h.state === 'working').map(([id]) => id)
      // The journals read this round: threads that changed or run here, those held here that moved, and at most one
      // round's worth of the others (a machine with thousands of threads to push reads them a round at a time).
      const look = new Set([...changed, ...working])
      let others = 0
      for (const [id, sha] of tips) {
        if (hub.get(id) === sha || look.has(id)) continue
        if (this.client.seen(id)?.lease?.holder === this.o.machine) look.add(id)
        else if (others++ < TAKES_PER_ROUND) look.add(id)
      }
      const intents = new Map<string, Intent>()
      for (const id of look) {
        if (this.movedHere(id)) continue
        const th = await this.book.thread(id)
        if (!th) continue
        const events = th.journal.events
        if (changed.has(id)) {
          const c = await this.book.commitThread(id, subjectOf(events, this.o.machine))
          if (c) tips.set(id, c)
        }
        intents.set(id, intentOf(events, tips.get(id) ?? null))
      }
      return { tips, hub, intents }
    }, () => false)
  }

  /** Every session of this thread on this machine went elsewhere: nothing of it is pushed from here. */
  private movedHere(id: string): boolean {
    const recs = this.sessions.all().filter((r) => r.thread === id)
    return recs.length > 0 && recs.every((r) => r.moved)
  }

  /** One round (every 20 s): renewals in one atomic push, new threads taken, threads lost handed over, orphans folded. */
  round(): Promise<void> {
    return this.serial(async () => {
      if (!this.ready && !(await this.init())) return this.save()
      await this.sessions.load().catch((e) => this.once('sessions', e))
      const l = await this.local()
      if (!l) {
        // The weevbook stayed locked (a long checkpoint, a backfill): the leases at work are renewed all the same, with
        // what the hub already has, so that a busy machine is never taken for a silent one.
        const keep = [...this.lastWorking].filter((id) => this.client.seen(id)?.lease?.holder === this.o.machine)
        if (keep.length) {
          const out = await this.client.renew(
            keep.map((id) => {
              const l = this.client.seen(id)!.lease!
              return { thread: id, intent: { engine: l.engine, leg: l.leg, state: l.state, ...(l.turn !== undefined ? { turn: l.turn } : {}) } }
            }),
          )
          for (const id of keep) await this.outcome(id, out.get(id)!)
        }
        return this.save()
      }
      this.lastWorking = new Set([...l.intents].filter(([, i]) => i.state === 'working').map(([id]) => id))
      const renew: { thread: string; intent: Intent }[] = []
      const fresh: string[] = []
      for (const [id, intent] of l.intents) {
        const tip = l.tips.get(id) ?? null
        const pending = tip !== null && l.hub.get(id) !== tip
        const seen = this.client.seen(id)
        if (seen?.lease?.holder === this.o.machine) {
          // A held thread is pushed when it moved, while a turn runs (the renewal), and when it goes idle.
          if (pending || intent.state === 'working' || seen.lease.state !== intent.state) renew.push({ thread: id, intent })
        } else if (pending || (intent.state === 'working' && intent.engine?.endsWith(`@${machinePart(this.o.machine)}`))) fresh.push(id)
      }
      if (renew.length) {
        const out = await this.client.renew(renew)
        for (const r of renew) await this.outcome(r.thread, out.get(r.thread)!)
      }
      const started = this.now()
      let taken = 0
      for (const id of fresh) {
        if (taken >= TAKES_PER_ROUND || this.now() - started > TAKE_BUDGET_MS) break
        if (this.status.state === 'offline' && taken > 0) break
        taken++
        await this.takeOrYield(id, l.intents.get(id)!, l.tips.get(id) ?? null)
      }
      if (this.now() - this.orphansAt >= ORPHANS_EVERY) {
        this.orphansAt = this.now()
        await this.foldOrphans().catch((e) => this.once('orphans', e))
      }
      if (this.o.hub.here && this.now() - this.composedAt >= COMPOSE_EVERY) {
        this.composedAt = this.now()
        await this.composeHub().catch((e) => this.once('compose', e))
      }
      this.status.working = Object.entries(this.status.held).filter(([, h]) => h.state === 'working').map(([id]) => id)
      const refs = await this.refMap('refs/threads/', 'refs/hub/threads/')
      this.status.pending = [...refs].filter(([ref, sha]) => ref.startsWith('refs/threads/') && refs.get(`refs/hub/${ref.slice(5)}`) !== sha && !this.movedHere(ref.slice(13))).length
      await this.save()
    })
  }

  private async outcome(id: string, o: Outcome) {
    if (o.ok) {
      this.reached()
      await this.setHubRef('threads', id, o.lease.tip)
      this.status.held[id] = { epoch: o.lease.epoch, state: o.lease.state }
      return
    }
    if (o.why === 'unreachable') return this.offline('push')
    this.reached()
    if (o.why === 'lost' || (o.why === 'rejected' && o.holder && o.holder !== this.o.machine)) {
      const seen = this.client.seen(id)
      if (seen) await this.yieldTo(id, seen)
    } else if (o.why === 'rejected') this.once(`push ${short(id)}`, 'rejected by the hub')
  }

  /** A thread this machine does not hold as far as it knows: read its lease, then take it, or give it up. */
  private async takeOrYield(id: string, intent: Intent, tip: string | null) {
    const f = await this.client.fetch(id)
    if (!f) return this.offline('fetch')
    this.reached()
    const l = f.seen.lease
    const H = f.seen.tip
    if (!l || l.holder === this.o.machine) return this.outcome(id, await this.client.take(id, intent))
    // Idle with another holder, and this machine has all the hub has: take it over, if there is anything to push.
    if (l.state === 'idle' && tip !== null && (!H || H === tip || (await this.isAncestor(H, tip)))) {
      if (H === tip && intent.state === 'idle') return this.setHubRef('threads', id, H)
      return this.outcome(id, await this.client.take(id, intent))
    }
    await this.yieldTo(id, f.seen)
  }

  /**
   * lose (03-sync-and-lease.md), or plain catching up: what this machine has and the hub does not goes to its orphan
   * ref, then the thread becomes the hub's. A session of this machine whose leg ended there is no longer read into it.
   */
  async yieldTo(id: string, seen: Seen) {
    const H = seen.tip
    if (!H) return
    // Under the lock from the first look to the end: nothing this machine writes meanwhile can fall between the two.
    const r = await this.withBook(async () => {
      const L = await this.book.threadRef(id)
      let orphan: string | null = null
      if (L && L !== H && !(await this.isAncestor(L, H))) {
        const epoch = this.status.held[id]?.epoch ?? Math.max(1, (seen.lease?.epoch ?? 2) - 1)
        const o = await this.client.orphan(id, L, epoch)
        if (!o.ok && o.why === 'unreachable') return 'offline' as const
        orphan = o.ok ? o.ref : orphanRefOf(id, this.o.machine, epoch)
        this.status.lost = [...this.status.lost, { thread: id, at: iso(this.now()), to: seen.lease?.holder ?? null, orphan }].slice(-20)
        this.info(`lost ${short(id)} to ${seen.lease?.holder ?? '?'}: what it had not pushed is in ${orphan}`)
      }
      if (L !== H) await this.book.adopt(id, H)
      await this.setHubRef('threads', id, H)
      const events = (await this.book.thread(id))?.journal.events ?? []
      await this.sessions.load()
      for (const r of this.sessions.all()) {
        if (r.thread !== id || r.moved) continue
        if (events.some((e) => e.type === 'leg.end' && e.leg === r.leg)) {
          await this.sessions.record({ key: r.key, moved: true })
          this.info(`${r.key}: its thread ${short(id)} continues on ${seen.lease?.holder ?? 'another machine'}; this session is no longer written into it`)
        }
      }
      return 'done' as const
    })
    if (r === 'offline') return this.offline('orphan')
    if (r === 'done') delete this.status.held[id]
  }

  /** Orphan refs of the threads this machine holds become late notes, in the push that deletes them. */
  private async foldOrphans() {
    const ls = await this.git(['ls-remote', REMOTE, 'refs/orphans/*'])
    if (ls.code !== 0) return this.offline('ls-remote')
    const threads = new Set(ls.stdout.split('\n').map((l) => /\trefs\/orphans\/([^/]+)\//.exec(l)?.[1]).filter((t): t is string => !!t))
    for (const id of threads) {
      if (!this.status.held[id] && this.client.seen(id)?.lease?.holder !== this.o.machine) continue
      const f = await this.client.fetch(id)
      if (!f || f.seen.lease?.holder !== this.o.machine || !f.orphans.length) continue
      const done = await this.withBook(async () => {
        const L = (await this.refMap(`refs/threads/${id}`)).get(`refs/threads/${id}`) ?? null
        if (!L || L !== f.seen.tip) return null
        const events = (await this.book.thread(id))?.journal.events ?? []
        const drafts: EventDraft[] = []
        for (const o of f.orphans) {
          // Already folded by an earlier push that did not delete the ref: only the deletion is left to do.
          if (events.some((e) => e.type === 'note' && e.kind === 'late' && (e.data as { from?: string } | undefined)?.from === o.ref)) continue
          const text = (await this.git(['cat-file', 'blob', `${o.commit}:events.jsonl`])).stdout
          const note = lateNote(events, parseJournal(text).events, o.ref)
          if (note) drafts.push(draft(this.now(), note.leg, { type: note.type, kind: note.kind, text: note.text, data: note.data }))
        }
        if (drafts.length) await this.book.append(id, { events: drafts })
        const tip = drafts.length ? await this.book.commitThread(id, subjectOf(events, this.o.machine, 'note')) : L
        return { tip, notes: drafts.length, intent: intentOf((await this.book.thread(id))?.journal.events ?? events, tip) }
      })
      if (!done) continue
      // Not pushed this time: the note is in the thread here and goes with the next renewal; the ref stays until then.
      const out = (await this.client.renew([{ thread: id, intent: done.intent, drop: f.orphans }])).get(id)!
      await this.outcome(id, out)
      if (out.ok) {
        this.status.notes += done.notes
        this.info(`${short(id)}: ${f.orphans.length} orphan ref(s) folded, ${done.notes} late note(s)`)
      }
    }
  }

  // ---------------------------------------------------------------- the dispatcher's machine: steals

  /** Every 10 s: every lease of the hub, read; a working lease of a silent holder, stolen (with `turn failed` and
   *  `leg.end` in the same push), and left idle for whoever resumes the thread. */
  observe(): Promise<string[]> {
    return this.serial(async () => {
      if (!this.ready && !(await this.init())) return []
      const f = await this.git(['fetch', '--quiet', '--prune', '--no-tags', REMOTE, '+refs/leases/*:refs/hub/leases/*'])
      if (f.code !== 0) {
        this.offline('fetch leases')
        return []
      }
      this.reached()
      const refs = await this.refMap('refs/hub/leases/')
      const changed = [...refs].filter(([ref, sha]) => this.leaseCommits.get(ref) !== sha)
      if (changed.length) {
        const out = await this.git(['cat-file', '--batch'], { input: changed.map(([, sha]) => `${sha}:lease.json\n`).join('') })
        let pos = 0
        const text = out.stdout
        for (const [ref, sha] of changed) {
          const nl = text.indexOf('\n', pos)
          const size = Number(text.slice(pos, nl).split(' ')[2])
          const body = Number.isFinite(size) ? text.slice(nl + 1, nl + 1 + size) : ''
          pos = Number.isFinite(size) ? nl + 1 + size + 1 : nl + 1
          const lease = parseLease(body)
          if (lease) this.leases.set(ref.slice('refs/hub/leases/'.length), lease)
          this.leaseCommits.set(ref, sha)
        }
      }
      for (const ref of [...this.leaseCommits.keys()]) {
        if (refs.has(ref)) continue
        this.leaseCommits.delete(ref)
        this.leases.delete(ref.slice('refs/hub/leases/'.length))
      }
      const took: string[] = []
      for (const [id, lease] of this.leases) {
        if (lease.state !== 'working' || lease.holder === this.o.machine) continue
        const r = await this.client.fetch(id)
        if (!r) return took
        if (!stealable(r.seen, this.now()).ok) continue
        if (await this.steal(id, r.seen)) took.push(id)
      }
      if (took.length) await this.save()
      return took
    })
  }

  /** The steal of 03: `turn failed` (machine-lost) and `leg.end` on the hub's tip, pushed with the lease, left idle. */
  async steal(id: string, seen: Seen): Promise<boolean> {
    const H = seen.tip
    const from = seen.lease?.holder ?? '?'
    const lastRenewal = seen.lease ? Date.parse(seen.lease.renewed) : this.now()
    const built = await this.withBook(async () => {
      const L = (await this.refMap(`refs/threads/${id}`)).get(`refs/threads/${id}`) ?? null
      if (H && L !== H) await this.book.adopt(id, H)
      const events = (await this.book.thread(id))?.journal.events ?? []
      const now = this.now()
      const open = openLeg(events)
      const failed = stolen(safeTurns(events))
      const drafts: EventDraft[] = []
      if (failed) drafts.push(draft(now, open?.leg ?? null, { type: 'turn', ...failed }))
      if (open) drafts.push(draft(now, open.leg, { type: 'leg.end', reason: 'machine-lost', by: this.o.machine }))
      if (drafts.length) await this.book.append(id, { events: drafts })
      const tip = drafts.length ? await this.book.commitThread(id, `${failed ? `turn ${failed.turn} (failed) · ` : ''}machine-lost · ${this.o.machine}`) : H
      return { tip }
    })
    if (!built) return false
    const o = await this.client.steal(id, { engine: null, leg: null, state: 'idle', tip: built.tip })
    if (!o.ok) {
      if (o.why === 'unreachable') this.offline('steal')
      // Beaten, or the holder came back: the hub's version, and the events of this attempt are dropped with it.
      const f = await this.client.fetch(id)
      if (f?.seen.tip) await this.withBook(() => this.book.adopt(id, f.seen.tip!))
      return false
    }
    await this.setHubRef('threads', id, o.lease.tip)
    this.status.held[id] = { epoch: o.lease.epoch, state: 'idle' }
    const delayMs = this.now() - lastRenewal
    this.status.stolen = [...this.status.stolen, { thread: id, from, at: iso(this.now()), delayMs }].slice(-20)
    this.info(`stole ${short(id)} from ${from}, ${Math.round(delayMs / 1000)} s after its last renewal`)
    return true
  }

  // ---------------------------------------------------------------- checkpoints and main

  /**
   * The checkpoint lane, apart from the leases so that a big push never makes a renewal late: each refs/checkpoints/
   * <id> of the weevbook that the hub does not have is pushed, fast-forward. When the hub's has moved elsewhere
   * (another machine checkpointed the thread since), a commit that keeps both is pushed instead: every checkpoint a
   * journal names stays reachable (restores use the commit the journal names, never the ref's tip).
   */
  checkpoints(): Promise<number> {
    return (async () => {
      if (!this.ready) return 0
      const refs = await this.refMap('refs/checkpoints/', 'refs/hub/checkpoints/')
      const todo = [...refs].filter(([ref, sha]) => ref.startsWith('refs/checkpoints/') && refs.get(`refs/hub/${ref.slice(5)}`) !== sha)
      this.status.checkpoints = todo.length
      let pushed = 0
      for (const [ref, sha] of todo) {
        const id = ref.slice('refs/checkpoints/'.length)
        let r = await this.ckGit(['push', '--porcelain', REMOTE, `${sha}:${ref}`])
        if (r.code !== 0 && r.stdout.split('\n').some((l) => l.startsWith('!'))) {
          const f = await this.ckGit(['fetch', '--quiet', '--no-tags', REMOTE, `+${ref}:refs/hub/${ref.slice(5)}`])
          const theirs = f.code === 0 ? (await this.refMap(`refs/hub/${ref.slice(5)}`)).get(`refs/hub/${ref.slice(5)}`) : undefined
          if (theirs && (await this.isAncestor(sha, theirs))) {
            pushed++
            continue
          }
          if (theirs) {
            const tree = (await this.git(['rev-parse', `${theirs}^{tree}`])).stdout.trim()
            const env = { GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: `weevils@${this.o.machine}`, GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: `weevils@${this.o.machine}` }
            const keep = (await this.git(['commit-tree', tree, '-p', theirs, '-p', sha, '-m', `keep · ${this.o.machine} · ${id}`], { env })).stdout.trim()
            r = await this.ckGit(['push', '--porcelain', REMOTE, `${keep}:${ref}`])
            if (r.code === 0) {
              await this.git(['update-ref', ref, keep, sha])
              await this.setHubRef('checkpoints', id, keep)
              pushed++
            }
            continue
          }
        }
        if (r.code === 0) {
          await this.setHubRef('checkpoints', id, sha)
          pushed++
        } else this.once(`checkpoint ${short(id)}`, (r.stderr || r.stdout).trim().split('\n').at(-1))
      }
      this.status.checkpoints = todo.length - pushed
      return pushed
    })().catch((e) => {
      this.once('checkpoints', e)
      return 0
    })
  }

  /** On the hub's machine: `main` of the hub, composed from the hub's own thread refs (nobody else composes it). */
  async composeHub(): Promise<string | null> {
    const key = (await runGit(['--git-dir', this.o.hub.url, 'for-each-ref', '--format=%(objectname)', 'refs/threads/'])).stdout
    if (key === this.composeKey) return null
    const r = await composeMain(this.o.hub.url, this.o.machine)
    this.composeKey = key
    if (r.commit) this.status.composed = r.commit
    return r.commit
  }

  /** The timers: rounds every 20 s, observations every 10 s (the dispatcher's machine), checkpoints in their lane. */
  start(): { stop: () => Promise<void> } {
    let stopped = false
    const timers = new Set<NodeJS.Timeout>()
    const running: Promise<unknown>[] = []
    const loop = (every: number, fn: () => Promise<unknown>) => {
      const tick = async () => {
        if (stopped) return
        const t0 = Date.now()
        const p = fn().catch((e) => this.once('loop', e))
        running.push(p)
        await p
        running.splice(running.indexOf(p), 1)
        if (stopped) return
        const t = setTimeout(() => {
          timers.delete(t)
          void tick()
        }, Math.max(1000, every - (Date.now() - t0)))
        t.unref?.()
        timers.add(t)
      }
      const t = setTimeout(() => {
        timers.delete(t)
        void tick()
      }, 2_000)
      t.unref?.()
      timers.add(t)
    }
    loop(RENEW_EVERY, () => this.round())
    loop(RENEW_EVERY, () => this.checkpoints())
    if (this.o.steals) loop(OBSERVE_EVERY, () => this.observe())
    return {
      stop: async () => {
        stopped = true
        for (const t of timers) clearTimeout(t)
        await Promise.allSettled(running)
        this.status.state = 'stopped'
        await this.save()
      },
    }
  }
}

// ---------------------------------------------------------------- the writer's hook

/**
 * The checkpoint of a turn that ends (the writer's hook, sync.ts): taken in the project, then copied into the
 * weevbook's refs/checkpoints/<id>, from where the checkpoint lane pushes it. Null leaves the adapter's `kind: none`
 * (a turn read long after it ended, or no folder).
 */
export function checkpointHook(o: { dataDir: string; home: string; weevbookGitDir: string; now?: () => number; log?: (line: string) => void }) {
  return async ({ thread, turn, cwd, at }: { thread: string; turn: number; cwd: string | undefined; at: number }): Promise<CheckpointFields | null> => {
    const now = o.now?.() ?? Date.now()
    if (!cwd || !Number.isFinite(at) || now - at > CHECKPOINT_FRESH) return null
    const t = await takeCheckpoint({ cwd, thread, turn, home: o.home, dataDir: o.dataDir, now: at })
    if (t.gitDir && t.fields.commit) {
      try {
        await keepInWeevbook(o.weevbookGitDir, t.gitDir, thread)
      } catch (e) {
        o.log?.(`[weevbook hub] checkpoint ${short(thread)}: ${(e as Error).message}`)
        return { kind: 'none', reason: `checkpoint not kept: ${(e as Error).message}`.slice(0, 300) } // i18n-ignore: journal data
      }
    }
    return t.fields
  }
}

export { hubRef }
