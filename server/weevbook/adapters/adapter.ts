// The adapter contract of docs/spec/01-thread.md: a provider session's lines in, events out.
//
// An adapter does not parse provider lines itself. It hands each line to the same reader as the app
// (readLine in server/transcripts.ts) and turns what that reader added (a message, a reply, a tool step, a stop error)
// into events. So the journal says what the app shows, and a change of format is handled in one place.
//
// What the reader does not need and the journal does (turns, their end, a failure) comes from the line itself, in
// the provider's file (claude.ts, codex.ts). The adapter is the only writer of turns in step 1: nothing is dispatched,
// so every turn is accepted, assigned to the session's own engine with rule « shadow », and running at once.

import crypto from 'node:crypto'
import type { Message } from '../../../shared/api.ts'
import { emptyTranscript, readLine, untranslatedTitleOf, type Transcript } from '../../transcripts.ts'
import type { EventDraft, JournalEvent, Provider } from '../journal.ts'

/** An event as an adapter emits it: the writer adds the leg it belongs to. */
export type Drafted = EventDraft extends infer E ? (E extends EventDraft ? Omit<E, 'leg'> : never) : never
/** What emit takes: an event without its id and time (a time in ms may be given). */
type Emit = Drafted extends infer E ? (E extends Drafted ? Omit<E, 'id' | 'at'> & { at?: number } : never) : never
/** One emitted event; an attachment carries its bytes, written to attachments/ before the event (02-weevbook.md). */
export interface Out {
  event: Drafted
  content?: Buffer
}

/** The rule of a turn read from a provider session: no dispatcher chose its engine (docs/spec/06-dispatch.md). */
export const SHADOW_RULE = 'shadow'
/** Why a checkpoint is `kind: none` in step 1: checkpoints of the code come with step 2. */
export const SHADOW_CHECKPOINT = 'shadow: no checkpoint before step 2'

export interface AdapterOptions {
  file: string
  /** The engine of the leg: `<provider>:<account>@<machine>`. */
  engine: string
  /** A new event id (a ULID) for an event at that time. */
  newId?: (ms: number) => string
  /** The time of events read before any line gave one (the file's own time). */
  fallbackAt?: number
}

/** idle: no turn in the engine's hands. starting: the provider said a turn starts, its request is not read yet.
 *  ended: the provider ended the turn, and the last lines of its reply may still come (Claude Code writes one line
 *  per part of a reply). failed: the last turn stopped on an error, and may be tried again. */
type State = 'idle' | 'starting' | 'running' | 'ended' | 'failed'

const iso = (ms: number) => new Date(ms).toISOString()
const timeOf = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : undefined
}

// ULID (https://github.com/ulid/spec): 48 bits of milliseconds, 80 random bits, Crockford's base 32.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function ulid(ms: number = Date.now()): string {
  let time = ''
  let t = Math.max(0, Math.floor(ms))
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = crypto.randomBytes(16)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += B32[bytes[i] % 32]
  return time + rand
}

export abstract class Adapter {
  abstract readonly provider: Provider
  readonly t: Transcript
  /** The engine of the leg (restore() takes it from leg.start). */
  engine: string
  /** The leg's folder: tool summaries name files under it by a relative path. Fixed when the leg starts. */
  cwd: string | undefined
  /** The time of the first line that has one, and of the latest. */
  firstAt: number | undefined
  lastAt: number
  /** Turn state, the same as the journal's: restore() rebuilds it from there. */
  turn = 0
  state: State = 'idle'
  attempt = 0
  private failedEffect: 'none' | 'some' = 'none'
  private effects = 0
  /** The last title written, and whether the thread has said anything yet (a title alone makes no thread). */
  title: string | undefined
  spoke = false
  private images = 0
  /** A title that is not in the provider's lines (Codex keeps its thread names apart). */
  externalTitle: string | undefined
  private seen: Message | undefined
  private seenLen = 0
  /** The reply being read: it is written when something else comes, since a reply may still grow. */
  private pending: { m: Message; at: number } | null = null
  protected endedId: string | undefined
  private endedAt: number | undefined
  private out: Out[] = []
  private attached = false
  private newId: (ms: number) => string

  constructor(tool: Provider, o: AdapterOptions) {
    this.t = emptyTranscript(o.file, tool)
    this.engine = o.engine
    this.newId = o.newId ?? ulid
    this.lastAt = o.fallbackAt ?? Date.now()
  }

  // ---------------------------------------------------------------- what each provider says differently

  /** This line continues the reply that ended the turn (another part of the same message). */
  protected abstract continues(o: Record<string, any>): boolean
  /** A message on this line joins the running turn instead of opening the next one. */
  protected abstract joins(o: Record<string, any>): boolean
  /** The tool's own name and the summary of the step (01-thread.md: « <name> · <detail> »). */
  protected abstract step(m: Message, o: Record<string, any>): { name: string; summary: string }
  /** Files the person attached on this line (pasted images). */
  protected abstract files(o: Record<string, any>): { mime: string; data: Buffer }[]
  /** The turn's start and end, said by the line (after the reader read it). */
  protected abstract signals(o: Record<string, any>): void
  /** The session's title now. */
  protected titleNow(): string | undefined {
    return untranslatedTitleOf(this.t)
  }

  // ---------------------------------------------------------------- reading

  /** Whether everything read so far is in the events emitted: no reply waiting for its end, no turn half-ended.
   *  The writer commits only at such a point, so that the journal alone says where the adapter stands. */
  get safe(): boolean {
    return this.pending === null && this.state !== 'ended' && this.state !== 'starting'
  }

  /** One line, read by the reader only: replaying lines already in the weevbook, before restore(). */
  feed(o: unknown) {
    if (!o || typeof o !== 'object') return
    this.clock(o)
    readLine(this.t, o)
  }

  /** One line of the provider session (parsed; undefined when it is not JSON). The events it gives. */
  line(o: unknown): Out[] {
    this.out = []
    this.attached = false
    if (!o || typeof o !== 'object') return this.out
    const rec = o as Record<string, any>
    this.clock(rec)
    if (this.state === 'ended' && !this.continues(rec)) this.close()
    const stopBefore = this.t.stopError
    readLine(this.t, rec)
    const stopped = this.t.stopError !== undefined && this.t.stopError !== stopBefore
    for (const m of this.fresh()) {
      if (m.role === 'event') this.tool(m, rec)
      // The sentence a provider writes when it refuses to go on is the turn's failure, not a reply (01-thread.md).
      else if (m.role === 'assistant') {
        if (!stopped) this.reply(m)
      } else this.said(m, rec)
    }
    if (!this.attached) this.attach(rec)
    if (stopped) this.fail(this.t.stopError!.reason)
    else this.signals(rec)
    this.retitle()
    return this.out
  }

  /**
   * Nothing more for now. A reply waiting for its end is written, a turn the provider ended is closed. With `hard`
   * (the session has been silent long enough to be over), a turn still running is closed too: it ended without a
   * word (the provider was closed mid-turn), and the next request, if one comes, opens the next turn.
   */
  settle(hard: boolean): Out[] {
    this.out = []
    if (hard && this.state === 'starting') this.state = 'idle'
    if (this.state === 'ended' || (hard && this.state === 'running')) this.close()
    else this.flush()
    this.retitle()
    return this.out
  }

  /** The state of a leg whose events are already in the journal (after its lines were fed). */
  restore(events: readonly JournalEvent[], leg: string) {
    const mine = events.filter((e) => e.leg === leg || e.leg === null)
    for (const e of mine) {
      if (e.type === 'leg.start' && e.leg === leg) {
        this.cwd = e.cwd
        this.engine = e.engine
      }
      else if (e.type === 'meta' && e.title !== undefined) this.title = e.title
      else if (e.type === 'attachment' && /^image-\d+\./.test(e.name)) this.images++
      else if (e.type === 'message' || e.type === 'tool') {
        this.spoke = true
        if (e.type === 'tool' || e.role === 'assistant') this.effects++
      } else if (e.type === 'turn') {
        this.turn = Math.max(this.turn, e.turn)
        if (e.state === 'assigned') this.attempt = e.attempt ?? this.attempt + 1
        if (e.state === 'running') this.effects = 0
        if (e.state === 'accepted') this.failedEffect = 'none'
        if (e.state === 'failed' && this.failedEffect !== 'some') this.failedEffect = e.effect ?? 'none'
        this.state = e.state === 'done' ? 'idle' : e.state === 'failed' ? 'failed' : 'running'
      }
    }
    this.seen = this.t.messages.at(-1)
    this.seenLen = this.seen?.text.length ?? 0
  }

  setExternalTitle(title: string | undefined): Out[] {
    this.out = []
    this.externalTitle = title || undefined
    this.retitle()
    return this.out
  }

  // ---------------------------------------------------------------- inside

  private clock(o: unknown) {
    const at = o && typeof o === 'object' ? timeOf((o as { timestamp?: unknown }).timestamp) : undefined
    if (at === undefined) return
    this.lastAt = at
    this.firstAt ??= at
  }

  private emit(event: Emit, content?: Buffer) {
    const ms = event.at ?? this.lastAt
    if (event.type === 'message' || event.type === 'tool') this.spoke = true
    this.cwd ??= this.t.cwd
    this.out.push({ event: { ...event, id: this.newId(ms), at: iso(ms) } as Drafted, ...(content ? { content } : {}) })
    return this.out[this.out.length - 1].event.id
  }

  /** What the reader added since the last line: new messages in order. A reply that grew after it was written (a
   *  late part of a message) comes back as a reply of its own, so that nothing it says is lost. */
  private fresh(): Message[] {
    const msgs = this.t.messages
    let k = msgs.length
    while (k > 0 && msgs[k - 1] !== this.seen) k--
    const found = this.seen !== undefined && k > 0
    const added = found || this.seen === undefined ? msgs.slice(k) : msgs.slice()
    if (found && this.seen!.text.length > this.seenLen && this.seen!.role === 'assistant' && this.pending?.m !== this.seen) {
      added.unshift({ ...this.seen!, text: this.seen!.text.slice(this.seenLen).trim() })
    }
    this.seen = msgs.at(-1)
    this.seenLen = this.seen?.text.length ?? 0
    return added
  }

  private flush() {
    if (!this.pending) return
    const { m, at } = this.pending
    this.pending = null
    this.emit({ type: 'message', role: 'assistant', text: m.text, at })
  }

  private reply(m: Message) {
    this.flush()
    this.ensureRunning()
    this.pending = { m, at: m.at || this.lastAt }
    this.effects++
  }

  private tool(m: Message, o: Record<string, any>) {
    this.flush()
    this.ensureRunning()
    const { name, summary } = this.step(m, o)
    this.emit({ type: 'tool', call: m.id, name, summary, at: m.at || this.lastAt })
    this.effects++
  }

  private said(m: Message, o: Record<string, any>) {
    this.flush()
    // A resume preface ([from:weevbook;thread:<id>]): leg.start already tells it; the turn is the engine's own.
    if (m.role === 'orchestrator' && m.author === 'weevbook') {
      this.ensureRunning()
      return
    }
    if (this.state === 'ended') this.close()
    const id = this.emit({ type: 'message', role: m.role === 'orchestrator' ? 'orchestrator' : 'user', text: m.text, source: this.provider, ...(m.role === 'orchestrator' ? { author: m.author ?? 'weevboss' } : {}), at: m.at || this.lastAt })
    this.attach(o)
    if (this.state === 'running' && this.joins(o)) return
    // A new request while a turn runs, which the provider did not take into it: that turn ended without a word.
    if (this.state === 'running') this.close()
    this.open(id)
  }

  private attach(o: Record<string, any>) {
    this.attached = true
    for (const f of this.files(o)) {
      const sha256 = crypto.createHash('sha256').update(f.data).digest('hex')
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[f.mime] ?? 'bin'
      this.images++
      this.emit({ type: 'attachment', role: 'user', sha256, name: `image-${this.images}.${ext}`, mime: f.mime, bytes: f.data.byteLength }, f.data)
    }
  }

  /** The engine takes a turn: the next one, opened by `message` (null: by the engine itself, background work that
   *  finished), or the failed one again. */
  private open(message: string | null) {
    const assigned = { type: 'turn', turn: 0, state: 'assigned', engine: this.engine, rule: SHADOW_RULE, reason: `${this.provider} session ${this.t.id}: read from the provider's file, not dispatched` } as const // i18n-ignore: journal text, the same on every machine
    if (this.state === 'failed') {
      this.attempt++
      this.emit({ ...assigned, turn: this.turn, attempt: this.attempt, ...(this.failedEffect === 'some' ? { resume: true } : {}) })
    } else {
      this.turn++
      this.attempt = 1
      this.failedEffect = 'none'
      this.emit({ type: 'turn', turn: this.turn, state: 'accepted', message })
      this.emit({ ...assigned, turn: this.turn, attempt: 1 })
    }
    this.emit({ type: 'turn', turn: this.turn, state: 'running' })
    this.state = 'running'
    this.effects = 0
  }

  /** A reply or a step needs a turn: the running one, or the one that ended if this line continues it (line() has
   *  closed it otherwise), or a turn the engine opened by itself (background work that finished). */
  protected ensureRunning() {
    if (this.state === 'running' || this.state === 'ended') return
    this.open(null)
  }

  /** The turn is over: written as done, after its checkpoint (THREAD-14). A turn the provider ended is done at the
   *  time of its last line, not of the line that came after. */
  protected close() {
    this.flush()
    if (this.state !== 'running' && this.state !== 'ended') return
    const at = this.state === 'ended' ? this.endedAt : undefined
    this.emit({ type: 'checkpoint', turn: this.turn, kind: 'none', reason: SHADOW_CHECKPOINT, at })
    this.emit({ type: 'turn', turn: this.turn, state: 'done', at })
    this.state = 'idle'
    this.endedId = undefined
  }

  /** The provider ended the turn; the rest of its last reply may still come. */
  protected ended(messageId: string | undefined) {
    if (this.state !== 'running' && this.state !== 'ended') return
    this.state = 'ended'
    this.endedId = messageId
    this.endedAt = this.lastAt
  }

  protected starting() {
    if (this.state === 'running' || this.state === 'ended') this.close()
    if (this.state === 'idle') this.state = 'starting'
  }

  private fail(reason: 'quota' | 'auth' | 'api') {
    this.flush()
    // No turn running: the provider failed on work it took by itself (a background task that finished, a hook after
    // the turn ended) or tried the failed turn again. That is a turn too, and it failed (every error is one).
    if (this.state === 'ended') this.close()
    if (this.state !== 'running') this.open(null)
    const effect = this.effects > 0 ? 'some' : 'none'
    if (effect === 'some') this.emit({ type: 'checkpoint', turn: this.turn, kind: 'none', reason: SHADOW_CHECKPOINT })
    this.emit({ type: 'turn', turn: this.turn, state: 'failed', reason, effect })
    this.state = 'failed'
    // Once an attempt has had an effect, every later attempt of the turn resumes (THREAD-10).
    if (this.failedEffect !== 'some') this.failedEffect = effect
  }

  private retitle() {
    if (!this.spoke) return
    const title = this.titleNow()
    if (!title || title === this.title) return
    this.title = title
    this.emit({ type: 'meta', title })
  }
}
