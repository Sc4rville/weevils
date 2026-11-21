// weevboss's request ledger: nothing the user asks is ever lost, and the work stays traceable.
//
//   - Capture: every message sent to weevboss lands in an inbox on disk at once, before any model runs.
//   - Reconcile: once the turn that answered it is over, Haiku splits the message into atomic requests (each with the
//     user's exact words, checked against the message), links them to the sessions the turn dispatched them to, to a
//     goal, and writes the trace (who got what, why, what they must report). A message Haiku cannot read after a few
//     tries becomes one request holding the whole message: still nothing lost.
//   - Close the loop: when a dispatched session stops, Haiku reads what it said since and the commits that landed
//     since the request was sent (server/ledger-evidence.ts: a session ships several requests in a few commits and
//     its last words are about something else). A commit that shows the request done closes it, the commit id in its
//     note; a session's word alone never does. Else the question or the failure is noted. A request at rest is read
//     again when a later commit speaks of it (a merge made after the session stopped). No progress for 24 h: stale.
//   - Every turn of weevboss gets a digest of fixed size (open requests, stale first, goals, the rules the user gave),
//     so it can never forget one, at a bounded cost.
//   - Knowledge: decisions, rules and project facts, deduplicated, never a secret, searchable with the log
//     (`weevils mem search`), each item pointing back to the message it came from (`weevils recall`).
//
// Files, all in ~/.local/share/weevils/boss: ledger.json (requests, goals, inbox; atomic writes), trace.jsonl
// (append-only journal of decisions, dispatches, reports and status changes), knowledge.json.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Session, SessionDetail } from '../shared/api.ts'
import type { Ask, Dispatch, Goal, Knowledge, KnowledgeKind, LedgerView, Outcome, TraceEntry } from '../shared/ledger.ts'
import { parseSigned } from './authors.ts'
import type { LandedCommit } from './ledger-evidence.ts'
import { shortId, tokensOf, type Entry } from './boss-view.ts'
import { looksSecret } from './memory.ts'
import { decide, speedMode } from './request-handling.ts'

// ---------------------------------------------------------------- types

export type { Ask, AskStatus, Dispatch, Goal, Knowledge, KnowledgeKind, Outcome, TraceEntry, TraceKind } from '../shared/ledger.ts'

export interface Inbox {
  /** Capture id. */
  cid: string
  at: number
  text: string
  from: string
  /** The weevboss turn that answers it. */
  turn?: string
  tries: number
  /** Not before this time (backoff after a failed read). */
  retryAt?: number
}

interface Store {
  v: 1
  next: { r: number; k: number }
  asks: Ask[]
  goals: Goal[]
  inbox: Inbox[]
  /** Turn ids already read, bounded (a backfill never reads a turn twice). */
  readTurns: string[]
  /** Hashes of recent captures with their time (a message retried by the outbox is captured once). */
  recent: Record<string, number>
  backfilled?: number
}

export type Model = (prompt: string, schema: object) => Promise<string>

export interface LedgerHost {
  /** Every session the app knows (all machines). */
  sessions(): Session[]
  detail(id: string): Promise<SessionDetail | undefined>
  /** The weevboss turn with this id is still running. */
  turnRunning(id: string): boolean
  /** The weevboss log (for search and the backfill). */
  journal(): Entry[]
  /** The language generated text is written in (the app's locale). */
  lang(): string
  user(): string
  /** What weevils remembers about the user (to name their goals on the first run). */
  memory?(): string
  /** Report-only judgements cannot close requests when proactive verification is available. */
  requiresVerification?(): boolean
  /** The commits that landed where this session's work ships, since a time (server/ledger-evidence.ts); none for a
   *  session of another machine or a folder that is not a repository. */
  commits?(s: Session, since: number): Promise<LandedCommit[]>
  /** Some of the lines one of those commits changed. */
  commitChanges?(s: Session, id: string): Promise<string>
}

// ---------------------------------------------------------------- small helpers

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
const DAY = 86400_000
export const STALE_MS = DAY
/** Messages of one author this close together are one burst: a twin request in it is merged. */
export const BURST_MS = 10 * 60_000
const LANG_NAMES: Record<string, string> = { en: 'English', fr: 'French' }
export const langName = (l: string) => LANG_NAMES[l] ?? l

/** Folded for matching: lower case, no accents, typographic quotes made plain. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”«»]/g, '"')

/** The quote, if it really is in the message (spacing and accents aside); else the message's start. Exported for tests. */
export function verbatim(quote: string, message: string): string {
  const q = oneLine(quote).replace(/^["'«“\s]+|["'»”\s.…]+$/g, '')
  const m = oneLine(message)
  if (q.length >= 2) {
    const at = fold(m).indexOf(fold(q))
    // fold keeps the length of NFC text in most cases; when it does, return the original slice (its own accents).
    if (at >= 0) return fold(m).length === m.length ? m.slice(at, at + q.length) : q
  }
  return clip(m, 300)
}

// i18n-ignore : stop words for search (never shown)
const STOP = new Set(`the a an and or of to in on for with is are be it this that what how why when where who do does did i you me my your we our at by from as not no yes
le la les un une des du de et ou a au aux en dans sur pour par avec est sont ce cet cette ces que qui quoi comment pourquoi quand ou je tu il elle nous vous on mon ma mes ton ta tes son sa ses pas ne ca c j t l d qu y`.split(/\s+/))
export const terms = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !STOP.has(w))

/** Two texts say the same thing (word overlap). */
export function similar(a: string, b: string, at = 0.72): boolean {
  const x = new Set(terms(a))
  const y = new Set(terms(b))
  if (!x.size || !y.size) return fold(oneLine(a)) === fold(oneLine(b))
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size) >= 0.9 || both / (x.size + y.size - both) >= at
}

/** A word without its ending, so « buttons » meets « button » and « removed » meets « remove ». */
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w)
const stems = (s: string) => new Set(terms(s).filter((w) => w.length >= 3).map(stem))
/** What a commit says, as words: its message and the names of the files it touched. */
const commitWords = (c: LandedCommit) => stems(`${c.subject} ${c.body} ${c.files.join(' ')}`)

/**
 * How much of a request each commit of a list speaks of, from 0 to 1: the share of the request's words found in the
 * commit, a rare word weighing more than one every commit holds (the project's name, « fix »). `hits`: how many words
 * met. A filter before the model reads, never a verdict. Exported for tests.
 */
export function relevance(all: LandedCommit[]): (request: string, c: LandedCommit) => { share: number; hits: number } {
  const bags = new Map(all.map((c) => [c, commitWords(c)]))
  const df = new Map<string, number>()
  for (const b of bags.values()) for (const w of b) df.set(w, (df.get(w) ?? 0) + 1)
  const weight = (w: string) => Math.log(1 + all.length / (1 + (df.get(w) ?? 0)))
  const asked = new Map<string, string[]>()
  return (request, c) => {
    const want = asked.get(request) ?? [...stems(request)]
    asked.set(request, want)
    const bag = bags.get(c) ?? commitWords(c)
    let got = 0
    let total = 0
    let hits = 0
    for (const w of want) {
      total += weight(w)
      if (bag.has(w)) { got += weight(w); hits++ }
    }
    return { share: total ? got / total : 0, hits }
  }
}
/** A commit speaks of a request enough to read the request again. */
const speaksOf = (r: { share: number; hits: number }) => r.hits >= 2 && r.share >= 0.4

function atomicWrite(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w', 0o600)
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (e) {
    // A file that exists but does not parse is kept aside, never overwritten silently.
    if (fs.existsSync(file)) {
      const aside = `${file}.broken-${Date.now()}`
      try { fs.copyFileSync(file, aside) } catch { /* nothing more to do */ }
      console.error(`[ledger] ${path.basename(file)} unreadable, kept as ${path.basename(aside)}: ${(e as Error).message}`)
    }
    return fallback
  }
}

const hhmm = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const age = (ms: number) => (ms >= DAY ? `${Math.floor(ms / DAY)}d` : ms >= 3600_000 ? `${Math.floor(ms / 3600_000)}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`)

// ---------------------------------------------------------------- what a turn did

export interface TurnAction {
  kind: 'send' | 'new' | 'resume' | 'ledger'
  /** Session id (full when known, else the prefix that was typed). */
  session?: string
  project?: string
  brief?: string
  command: string
}
export interface TurnRead {
  /** Id of the user's message in the transcript (journal id). */
  src?: string
  reply: string
  actions: TurnAction[]
}

/** The brief in a weevils send/new argument: quotes and heredoc wrappers peeled. */
function briefOf(rest: string): string {
  let s = rest.trim()
  const heredoc = /<<-?\s*'?"?(\w+)'?"?\s*\n([\s\S]*?)\n\s*\1\b/.exec(s)
  if (heredoc) s = heredoc[2]
  else {
    const q = /^(["'])([\s\S]*?)\1/.exec(s)
    if (q) s = q[2]
    else s = s.replace(/^\$\(\s*cat\s*/, '')
  }
  return clip(oneLine(s.replace(/\\"/g, '"').replace(/\\n/g, ' ')), 600)
}

/** The weevils commands in one shell command (several can be chained). Exported for tests. */
export function actionsOf(command: string, result = ''): TurnAction[] {
  const out: TurnAction[] = []
  const re = /\bweevils\s+(send|new|resume|ask|goal)\s+/g
  const hits = [...command.matchAll(re)]
  hits.forEach((m, i) => {
    const rest = command.slice(m.index! + m[0].length, hits[i + 1]?.index ?? command.length)
    const verb = m[1]
    if (verb === 'send' || verb === 'resume') {
      const target = /^["']?([0-9a-f][0-9a-f-]{5,})/i.exec(rest)?.[1]
      if (target) out.push({ kind: verb, session: target.toLowerCase(), brief: verb === 'send' ? briefOf(rest.slice(target.length + 1)) : undefined, command: clip(oneLine(command), 300) })
    } else if (verb === 'new') {
      const project = /^["']?([\w.-]+)/.exec(rest)?.[1]
      const made = /(?:new session|nouvelle session)\s+([0-9a-f]{8})/i.exec(result)?.[1]
      if (project) out.push({ kind: 'new', project, session: made, brief: briefOf(rest.slice(project.length + 1)), command: clip(oneLine(command), 300) })
    } else out.push({ kind: 'ledger', command: clip(oneLine(command), 300) })
  })
  return out
}

/** What one weevboss turn did, from its transcript. */
export function readTurn(file: string): TurnRead {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { reply: '', actions: [] } }
  let src: string | undefined
  const replies: string[] = []
  const calls: { id: string; command: string }[] = []
  const results = new Map<string, string>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (o.isSidechain) continue
    const content = o.message?.content
    if (o.type === 'user') {
      if (!src && (typeof content === 'string' || (Array.isArray(content) && content.some((p: any) => p?.type === 'text')))) src = o.uuid
      if (Array.isArray(content)) for (const p of content) {
        if (p?.type !== 'tool_result') continue
        const text = typeof p.content === 'string' ? p.content : Array.isArray(p.content) ? p.content.map((c: any) => c?.text ?? '').join('\n') : ''
        results.set(p.tool_use_id, text)
      }
    } else if (o.type === 'assistant' && Array.isArray(content)) {
      for (const p of content) {
        if (p?.type === 'text' && p.text?.trim()) replies.push(p.text.trim())
        else if (p?.type === 'tool_use' && typeof p.input?.command === 'string') calls.push({ id: p.id, command: p.input.command })
      }
    }
  }
  const actions = calls.flatMap((c) => actionsOf(c.command, results.get(c.id) ?? ''))
  return { src, reply: replies.join('\n\n'), actions }
}

// ---------------------------------------------------------------- the model's answers

/** A request's short title as the model wrote it: one line, 60 characters at most, no final punctuation. */
export const askTitle = (t: string | undefined) => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim().replace(/[.:;,!…]+$/, '')
  return s ? clip(s, 60) : undefined
}
const str = { type: 'string' }
const strs = { type: 'array', items: str }
export const RECONCILE_SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          m: str,
          requests: {
            type: 'array',
            items: {
              type: 'object',
              properties: { quote: str, text: str, title: str, kind: { type: 'string', enum: ['task', 'question'] }, state: { type: 'string', enum: ['open', 'dispatched', 'done'] }, sessions: strs, goal: str, expect: str, merge_into: str },
              required: ['quote', 'text', 'title', 'kind', 'state', 'sessions', 'goal'],
            },
          },
          updates: {
            type: 'array',
            items: { type: 'object', properties: { id: str, status: { type: 'string', enum: ['', 'done', 'dropped', 'dispatched'] }, sessions: strs, note: str }, required: ['id', 'status'] },
          },
          memory: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['rule', 'decision', 'fact'] }, text: str }, required: ['kind', 'text'] } },
          trace: { type: 'array', items: { type: 'object', properties: { session: str, text: str, why: str, expect: str }, required: ['text'] } },
        },
        required: ['m', 'requests', 'updates', 'memory', 'trace'],
      },
    },
    new_goals: { type: 'array', items: { type: 'object', properties: { id: str, title: str, why: str }, required: ['id', 'title'] } },
  },
  required: ['messages', 'new_goals'],
}

interface Reconciled {
  messages: {
    m: string
    requests: { quote: string; text: string; title?: string; kind: 'task' | 'question'; state: 'open' | 'dispatched' | 'done'; sessions: string[]; goal: string; expect?: string; merge_into?: string }[]
    updates: { id: string; status: '' | 'done' | 'dropped' | 'dispatched'; sessions?: string[]; note?: string }[]
    memory: { kind: KnowledgeKind; text: string }[]
    trace: { session?: string; text: string; why?: string; expect?: string }[]
  }[]
  new_goals: { id: string; title: string; why?: string }[]
}

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { n: { type: 'number' }, outcome: { type: 'string', enum: ['done', 'question', 'failed', 'progress'] }, report: str, commit: str }, required: ['n', 'outcome', 'report', 'commit'] } } },
  required: ['items'],
}

/** One message to read, with what the turn that answered it did. */
export interface MessageToRead {
  key: string
  src: string
  at: number
  from: string
  text: string
  reply: string
  actions: TurnAction[]
}

// ---------------------------------------------------------------- the ledger

export interface LedgerOptions {
  dir: string
  model: Model
  host: LedgerHost
  /** Size of the digest each turn receives, in tokens. */
  budget?: number
  now?: () => number
}

export class Ledger {
  readonly dir: string
  readonly budget: number
  private readonly file: string
  private readonly traceFile: string
  private readonly knowFile: string
  private s: Store
  private know: { items: Knowledge[] }
  private readonly model: Model
  private readonly host: LedgerHost
  private readonly now: () => number
  private busy = false
  private judging = false
  private listeners = new Set<() => void>()

  constructor(o: LedgerOptions) {
    this.dir = o.dir
    this.model = o.model
    this.host = o.host
    this.budget = o.budget ?? 1800
    this.now = o.now ?? Date.now
    this.file = path.join(o.dir, 'ledger.json')
    this.traceFile = path.join(o.dir, 'trace.jsonl')
    this.knowFile = path.join(o.dir, 'knowledge.json')
    const empty: Store = { v: 1, next: { r: 1, k: 1 }, asks: [], goals: [], inbox: [], readTurns: [], recent: {} }
    this.s = { ...empty, ...readJson<Partial<Store>>(this.file, {}) }
    this.s.next = { ...empty.next, ...this.s.next }
    this.know = { items: [], ...readJson<{ items?: Knowledge[] }>(this.knowFile, {}) } as { items: Knowledge[] }
  }

  /** The ledger existed before this run (else a backfill is due). */
  get fresh() { return !fs.existsSync(this.file) }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private save() {
    this.s.readTurns = this.s.readTurns.slice(-4000)
    const t = this.now()
    for (const [k, at] of Object.entries(this.s.recent)) if (t - at > 3600_000) delete this.s.recent[k]
    atomicWrite(this.file, JSON.stringify(this.s, null, 1))
    for (const fn of this.listeners) fn()
  }
  private saveKnow() {
    atomicWrite(this.knowFile, JSON.stringify(this.know, null, 1))
  }

  trace(e: Omit<TraceEntry, 'at'> & { at?: number }) {
    const entry: TraceEntry = { at: e.at ?? this.now(), ...e }
    fs.mkdirSync(this.dir, { recursive: true })
    fs.appendFileSync(this.traceFile, JSON.stringify(entry) + '\n')
  }

  // ------------------------------------------------ capture

  /** A message for weevboss, kept on disk before anything else. Returns its capture id (the same for a retry). */
  capture(raw: string, from = 'user'): string | null {
    const signed = parseSigned(raw)
    const text = (signed ? signed.text : raw).trim()
    if (!text) return null
    const author = signed?.author ?? from
    const key = sha(`${author}\0${oneLine(text)}`)
    const known = this.s.inbox.find((m) => sha(`${m.from}\0${oneLine(m.text)}`) === key)
    if (known) return known.cid
    if (this.s.recent[key] && this.now() - this.s.recent[key] < 30 * 60_000) return null
    const cid = `c${crypto.randomBytes(4).toString('hex')}`
    this.s.inbox.push({ cid, at: this.now(), text: clip(text, 12000), from: author, tries: 0 })
    this.s.recent[key] = this.now()
    this.save()
    return cid
  }

  /** The turn that answers a captured message (its transcript says what was dispatched). */
  attach(cid: string, turn: string) {
    const m = this.s.inbox.find((x) => x.cid === cid)
    if (!m) return
    m.turn = turn
    this.save()
  }

  // ------------------------------------------------ reading

  asks(filter: 'open' | 'all' | 'stale' | 'done' = 'open'): Ask[] {
    const t = this.now()
    const live = (a: Ask) => a.status === 'open' || a.status === 'dispatched'
    const list = this.s.asks.filter((a) => filter === 'all' || (filter === 'done' ? !live(a) : live(a) && (filter !== 'stale' || this.stale(a, t))))
    return [...list].sort((a, b) => b.at - a.at)
  }
  ask(id: string): Ask | undefined {
    const want = id.trim().toLowerCase().replace(/^#/, '')
    return this.s.asks.find((a) => a.id === want || a.id === `r${want}`)
  }
  stale(a: Ask, t = this.now()) {
    return (a.status === 'open' || a.status === 'dispatched') && t - a.progressAt > STALE_MS
  }
  get openCount() { return this.s.asks.filter((a) => a.status === 'open' || a.status === 'dispatched').length }
  get pending(): readonly Inbox[] { return this.s.inbox }
  goals(all = false): Goal[] {
    return this.s.goals.filter((g) => all || g.status !== 'done')
  }
  goal(id: string): Goal | undefined {
    const want = id.trim().toLowerCase()
    return this.s.goals.find((g) => g.id === want)
  }
  goalStats(id: string) {
    const list = this.s.asks.filter((a) => a.goal === id)
    const done = list.filter((a) => a.status === 'done').length
    const dropped = list.filter((a) => a.status === 'dropped').length
    const stale = list.filter((a) => this.stale(a)).length
    return { total: list.length - dropped, done, open: list.length - done - dropped, stale, sessions: [...new Set(list.flatMap((a) => a.dispatches.map((d) => d.session)))] }
  }
  traceList(o: { goal?: string; n?: number; since?: number } = {}): TraceEntry[] {
    let raw = ''
    try { raw = fs.readFileSync(this.traceFile, 'utf8') } catch { return [] }
    const out: TraceEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        const e = JSON.parse(line) as TraceEntry
        if (o.goal && e.goal !== o.goal) continue
        if (o.since && e.at < o.since) continue
        out.push(e)
      } catch { /* a torn last line */ }
    }
    return out.slice(-(o.n ?? 200))
  }

  // ------------------------------------------------ changes by weevboss or the user

  private nextAsk() { return `r${this.s.next.r++}` }

  /** Every exact word the user said for a request (its first message and the ones merged into it). */
  static words(a: Ask) { return [a.quote, ...(a.more ?? []).map((m) => m.quote)].join(' · ') }

  /** Answered, sent, to send now or queued (and why), from its state, the user's words and the speed mode. */
  private rehandle(a: Ask) {
    if (a.status === 'dropped') return
    const d = decide({ state: a.status === 'done' ? (a.handling === 'sent' || a.dispatches.length ? 'dispatched' : 'done') : a.status, kind: a.kind, words: Ledger.words(a), mode: speedMode() })
    a.handling = d.handling
    a.why = d.why
  }

  /** A follow-up or a correction folded into an open request: its words kept, never a near-duplicate. */
  private merge(a: Ask, m: { src: string; quote: string; at: number; from: string }, text?: string) {
    const more = (a.more ??= [])
    if (a.src === m.src && fold(a.quote) === fold(m.quote)) return
    if (!more.some((x) => x.src === m.src && fold(x.quote) === fold(m.quote))) more.push({ src: m.src, quote: clip(oneLine(m.quote), 600), at: m.at, from: m.from })
    if (text && oneLine(text)) a.text = clip(oneLine(text), 400)
    a.progressAt = Math.max(a.progressAt, m.at)
  }

  add(text: string, o: { goal?: string; quote?: string; src?: string; from?: string; kind?: 'task' | 'question' } = {}): Ask {
    const t = oneLine(text)
    if (!t) throw new Error('empty request') // i18n-ignore : API guard, the CLI checks first
    const now = this.now()
    const a: Ask = { id: this.nextAsk(), text: clip(t, 400), quote: clip(oneLine(o.quote ?? t), 600), src: o.src ?? '', from: o.from ?? 'user', at: now, kind: o.kind ?? 'task', status: 'open', dispatches: [], progressAt: now }
    if (o.goal && this.goal(o.goal)) a.goal = this.goal(o.goal)!.id
    this.rehandle(a)
    this.s.asks.push(a)
    this.trace({ kind: 'request', text: a.text, asks: [a.id], goal: a.goal, src: a.src })
    this.save()
    return a
  }

  /** done | drop | open: closes or reopens a request. */
  setStatus(id: string, status: 'done' | 'dropped' | 'open', by: 'user' | 'weevboss' | 'auto', note?: string): Ask {
    const a = this.ask(id)
    if (!a) throw new Error(`no such request: ${id}`) // i18n-ignore : read by weevboss through the CLI
    const now = this.now()
    a.status = status === 'open' ? (a.dispatches.length ? 'dispatched' : 'open') : status
    if (status === 'open') { delete a.closedAt; delete a.closedBy } else { a.closedAt = now; a.closedBy = by }
    if (note) a.note = clip(oneLine(note), 400)
    a.progressAt = now
    if (status === 'open') this.rehandle(a)
    this.trace({ kind: 'status', status, text: note ? oneLine(note) : a.text, asks: [a.id], goal: a.goal, who: by })
    this.save()
    return a
  }

  link(id: string, session: string, expect?: string, brief?: string): Ask {
    const a = this.ask(id)
    if (!a) throw new Error(`no such request: ${id}`) // i18n-ignore : read by weevboss through the CLI
    const s = this.resolve(session)
    const sid = s?.id ?? session
    if (!a.dispatches.some((d) => d.session === sid)) {
      a.dispatches.push({ session: sid, label: s ? this.label(s) : undefined, at: this.now(), expect: expect ? clip(oneLine(expect), 300) : undefined, brief: brief ? clip(oneLine(brief), 600) : undefined })
    }
    if (a.status === 'open') a.status = 'dispatched'
    a.progressAt = this.now()
    this.rehandle(a)
    this.trace({ kind: 'dispatch', text: a.text, asks: [a.id], goal: a.goal, session: sid, who: s ? this.label(s) : sid.slice(0, 8), expect })
    this.save()
    return a
  }

  setGoalOf(id: string, goal: string): Ask {
    const a = this.ask(id)
    const g = this.goal(goal)
    if (!a || !g) throw new Error(`no such request or goal: ${id} ${goal}`) // i18n-ignore : read by weevboss through the CLI
    a.goal = g.id
    this.save()
    return a
  }

  addGoal(id: string, title: string, why?: string): Goal {
    const slug = fold(id).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
    if (!slug || !oneLine(title)) throw new Error('a goal needs an id and a title') // i18n-ignore : read by weevboss through the CLI
    const known = this.goal(slug)
    if (known) {
      known.title = clip(oneLine(title), 160)
      if (why) known.why = clip(oneLine(why), 400)
      this.save()
      return known
    }
    const g: Goal = { id: slug, title: clip(oneLine(title), 160), status: 'active', at: this.now(), ...(why ? { why: clip(oneLine(why), 400) } : {}) }
    this.s.goals.push(g)
    this.trace({ kind: 'goal', text: g.title, goal: g.id, why })
    this.save()
    return g
  }

  goalNote(id: string, text: string): Goal {
    const g = this.goal(id)
    if (!g) throw new Error(`no such goal: ${id}`) // i18n-ignore : read by weevboss through the CLI
    g.progress = clip(oneLine(text), 400)
    g.progressAt = this.now()
    this.trace({ kind: 'decision', text: g.progress, goal: g.id })
    this.save()
    return g
  }

  setGoalStatus(id: string, status: Goal['status']): Goal {
    const g = this.goal(id)
    if (!g) throw new Error(`no such goal: ${id}`) // i18n-ignore : read by weevboss through the CLI
    g.status = status
    this.trace({ kind: 'goal', status, text: g.title, goal: g.id })
    this.save()
    return g
  }

  decide(text: string, goal?: string, why?: string) {
    const t = oneLine(text)
    if (!t) throw new Error('empty decision') // i18n-ignore : read by weevboss through the CLI
    this.trace({ kind: 'decision', text: clip(t, 500), goal: goal && this.goal(goal) ? this.goal(goal)!.id : undefined, why })
    for (const fn of this.listeners) fn()
  }

  // ------------------------------------------------ knowledge

  knowledge(): Knowledge[] {
    return [...this.know.items].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Kept once: a text that says the same thing as an existing item refreshes it. Secrets are refused. */
  remember(kind: KnowledgeKind, text: string, src?: string, goal?: string): Knowledge {
    const t = clip(oneLine(text), 400)
    if (!t) throw new Error('empty memory') // i18n-ignore : read by weevboss through the CLI
    if (looksSecret(t)) throw new Error('looks like a secret: not kept') // i18n-ignore : read by weevboss through the CLI
    const now = this.now()
    const same = this.know.items.find((k) => similar(k.text, t))
    if (same) {
      if (t.length >= same.text.length * 0.8) same.text = t
      if (kind === 'rule' || same.kind !== 'rule') same.kind = kind
      same.updatedAt = now
      same.seen++
      if (src && !same.src.includes(src)) same.src = [...same.src, src].slice(-6)
      this.saveKnow()
      return same
    }
    const k: Knowledge = { id: `k${this.s.next.k++}`, kind, text: t, at: now, updatedAt: now, src: src ? [src] : [], seen: 1, ...(goal ? { goal } : {}) }
    this.know.items.push(k)
    this.saveKnow()
    this.save()
    return k
  }

  forget(id: string): boolean {
    const n = this.know.items.length
    this.know.items = this.know.items.filter((k) => k.id !== id.trim().toLowerCase())
    if (this.know.items.length === n) return false
    this.saveKnow()
    return true
  }

  /** Knowledge first, then the requests, then the log itself: each hit carries an id that leads back (weevils recall). */
  search(q: string, max = 8): { knowledge: (Knowledge & { score: number })[]; asks: (Ask & { score: number })[]; log: { id: string; at: number; role: string; text: string; score: number }[] } {
    const want = [...new Set(terms(q))]
    if (!want.length) return { knowledge: [], asks: [], log: [] }
    const journal = this.host.journal().filter((e) => e.role === 'user' || e.role === 'agent' || e.role === 'assistant')
    const docs = journal.length + this.know.items.length + this.s.asks.length || 1
    const df = new Map<string, number>()
    const bag = (s: string) => new Set(terms(s))
    const bags = { j: journal.map((e) => bag(e.text)), k: this.know.items.map((k) => bag(k.text)), a: this.s.asks.map((a) => bag(`${a.text} ${a.quote}`)) }
    const has = (b: Set<string>, w: string) => b.has(w) || (w.length >= 4 && [...b].some((x) => x.startsWith(w)))
    for (const w of want) df.set(w, [...bags.j, ...bags.k, ...bags.a].filter((b) => has(b, w)).length)
    const score = (b: Set<string>) => {
      let s = 0
      let hit = 0
      for (const w of want) if (has(b, w)) { s += Math.log(1 + docs / (1 + df.get(w)!)); hit++ }
      return hit ? s * (hit / want.length) : 0
    }
    const top = <T>(list: T[], b: Set<string>[], n: number) => list.map((x, i) => ({ ...x, score: score(b[i]) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n)
    return {
      knowledge: top(this.know.items, bags.k, max),
      asks: top(this.s.asks, bags.a, Math.ceil(max / 2)),
      log: top(journal, bags.j, Math.ceil(max / 2)).map((e) => ({ id: shortId(e.id), at: e.at, role: e.role === 'assistant' ? 'weevboss' : e.role === 'agent' ? (e.author ?? 'agent') : 'user', text: clip(oneLine(e.text), 240), score: e.score })),
    }
  }

  // ------------------------------------------------ the digest each turn reads

  /** Open requests (stale first), goals and the user's rules, within a fixed budget of tokens. */
  digest(budget = this.budget, except?: string): string {
    const t = this.now()
    const chars = Math.floor(budget * 3.2)
    const out: string[] = []
    let used = 0
    const put = (line: string) => {
      if (used + line.length + 1 > chars) return false
      out.push(line)
      used += line.length + 1
      return true
    }
    const live = this.asks('open')
    const stale = live.filter((a) => this.stale(a, t)).sort((a, b) => a.progressAt - b.progressAt)
    const fresh = live.filter((a) => !this.stale(a, t))
    const line = (a: Ask) => {
      const d = a.dispatches.at(-1)
      const where = d ? `→ ${d.session.slice(0, 8)}${d.label ? ` ${clip(d.label, 40)}` : ''}${d.outcome && d.outcome !== 'done' ? ` (${d.outcome})` : ''}` : 'open'
      const note = a.note ? ` · ${clip(a.note, 90)}` : ''
      const how = a.status === 'open' && a.handling === 'send' ? ` · SEND NOW (${a.why})` : a.status === 'open' && a.handling === 'queued' ? ` · queued (${a.why})` : ''
      const merged = a.more?.length ? ` · ${a.more.length + 1} messages` : ''
      return `- ${a.id} [${where}${how}${merged}${a.goal ? ` · ${a.goal}` : ''} · ${age(t - a.at)}] ${clip(a.text, 150)}${note}`
    }
    // Goals and rules have a reserved share; requests take the rest (they are the point).
    const goalShare = Math.floor(chars * 0.18)
    const ruleShare = Math.floor(chars * 0.17)
    const reqChars = chars - goalShare - ruleShare
    put(`## Open requests (${live.length} open${stale.length ? `, ${stale.length} stale` : ''}) — never drop one silently: weevils asks · weevils ask done|drop <id> · weevils ask link <id> <session> · speed mode ${speedMode()}: the user's own timing wins (now → send, later → keep queued), else pause/veille queue · cruise keeps ongoing work going · turbo/max send at once`)
    const pending = this.s.inbox.filter((m) => m.cid !== except)
    let shown = 0
    for (const a of [...stale.map((x) => ({ x, s: true })), ...fresh.map((x) => ({ x, s: false }))]) {
      const l = (a.s ? `- STALE ${age(t - a.x.progressAt)} no progress:` + line(a.x).slice(1) : line(a.x))
      if (used + l.length > reqChars) break
      put(l)
      shown++
    }
    if (shown < live.length) put(`- …${live.length - shown} more: weevils asks`)
    if (pending.length) {
      const p = pending.slice(-3).map((m) => `"${clip(oneLine(m.text), 110)}" (${hhmm(m.at)})`).join(' · ')
      put(`- not split into requests yet (${pending.length}): ${p}`)
    }
    const goals = this.goals().filter((g) => g.status === 'active')
    if (goals.length) {
      const room = used + goalShare
      put('## Goals (weevils goals)')
      for (const g of goals) {
        const st = this.goalStats(g.id)
        const l = `- ${g.id}: ${clip(g.title, 70)} · ${st.done}/${st.total} done${st.stale ? `, ${st.stale} stale` : ''}${g.progress ? ` · ${clip(g.progress, 80)}` : ''}`
        if (used + l.length > room) break
        put(l)
      }
    }
    const rules = this.knowledge().filter((k) => k.kind === 'rule')
    if (rules.length) {
      put('## Rules the user gave (weevils mem search <words> for decisions and facts)')
      for (const k of rules) if (!put(`- ${clip(k.text, 160)}`)) break
    }
    return out.join('\n')
  }

  // ------------------------------------------------ reconcile: messages → requests

  private resolve(prefix: string): Session | undefined {
    const p = prefix.toLowerCase()
    const hits = this.host.sessions().filter((s) => s.id.toLowerCase().startsWith(p))
    return hits.length === 1 ? hits[0] : undefined
  }
  private label(s: Session) {
    return clip(`${s.projectId} · ${s.tool} · ${s.title}`, 90)
  }

  /** Messages whose turn is over (or that never got one), ready to be read. */
  private ready(): Inbox[] {
    const t = this.now()
    return this.s.inbox.filter((m) => {
      if (m.retryAt && m.retryAt > t) return false
      if (m.turn) return !this.host.turnRunning(m.turn) || t - m.at > 30 * 60_000
      return t - m.at > 3 * 60_000
    })
  }

  /** Reads what is ready: called after each turn and on a timer. */
  async reconcile(transcripts: string): Promise<number> {
    if (this.busy) return 0
    const batch = this.ready().slice(0, 6)
    if (!batch.length) {
      await this.titleAsks()
      return 0
    }
    this.busy = true
    try {
      const msgs: MessageToRead[] = batch.map((m) => {
        const turn = m.turn ? readTurn(path.join(transcripts, `${m.turn}.jsonl`)) : { reply: '', actions: [] }
        return { key: m.cid, src: turn.src ?? m.cid, at: m.at, from: m.from, text: m.text, reply: turn.reply, actions: turn.actions }
      })
      const ok = await this.read(msgs)
      const t = this.now()
      if (ok) {
        this.s.inbox = this.s.inbox.filter((m) => !batch.includes(m))
        for (const m of batch) if (m.turn) this.s.readTurns.push(m.turn)
      } else {
        for (const m of batch) {
          m.tries++
          m.retryAt = t + Math.min(60, 2 ** m.tries) * 60_000
          if (m.tries >= 5) {
            // Haiku can't read it: the whole message becomes one request. Nothing is lost.
            const a = this.add(clip(oneLine(m.text), 300), { quote: m.text, src: m.cid, from: m.from })
            a.note = 'kept whole: could not be split automatically'
            this.s.inbox = this.s.inbox.filter((x) => x !== m)
          }
        }
      }
      this.save()
      return ok ? batch.length : 0
    } finally {
      this.busy = false
    }
  }

  private prompt(msgs: MessageToRead[]): string {
    const user = this.host.user()
    const lang = langName(this.host.lang())
    const goals = this.goals().map((g) => `- ${g.id}: ${g.title}`).join('\n') || '(none yet)'
    const open = this.asks('open').slice(0, 60).map((a) => `- ${a.id} [${a.dispatches.length ? `sent to ${a.dispatches.map((d) => d.session.slice(0, 8)).join(', ')}` : 'open'}] ${clip(a.text, 160)}`).join('\n') || '(none)'
    const sessionLine = (a: TurnAction) => {
      const s = a.session ? this.resolve(a.session) : undefined
      const who = s ? `${s.id.slice(0, 8)} (${this.label(s)})` : a.session ? a.session.slice(0, 8) : '?'
      return a.kind === 'send' ? `- sent to session ${who}: ${clip(a.brief ?? '', 450)}`
        : a.kind === 'new' ? `- opened new session ${who} in project ${a.project}: ${clip(a.brief ?? '', 450)}`
        : a.kind === 'resume' ? `- resumed session ${who}`
        : `- ledger command: ${clip(a.command, 160)}`
    }
    const blocks = msgs.map((m, i) => [
      `### M${i + 1} · ${hhmm(m.at)} · ${m.from === 'user' ? user : `agent ${m.from}`}`,
      clip(m.text, 5000),
      m.reply ? `weevboss replied: ${clip(oneLine(m.reply), 1200)}` : 'weevboss replied: (nothing recorded)',
      m.actions.length ? `Actions of that turn:\n${m.actions.map(sessionLine).join('\n')}` : 'Actions of that turn: none',
    ].join('\n'))
    return `You keep the request ledger of weevboss, the assistant that dispatches ${user}'s work to coding sessions. ${user} dictates fast, without punctuation; one message often holds 3 to 5 separate asks. Nothing they ask may ever be lost.

For each message below, list every distinct request it contains (something ${user} wants done, changed, made, checked, sent or answered):
- One request per distinct ask: "do X and also Y, then send Z to W" is three requests. Merge only true repeats inside one message.
- ${user} often sends several messages in a burst about one thing: a follow-up, a correction, a precision ("desktop", "on mobile", "and the colour too", "no, the other button"), often in French. Such a message does NOT make a new request: give it "merge_into" = the id of the request it refines (an open request below, or "M<k>.<n>" from an earlier message of this batch), its own "quote", and as "text" the refined request restated whole. Same for a later message that clearly refines an open request. Never merge two different asks, even about the same project: when unsure, make a new request. Else "merge_into" is "".
- "quote": the exact words of the message that carry this request, copied character for character (one contiguous excerpt, 3 to 40 words). Never paraphrase it, never translate it.
- "text": the request as one short sentence in ${lang}, complete enough to understand alone (name the project or the thing). An imperative for a task, a question for a question.
- "title": the request as a short title in ${lang}, 2 to 5 words, naming the thing like a heading ("Onboarding via weevboss", "For you feed overhaul"); never a cut sentence, no final punctuation.
- "kind": "question" when ${user} only wants an answer or an explanation; "task" when something must be done.
- "state": "done" when weevboss's reply already answered the question or the turn itself fully did it; "dispatched" when the turn's actions sent it to a session (put their ids in "sessions", 8 characters); else "open".
- "goal": the id of the goal it clearly moves forward (list below, or one of your new_goals), else "". A question about how something works, a bug in the app, an account or billing matter: "" unless it plainly serves that goal.
- "expect": for a dispatched request, what the session must report back, in ${lang}; else "".
- No request for acknowledgements, thanks, emotions, small talk or a bare "ok", "go", "yes". A short answer to a question weevboss asked ("opus at medium", "yes do it") is a request only when it asks for something; when it confirms an open request, put it in "updates".
- A message from an agent: a request it relays from ${user} counts; a report about an open request goes in "updates".
"updates": open requests (list below, or one you listed for an earlier message of this batch: id "M<k>.<n>" = the n-th request of message Mk) that this message or its turn changes: done (${user} or an agent says it is finished, or the turn finished it), dropped (ONLY when ${user} explicitly says to drop, cancel or forget it), dispatched (the turn sent it to sessions: their ids), or "" with a "note" for progress. A later turn of this batch that sends an earlier request to a session is a "dispatched" update with its sessions. Never invent. Notes never mention M1, M2…
"memory": durable things worth keeping beyond this task: a rule ${user} gives about how to work ("never…", "always…", "stop doing…"), a decision ${user} makes, a lasting project fact. One sentence each, third person, in ${lang}, no secret, no relative date. Usually empty.
"trace": one line per session the turn sent work to: "session" (8 characters), "text" = what was asked of it in plain words, "why" = the need of ${user}'s it serves, "expect" = what it must report back; in ${lang}.
"new_goals": only for a broad, durable objective ${user} states that is not in the list (e.g. "make weevils blow up"): "id" a short lowercase slug, "title", "why".
Answer for every message, in order, with "m" = M1, M2…

Goals:
${goals}

Open requests:
${open}

Messages (oldest first):

${blocks.join('\n\n')}`
  }

  /** Reads messages with the model and applies what it found. false: the model failed (the caller retries). */
  async read(msgs: MessageToRead[]): Promise<boolean> {
    let r: Reconciled
    try {
      const raw = await this.model(this.prompt(msgs), RECONCILE_SCHEMA)
      r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Reconciled
      if (!Array.isArray(r?.messages)) throw new Error('no messages in the answer') // i18n-ignore : log only
    } catch (e) {
      console.error(`[ledger] read failed: ${(e as Error).message.slice(0, 200)}`)
      return false
    }
    this.apply(msgs, r)
    return true
  }

  private apply(msgs: MessageToRead[], r: Reconciled) {
    const now = this.now()
    const made = new Map<string, Ask>()
    const noM = (t: string) => t.replace(/\(?\bM\d+(?:\.\d+)?\b\)?:?\s*/g, '').trim()
    for (const g of r.new_goals ?? []) if (g?.id && g.title && !this.goal(g.id)) this.addGoal(g.id, g.title, g.why)
    const goalOk = (id?: string) => (id && this.goal(id) ? this.goal(id)!.id : undefined)
    msgs.forEach((m, i) => {
      const got = r.messages.find((x) => x.m === `M${i + 1}`) ?? r.messages[i]
      // A brief that names an open request « (r12) » dispatches it, whatever the model saw.
      for (const act of m.actions) {
        if (!act.session || !act.brief) continue
        for (const [, n] of act.brief.matchAll(/\br(\d{1,5})\b/g)) {
          const a = this.ask(`r${n}`)
          if (!a || a.status === 'done' || a.status === 'dropped') continue
          const s = this.resolve(act.session)
          const sid = s?.id ?? act.session
          if (a.dispatches.some((d) => d.session === sid)) continue
          a.dispatches.push({ session: sid, label: s ? this.label(s) : act.project, at: m.at, brief: act.brief })
          a.status = 'dispatched'
          a.progressAt = Math.max(a.progressAt, m.at)
          this.rehandle(a)
          this.trace({ at: m.at, kind: 'dispatch', text: a.text, asks: [a.id], goal: a.goal, session: sid, who: s ? this.label(s) : sid.slice(0, 8), src: m.src })
        }
      }
      if (!got) return
      const sessionsOf = (ids: string[] | undefined) => {
        const out: { id: string; label?: string; brief?: string }[] = []
        for (const raw of ids ?? []) {
          const p = String(raw).trim().toLowerCase().slice(0, 36)
          if (p.length < 6) continue
          const act = m.actions.find((a) => a.session && (a.session.startsWith(p) || p.startsWith(a.session)))
          const s = this.resolve(act?.session && act.session.length > p.length ? act.session : p)
          const id = s?.id ?? act?.session ?? p
          if (!out.some((x) => x.id === id)) out.push({ id, label: s ? this.label(s) : act?.project, brief: act?.brief })
        }
        return out
      }
      const traceFor = (sid: string) => got.trace?.find((t) => t.session && sid.startsWith(String(t.session).toLowerCase().slice(0, 8)))
      const created: Ask[] = []
      for (const q of got.requests ?? []) {
        if (!q?.text?.trim()) continue
        const quote = verbatim(q.quote ?? '', m.text)
        const goal = goalOk(q.goal)
        const sent = sessionsOf(q.sessions)
        // A follow-up or a correction: folded into the request it refines (named by the model, or, in a burst of the
        // same author, one that plainly says the same thing). Never into a closed one.
        const live = (x?: Ask) => (x && (x.status === 'open' || x.status === 'dispatched') ? x : undefined)
        const named = q.merge_into ? live(made.get(String(q.merge_into).trim().toUpperCase()) ?? this.ask(String(q.merge_into))) : undefined
        const twin = named ?? live([...made.values()].reverse().find((x) => x.from === m.from && m.at - x.at <= BURST_MS && x.kind === (q.kind === 'question' ? 'question' : 'task') && similar(x.text, q.text)))
        if (twin && q.state !== 'done') {
          this.merge(twin, { src: m.src, quote, at: m.at, from: m.from }, named ? q.text : undefined)
          for (const s of sent) if (!twin.dispatches.some((d) => d.session === s.id)) twin.dispatches.push({ session: s.id, label: s.label, at: m.at, brief: s.brief, expect: q.expect ? clip(oneLine(q.expect), 300) : traceFor(s.id)?.expect })
          if (twin.status === 'open' && twin.dispatches.length) twin.status = 'dispatched'
          if (!twin.goal && goal) twin.goal = goal
          this.rehandle(twin)
          created.push(twin)
          made.set(`M${i + 1}.${created.length}`, twin)
          this.trace({ at: m.at, kind: 'status', status: 'progress', text: quote, asks: [twin.id], goal: twin.goal, src: m.src, who: m.from })
          continue
        }
        const a: Ask = {
          id: this.nextAsk(),
          text: clip(oneLine(q.text), 400),
          ...(askTitle(q.title) ? { title: askTitle(q.title) } : {}),
          quote,
          src: m.src,
          from: m.from,
          at: m.at,
          kind: q.kind === 'question' ? 'question' : 'task',
          status: q.state === 'done' ? 'done' : sent.length ? 'dispatched' : 'open',
          dispatches: sent.map((s) => ({ session: s.id, label: s.label, at: m.at, brief: s.brief, expect: q.expect ? clip(oneLine(q.expect), 300) : traceFor(s.id)?.expect })),
          progressAt: m.at,
          ...(goal ? { goal } : {}),
        }
        if (a.status === 'done') { a.closedAt = m.at; a.closedBy = 'weevboss'; a.note = a.kind === 'question' ? 'answered in the thread' : 'done in the thread' }
        this.rehandle(a)
        this.s.asks.push(a)
        created.push(a)
        made.set(`M${i + 1}.${created.length}`, a)
        this.trace({ at: m.at, kind: 'request', text: a.text, asks: [a.id], goal: a.goal, src: m.src })
      }
      for (const u of got.updates ?? []) {
        const a = u?.id ? made.get(String(u.id).trim().toUpperCase()) ?? this.ask(u.id) : undefined
        if (!a || a.status === 'done' || a.status === 'dropped') continue
        if (u.status === 'dropped' && m.from !== 'user') continue
        const note = u.note && noM(oneLine(u.note)) ? clip(noM(oneLine(u.note)), 300) : undefined
        if (u.status === 'done' || u.status === 'dropped') {
          a.status = u.status
          a.closedAt = m.at
          a.closedBy = u.status === 'dropped' ? 'user' : 'weevboss'
        }
        for (const s of sessionsOf(u.sessions)) if (!a.dispatches.some((d) => d.session === s.id)) a.dispatches.push({ session: s.id, label: s.label, at: m.at, brief: s.brief, expect: traceFor(s.id)?.expect })
        if (a.status === 'open' && a.dispatches.length) a.status = 'dispatched'
        if (note) a.note = note
        a.progressAt = Math.max(a.progressAt, m.at)
        this.rehandle(a)
        this.trace({ at: m.at, kind: 'status', status: u.status || 'progress', text: note ?? a.text, asks: [a.id], goal: a.goal, src: m.src, who: m.from })
      }
      for (const k of got.memory ?? []) {
        if (!k?.text?.trim() || !['rule', 'decision', 'fact'].includes(k.kind)) continue
        try { this.remember(k.kind, k.text, m.src) } catch { /* a secret, refused */ }
      }
      for (const tr of got.trace ?? []) {
        if (!tr?.text?.trim()) continue
        const sid = tr.session ? sessionsOf([tr.session])[0] : undefined
        const asks = created.filter((a) => sid && a.dispatches.some((d) => d.session === sid.id)).map((a) => a.id)
        const goal = created.find((a) => asks.includes(a.id) && a.goal)?.goal
        this.trace({ at: m.at, kind: 'dispatch', text: clip(oneLine(tr.text), 400), why: tr.why ? clip(oneLine(tr.why), 300) : undefined, expect: tr.expect ? clip(oneLine(tr.expect), 300) : undefined, session: sid?.id, who: sid?.label, asks, goal, src: m.src })
      }
    })
    void now
  }

  // ------------------------------------------------ close the loop

  /** The commits that landed for each folder these sessions work in, since the oldest of their requests (30 days at most). */
  private async landed(items: { a: Ask; d: Dispatch; s: Session }[]): Promise<Map<string, LandedCommit[]>> {
    const out = new Map<string, LandedCommit[]>()
    if (!this.host.commits) return out
    const since = new Map<string, { s: Session; at: number }>()
    for (const { a, d, s } of items) {
      const at = Math.max(Math.min(a.at, d.at), this.now() - 30 * DAY)
      const known = since.get(s.cwd)
      if (!known || at < known.at) since.set(s.cwd, { s, at })
    }
    await Promise.all([...since].map(async ([cwd, { s, at }]) => {
      out.set(cwd, await this.host.commits!(s, at).catch(() => []))
    }))
    return out
  }

  /**
   * Sessions that stopped since they got work: their requests are judged (done, question, failed, progress), from what
   * the session said and from the commits that landed since. A request already judged, its session at rest, is judged
   * again when later commits landed (at once when one speaks of it, else after a growing wait). Only a commit closes
   * a request here; a report alone waits for weevboss.
   */
  async closeLoop(): Promise<number> {
    if (this.judging) return 0
    const t = this.now()
    const sessions = new Map(this.host.sessions().map((s) => [s.id, s]))
    type Item = { a: Ask; d: Dispatch; s: Session }
    const due: Item[] = []
    const resting: Item[] = []
    let touched = false
    for (const a of this.s.asks) {
      if (a.status !== 'dispatched') continue
      for (const d of a.dispatches) {
        const s = sessions.get(d.session)
        if (!s) continue
        if (s.lastActivityAt > a.progressAt && s.lastActivityAt > d.at) { a.progressAt = s.lastActivityAt; touched = true }
        if (s.status === 'working' || s.lastActivityAt <= d.at + 5000) continue
        // Settle a moment before judging (a session that pauses between two steps is not done).
        if (t - s.lastActivityAt < 90_000) continue
        if ((d.judgedAt ?? 0) >= s.lastActivityAt) resting.push({ a, d, s })
        else due.push({ a, d, s })
      }
    }
    if (touched) this.save()
    if (!due.length && !(resting.length && this.host.commits)) return 0
    this.judging = true
    try {
      const landed = await this.landed([...due, ...resting])
      const sent = ({ a, d }: Item) => Math.min(a.at, d.at) - 60_000
      const words = (a: Ask) => `${a.title ?? ''} ${a.text}`
      const score = new Map([...landed].map(([cwd, list]) => [cwd, relevance(list)]))
      /** The commits that may answer an item (landed after it was sent), the ones that speak of it most first. */
      const candidates = (it: Item) => {
        const rate = score.get(it.s.cwd)
        return (landed.get(it.s.cwd) ?? []).filter((c) => c.at >= sent(it)).map((c) => ({ c, r: rate!(words(it.a), c) })).sort((x, y) => y.r.share - x.r.share || y.c.at - x.c.at)
      }
      // At rest and judged: read again only when commits landed since the last reading, at once when one speaks of
      // it (or when it was never read against commits), else after a wait that doubles from one hour to a day, for
      // two weeks (the words of a request and of its commit often differ: « writing box », « composer »).
      for (const it of resting) {
        const read = it.d.checkedAt ?? 0
        const fresh = candidates(it).filter(({ c }) => c.at > read)
        if (!fresh.length) continue
        const wait = Math.min(DAY, Math.max(3600_000, read - it.s.lastActivityAt))
        if (!read || fresh.some(({ r }) => speaksOf(r)) || (t - it.s.lastActivityAt < 14 * DAY && t - read >= wait)) due.push(it)
      }
      if (!due.length) return 0
      const items = due.slice(0, 8)
      const details = new Map<string, Promise<SessionDetail | undefined>>()
      const detailOf = (s: Session) => details.get(s.id) ?? details.set(s.id, this.host.detail(s.id).catch(() => undefined)).get(s.id)!
      const texts = await Promise.all(items.map(async ({ d, s }) => {
        const said = ((await detailOf(s))?.messages ?? []).filter((m) => m.at >= d.at && m.role === 'assistant' && m.text?.trim()).slice(-3).map((m) => oneLine(m.text))
        return clip(said.join(' / '), 2400)
      }))
      // The session's own commits: the landed ones its commands or their output name (by id, or by the first words of
      // their message, as in `git commit -m`), the newest first. Its replies rarely name them.
      const own = await Promise.all(items.map(async (it) => {
        const ran = fold(oneLine(((await detailOf(it.s))?.messages ?? []).filter((m) => m.role === 'event' && m.at >= sent(it)).map((m) => `${(m.toolDetails?.commands ?? []).join(' ')} ${m.toolDetails?.output ?? ''}`).join(' '))).slice(-400_000)
        if (!ran) return []
        const named = (c: LandedCommit) => ran.includes(c.id) || (c.subject.length >= 16 && ran.includes(fold(oneLine(c.subject)).slice(0, 48)))
        return candidates(it).map(({ c }) => c).filter(named).sort((x, y) => y.at - x.at).slice(0, 40)
      }))
      // What the model reads of the commits: per folder, the closest ones of each item by their words (the four
      // closest with their files, the very closest with some of its changed lines), the session's own, then the latest
      // ones by their first line (a request and a commit may not share their words, or their language).
      const stamp = (at: number) => new Date(at).toISOString().slice(5, 16).replace('T', ' ')
      const folders = [...new Set(items.map((it) => it.s.cwd))].filter((cwd) => landed.get(cwd)?.length)
      const near = items.map((it) => candidates(it).filter(({ r }) => r.hits >= 1).slice(0, 8))
      const close = near.map((list) => list.filter(({ r }) => r.share >= 0.2).slice(0, 4).map(({ c }) => c))
      const changes = new Map<string, string>()
      await Promise.all(items.map(async ({ s }, i) => {
        const c = close[i][0]
        if (!c || !this.host.commitChanges || changes.has(c.id)) return
        changes.set(c.id, '')
        changes.set(c.id, await this.host.commitChanges(s, c.id).catch(() => ''))
      }))
      const shown = new Map(folders.map((cwd) => {
        const here = items.map((it, i) => (it.s.cwd === cwd ? i : -1)).filter((i) => i >= 0)
        const detailed = new Set(here.flatMap((i) => close[i]))
        const first = Math.min(...here.map((i) => sent(items[i])))
        const list = [...new Set([...detailed, ...here.flatMap((i) => [...near[i].map(({ c }) => c), ...own[i]]), ...landed.get(cwd)!.filter((c) => c.at >= first).slice(0, 30)])].sort((x, y) => y.at - x.at)
        return [cwd, { detailed, list }] as const
      }))
      const commitBlock = folders.map((cwd, f) => {
        const { detailed, list } = shown.get(cwd)!
        const lines = list.map((c) => {
          const head = `- ${c.id} · ${stamp(c.at)} · ${c.branch} · ${clip(oneLine(c.subject), 240)}`
          if (!detailed.has(c)) return head
          const more = [c.body && `  ${clip(oneLine(c.body), 500)}`, c.files.length && `  files: ${clip(c.files.join(', '), 300)}`, changes.get(c.id) && `  changed lines:\n${changes.get(c.id)!.split('\n').map((l) => `    ${l}`).join('\n')}`].filter(Boolean)
          return [head, ...more].join('\n')
        })
        return `Folder ${f + 1}:\n${lines.join('\n')}`
      }).join('\n\n')
      const commitLine = (it: Item, i: number) => {
        const f = folders.indexOf(it.s.cwd)
        if (f < 0) return 'Commits: none landed since it was sent'
        return `Commits: folder ${f + 1}, only those after ${stamp(sent(it))}${own[i].length ? `; made by this session: ${own[i].map((c) => c.id).join(', ')}` : ''}${close[i].length ? `; closest by their words: ${close[i].map((c) => c.id).join(', ')}` : ''}`
      }
      const user = this.host.user()
      const prompt = `Each numbered item is a request ${user} made, sent by their assistant weevboss to a coding session, then what the session said since, its state, and where to look for the commits that landed since. For each, decide:
- "outcome": "done" (the request is fully completed), "question" (what is left is on ${user}: an answer, a choice, an approval, or something only they can do, such as a restart, a merge, a login or a try on their own device), "failed" (the session says it could not do it, gave up or is blocked), "progress" (only part of it is done, more work is announced, or nothing shows it yet).
- "commit": a session often ships several requests in a few commits, and its last words are about something else. So read the commits of the item's folder: when one of them, landed after the item was sent, shows by its message, its files or its changed lines that this very request was done (not merely the same screen or area, and never the opposite change), give its id; else "". Never an id that is not listed.
- The commit is the evidence, not the report: the expected report is only what the session was asked to say back. A screenshot, a clip or a confirmation that never came does not keep a request open when a commit shows the work itself done; then the outcome is "done". A request the commits later undid, or that contradicts a newer one, is "question": ${user} must say which they want.
- Silence is not failure: a session that says nothing of the request, with no commit for it, is "progress".
- "report": one plain sentence in ${langName(this.host.lang())}, at most 25 words, saying what came back (the result, a link, a number, the question, what ${user} must do). No session ids, no commit ids.
Answer for every item with its number "n".

${items.map(({ a, d, s }, i) => `${i + 1}. Request: ${a.text}${d.expect ? `\nExpected report: ${d.expect}` : ''}\nSession: ${this.label(s)} · state ${s.status}${s.interrupted ? ` (cut: ${s.interrupted.reason})` : ''}\nIt said: ${texts[i] || '(nothing readable)'}\n${commitLine(items[i], i)}`).join('\n\n')}${commitBlock ? `\n\nCommits that landed where the work ships, newest first (id · time · branch · message):\n\n${commitBlock}` : ''}`
      let got: { items: { n: number; outcome: Outcome; report: string; commit?: string }[] }
      try {
        const raw = await this.model(prompt, JUDGE_SCHEMA)
        got = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
      } catch (e) {
        console.error(`[ledger] judge failed: ${(e as Error).message.slice(0, 200)}`)
        // Judged at this activity anyway: no retry storm; the next stop is judged again.
        for (const { d, s } of items) { d.judgedAt = s.lastActivityAt; d.checkedAt = this.now() }
        this.save()
        return 0
      }
      for (const [i, it] of items.entries()) {
        const { a, d, s } = it
        const v = got.items?.find((x) => x.n === i + 1)
        d.judgedAt = s.lastActivityAt
        d.checkedAt = this.now()
        if (a.status !== 'dispatched' || !v || !['done', 'question', 'failed', 'progress'].includes(v.outcome)) continue
        // The commit the model names must be one that really landed after the request was sent.
        const named = /[0-9a-f]{7,40}/.exec(String(v.commit ?? '').toLowerCase())?.[0].slice(0, 8)
        const proof = named ? candidates(it).find(({ c }) => c.id.startsWith(named))?.c : undefined
        d.outcome = v.outcome
        d.report = clip(oneLine(v.report ?? ''), 300)
        d.reportAt = this.now()
        if (proof) d.evidence = proof.id
        else delete d.evidence
        a.note = proof ? clip(`${proof.id} · ${d.report}`, 400) : d.report
        this.trace({ kind: 'report', text: a.note, asks: [a.id], goal: a.goal, session: s.id, who: this.label(s) })
        // A commit that shows it closes it. A report alone closes nothing while weevboss verifies results itself.
        if (v.outcome === 'done' && (proof || (!this.host.requiresVerification?.() && a.dispatches.every((x) => x.outcome === 'done')))) {
          a.status = 'done'
          a.closedAt = this.now()
          a.closedBy = 'auto'
          this.trace({ kind: 'status', status: 'done', text: proof ? a.note : a.text, asks: [a.id], goal: a.goal, who: 'auto' })
        }
      }
      this.save()
      return items.length
    } finally {
      this.judging = false
    }
  }

  // ------------------------------------------------ migration from the log

  /** Reads the log of the last `hours` (user and agent messages with what each turn did) into the ledger, once. */
  async backfill(hours = 24, onBatch?: (done: number, total: number) => void): Promise<{ messages: number; asks: number }> {
    if (this.busy) throw new Error('the ledger is reading messages; try again in a minute') // i18n-ignore : CLI/log only
    this.busy = true
    try {
      return await this.backfillNow(hours, onBatch)
    } finally {
      this.busy = false
    }
  }

  private async backfillNow(hours: number, onBatch?: (done: number, total: number) => void): Promise<{ messages: number; asks: number }> {
    const since = this.now() - hours * 3600_000
    const entries = this.host.journal()
    // A message already captured live is read from the inbox, not twice.
    const live = new Set(this.s.inbox.map((m) => fold(oneLine(m.text))))
    const msgs: MessageToRead[] = []
    entries.forEach((e, i) => {
      if (e.at < since || (e.role !== 'user' && e.role !== 'agent')) return
      if (this.s.asks.some((a) => a.src === e.id) || live.has(fold(oneLine(e.text)))) return
      const actions: TurnAction[] = []
      const reply: string[] = []
      for (let j = i + 1; j < entries.length && entries[j].role !== 'user' && entries[j].role !== 'agent'; j++) {
        const x = entries[j]
        if (x.role === 'assistant') reply.push(x.text)
        else if (x.role === 'event' && /^Bash · /.test(x.text)) actions.push(...actionsOf(x.text.slice(7)))
      }
      // A `weevils new` seen in the log has no result line: the session opened in that project right after is it.
      for (const a of actions) {
        if (a.kind !== 'new' || a.session) continue
        const s = this.host.sessions().filter((x) => x.projectId === a.project && x.openedAt >= e.at - 60_000 && x.openedAt <= e.at + 15 * 60_000).sort((x, y) => x.openedAt - y.openedAt)[0]
        if (s) a.session = s.id
      }
      msgs.push({ key: e.id, src: e.id, at: e.at, from: e.role === 'agent' ? (e.author ?? 'agent') : 'user', text: e.text, reply: reply.join('\n\n'), actions })
    })
    const before = this.s.asks.length
    if (!this.s.goals.length && msgs.length) await this.seedGoals(msgs)
    for (let i = 0; i < msgs.length; i += 6) {
      const batch = msgs.slice(i, i + 6)
      let ok = await this.read(batch)
      if (!ok) ok = await this.read(batch)
      if (!ok) for (const m of batch) this.add(clip(oneLine(m.text), 300), { quote: m.text, src: m.src, from: m.from }).note = 'kept whole: could not be split automatically'
      this.save()
      onBatch?.(Math.min(i + 6, msgs.length), msgs.length)
    }
    this.s.backfilled = this.now()
    this.save()
    return { messages: msgs.length, asks: this.s.asks.length - before }
  }

  /** First run: the user's durable goals, from what weevils remembers of them and what they asked lately. */
  private async seedGoals(msgs: MessageToRead[]) {
    const user = this.host.user()
    const memory = this.host.memory?.() ?? ''
    const said = msgs.filter((m) => m.from === 'user').map((m) => `- ${clip(oneLine(m.text), 220)}`).join('\n')
    const prompt = `${user} works with weevboss, an assistant that dispatches their work to coding sessions. From what weevils remembers about ${user} and their recent requests, name their 3 to 5 durable goals: broad objectives that many requests serve (a launch, a release, a content push, a product quality bar), not single tasks. Each: "id" a short lowercase slug (one or two words joined by a dash), "title" one short sentence in ${langName(this.host.lang())}, "why" a few words on why it matters to ${user}. No goal for chores or questions.

What weevils remembers about ${user}:
${clip(memory, 4000) || '(nothing)'}

Recent requests:
${clip(said, 9000)}`
    try {
      const raw = await this.model(prompt, { type: 'object', properties: { goals: { type: 'array', items: { type: 'object', properties: { id: str, title: str, why: str }, required: ['id', 'title'] } } }, required: ['goals'] })
      const got = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { goals?: { id: string; title: string; why?: string }[] }
      for (const g of (got.goals ?? []).slice(0, 5)) if (g?.id && g.title) this.addGoal(g.id, g.title, g.why)
    } catch (e) {
      console.error(`[ledger] goals: ${(e as Error).message.slice(0, 200)}`)
    }
  }

  private titlesFailedAt = 0
  /** Requests recorded before they had a short title (or whose model gave none): titled in one call, the live ones
   *  first, while nothing else is read. A failure waits an hour. */
  async titleAsks(): Promise<number> {
    if (this.busy || this.now() - this.titlesFailedAt < 60 * 60_000) return 0
    const live = (a: Ask) => a.status === 'open' || a.status === 'dispatched'
    const todo = this.s.asks.filter((a) => !a.title).sort((a, b) => Number(live(b)) - Number(live(a)) || b.at - a.at).slice(0, 20)
    if (!todo.length) return 0
    this.busy = true
    try {
      const lang = langName(this.host.lang())
      const prompt = `Give each request below a short title in ${lang}: 2 to 5 words naming the thing, like a heading ("Onboarding via weevboss", "For you feed overhaul"); never a cut sentence, no final punctuation. Answer with "items": [{ "id", "title" }] for every id.

${todo.map((a) => `- ${a.id}: ${clip(a.text, 300)}`).join('\n')}`
      const raw = await this.model(prompt, { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: str, title: str }, required: ['id', 'title'] } } }, required: ['items'] })
      const got = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { items?: { id: string; title: string }[] }
      let n = 0
      for (const it of got.items ?? []) {
        const a = todo.find((x) => x.id === it?.id)
        const title = askTitle(it?.title)
        if (a && title) { a.title = title; n++ }
      }
      if (n) this.save()
      return n
    } catch (e) {
      this.titlesFailedAt = this.now()
      console.error(`[ledger] titles: ${(e as Error).message.slice(0, 200)}`)
      return 0
    } finally {
      this.busy = false
    }
  }

  /** Everything the app's page shows. */
  view(): LedgerView {
    const t = this.now()
    const goals = this.s.goals.map((g) => ({ ...g, ...this.goalStats(g.id) }))
    return {
      goals,
      asks: [...this.s.asks].sort((a, b) => b.at - a.at).map((a) => ({ ...a, stale: this.stale(a, t) })),
      pending: this.s.inbox.map((m) => ({ cid: m.cid, at: m.at, text: clip(oneLine(m.text), 300), from: m.from })),
      trace: this.traceList({ n: 150 }),
      knowledge: this.knowledge().slice(0, 60),
      digestTokens: tokensOf(this.digest()),
    }
  }
}
