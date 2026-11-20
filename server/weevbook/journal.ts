// The journal of a thread: `events.jsonl`, one event per line, append-only. Specified in docs/spec/01-thread.md
// (events, invariants THREAD-n) and docs/spec/02-weevbook.md (the thread folder, invariants BOOK-n).
//
// Pure: no clock, no randomness, no disk. The caller brings ids, times and file contents. Nothing in the app imports
// this module yet (step 0 of docs/spec/README.md); its tests run it against examples/weevbook.

import crypto from 'node:crypto'
import { redactToolText } from '../codex-command-details.ts'

// ---------------------------------------------------------------- types (docs/spec/01-thread.md)

export const FORMAT = 1
export type Provider = 'claude' | 'codex'
export type Source = 'weevils' | 'claude' | 'codex' | 'connector' | 'import'
export type App = 'chatgpt' | 'claude-ai'
export type LegId = `L${number}`
export type TurnState = 'accepted' | 'held' | 'assigned' | 'running' | 'done' | 'failed'

interface Envelope {
  v: number
  seq: number
  id: string
  at: string
  leg: LegId | null
}
export interface MessageEvent extends Envelope {
  type: 'message'
  role: 'user' | 'assistant' | 'orchestrator'
  text: string
  source?: Source
  app?: App
  author?: string
  key?: string
}
export interface ToolEvent extends Envelope {
  type: 'tool'
  call: string
  name: string
  summary: string
}
export interface AttachmentEvent extends Envelope {
  type: 'attachment'
  role: 'user' | 'assistant'
  sha256: string
  name: string
  mime: string
  bytes: number
  key?: string
}
export interface LegStartEvent extends Envelope {
  type: 'leg.start'
  engine: string
  session: string
  cwd: string
  rung: 0 | 1 | 2 | 3
  epoch: number
}
export interface LegEndEvent extends Envelope {
  type: 'leg.end'
  reason: 'moved' | 'quota' | 'machine-lost' | 'lease-lost' | 'error' | 'closed'
  by: string
}
export interface TurnEvent extends Envelope {
  type: 'turn'
  turn: number
  state: TurnState
  /** accepted: id of the message that opened the turn; null when the engine opened it itself. */
  message?: string | null
  /** assigned */
  engine?: string
  attempt?: number
  resume?: boolean
  /** assigned, held: the row of the dispatch table (docs/spec/06-dispatch.md). held, failed: why. */
  rule?: string
  reason?: string
  /** failed */
  effect?: 'none' | 'some'
}
export interface CheckpointEvent extends Envelope {
  type: 'checkpoint'
  turn: number
  kind: 'git' | 'shadow' | 'none'
  repo?: string
  commit?: string
  base?: string
  branch?: string
  changed?: number
  skipped?: string[]
  reason?: string
}
export interface HandoffEvent extends Envelope {
  type: 'handoff'
  upTo: number
  by: string
  sha256: string
}
export interface MetaEvent extends Envelope {
  type: 'meta'
  thread?: string
  title?: string
  project?: string | null
}
export interface NoteEvent extends Envelope {
  type: 'note'
  kind: 'late' | 'repair' | 'debug'
  text: string
  data?: unknown
}
export type JournalEvent =
  | MessageEvent | ToolEvent | AttachmentEvent | LegStartEvent | LegEndEvent
  | TurnEvent | CheckpointEvent | HandoffEvent | MetaEvent | NoteEvent
export type EventType = JournalEvent['type']
/** What a caller hands to appendEvent: everything but `v` and `seq`. */
export type EventDraft = JournalEvent extends infer E ? (E extends JournalEvent ? Omit<E, 'v' | 'seq'> : never) : never

export interface Violation {
  /** « THREAD-1 », « BOOK-3 »: the invariant's number in the spec. */
  invariant: string
  /** The event concerned, when there is one. */
  seq?: number
  info: string
}
export class JournalError extends Error {
  violations: Violation[]
  constructor(violations: Violation[]) {
    super(violations.map((v) => `${v.invariant}: ${v.info}`).join('; '))
    this.violations = violations
  }
}

// ---------------------------------------------------------------- one line

/** Field order of a line: the envelope, then the type's own fields in the order of the spec's tables. */
const FIELDS: Record<EventType, readonly string[]> = {
  message: ['role', 'text', 'source', 'app', 'author', 'key'],
  tool: ['call', 'name', 'summary'],
  attachment: ['role', 'sha256', 'name', 'mime', 'bytes', 'key'],
  'leg.start': ['engine', 'session', 'cwd', 'rung', 'epoch'],
  'leg.end': ['reason', 'by'],
  turn: ['turn', 'state', 'message', 'engine', 'attempt', 'resume', 'rule', 'reason', 'effect'],
  checkpoint: ['turn', 'kind', 'repo', 'commit', 'base', 'branch', 'changed', 'skipped', 'reason'],
  handoff: ['upTo', 'by', 'sha256'],
  meta: ['thread', 'title', 'project'],
  note: ['kind', 'text', 'data'],
}
const ENVELOPE = ['v', 'seq', 'id', 'at', 'leg', 'type'] as const
const REQUIRED: Record<EventType, readonly string[]> = {
  message: ['role', 'text'],
  tool: ['call', 'name', 'summary'],
  attachment: ['role', 'sha256', 'name', 'mime', 'bytes'],
  'leg.start': ['engine', 'session', 'cwd', 'rung', 'epoch'],
  'leg.end': ['reason', 'by'],
  turn: ['turn', 'state'],
  checkpoint: ['turn', 'kind'],
  handoff: ['upTo', 'by', 'sha256'],
  meta: [],
  note: ['kind', 'text'],
}
const TURN_FIELDS: Record<TurnState, readonly string[]> = {
  accepted: ['message'],
  held: ['rule', 'reason'],
  assigned: ['engine', 'attempt', 'rule', 'reason'],
  running: [],
  done: [],
  failed: ['effect', 'reason'],
}
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
const LEG = /^L[1-9]\d*$/
const SHA256 = /^[0-9a-f]{64}$/
const ENGINE = /^(claude|codex):([a-z0-9][a-z0-9-]*)@([A-Za-z0-9][A-Za-z0-9_.-]*)$/
export const MAX_LINE_BYTES = 1 << 20
export const MAX_RAW_BYTES = 16 << 20

/** « claude:main@laptop » → its three parts; null when it is not an engine id. */
export function parseEngine(engine: string): { provider: Provider; account: string; machine: string } | null {
  const m = ENGINE.exec(engine)
  return m ? { provider: m[1] as Provider, account: m[2], machine: m[3] } : null
}

/** The one way an event is written: fixed field order, no spaces, absent fields left out. */
export function serializeEvent(e: JournalEvent): string {
  const o = e as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of [...ENVELOPE, ...(FIELDS[e.type] ?? [])]) if (o[k] !== undefined) out[k] = o[k]
  // A field this version does not know (a line written by a newer weevils) is kept, after the known ones.
  for (const k of Object.keys(o)) if (!(k in out) && o[k] !== undefined) out[k] = o[k]
  return JSON.stringify(out)
}

export interface ParsedJournal {
  events: JournalEvent[]
  /** Lines that are not one JSON object each, a missing final newline, an oversized line: BOOK-7. */
  errors: Violation[]
}
/** `events.jsonl` as text → its events, in file order. A broken line is reported and skipped, never guessed. */
export function parseJournal(text: string): ParsedJournal {
  const events: JournalEvent[] = []
  const errors: Violation[] = []
  const bad = (n: number, info: string) => errors.push({ invariant: 'BOOK-7', info: `line ${n}: ${info}` })
  if (text === '') return { events, errors }
  if (text.includes('\r')) bad(0, 'carriage return')
  if (!text.endsWith('\n')) bad(0, 'no final newline')
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  lines.forEach((line, i) => {
    const n = i + 1
    if (!line) return bad(n, 'blank')
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) bad(n, 'over 1 MiB')
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      return bad(n, 'not JSON')
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return bad(n, 'not an object')
    const e = o as JournalEvent
    if (serializeEvent(e) !== line) bad(n, 'not in canonical form')
    events.push(e)
  })
  return { events, errors }
}

// ---------------------------------------------------------------- THREAD invariants

const isStr = (v: unknown): v is string => typeof v === 'string'
const isInt = (v: unknown): v is number => Number.isInteger(v)

function shape(e: JournalEvent): string | null {
  const o = e as unknown as Record<string, unknown>
  if (!isInt(o.v) || (o.v as number) < 1) return 'v'
  if (!isStr(o.at) || !AT.test(o.at) || Number.isNaN(Date.parse(o.at))) return 'at'
  if (o.leg !== null && !(isStr(o.leg) && LEG.test(o.leg))) return 'leg'
  // A newer format: this version checks the envelope only and keeps the line.
  if ((o.v as number) > FORMAT) return null
  if (!isStr(o.type) || !(o.type in FIELDS)) return 'type'
  for (const k of REQUIRED[e.type]) if (o[k] === undefined) return k
  for (const k of Object.keys(o)) if (!(ENVELOPE as readonly string[]).includes(k) && !FIELDS[e.type].includes(k)) return k
  switch (e.type) {
    case 'message':
      if (!['user', 'assistant', 'orchestrator'].includes(e.role) || !isStr(e.text)) return 'role'
      if (e.source !== undefined && !['weevils', 'claude', 'codex', 'connector', 'import'].includes(e.source)) return 'source'
      if ((e.source === 'connector' || e.source === 'import') !== (e.app !== undefined)) return 'app'
      if (e.app !== undefined && !['chatgpt', 'claude-ai'].includes(e.app)) return 'app'
      if (e.key !== undefined && !isStr(e.key)) return 'key'
      return null
    case 'tool':
      return isStr(e.call) && isStr(e.name) && isStr(e.summary) ? null : 'call'
    case 'attachment':
      if (!['user', 'assistant'].includes(e.role)) return 'role'
      if (!isStr(e.sha256) || !SHA256.test(e.sha256)) return 'sha256'
      if (!isStr(e.name) || !e.name || /[/\\]/.test(e.name)) return 'name'
      return isStr(e.mime) && isInt(e.bytes) && e.bytes >= 0 ? null : 'bytes'
    case 'leg.start':
      if (!isStr(e.engine) || !parseEngine(e.engine)) return 'engine'
      if (!isStr(e.session) || !isStr(e.cwd)) return 'session'
      if (![0, 1, 2, 3].includes(e.rung)) return 'rung'
      return isInt(e.epoch) && e.epoch >= 1 ? null : 'epoch'
    case 'leg.end':
      if (!['moved', 'quota', 'machine-lost', 'lease-lost', 'error', 'closed'].includes(e.reason)) return 'reason'
      return isStr(e.by) && e.by ? null : 'by'
    case 'turn': {
      if (!isInt(e.turn) || e.turn < 1) return 'turn'
      if (!(e.state in TURN_FIELDS)) return 'state'
      const own = TURN_FIELDS[e.state]
      for (const k of own) if (o[k] === undefined) return k
      for (const k of FIELDS.turn) if (o[k] !== undefined && !['turn', 'state', 'resume', ...own].includes(k)) return k
      if (e.resume !== undefined && (e.state !== 'assigned' || typeof e.resume !== 'boolean')) return 'resume'
      if (e.state === 'accepted' && e.message !== null && !(isStr(e.message) && ULID.test(e.message))) return 'message'
      if (e.state === 'assigned' && (!isStr(e.engine) || !parseEngine(e.engine) || !isInt(e.attempt))) return 'engine'
      if (e.state === 'failed' && !['none', 'some'].includes(e.effect as string)) return 'effect'
      return null
    }
    case 'checkpoint':
      if (!isInt(e.turn) || e.turn < 1) return 'turn'
      if (!['git', 'shadow', 'none'].includes(e.kind)) return 'kind'
      if (e.kind === 'none') return isStr(e.reason) && e.commit === undefined ? null : 'reason'
      if (!isStr(e.commit) || !/^[0-9a-f]{40}$/.test(e.commit)) return 'commit'
      if (e.kind === 'git' && (!isStr(e.repo) || !isStr(e.base) || !/^[0-9a-f]{40}$/.test(e.base))) return 'base'
      return null
    case 'handoff':
      if (!isInt(e.upTo) || e.upTo < 0) return 'upTo'
      if (!isStr(e.by) || (e.by !== 'journal' && !parseEngine(e.by))) return 'by'
      return isStr(e.sha256) && SHA256.test(e.sha256) ? null : 'sha256'
    case 'meta':
      if (e.thread === undefined && e.title === undefined && e.project === undefined) return 'title'
      if (e.thread !== undefined && !(isStr(e.thread) && ULID.test(e.thread))) return 'thread'
      if (e.title !== undefined && !isStr(e.title)) return 'title'
      return e.project === undefined || e.project === null || (isStr(e.project) && slugify(e.project) === e.project) ? null : 'project'
    case 'note':
      return ['late', 'repair', 'debug'].includes(e.kind) && isStr(e.text) ? null : 'kind'
  }
}

interface TurnTrack {
  state: TurnState
  attempt: number
  engine?: string
  effect?: 'none' | 'some'
}
const NEXT: Record<TurnState, readonly TurnState[]> = {
  accepted: ['held', 'assigned'],
  held: ['held', 'assigned'],
  assigned: ['running', 'failed'],
  running: ['done', 'failed'],
  done: [],
  failed: ['held', 'assigned'],
}

/** Every broken invariant of docs/spec/01-thread.md, by number. An empty list: the journal is sound. */
export function validateJournal(events: readonly JournalEvent[]): Violation[] {
  const out: Violation[] = []
  const bad = (invariant: string, e: JournalEvent | undefined, info: string) => out.push({ invariant, ...(e ? { seq: e.seq } : {}), info })
  const ids = new Set<string>()
  const keys = new Set<string>()
  const legs = new Map<string, { engine: string; ended: boolean }>()
  const turns = new Map<number, TurnTrack>()
  let open: LegId | null = null
  let lastUpTo = -1

  events.forEach((e, i) => {
    // THREAD-1: seq counts from 1, one by one.
    if (e.seq !== i + 1) bad('THREAD-1', e, `seq ${e.seq} at line ${i + 1}`)
    // THREAD-2: ids are ULIDs, each used once.
    if (!isStr(e.id) || !ULID.test(e.id)) bad('THREAD-2', e, 'id is not a ULID')
    else if (ids.has(e.id)) bad('THREAD-2', e, `id ${e.id} used twice`)
    else ids.add(e.id)
    // THREAD-3: the envelope and the fields of the type.
    const wrong = shape(e)
    if (wrong) {
      bad('THREAD-3', e, `field ${wrong}`)
      return
    }
    if (e.v > FORMAT) return
    // THREAD-4: the thread is born once, on line 1.
    if (e.type === 'meta' && (e.thread !== undefined) !== (i === 0)) bad('THREAD-4', e, i === 0 ? 'line 1 has no thread id' : 'thread id given again')
    if (i === 0 && e.type !== 'meta') bad('THREAD-4', e, 'line 1 is not a meta event')

    // THREAD-5, THREAD-6: legs are numbered in order and never overlap.
    if (e.type === 'leg.start') {
      if (e.leg !== `L${legs.size + 1}`) bad('THREAD-5', e, `expected L${legs.size + 1}`)
      if (open) bad('THREAD-6', e, `${open} is still open`)
      if (e.leg && !legs.has(e.leg)) legs.set(e.leg, { engine: e.engine, ended: false })
      open = e.leg
    } else if (e.type === 'note') {
      // THREAD-7: a note may speak of any leg that started.
      if (e.leg !== null && !legs.has(e.leg)) bad('THREAD-7', e, `unknown ${e.leg}`)
    } else if (e.leg !== open) {
      // THREAD-7: every other event carries the open leg, or null when none is open.
      bad('THREAD-7', e, `carries ${e.leg}, open leg is ${open}`)
    }
    if (e.type === 'leg.end') {
      const l = e.leg ? legs.get(e.leg) : undefined
      if (!l || l.ended) bad('THREAD-5', e, 'ends a leg that is not open')
      else l.ended = true
      if (e.leg === open) open = null
    }
    if ((e.type === 'tool' || e.type === 'checkpoint') && e.leg === null) bad('THREAD-7', e, `${e.type} outside a leg`)

    // THREAD-8: a message outside a leg says where it came from; an agent's reply never claims another source.
    if (e.type === 'message') {
      if (e.leg === null && e.source === undefined) bad('THREAD-8', e, 'no source outside a leg')
      if (e.leg === null && e.role === 'assistant' && e.source !== 'connector' && e.source !== 'import') bad('THREAD-8', e, 'assistant message outside a leg')
      if (e.leg !== null && e.role === 'assistant' && e.source !== undefined) bad('THREAD-8', e, 'assistant message in a leg with a source')
    }
    // THREAD-9: an idempotency key is used once.
    if ((e.type === 'message' || e.type === 'attachment') && e.key !== undefined) {
      if (keys.has(e.key)) bad('THREAD-9', e, `key ${e.key} used twice`)
      keys.add(e.key)
    }

    const live = [...turns.entries()].filter(([, t]) => t.state === 'assigned' || t.state === 'running')
    if (e.type === 'turn') {
      const t = turns.get(e.turn)
      // THREAD-10: turns are numbered in order and follow the state machine.
      if (!t) {
        if (e.state !== 'accepted') bad('THREAD-10', e, `turn ${e.turn} starts with ${e.state}`)
        if (e.turn !== turns.size + 1) bad('THREAD-10', e, `expected turn ${turns.size + 1}`)
        if (e.state === 'accepted' && e.message != null && !ids.has(e.message)) bad('THREAD-10', e, 'opening message not found before')
        turns.set(e.turn, { state: e.state, attempt: 0 })
      } else {
        if (!NEXT[t.state].includes(e.state)) bad('THREAD-10', e, `${t.state} → ${e.state}`)
        if (e.state === 'failed' && t.state === 'assigned' && e.effect !== 'none') bad('THREAD-10', e, 'failed before running with an effect')
        if (e.state === 'assigned') {
          if (e.attempt !== t.attempt + 1) bad('THREAD-10', e, `attempt ${e.attempt}, expected ${t.attempt + 1}`)
          if (t.effect === 'some' && e.resume !== true) bad('THREAD-10', e, 'resumes a turn failed mid-way without resume')
          // THREAD-11: one turn at a time is in an engine's hands.
          if (live.some(([n]) => n !== e.turn)) bad('THREAD-11', e, `turn ${live[0][0]} is still ${live[0][1].state}`)
          // THREAD-12: no change of engine inside a leg.
          if (open && legs.get(open)?.engine !== e.engine) bad('THREAD-12', e, `assigned to ${e.engine} while ${open} is open`)
          t.attempt = e.attempt ?? t.attempt + 1
          t.engine = e.engine
        }
        // THREAD-12: a turn runs in a leg of the engine it was assigned to.
        if (e.state === 'running' && (!open || legs.get(open)?.engine !== t.engine)) bad('THREAD-12', e, 'runs outside a leg of its engine')
        // THREAD-14: a finished turn has its checkpoint just before.
        if (e.state === 'done') {
          const prev = events[i - 1]
          if (!prev || prev.type !== 'checkpoint' || prev.turn !== e.turn) bad('THREAD-14', e, 'no checkpoint just before')
        }
        if (e.state === 'failed') t.effect = e.effect
        t.state = e.state
      }
    }
    // THREAD-13: an agent speaks and acts only while a turn is running.
    if ((e.type === 'tool' || (e.type === 'message' && e.role === 'assistant' && e.leg !== null)) && !live.some(([, t]) => t.state === 'running')) {
      bad('THREAD-13', e, `${e.type} with no running turn`)
    }
    // THREAD-15: a handoff covers what is behind it, and never less than the one before.
    if (e.type === 'handoff') {
      if (e.upTo >= e.seq) bad('THREAD-15', e, `upTo ${e.upTo} is not behind`)
      if (e.upTo < lastUpTo) bad('THREAD-15', e, `upTo ${e.upTo} after ${lastUpTo}`)
      lastUpTo = Math.max(lastUpTo, e.upTo)
    }
  })
  return out
}

/**
 * The line to append for `draft`, numbered after `events`. Throws JournalError when the journal would break an
 * invariant. Returns null when the draft carries a key the journal already has: a replay, nothing to write.
 * (Checks the whole journal each time: fine for a specification, to be made incremental when the app uses it.)
 */
export function appendEvent(events: readonly JournalEvent[], draft: EventDraft): string | null {
  const key = (draft as { key?: string }).key
  if (key !== undefined && events.some((e) => (e.type === 'message' || e.type === 'attachment') && e.key === key)) return null
  const event = { ...draft, v: FORMAT, seq: events.length + 1 } as JournalEvent
  const before = validateJournal(events).length
  const after = validateJournal([...events, event])
  if (after.length > before) throw new JournalError(after.slice(before))
  return serializeEvent(event)
}

/** BOOK-2: the journal only grows. `next` starts with every byte of `previous`. */
export const extendsJournal = (previous: string, next: string) => next.startsWith(previous) && (previous === '' || previous.endsWith('\n'))

// ---------------------------------------------------------------- what is derived from the journal

/** « Fix the login redirect! » → « fix-the-login-redirect »: folder and project names. */
export function slugify(text: string): string {
  const s = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, 48).replace(/-+$/, '')
}

interface Facts {
  thread: string
  title: string
  project: string | null
  created: string
  updated: string
}
function facts(events: readonly JournalEvent[]): Facts {
  const f: Facts = { thread: '', title: '', project: null, created: events[0]?.at ?? '', updated: events[events.length - 1]?.at ?? '' }
  for (const e of events) {
    if (e.type !== 'meta') continue
    if (e.thread !== undefined) f.thread = e.thread
    if (e.title !== undefined) f.title = e.title
    if (e.project !== undefined) f.project = e.project
  }
  return f
}

export const UNSORTED = '_unsorted'
/** BOOK-1: where the thread sits on `main`: projects/<project>/<YYYY-MM>/<id>-<slug>. */
export function threadFolder(events: readonly JournalEvent[]): string {
  const f = facts(events)
  return `projects/${f.project ?? UNSORTED}/${f.created.slice(0, 7)}/${f.thread}-${slugify(f.title) || 'untitled'}`
}

/** The file of an attachment: its SHA-256, and the extension of its name when it has a plain one. */
export function attachmentFile(e: Pick<AttachmentEvent, 'sha256' | 'name'>): string {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(e.name)?.[0].toLowerCase() ?? ''
  return `attachments/${e.sha256}${ext}`
}

const stamp = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`
const APP_NAME: Record<App, string> = { chatgpt: 'ChatGPT', 'claude-ai': 'Claude' }
function speaker(e: MessageEvent): string {
  if (e.role === 'user') return 'You'
  if (e.role === 'orchestrator') return e.author ?? 'weevboss'
  return e.app ? APP_NAME[e.app] : 'Agent'
}

/** `thread.md`: the thread as someone reads it. Messages, tool steps and attachments; nothing about legs or engines. */
export function renderThread(events: readonly JournalEvent[]): string {
  const f = facts(events)
  const blocks: string[] = [`# ${f.title || 'Untitled'}`, `Project: ${f.project ?? 'none'} · Started ${stamp(f.created)} · Thread ${f.thread}`, '---']
  let steps: string[] = []
  const flush = () => {
    if (steps.length) blocks.push(steps.join('\n'))
    steps = []
  }
  for (const e of events) {
    if (e.type === 'tool') {
      steps.push(`- ${e.summary.replace(/\s+/g, ' ').trim()}`)
      continue
    }
    if (e.type !== 'message' && e.type !== 'attachment') continue
    flush()
    if (e.type === 'message') blocks.push(`**${speaker(e)}** · ${stamp(e.at)}`, e.text.replace(/\r\n?/g, '\n').trim())
    else blocks.push(`Attachment: [${e.name}](${attachmentFile(e)})`)
  }
  flush()
  return `${blocks.join('\n\n')}\n`
}

export interface ThreadMeta {
  v: number
  thread: string
  title: string
  project: string | null
  created: string
  updated: string
  /** What the app shows: the agent works, the thread waits for the user, or it is paused and says what to do. */
  state: 'working' | 'waiting' | 'paused'
  turns: number
  events: number
  sources: Source[]
  legs: { leg: LegId; engine: string; rung: number; started: string; ended: string | null }[]
  checkpoint: { turn: number; kind: string; commit: string | null } | null
  handoff: { upTo: number; by: string } | null
}
export function deriveMeta(events: readonly JournalEvent[]): ThreadMeta {
  const f = facts(events)
  const sources = new Set<Source>()
  const legs: ThreadMeta['legs'] = []
  const turns = new Map<number, TurnState>()
  let checkpoint: ThreadMeta['checkpoint'] = null
  let handoff: ThreadMeta['handoff'] = null
  for (const e of events) {
    if (e.type === 'message' && e.source) sources.add(e.source)
    else if (e.type === 'leg.start' && e.leg) {
      legs.push({ leg: e.leg, engine: e.engine, rung: e.rung, started: e.at, ended: null })
      const p = parseEngine(e.engine)
      if (p) sources.add(p.provider)
    } else if (e.type === 'leg.end') {
      const l = legs.find((x) => x.leg === e.leg)
      if (l) l.ended = e.at
    } else if (e.type === 'turn') turns.set(e.turn, e.state)
    else if (e.type === 'checkpoint') checkpoint = { turn: e.turn, kind: e.kind, commit: e.commit ?? null }
    else if (e.type === 'handoff') handoff = { upTo: e.upTo, by: e.by }
  }
  const states = [...turns.values()]
  const state = states.some((s) => s === 'held' || s === 'failed') ? 'paused' : states.some((s) => s !== 'done') ? 'working' : 'waiting'
  return { v: FORMAT, thread: f.thread, title: f.title, project: f.project, created: f.created, updated: f.updated, state, turns: turns.size, events: events.length, sources: [...sources].sort(), legs, checkpoint, handoff }
}
/** `meta.json`: the same facts, two-space JSON, final newline. */
export const renderMeta = (events: readonly JournalEvent[]) => `${JSON.stringify(deriveMeta(events), null, 2)}\n`

// ---------------------------------------------------------------- BOOK invariants: one thread folder

export interface ThreadFolder {
  /** Its path on `main`, from the weevbook's root. */
  path: string
  /** Every file under it, by path inside the folder (« events.jsonl », « raw/L1.claude.0001.jsonl »). */
  files: Record<string, Uint8Array>
}
const text = (b: Uint8Array | undefined) => (b ? Buffer.from(b).toString('utf8') : undefined)
const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex')
const RAW = /^raw\/(L[1-9]\d*)\.(claude|codex)\.(\d{4})\.jsonl$/
const clean = (s: string) => redactToolText(s, Infinity) === s
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) leaves(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out)
  return out
}

/** Every broken invariant of docs/spec/02-weevbook.md for one thread folder (BOOK-2 compares two versions: extendsJournal). */
export function validateFolder(folder: ThreadFolder): Violation[] {
  const out: Violation[] = []
  const bad = (invariant: string, info: string) => out.push({ invariant, info })
  const journal = text(folder.files['events.jsonl'])
  if (journal === undefined) return [{ invariant: 'BOOK-10', info: 'no events.jsonl' }]
  const { events, errors } = parseJournal(journal)
  out.push(...errors)

  if (folder.path !== threadFolder(events)) bad('BOOK-1', `expected ${threadFolder(events)}`)
  if (text(folder.files['thread.md']) !== renderThread(events)) bad('BOOK-3', 'thread.md differs from the journal')
  if (text(folder.files['meta.json']) !== renderMeta(events)) bad('BOOK-4', 'meta.json differs from the journal')

  const names = Object.keys(folder.files)
  const wanted = new Set(events.filter((e) => e.type === 'attachment').map((e) => attachmentFile(e)))
  for (const e of events) {
    if (e.type !== 'attachment') continue
    const file = folder.files[attachmentFile(e)]
    if (!file) bad('BOOK-5', `${attachmentFile(e)} is missing`)
    else if (sha256(file) !== e.sha256 || file.byteLength !== e.bytes) bad('BOOK-5', `${attachmentFile(e)} does not match its event`)
  }
  for (const n of names) if (n.startsWith('attachments/') && !wanted.has(n)) bad('BOOK-5', `${n} belongs to no event`)

  const started = new Map(events.filter((e) => e.type === 'leg.start').map((e) => [e.leg as string, parseEngine(e.engine)?.provider]))
  const segments = new Map<string, number[]>()
  for (const n of names.filter((x) => x.startsWith('raw/'))) {
    const m = RAW.exec(n)
    if (!m || started.get(m[1]) !== m[2]) {
      bad('BOOK-6', `${n} names no leg of this thread`)
      continue
    }
    segments.set(m[1], [...(segments.get(m[1]) ?? []), Number(m[3])])
    const body = text(folder.files[n]) ?? ''
    if (folder.files[n].byteLength > MAX_RAW_BYTES) bad('BOOK-6', `${n} is over 16 MiB`)
    for (const line of body.split('\n')) {
      if (!line) continue
      try {
        if (!leaves(JSON.parse(line)).every(clean)) bad('BOOK-9', `${n} holds something that looks like a secret`)
      } catch {
        bad('BOOK-6', `${n} has a line that is not JSON`)
      }
    }
    if (body && !body.endsWith('\n')) bad('BOOK-6', `${n} has no final newline`)
  }
  for (const [leg, ns] of segments) if (ns.sort((a, b) => a - b).some((n, i) => n !== i + 1)) bad('BOOK-6', `${leg} segments are not 0001, 0002, …`)

  const last = events.findLast((e) => e.type === 'handoff')
  const handoff = folder.files['handoff.md']
  if (!!last !== !!handoff) bad('BOOK-8', last ? 'handoff.md is missing' : 'handoff.md without a handoff event')
  else if (last && handoff) {
    if (sha256(handoff) !== last.sha256) bad('BOOK-8', 'handoff.md is not the one the journal recorded')
    if (Number(/^---\n[\s\S]*?^upTo: (\d+)$[\s\S]*?^---$/m.exec(text(handoff) ?? '')?.[1] ?? -1) !== last.upTo) bad('BOOK-8', 'handoff.md does not say the same upTo')
    if (!(text(handoff) ?? '').split('\n').every(clean)) bad('BOOK-9', 'handoff.md holds something that looks like a secret')
  }

  for (const e of events) if (!leaves(e).every(clean)) out.push({ invariant: 'BOOK-9', seq: e.seq, info: 'holds something that looks like a secret' })

  for (const n of names) {
    if (!['events.jsonl', 'thread.md', 'meta.json', 'handoff.md'].includes(n) && !n.startsWith('attachments/') && !n.startsWith('raw/')) bad('BOOK-10', `${n} is not a file of a thread`)
  }
  return out
}
