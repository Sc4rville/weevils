// Threads in weevilsd (docs/spec, step 4, behind WEEVILS_THREADS): one conversation is one weevbook thread, whatever
// engines carried it. Every machine publishes its engines.json and starts the turns the dispatcher gives it; the
// machine that serves the app also runs the dispatcher. The person writes to a thread; the rest happens here:
//
//   message → inbox (kept on disk) → filed as `message` + `turn accepted` with the lease (turn.ts) → decide on the
//   engine table (dispatch.ts, dispatcher.ts) → reserve → the engine's machine takes the lease and starts the turn
//   (start.ts, lease.ts) → the shadow writer records what the engine does → the hub sync lets the lease go at its end.
//
// A turn that fails (quota, sign-in, error, a machine gone) is placed again by the same table, on another account,
// machine or provider (resume.ts, handoff.ts); the app shows none of it. Only a held turn shows a sentence.

import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Message } from '../../shared/api.ts'
import type { ThreadHold, ThreadLine, ThreadList, ThreadView } from '../../shared/threads.ts'
import { ulid } from './adapters/adapter.ts'
import { ENTER_UNDER, type DecideInput, type Quota } from './dispatch.ts'
import { Dispatcher, type Instruction } from './dispatcher.ts'
import { PUBLISH_EVERY, factsOf, machineEngines, publishEngines, readEngines, type EngineSource } from './engines.ts'
import { activeRecently, checkHandoff, handoffEvent, nextHandoff } from './handoff.ts'
import { HubSync, draft, openLeg, safeTurns } from './hub.ts'
import { parseEngine, parseJournal, slugify, type EventDraft, type JournalEvent, type LegId, type MetaEvent, type Provider } from './journal.ts'
import { OBSERVE_EVERY, stealable } from './lease.ts'
import { pushEvents, readThread, type StartResult } from './start.ts'
import { threadRefs } from './store.ts'
import { machinePart } from './sync.ts'
import { next, type Turn } from './turn.ts'
import { openSession, threadMessages, titleOf, visibleState } from './view.ts'

/** A connector request (continue_with_agent) held longer than this never starts: it ends as « expired, ask again ». */
export const REQUEST_EXPIRES = 3600_000
/** A message for a running turn is given to its engine again after this, if the first try failed. */
const FORWARD_AGAIN = 30_000
/** A handoff is rewritten this long after the turn ended (a quick next turn makes it wait). */
const HANDOFF_AFTER = 15_000

/** A message accepted and not yet in its thread (kept in DATA_DIR/threads-inbox.jsonl until it is). */
export interface Inbox {
  key: string
  thread: string
  text: string
  source: 'weevils' | 'connector'
  app?: 'chatgpt' | 'claude-ai'
  /** A new thread: its project and title. */
  project?: string | null
  title?: string
  at: number
}

/** Another machine's weevilsd, as the dispatcher reaches it (server/remotes.ts). */
export interface Peer {
  machine: string
  online: boolean
  start(ins: Instruction): Promise<StartResult>
  deliver(thread: string, text: string): Promise<void>
}

export interface ThreadsOptions {
  sync: HubSync
  machine: string
  /** This machine runs the dispatcher (the one that serves the app). */
  dispatcher: boolean
  preferred: Provider
  /** DATA_DIR/threads-inbox.jsonl */
  inboxFile: string
  /** The projects present here, and the accounts signed in here (engines.json). */
  projects: () => string[]
  sources: () => EngineSource[]
  /** This machine starts an instruction (start.ts, bound to weevilsd). */
  start: (ins: Instruction) => Promise<StartResult>
  /** A message for the turn running here: given to the provider session, which takes it into the turn. */
  deliver: (session: string, text: string) => Promise<void>
  peers: () => Peer[]
  /** The small model of a provider, isolated (server/quiet-calls.ts), for handoff.md. */
  write?: (provider: Provider, prompt: string) => Promise<string>
  /** A thread changed (the app reads it again). */
  changed?: (thread: string) => void
  now?: () => number
  log?: (line: string) => void
}

export class Threads {
  readonly d: Dispatcher
  private readonly o: ThreadsOptions
  private readonly inbox = new Map<string, Map<string, Inbox>>()
  private readonly keys = new Map<string, string>()
  private readonly watch = new Set<string>()
  private readonly running = new Map<string, Promise<void>>()
  private readonly again = new Set<string>()
  private readonly forwarded = new Map<string, number>()
  private readonly holds = new Map<string, ThreadHold>()
  private lastWorking = new Set<string>()
  private readonly handoffs = new Map<string, number>()
  private handoffBusy = false
  private refsCache: { key: string; lines: ThreadLine[]; handoffs: Map<string, string> } | null = null
  private published = 0
  private stopped = false
  private timers: NodeJS.Timeout[] = []

  constructor(o: ThreadsOptions) {
    this.o = o
    this.d = new Dispatcher(o.preferred)
  }
  private now() {
    return this.o.now?.() ?? Date.now()
  }
  private log(line: string) {
    this.o.log?.(`[threads] ${line}`)
  }
  private get me() {
    return machinePart(this.o.machine)
  }

  // ---------------------------------------------------------------- start

  /** The inbox from disk, the threads with a turn not done, the timers. */
  async start(): Promise<void> {
    await this.loadInbox()
    if (this.o.dispatcher) {
      await this.o.sync.ensure()
      for (const t of await this.lines().catch(() => [] as ThreadLine[])) if (t.state !== 'waiting') this.watch.add(t.thread)
      for (const id of this.inbox.keys()) this.watch.add(id)
    }
    const every = (ms: number, fn: () => Promise<unknown>) => {
      const tick = async () => {
        if (this.stopped) return
        await fn().catch((e) => this.log(`loop: ${(e as Error).message}`))
        const t = setTimeout(tick, ms)
        t.unref?.()
        this.timers.push(t)
      }
      const t = setTimeout(tick, 1000)
      t.unref?.()
      this.timers.push(t)
    }
    every(OBSERVE_EVERY, () => this.tick())
  }
  stop() {
    this.stopped = true
    for (const t of this.timers) clearTimeout(t)
  }

  /** Every 10 s: engines.json written (each minute), read back (dispatcher), every watched thread looked at. */
  async tick() {
    const now = this.now()
    if (now - this.published >= PUBLISH_EVERY) await this.publish()
    if (this.o.dispatcher) {
      await this.readTable()
      for (const id of [...this.watch]) await this.step(id)
    }
    await this.keepHandoffs()
  }

  /** This machine's engines.json, written to the hub. */
  async publish() {
    const j = await machineEngines(this.o.machine, this.o.projects(), this.o.sources(), this.now())
    if (await this.o.sync.serial(() => publishEngines(this.o.sync.git, j))) this.published = this.now()
    else this.log('engines.json not written: the hub did not answer')
  }

  /** Every machine's engines.json, read by the dispatcher: a version not seen before enters the table now. */
  async readTable() {
    const all = await this.o.sync.serial(() => readEngines(this.o.sync.git))
    if (!all) return
    for (const j of all) {
      const f = factsOf(j)
      if (this.d.engines.seenOf(f.facts.machine) === f.seen) continue
      this.d.engines.publish(f.facts, f.quotas, f.seen, this.now())
    }
  }

  // ---------------------------------------------------------------- messages

  /**
   * A message for a thread (null: a new thread in `project`). Kept on disk at once, then filed by the dispatcher. The
   * same key twice is the same message (a retry): it is answered, not filed again.
   */
  async accept(thread: string | null, m: { text: string; key?: string; source?: Inbox['source']; app?: Inbox['app']; project?: string | null; title?: string }): Promise<{ thread: string; key: string }> {
    const key = m.key ?? `weevils:${ulid(this.now())}`
    const known = this.keys.get(key)
    if (known) return { thread: known, key }
    const id = thread ?? ulid(this.now())
    const e: Inbox = { key, thread: id, text: m.text, source: m.source ?? 'weevils', ...(m.app ? { app: m.app } : {}), ...(thread ? (m.project !== undefined ? { project: m.project } : {}) : { project: m.project ?? null, ...(m.title ? { title: m.title } : {}) }), at: this.now() }
    await fsp.mkdir(path.dirname(this.o.inboxFile), { recursive: true })
    await fsp.appendFile(this.o.inboxFile, `${JSON.stringify(e)}\n`, { mode: 0o600 })
    this.remember(e)
    this.watch.add(id)
    this.poke(id)
    return { thread: id, key }
  }
  private remember(e: Inbox) {
    const box = this.inbox.get(e.thread) ?? new Map<string, Inbox>()
    box.set(e.key, e)
    this.inbox.set(e.thread, box)
    this.keys.set(e.key, e.thread)
  }
  private async loadInbox() {
    const text = await fsp.readFile(this.o.inboxFile, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      try {
        const e = JSON.parse(line) as Inbox
        if (e?.key && e.thread && typeof e.text === 'string') this.remember(e)
      } catch {
        /* a cut line */
      }
    }
  }
  /** Messages of a thread its journal does not have yet; the others leave the inbox (and the file, rewritten). */
  private async waiting(thread: string, events: readonly JournalEvent[]): Promise<Inbox[]> {
    const box = this.inbox.get(thread)
    if (!box?.size) return []
    const keys = new Set(events.flatMap((e) => (e.type === 'message' && e.key ? [e.key] : [])))
    let dropped = false
    for (const key of [...box.keys()]) if (keys.has(key)) {
      box.delete(key)
      dropped = true
    }
    if (!box.size) this.inbox.delete(thread)
    if (dropped) await this.saveInbox()
    return [...(this.inbox.get(thread)?.values() ?? [])].sort((a, b) => a.at - b.at)
  }
  private async saveInbox() {
    const lines = [...this.inbox.values()].flatMap((b) => [...b.values()]).map((e) => JSON.stringify(e))
    const tmp = `${this.o.inboxFile}.${process.pid}.tmp`
    await fsp.writeFile(tmp, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 })
    await fsp.rename(tmp, this.o.inboxFile)
  }

  /** The dispatcher looks at the thread soon (now, unless it is already looking: then once more after). */
  poke(thread: string) {
    if (!this.o.dispatcher) return
    this.watch.add(thread)
    void this.step(thread)
  }

  // ---------------------------------------------------------------- the dispatcher's look at one thread

  /** One look at a time per thread; a look asked meanwhile runs once more after it. */
  step(thread: string): Promise<void> {
    const cur = this.running.get(thread)
    if (cur) {
      this.again.add(thread)
      return cur
    }
    const run = (async () => {
      do {
        this.again.delete(thread)
        try {
          await this.look(thread)
        } catch (e) {
          this.log(`${thread.slice(-6)}: ${(e as Error).message}`)
        }
      } while (this.again.has(thread))
    })().finally(() => this.running.delete(thread))
    this.running.set(thread, run)
    return run
  }

  /** Steal what is stale, give a running turn its new messages, file what waits, expire old requests, place a turn. */
  private async look(thread: string) {
    const sync = this.o.sync
    let r = await sync.serial(() => readThread(sync, thread))
    if (!r) return
    let lease = r.seen.lease
    if (lease?.state === 'working') {
      this.d.working(thread)
      await this.forward(thread, lease.holder, r.events)
      if (lease.holder === this.o.machine || !stealable(r.seen, this.now()).ok) return
      const seen = r.seen
      if (!(await sync.serial(() => sync.steal(thread, seen)))) return
      this.d.stole(thread)
      this.log(`${thread.slice(-6)}: took the lease from ${lease.holder}, silent`)
      r = await sync.serial(() => readThread(sync, thread))
      if (!r) return
      lease = r.seen.lease
    }
    // Idle or absent: file what waits, and the requests that waited too long end. Each carries the open leg (THREAD-7).
    const waiting = await this.waiting(thread, r.events)
    const drafts: EventDraft[] = []
    const now = this.now()
    const legNow = openLeg(r.events)?.leg ?? null
    let turns = safeTurns(r.events)
    if (!r.seen.tip && !r.events.length) {
      const first = waiting[0]
      if (!first) return this.forget(thread)
      drafts.push(draft(now, null, { type: 'meta', thread, ...(first.title ? { title: first.title } : {}), ...(first.project ? { project: slugify(first.project) || null } : {}) }))
    }
    let turn = turns.length
    let project = events0Project(r.events)
    for (const w of waiting) {
      // A request that names another project moves the thread there (the connector's `project`).
      if (r.events.length && w.project !== undefined && w.project !== project) {
        project = w.project ? slugify(w.project) || null : null
        drafts.push(draft(now, legNow, { type: 'meta', project }))
      }
      const id = ulid(now)
      drafts.push(draft(now, legNow, { type: 'message', role: 'user', text: w.text, source: w.source, ...(w.app ? { app: w.app } : {}), key: w.key, id }))
      drafts.push(draft(now, legNow, { type: 'turn', turn: ++turn, state: 'accepted', message: id }))
    }
    drafts.push(...this.expired(thread, r.events, turns, now, legNow))
    if (drafts.length) {
      const seen = r.seen
      const out = await sync.serial(() => pushEvents(sync, thread, seen.tip, drafts, () => ({ engine: openLeg(r!.events)?.engine ?? null, leg: openLeg(r!.events)?.leg ?? null, state: 'idle' }), `turn ${turn} (accepted) · ${this.o.machine}`))
      if (!out.ok) return
      this.o.changed?.(thread)
      r = await sync.serial(() => readThread(sync, thread))
      if (!r) return
      turns = safeTurns(r.events)
    }
    await this.place(thread, r.events, turns, r.seen.tip)
  }

  /** Connector requests held more than an hour, never started: held again, `expired` (they wait for « ask again »). */
  private expired(thread: string, events: readonly JournalEvent[], turns: readonly Turn[], now: number, leg: LegId | null): EventDraft[] {
    const out: EventDraft[] = []
    for (const t of turns) {
      if (t.state !== 'held' || t.attempts.some((a) => a.ran) || !t.message) continue
      if (t.held?.reason === 'expired' || t.held?.reason === 'attempts') continue
      const m = events.find((e) => e.id === t.message)
      if (!m || m.type !== 'message' || !m.key?.includes(':req:')) continue
      if (now - Date.parse(m.at) < REQUEST_EXPIRES) continue
      out.push(draft(now, leg, { type: 'turn', turn: t.turn, state: 'held', rule: 'hold', reason: 'expired' })) // i18n-ignore: log and journal data
      this.log(`${thread.slice(-6)} turn ${t.turn}: a request held for ${Math.round((now - Date.parse(m.at)) / 60_000)} min expires`)
    }
    return out
  }

  /** The decision for the oldest waiting turn, and what it says to do. */
  private async place(thread: string, events: readonly JournalEvent[], turns: readonly Turn[], tip: string | null) {
    const n = next(turns)
    if (n.kind === 'quiet' && !this.inbox.get(thread)?.size) return this.forget(thread)
    const meta = events.findLast((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)
    const project = meta?.project ?? null
    const p = this.d.place(thread, events, turns, this.now(), {
      project,
      cloneable: events.some((e) => e.type === 'checkpoint' && !!e.repo),
      direct: (machine) => machine === this.me || !!this.o.peers().find((x) => x.machine === machine)?.online,
      record: (d) => this.log(`${thread.slice(-6)} turn ${d.turn}.${d.attempt}: ${d.output.rule}${d.output.engine ? ` → ${d.output.engine}` : ` (${d.output.hold})`}: ${d.output.reason}`),
    })
    if (p.kind === 'none') return
    if (p.kind === 'hold') {
      if (p.decision) this.holds.set(thread, holdFacts(p.decision.hold ?? 'no-machine', p.input, project))
      if (!p.changes.length) return
      const sync = this.o.sync
      const now = this.now()
      const leg = openLeg(events)?.leg ?? null
      await sync.serial(() => pushEvents(sync, thread, tip, p.changes.map((c) => draft(now, leg, { type: 'turn', ...c })), (ev) => ({ engine: openLeg(ev)?.engine ?? null, leg: openLeg(ev)?.leg ?? null, state: 'idle' }), `turn ${p.changes[0].turn} (held) · ${this.o.machine}`))
      this.o.changed?.(thread)
      return
    }
    this.holds.delete(thread)
    const machine = parseEngine(p.ins.engine)!.machine
    const go = async (): Promise<StartResult> => {
      if (machine === this.me) return this.o.start(p.ins)
      const peer = this.o.peers().find((x) => x.machine === machine)
      if (!peer) return { ok: false, why: 'unreachable', detail: `${machine} is not a remote of this install` } // i18n-ignore: log and journal data
      return peer.start(p.ins)
    }
    void go()
      .catch((e): StartResult => {
        this.d.engines.answered(machine, false, this.now())
        return { ok: false, why: 'unreachable', detail: (e as Error).message }
      })
      .then((res) => {
        if (res.ok) {
          this.o.changed?.(thread)
          return
        }
        this.log(`${thread.slice(-6)} turn ${p.ins.turn}: ${machine} did not start it (${res.why}: ${res.detail})`)
        this.d.unplaced(thread)
        if (res.why !== 'busy' && res.why !== 'stale') setTimeout(() => void this.step(thread), 2000).unref?.()
      })
  }

  private forget(thread: string) {
    if (!this.inbox.get(thread)?.size && !this.running.has(thread)) this.watch.delete(thread)
  }

  /** New messages for a turn that runs go to its engine, which takes them into the turn (01-thread.md). */
  private async forward(thread: string, holder: string, events: readonly JournalEvent[]) {
    for (const e of await this.waiting(thread, events)) {
      if ((this.forwarded.get(e.key) ?? -Infinity) + FORWARD_AGAIN > this.now()) continue
      this.forwarded.set(e.key, this.now())
      try {
        if (holder === this.o.machine) await this.deliverHere(thread, e.text)
        else {
          const peer = this.o.peers().find((p) => p.machine === machinePart(holder))
          if (!peer?.online) continue
          await peer.deliver(thread, e.text)
        }
        // The provider has it: it is the engine's to write now, no longer the inbox's.
        this.inbox.get(thread)?.delete(e.key)
        await this.saveInbox()
      } catch (err) {
        this.log(`${thread.slice(-6)}: message not given to the running turn yet (${(err as Error).message})`)
      }
    }
  }

  /** A message for the turn that runs here. */
  async deliverHere(thread: string, text: string) {
    const events = await this.o.sync.withBook(async () => (await this.o.sync.book.thread(thread))?.journal.events ?? [])
    const session = openSession(events ?? [], this.me)
    if (!session) throw new Error('no session of this thread runs here') // i18n-ignore: log and journal data
    await this.o.deliver(session, text)
  }

  // ---------------------------------------------------------------- handoff.md, kept current (decision D3)

  /** Threads whose turn just ended here get their handoff rewritten, one at a time, in the background. */
  private async keepHandoffs() {
    const working = new Set(this.o.sync.status.working)
    for (const id of this.lastWorking) if (!working.has(id)) this.handoffs.set(id, this.now())
    this.lastWorking = working
    if (this.handoffBusy) return
    const due = [...this.handoffs].find(([id, at]) => this.now() - at >= HANDOFF_AFTER && !working.has(id))
    if (!due) return
    this.handoffs.delete(due[0])
    this.handoffBusy = true
    try {
      await this.rewriteHandoff(due[0])
    } catch (e) {
      this.log(`${due[0].slice(-6)}: handoff not rewritten (${(e as Error).message})`)
    } finally {
      this.handoffBusy = false
    }
  }

  /** The thread's handoff after its last turn: the leg's provider's small model, or the journal (`by: journal`). */
  async rewriteHandoff(id: string) {
    const sync = this.o.sync
    const read = await sync.withBook(async () => {
      const th = await sync.book.thread(id)
      if (!th) return null
      const p = sync.book.pathOf(id)
      const previous = p ? await fsp.readFile(path.join(sync.book.abs(p), 'handoff.md'), 'utf8').catch(() => null) : null
      return { events: th.journal.events, previous }
    })
    if (!read || !activeRecently(read.events, this.now())) return
    if (sync.client.seen(id)?.lease?.holder !== this.o.machine) return
    const last = read.events.at(-1)?.seq ?? 0
    if (read.previous && (checkHandoff(read.previous, id)?.upTo ?? -1) >= last - 1) return
    const leg = read.events.findLast((e) => e.type === 'leg.start')
    const engine = leg && leg.type === 'leg.start' ? leg.engine : null
    const provider = engine ? parseEngine(engine)?.provider : undefined
    const h = await nextHandoff({ thread: id, events: read.events, previous: read.previous, now: this.now(), by: engine ?? 'journal', write: provider && this.o.write && engine ? (prompt) => this.o.write!(provider, prompt) : undefined })
    await sync.serial(() =>
      sync.withBook(async () => {
        const th = await sync.book.thread(id)
        // A turn started meanwhile: this handoff waits for the next end.
        if (!th || (th.journal.events.at(-1)?.seq ?? 0) !== last) return
        const r = await sync.book.append(id, { events: [handoffEvent(h.text, h.upTo, h.by, this.now(), ulid(this.now()))], handoff: h.text })
        if (r.written) await sync.book.commitThread(id, `handoff · ${this.o.machine}`)
      }),
    )
    this.log(`${id.slice(-6)}: handoff up to ${h.upTo} (${h.by})`)
  }

  // ---------------------------------------------------------------- what the app reads

  /** Every thread of the weevbook (the hub's when it is here, and this machine's), newest first. */
  async lines(): Promise<ThreadLine[]> {
    const dirs = [this.o.sync.book.gitDir, ...(this.o.sync.status.here ? [this.o.sync.status.hub] : [])]
    const key = (await Promise.all(dirs.map((d) => gitOut(d, ['for-each-ref', '--format=%(objectname)', 'refs/threads/'])))).join('|')
    if (this.refsCache?.key === key) return this.refsCache.lines
    const by = new Map<string, ThreadLine & { commit: string; dir: string }>()
    for (const dir of dirs) {
      for (const r of await threadRefs(dir).catch(() => [])) {
        const cur = by.get(r.id)
        if (cur && cur.updated >= Date.parse(r.meta.updated)) continue
        by.set(r.id, { thread: r.id, title: r.meta.title, project: r.meta.project, updated: Date.parse(r.meta.updated), state: r.meta.state, commit: r.commit, dir })
      }
    }
    const lines = [...by.values()].sort((a, b) => b.updated - a.updated)
    const handoffs = new Map<string, string>()
    for (const dir of dirs) {
      const mine = lines.filter((l) => l.dir === dir)
      if (!mine.length) continue
      const out = await gitOut(dir, ['cat-file', '--batch'], mine.map((l) => `${l.commit}:handoff.md\n`).join(''))
      let pos = 0
      for (const l of mine) {
        const nl = out.indexOf('\n', pos)
        if (nl < 0) break
        const head = out.slice(pos, nl)
        if (head.endsWith('missing')) {
          pos = nl + 1
          continue
        }
        const size = Number(head.split(' ')[2])
        handoffs.set(l.thread, out.slice(nl + 1, nl + 1 + size))
        pos = nl + 1 + size + 1
      }
    }
    // meta.json says `paused` for a failed turn too; the dispatcher retries those: the thread is working (view.ts).
    for (const l of lines) {
      if (l.state !== 'paused') continue
      const text = await gitOut(l.dir, ['cat-file', 'blob', `${l.commit}:events.jsonl`])
      if (text) l.state = visibleState(parseJournal(text).events).state
    }
    const plain = lines.map(({ commit: _c, dir: _d, ...l }) => l)
    this.refsCache = { key, lines: plain, handoffs }
    return plain
  }

  /** The weevbook page: threads by project, or those matching words (titles and handoff.md first, 02-weevbook.md). */
  async list(o: { project?: string; q?: string } = {}): Promise<ThreadList> {
    const all = await this.lines()
    const projects = [...new Set(all.map((t) => t.project ?? ''))].filter(Boolean).sort()
    let threads = o.project !== undefined ? all.filter((t) => (t.project ?? '') === o.project) : all
    const words = norm(o.q ?? '').split(' ').filter((w) => w.length >= 2)
    if (words.length) {
      const scored: { t: ThreadLine; score: number }[] = []
      for (const t of threads) {
        const title = ` ${norm(`${t.title} ${t.project ?? ''}`)} `
        const handoff = norm(this.refsCache?.handoffs.get(t.thread) ?? '')
        let score = 0
        let snippet: string | undefined
        for (const w of words) {
          if (title.includes(` ${w}`)) score += 3
          else if (title.includes(w)) score += 2
          else if (handoff.includes(w)) {
            score += 1
            const i = handoff.indexOf(w)
            snippet ??= handoff.slice(Math.max(0, i - 40), i + 60).trim()
          }
        }
        if (score) scored.push({ t: { ...t, ...(snippet ? { snippet } : {}) }, score })
      }
      threads = scored.sort((a, b) => b.score - a.score || b.t.updated - a.t.updated).map((x) => x.t)
    }
    return { threads: threads.slice(0, 200), projects }
  }

  /** One thread, reread: its messages, its state and, when it is paused, why. */
  async view(id: string): Promise<ThreadView | null> {
    const events = await this.events(id)
    if (!events?.length) {
      // Only in the inbox so far: the request the person just sent.
      const box = this.inbox.get(id)
      if (!box?.size) return null
      const first = [...box.values()][0]
      const messages: Message[] = [...box.values()].map((e) => ({ id: e.key, role: 'user', text: e.text, at: e.at }))
      return { thread: id, title: first.title ?? first.text.slice(0, 60), project: first.project ?? null, updated: first.at, state: 'working', messages }
    }
    const s = visibleState(events)
    const pending = [...(this.inbox.get(id)?.values() ?? [])]
    const messages = [...threadMessages(events), ...pending.map((e): Message => ({ id: e.key, role: 'user', text: e.text, at: e.at }))]
    const meta = events.findLast((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)
    const hold = s.hold ? { ...s.hold, ...(this.holds.get(id)?.reason === s.hold.reason ? this.holds.get(id) : {}) } : undefined
    const session = openSession(events, this.me)
    return {
      thread: id,
      title: titleOf(events),
      project: meta?.project ?? null,
      updated: Date.parse(events.at(-1)!.at),
      state: pending.length && s.state === 'waiting' ? 'working' : s.state,
      ...(hold ? { hold } : {}),
      messages,
      ...(session ? { session } : {}),
    }
  }

  /** A thread's journal: this machine's copy, or the hub's when it is newer (or the only one). */
  async events(id: string): Promise<JournalEvent[] | null> {
    const sync = this.o.sync
    const local = await sync.withBook(async () => ({ tip: await sync.book.threadRef(id), events: (await sync.book.thread(id))?.journal.events ?? null }))
    const hubDir = sync.status.here ? sync.status.hub : null
    const hubTip = hubDir ? (await gitOut(hubDir, ['rev-parse', '--verify', '--quiet', `refs/threads/${id}`])).trim() || null : null
    if (hubTip && hubTip !== local?.tip) {
      const newer = !local?.tip || (await gitOut(hubDir!, ['merge-base', '--is-ancestor', local.tip, hubTip], undefined, true)) === 'ok'
      if (newer) return parseJournal(await gitOut(hubDir!, ['cat-file', 'blob', `${hubTip}:events.jsonl`])).events
    }
    return local?.events ?? null
  }
}

/** What the sentence of a hold needs from the table: when the first account starts again, where the project is. */
function holdFacts(reason: string, input: DecideInput | undefined, project: string | null): ThreadHold {
  if (!input) return { reason }
  if (reason === 'no-room') {
    const resets: number[] = []
    for (const q of Object.values(input.table.quotas) as Quota[]) {
      const five = q.fiveHour.resetsAt !== null && input.now >= q.fiveHour.resetsAt ? 0 : q.fiveHour.used
      const week = q.week.resetsAt !== null && input.now >= q.week.resetsAt ? 0 : q.week.used
      const busier = week >= ENTER_UNDER ? q.week.resetsAt : five >= ENTER_UNDER ? q.fiveHour.resetsAt : null
      if (busier !== null && busier > input.now) resets.push(busier)
    }
    return { reason, until: resets.length ? Math.min(...resets) : null }
  }
  if (reason === 'no-machine') {
    const where = input.table.machines.filter((m) => !project || m.projects.includes(project)).map((m) => m.machine)
    return { reason, ...(where.length ? { machine: where.join(', ') } : {}) }
  }
  return { reason }
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** git's output in a repository (empty when it fails); `ok` instead of the output when only the exit code matters. */
function gitOut(gitDir: string, args: string[], input?: string, code = false): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile('git', ['--git-dir', gitDir, ...args], { maxBuffer: 1 << 30, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => resolve(code ? (err ? 'no' : 'ok') : err ? '' : String(stdout)))
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

/** The thread's project as its journal says now. */
function events0Project(events: readonly JournalEvent[]): string | null {
  return events.findLast((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)?.project ?? null
}
