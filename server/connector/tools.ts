// The connector's five tools (docs/spec/05-connector.md), over the local weevbook (server/weevbook/store.ts).
//
// A chat app (ChatGPT, Claude.ai) calls them through /mcp with a token the person approved (oauth.ts, http.ts). The
// token says which app it is: that app is the `app` of every key a call writes, whatever the call's own argument says.
//
//   send_to_weevboss     a chat, in parts of at most 40 messages, into the thread of its conversation
//   continue_with_agent  a request for an engine: a message and a turn (held until step 4 wires the dispatcher)
//   search_weevbook      threads by words of their title or project
//   read_thread          a thread's handoff or summary, or its last messages
//   thread_status        where a thread stands
//
// Every message has a key built from the call (`conn:<app>:<conversation>:<ordinal>:<hash>`), so a call repeated by a
// model, a network retry or the person asking twice writes nothing the second time. The key is the mapping: the thread
// of a conversation is the one whose journal holds keys with its prefix. Writes go through the store under the
// weevbook's lock, like the shadow writer's, and never touch a thread an engine writes (a thread with a leg).
//
// The texts below are written for the chat app's model to read and repeat, in English like the journal: they are the
// protocol of docs/spec/05-connector.md, not the app's interface.

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ruleMatch, type CatalogEntry } from '../classify.ts'
import { ulid } from '../weevbook/adapters/adapter.ts'
import { deriveMeta, slugify, type App, type EventDraft, type JournalEvent, type MessageEvent, type ThreadMeta } from '../weevbook/journal.ts'
import { redactText } from '../weevbook/redact.ts'
import { Weevbook, type IndexEntry } from '../weevbook/store.ts'

export const APPS: readonly App[] = ['chatgpt', 'claude-ai']
export const APP_NAMES: Record<App, string> = { chatgpt: 'ChatGPT', 'claude-ai': 'Claude' }
/** Messages per part, and characters per message (docs/spec/README.md, constants). */
export const PART_MAX = 40
export const TEXT_MAX = 20_000
/** The longest result of each tool (CONN-5). */
export const LIMITS = { part: 200, final: 300, replay: 300, continue: 300, search: 10, read: 12_000, status: 600, error: 300 } as const

// ---------------------------------------------------------------- the tools as the chat app receives them

type Schema = Record<string, unknown>
const THREAD: Schema = { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' }
const CONVERSATION: Schema = { type: 'string', pattern: '^[a-z0-9-]{8,80}$', description: 'A name you choose once for this chat and reuse in every call about it.' } // i18n-ignore
const APP: Schema = { enum: [...APPS] }

export interface ToolDef {
  name: string
  title: string
  description: string
  inputSchema: Schema
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
}

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export const TOOLS: readonly ToolDef[] = [
  {
    name: 'send_to_weevboss',
    title: 'Send this chat to weevboss', // i18n-ignore
    description: 'Save this chat in the user\'s weevbook. Send every message in order. More than 40 messages: send several parts, each with the offset of its first message, and `final: true` on the last.', // i18n-ignore
    annotations: write,
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['app', 'offset', 'messages', 'final'],
      anyOf: [{ required: ['conversation'] }, { required: ['thread'] }],
      properties: {
        conversation: CONVERSATION, thread: THREAD, app: APP,
        title: { type: 'string', maxLength: 120 },
        project: { type: 'string', maxLength: 60, description: 'Only if the user named a project.' }, // i18n-ignore
        offset: { type: 'integer', minimum: 0, description: 'Position in the chat of the first message of this part.' }, // i18n-ignore
        messages: {
          type: 'array', minItems: 1, maxItems: PART_MAX,
          items: {
            type: 'object', additionalProperties: false, required: ['role', 'text'],
            properties: { role: { enum: ['user', 'assistant'] }, text: { type: 'string', maxLength: TEXT_MAX } },
          },
        },
        final: { type: 'boolean' },
      },
    },
  },
  {
    name: 'continue_with_agent',
    title: 'Ask an agent to continue', // i18n-ignore
    description: 'Ask a coding agent on the user\'s machines to work on a thread. Save the chat first with send_to_weevboss if it is not saved.', // i18n-ignore
    annotations: write,
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['instruction', 'request'],
      anyOf: [{ required: ['thread'] }, { required: ['conversation', 'app'] }],
      properties: {
        thread: THREAD, conversation: CONVERSATION, app: APP,
        instruction: { type: 'string', minLength: 1, maxLength: 8000, description: 'What the agent must do, in full sentences.' }, // i18n-ignore
        request: { type: 'string', pattern: '^[a-z0-9-]{4,60}$', description: 'A short name for this request. Reuse it only to retry the same call.' }, // i18n-ignore
        project: { type: 'string', maxLength: 60 },
      },
    },
  },
  {
    name: 'search_weevbook',
    title: 'Search the weevbook', // i18n-ignore
    description: 'Find threads of the user\'s weevbook by words of their title, project or subject.', // i18n-ignore
    annotations: read,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        project: { type: 'string', maxLength: 60 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
      },
    },
  },
  {
    name: 'read_thread',
    title: 'Read a thread', // i18n-ignore
    description: 'Read a thread, to continue it here. `summary` gives a summary of it; `recent` gives its last messages.', // i18n-ignore
    annotations: read,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['thread', 'mode'],
      properties: {
        thread: THREAD,
        mode: { enum: ['summary', 'recent'] },
        count: { type: 'integer', minimum: 1, maximum: 20, default: 6, description: 'For recent.' }, // i18n-ignore
      },
    },
  },
  {
    name: 'thread_status',
    title: 'Where a thread stands', // i18n-ignore
    description: 'Say where a thread stands: an agent is working, it waits for the user, or it is paused.', // i18n-ignore
    annotations: read,
    inputSchema: {
      type: 'object', additionalProperties: false,
      anyOf: [{ required: ['thread'] }, { required: ['conversation', 'app'] }],
      properties: { thread: THREAD, conversation: CONVERSATION, app: APP },
    },
  },
]

/** What the chat app's model reads first (MCP `instructions`): its first 512 characters stand alone. */
export const INSTRUCTIONS = 'weevils keeps the user\'s conversations in their weevbook, where coding agents on their own machines can continue them. When the user says "send this to weevboss" (or to weevils), call send_to_weevboss with every message of this chat, in order, in parts of at most 40, the last with final: true. Choose one conversation name for this chat and reuse it in every later call, so that a later send extends the same thread. Use continue_with_agent only when the user asks for an agent to do the work.' // i18n-ignore

// ---------------------------------------------------------------- arguments

/** The first thing wrong with `v` against `s` (the subset of JSON Schema the tools use), as one sentence. */
export function invalid(s: Schema, v: unknown, at = ''): string | null {
  const name = at || 'arguments'
  if (Array.isArray(s.enum)) return s.enum.includes(v) ? null : `"${name}" must be one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')}.` // i18n-ignore
  switch (s.type) {
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `"${name}" must be an object.` // i18n-ignore
      const o = v as Record<string, unknown>
      const props = (s.properties ?? {}) as Record<string, Schema>
      for (const k of Object.keys(o)) if (!(k in props)) return `"${k}" is not an argument of this tool.` // i18n-ignore
      for (const k of (s.required ?? []) as string[]) if (o[k] === undefined) return `"${k}" is missing.` // i18n-ignore
      const any = s.anyOf as { required: string[] }[] | undefined
      if (any && !any.some((r) => r.required.every((k) => o[k] !== undefined))) return `Give ${any.map((r) => r.required.map((k) => `"${k}"`).join(' and ')).join(', or ')}.` // i18n-ignore
      for (const [k, sub] of Object.entries(props)) {
        if (o[k] === undefined) continue
        const bad = invalid(sub, o[k], at ? `${at}.${k}` : k)
        if (bad) return bad
      }
      return null
    }
    case 'array': {
      if (!Array.isArray(v)) return `"${name}" must be a list.` // i18n-ignore
      if (s.maxItems !== undefined && v.length > (s.maxItems as number)) {
        return name === 'messages' ? `A part holds at most ${PART_MAX} messages: send this one as several parts, each with the offset of its first message.` : `"${name}" has more than ${s.maxItems} items.` // i18n-ignore
      }
      if (s.minItems !== undefined && v.length < (s.minItems as number)) return `"${name}" is empty.` // i18n-ignore
      for (let i = 0; i < v.length; i++) {
        const bad = invalid(s.items as Schema, v[i], `${name}[${i}]`)
        if (bad) return bad
      }
      return null
    }
    case 'string': {
      if (typeof v !== 'string') return `"${name}" must be a string.` // i18n-ignore
      if (s.maxLength !== undefined && v.length > (s.maxLength as number)) {
        return /^messages\[\d+\]\.text$/.test(name) ? `${name} is longer than ${TEXT_MAX} characters: send it as two messages.` : `"${name}" is longer than ${s.maxLength} characters.` // i18n-ignore
      }
      if (s.minLength !== undefined && v.length < (s.minLength as number)) return `"${name}" is empty.` // i18n-ignore
      if (s.pattern && !new RegExp(s.pattern as string).test(v)) {
        if (name === 'conversation') return '"conversation" must be 8 to 80 lower-case letters, digits or dashes, the same in every call about this chat.' // i18n-ignore
        if (name === 'request') return '"request" must be 4 to 60 lower-case letters, digits or dashes.' // i18n-ignore
        if (name === 'thread') return '"thread" must be a thread id of 26 characters, as search_weevbook gives it.' // i18n-ignore
        return `"${name}" does not match ${s.pattern}.` // i18n-ignore
      }
      return null
    }
    case 'integer':
      if (!Number.isInteger(v)) return `"${name}" must be a whole number.` // i18n-ignore
      if (s.minimum !== undefined && (v as number) < (s.minimum as number)) return `"${name}" must be at least ${s.minimum}.` // i18n-ignore
      if (s.maximum !== undefined && (v as number) > (s.maximum as number)) return `"${name}" must be at most ${s.maximum}.` // i18n-ignore
      return null
    case 'boolean':
      return typeof v === 'boolean' ? null : `"${name}" must be true or false.` // i18n-ignore
  }
  return null
}

// ---------------------------------------------------------------- results

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: true
}
const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text: cut(text, LIMITS.error) }], isError: true })
/** Text cut to `n` characters, with an ellipsis. */
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`)
/** A sentence and a link, within `limit`: the sentence gives way, never the link. */
const withLink = (text: string, link: string, limit: number) => `${cut(text, limit - link.length - 1)} ${link}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Thrown inside a tool: its sentence is the result. */
class Refusal extends Error {}

const BUSY = 'The weevbook is busy. Try again in a minute; nothing was written.' // i18n-ignore
const FAILED = 'The weevbook could not be written. Try again in a minute; nothing was written.' // i18n-ignore
const IN_A_LEG = 'An agent session writes this thread: it cannot take chat messages before agents take turns from the weevbook. Send this chat as its own conversation.' // i18n-ignore
const UNSAFE_NAME = 'Choose a name without words like token, password, secret, api-key or cookie: what follows them are hidden in the weevbook.' // i18n-ignore

// ---------------------------------------------------------------- the journal, as the connector reads it

/** `conn:<app>:<conversation>:` → the thread of that conversation; the key of a message, its ordinal and hash. */
export const prefixOf = (app: App, conversation: string) => `conn:${app}:${conversation}:`
export const messageHash = (role: string, text: string) => crypto.createHash('sha256').update(`${role}\n${text}`).digest('hex').slice(0, 16)
function keyParts(key: string): { prefix: string; rest: string } | null {
  const m = /^(conn:(?:chatgpt|claude-ai):[a-z0-9-]+:)(.+)$/.exec(key)
  return m ? { prefix: m[1], rest: m[2] } : null
}
/** The messages of a conversation already in a journal: ordinal → hash. */
function savedOf(events: readonly JournalEvent[], prefix: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const e of events) {
    if (e.type !== 'message' || !e.key?.startsWith(prefix)) continue
    const m = /^(\d+):([0-9a-f]{16})$/.exec(e.key.slice(prefix.length))
    if (m) out.set(Number(m[1]), m[2])
  }
  return out
}
/** Redaction runs over every string of an event (docs/spec/02-weevbook.md#redaction), the key too: a name that reads
 *  like a secret (`my-api-token`, then `:0:…`) would come out as `[redacted]` and the call could no longer be
 *  recognised. Such a name is refused before anything is written. */
const keySafe = (key: string) => redactText(key) === key
/** How many messages of a conversation are saved: the ordinals 0, 1, … with no gap. */
const countOf = (saved: Map<number, string>) => {
  let n = 0
  while (saved.has(n)) n++
  return n
}
function openLeg(events: readonly JournalEvent[]): string | null {
  let open: string | null = null
  for (const e of events) {
    if (e.type === 'leg.start') open = e.leg
    else if (e.type === 'leg.end' && e.leg === open) open = null
  }
  return open
}
/** The latest state of each turn. */
function turnsOf(events: readonly JournalEvent[]): Map<number, { state: string; reason?: string; message?: string | null }> {
  const out = new Map<number, { state: string; reason?: string; message?: string | null }>()
  for (const e of events) {
    if (e.type !== 'turn') continue
    const t = out.get(e.turn)
    out.set(e.turn, { state: e.state, reason: e.reason, message: t?.message ?? e.message })
  }
  return out
}
/** A title from the chat itself, when the call gives none: the first request, cut at a word near 60 characters. */
function titleFrom(text: string | undefined): string | undefined {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return undefined
  if (line.length <= 60) return line
  const head = line.slice(0, 60)
  const space = head.lastIndexOf(' ')
  return `${space > 30 ? head.slice(0, space) : head}…`
}
const stamp = (at: string) => `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`
const SPEAKER = (e: MessageEvent) => (e.role === 'user' ? 'User' : e.role === 'orchestrator' ? (e.author ?? 'weevboss') : e.app ? APP_NAMES[e.app] : 'Agent') // i18n-ignore: labels of thread.md
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** What a held turn's reason means, for the model to repeat (docs/spec/06-dispatch.md, when nothing matches). */
const HELD: Record<string, string> = { // i18n-ignore
  'no-machine': 'none of the user\'s machines takes work from the weevbook now', // i18n-ignore
  'no-room': 'every account is at its limit for now', // i18n-ignore
  'not-signed-in': 'an account must be signed in again on the machine', // i18n-ignore
  'only-there': 'it can only continue on the machine where it started, which is off', // i18n-ignore
  attempts: 'it stopped three times in a row', // i18n-ignore
  expired: 'it waited more than an hour for a machine and was dropped; ask again if it is still wanted', // i18n-ignore
  stopped: 'it stopped earlier and will not go on by itself; ask again to continue', // i18n-ignore
}

// ---------------------------------------------------------------- the connector

/** What a dispatcher answers about a turn the connector accepted: held (rule and reason of docs/spec/06-dispatch.md,
 *  which the result turns into a sentence), or taken (it writes the turn's next events itself). */
export type Dispatch = (thread: string, turn: number) => Promise<{ held: { rule: string; reason: string } } | { taken: true }>
/** Until step 4 wires the dispatcher into weevilsd, no machine publishes an engine table: the dispatcher's answer to
 *  an empty table is to hold the turn (docs/spec/06-dispatch.md, rule `hold`). */
export const NO_DISPATCHER: Dispatch = async () => ({ held: { rule: 'hold', reason: 'no-machine' } })

/** The repositories directly under the project roots (folders with a .git), read again at most once a minute: a chat
 *  that names one is filed under it, like a session started in it (sync.ts projectOf). */
export function reposUnder(roots: readonly string[], now: () => number = Date.now): () => string[] {
  let cache: { at: number; repos: string[] } | null = null
  return () => {
    if (cache && now() - cache.at < 60_000) return cache.repos
    const repos: string[] = []
    for (const root of roots) {
      let names: string[] = []
      try {
        names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
      } catch {
        continue
      }
      for (const name of names) if (fs.existsSync(path.join(root, name, '.git'))) repos.push(name)
    }
    cache = { at: now(), repos }
    return repos
  }
}

export interface ConnectorOptions {
  /** DATA_DIR/weevbook */
  dir: string
  machine: string
  /** The repositories under the project roots: a chat that names one is filed under it. */
  projects?: () => string[]
  dispatch?: Dispatch
  /** Threads (step 4, WEEVILS_THREADS): the request goes to the dispatcher's inbox, which files it with the lease when
   *  the thread is free and places it like any message. The thread may then have a leg: leases decide. */
  accept?: (thread: string, m: { text: string; key: string; app: 'chatgpt' | 'claude-ai'; project?: string | null }) => Promise<void>
  now?: () => number
  /** How long a call waits for the weevbook's lock (the shadow writer holds it a moment at a time). */
  lockMs?: number
  /** How long after a part without `final` main is composed anyway. */
  composeMs?: number
  log?: (line: string) => void
}
export interface CallContext {
  /** The chat app the token was given to. */
  app: App
  /** This weevils' public address, for links: https://host */
  base: string
}

export class Connector {
  private o: ConnectorOptions
  private book: Promise<Weevbook> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Conversation prefix → thread, and the threads already looked at for keys. */
  private convs = new Map<string, string>()
  private scanned = new Set<string>()
  private composeTimer: NodeJS.Timeout | null = null
  /** The call under the lock appended to a thread or composed main. */
  private appended = false

  constructor(o: ConnectorOptions) {
    this.o = o
  }
  private now = () => (this.o.now ?? Date.now)()
  private log = (line: string) => (this.o.log ?? ((l: string) => console.error(l)))(line)

  /** Calls run one at a time: the store's lock is per process, not per call. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f)
    this.queue = run.catch(() => undefined)
    return run
  }
  private open(): Promise<Weevbook> {
    this.book ??= Weevbook.open(this.o.dir, this.o.machine).catch((e) => {
      this.book = null
      throw e
    })
    return this.book
  }
  /** `f` under the weevbook's lock. */
  private async locked<T>(f: (book: Weevbook) => Promise<T>): Promise<T | ToolResult> {
    const book = await this.open()
    if (!(await book.lockWait(this.o.lockMs ?? 10_000))) return fail(BUSY)
    this.appended = false
    try {
      return await f(book)
    } finally {
      // Something was appended (even by a call that failed after): the other processes read the weevbook again.
      await book.unlock(this.appended).catch((e) => this.log(`[connector] unlock: ${(e as Error).message}`))
    }
  }

  stop() {
    if (this.composeTimer) clearTimeout(this.composeTimer)
    this.composeTimer = null
  }

  /** One tool call. Never throws: a failure is a result with isError and one sentence. */
  async call(name: string, args: unknown, ctx: CallContext): Promise<ToolResult> {
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return fail(`There is no tool "${name}". The tools are ${TOOLS.map((t) => t.name).join(', ')}.`) // i18n-ignore
    const a = (args ?? {}) as Record<string, unknown>
    const bad = invalid(tool.inputSchema, a)
    if (bad) return fail(bad)
    return this.serial(async () => {
      try {
        const r = await this.locked(async (book) => {
          switch (name) {
            case 'send_to_weevboss': return this.send(book, a as unknown as SendArgs, ctx)
            case 'continue_with_agent': return this.continueWith(book, a as unknown as ContinueArgs, ctx)
            case 'search_weevbook': return this.search(book, a as unknown as SearchArgs)
            case 'read_thread': return this.read(book, a as unknown as ReadArgs)
            default: return this.status(book, a as unknown as StatusArgs, ctx)
          }
        })
        return r as ToolResult
      } catch (e) {
        if (e instanceof Refusal) return fail(e.message)
        this.log(`[connector] ${name}: ${(e as Error).stack ?? e}`)
        return fail(FAILED)
      }
    })
  }

  // -------------------------------------------------------------- which thread

  /** The thread holding keys of this conversation, if any. Threads are read once; the connector's own writes keep the
   *  map current (no other writer makes connector keys). */
  private async find(book: Weevbook, prefix: string): Promise<string | undefined> {
    const known = this.convs.get(prefix)
    if (known && book.pathOf(known)) return known
    for (const { id, path: rel } of book.threads()) {
      if (this.scanned.has(id)) continue
      this.scanned.add(id)
      const meta = await fsp.readFile(path.join(book.abs(rel), 'meta.json'), 'utf8').then((t) => JSON.parse(t) as ThreadMeta, () => null)
      if (!meta?.sources?.includes('connector')) continue
      for (const e of (await book.thread(id))?.journal.events ?? []) this.remember(e, id)
    }
    return this.convs.get(prefix)
  }
  private remember(e: JournalEvent | EventDraft, thread: string) {
    if (e.type !== 'message' || !e.key) return
    const k = keyParts(e.key)
    if (k) this.convs.set(k.prefix, thread)
  }
  /** The thread a call names (`thread`), or the one of its conversation. */
  private async threadOf(book: Weevbook, prefix: string, thread: string | undefined, conversation: string | undefined): Promise<string | undefined> {
    if (thread) {
      if (!(await book.thread(thread))) throw new Refusal(`There is no thread ${thread}. Use search_weevbook to find the right one.`) // i18n-ignore
      if (conversation) {
        const other = await this.find(book, prefix)
        if (other && other !== thread) throw new Refusal(`This conversation is saved in thread ${other}: name that one, or choose another conversation name.`) // i18n-ignore
      }
      return thread
    }
    return this.find(book, prefix)
  }

  /** The project a chat is filed under: the one the user named, else a repository or weevbook project its text names. */
  private async projectOf(book: Weevbook, named: string | undefined, text: string): Promise<string | null> {
    if (named !== undefined) return slugify(named) || null
    const catalog = new Map<string, CatalogEntry>()
    for (const repo of this.o.projects?.() ?? []) {
      const id = slugify(repo)
      if (id) catalog.set(id, { id, name: repo, repos: [repo] })
    }
    for (const t of (await this.index(book)).values()) if (t.project && !catalog.has(t.project)) catalog.set(t.project, { id: t.project, name: t.project, repos: [] })
    return ruleMatch(text, [...catalog.values()])?.id ?? null
  }

  /** Every thread's title, project, update and state: index.json of main, and meta.json of the folders it lacks. */
  private async index(book: Weevbook): Promise<Map<string, Pick<IndexEntry, 'thread' | 'title' | 'project' | 'updated' | 'state'>>> {
    const listed = new Map<string, IndexEntry>()
    const text = await fsp.readFile(path.join(book.dir, 'index.json'), 'utf8').catch(() => '')
    if (text) for (const t of (JSON.parse(text) as { threads: IndexEntry[] }).threads) listed.set(t.thread, t)
    const out = new Map<string, Pick<IndexEntry, 'thread' | 'title' | 'project' | 'updated' | 'state'>>()
    for (const { id, path: rel } of book.threads()) {
      const t = listed.get(id)
      if (t && t.path === rel) {
        out.set(id, t)
        continue
      }
      const meta = await fsp.readFile(path.join(book.abs(rel), 'meta.json'), 'utf8').then((x) => JSON.parse(x) as ThreadMeta, () => null)
      if (meta) out.set(id, { thread: id, title: meta.title, project: meta.project, updated: meta.updated, state: meta.state })
    }
    return out
  }

  /** Commits a thread's folder to its ref, and composes main now (final) or a little later. */
  private async publish(book: Weevbook, id: string, subject: string, now: boolean) {
    await book.commitThread(id, subject)
    if (now) {
      if (this.composeTimer) clearTimeout(this.composeTimer)
      this.composeTimer = null
      if (await book.compose()) this.appended = true
    } else this.composeSoon()
  }
  private composeSoon() {
    if (this.composeTimer) return
    this.composeTimer = setTimeout(() => {
      this.composeTimer = null
      void this.serial(() => this.locked(async (book) => {
        if (await book.compose()) this.appended = true
      })).catch((e) => this.log(`[connector] main: ${(e as Error).message}`))
    }, this.o.composeMs ?? 60_000)
    this.composeTimer.unref?.()
  }
  private async append(book: Weevbook, id: string, events: EventDraft[]) {
    const r = await book.append(id, { events })
    this.appended ||= r.written > 0
    if (r.refused) {
      this.log(`[connector] ${id}: ${r.refused} events refused by the journal (kept in a note)`)
      throw new Refusal(FAILED)
    }
    for (const e of events) this.remember(e, id)
  }

  // -------------------------------------------------------------- send_to_weevboss

  private async send(book: Weevbook, a: SendArgs, ctx: CallContext): Promise<ToolResult> {
    const app = ctx.app
    const conversation = a.conversation ?? a.thread!.toLowerCase()
    const prefix = prefixOf(app, conversation)
    if (!keySafe(`${prefix}0:0000000000000000`)) throw new Refusal(UNSAFE_NAME)
    let id = await this.threadOf(book, prefix, a.thread, a.conversation)
    const before = id ? ((await book.thread(id))?.journal.events ?? []) : []
    if (openLeg(before)) throw new Refusal(IN_A_LEG)
    const saved = savedOf(before, prefix)
    const count = countOf(saved)
    // Parts come in order: a part may start at or before what is saved (a replay), never after it.
    if (a.offset > count) throw new Refusal(`Send messages starting at offset ${count} first.`) // i18n-ignore
    const now = this.now()
    const at = new Date(now).toISOString()
    const drafts: EventDraft[] = []
    let differ = 0
    a.messages.forEach((m, i) => {
      const ordinal = a.offset + i
      const hash = messageHash(m.role, m.text)
      if (ordinal < count) {
        // Already saved. The same ordinal with another text (the user edited the chat): the saved version stays.
        if (saved.get(ordinal) !== hash) differ++
        return
      }
      drafts.push({ id: ulid(now), at, leg: null, type: 'message', role: m.role, text: m.text, source: 'connector', app, key: `${prefix}${ordinal}:${hash}` })
    })
    const added = drafts.length
    const last = a.offset + a.messages.length - 1

    // The thread's facts: a new thread is born with its title (the one given, else the chat's first request).
    const created = !id
    const facts = before.length ? deriveMeta(before) : null
    const meta: { title?: string; project?: string | null } = {}
    if (created) {
      id = ulid(now)
      const first = a.messages.find((m) => m.role === 'user')?.text
      const title = a.title?.trim() || titleFrom(first)
      drafts.unshift({ id: ulid(now), at, leg: null, type: 'meta', thread: id, ...(title ? { title } : {}) })
    } else if (a.final) {
      const first = [...before, ...drafts].find((e): e is MessageEvent => e.type === 'message' && e.role === 'user')?.text
      const title = a.title?.trim() || (facts?.title ? undefined : titleFrom(first))
      if (title && title !== facts?.title) meta.title = title
    }
    if (a.final) {
      // Filed when the chat is complete: the project the user named, else one its text names, else none.
      const text = [...before, ...drafts].flatMap((e) => (e.type === 'message' ? [e.text] : [])).join('\n')
      const current = facts?.project ?? null
      const project = a.project !== undefined || !current ? await this.projectOf(book, a.project, text) : current
      if (project && project !== current) meta.project = project
    }
    if (meta.title !== undefined || meta.project !== undefined) drafts.push({ id: ulid(now), at, leg: null, type: 'meta', ...meta })

    const link = `${ctx.base}/t/${id}`
    const note = differ ? ` ${plural(differ, 'earlier message differs', 'earlier messages differ')} from what was saved; the saved version was kept.` : '' // i18n-ignore
    if (!drafts.length) {
      const hint = differ && last < count ? ` To add new messages, send them with offset ${count}.` : '' // i18n-ignore
      if (a.final) await this.publish(book, id!, `meta · ${this.o.machine}`, true)
      return ok(withLink(`Already saved: nothing new in messages ${a.offset} to ${last}.${note}${hint}`, link, LIMITS.replay)) // i18n-ignore
    }
    await this.append(book, id!, drafts)
    await this.publish(book, id!, added ? `chat · ${app} · ${plural(added, 'message', 'messages')}` : `meta · ${this.o.machine}`, a.final) // i18n-ignore: commit subject
    if (!a.final) return ok(cut(`Saved messages ${a.offset} to ${last}. Send the next part with offset ${last + 1}.${note}`, LIMITS.part)) // i18n-ignore
    const after = deriveMeta((await book.thread(id!))!.journal.events)
    const total = countOf(savedOf((await book.thread(id!))!.journal.events, prefix))
    const where = after.project ? ` in ${after.project}` : ''
    return ok(withLink(`Saved ${plural(total, 'message', 'messages')} to "${cut(after.title || 'Untitled', 120)}"${where}.${note}`, link, LIMITS.final)) // i18n-ignore
  }

  // -------------------------------------------------------------- continue_with_agent

  private async continueWith(book: Weevbook, a: ContinueArgs, ctx: CallContext): Promise<ToolResult> {
    const app = ctx.app
    const conversation = a.conversation ?? a.thread!.toLowerCase()
    const prefix = prefixOf(app, conversation)
    const id = await this.threadOf(book, prefix, a.thread, a.conversation)
    if (!id) throw new Refusal('This chat is not saved yet: save it with send_to_weevboss first, then ask again.') // i18n-ignore
    const before = (await book.thread(id))!.journal.events
    if (!this.o.accept && openLeg(before)) throw new Refusal('An agent session writes this thread: continue it from weevils.') // i18n-ignore
    const key = `${prefix}req:${a.request}`
    if (!keySafe(key)) throw new Refusal(UNSAFE_NAME)
    const link = `${ctx.base}/t/${id}`
    const answer = (events: readonly JournalEvent[], turn: number) => {
      const m = deriveMeta(events)
      const t = turnsOf(events).get(turn)
      const where = `"${cut(m.title || 'Untitled', 120)}"${m.project ? ` in ${m.project}` : ''}`
      if (t?.state === 'held' || t?.state === 'failed') return ok(withLink(`Saved. No machine can work on it now: ${t.state === 'failed' ? 'it stopped before the end' : (HELD[t.reason ?? ''] ?? t.reason ?? 'it waits')}. It starts as soon as one can.`, link, LIMITS.continue)) // i18n-ignore
      if (t?.state === 'done') return ok(withLink(`An agent already did this request on ${where}. Ask for thread_status to see its reply.`, link, LIMITS.continue)) // i18n-ignore
      return ok(withLink(`An agent is working on ${where}. Ask for thread_status to follow it.`, link, LIMITS.continue)) // i18n-ignore
    }
    // The same request name: the turn it opened, never a second one (CONN-4).
    const asked = before.find((e) => e.type === 'message' && e.key === key)
    if (asked) {
      const turn = [...turnsOf(before)].find(([, t]) => t.message === asked.id)?.[0]
      return answer(before, turn ?? 0)
    }
    if (this.o.accept) {
      await this.o.accept(id, { text: a.instruction, key, app, ...(a.project !== undefined ? { project: slugify(a.project) || null } : {}) })
      return answer(before, 0)
    }
    const now = this.now()
    const at = new Date(now).toISOString()
    const message: EventDraft = { id: ulid(now), at, leg: null, type: 'message', role: 'user', text: a.instruction, source: 'connector', app, key }
    const drafts: EventDraft[] = [message]
    const current = deriveMeta(before).project
    if (a.project !== undefined) {
      const project = slugify(a.project) || null
      if (project && project !== current) drafts.push({ id: ulid(now), at, leg: null, type: 'meta', project })
    }
    const turn = turnsOf(before).size + 1
    drafts.push({ id: ulid(now), at, leg: null, type: 'turn', turn, state: 'accepted', message: message.id })
    await this.append(book, id, drafts)
    const d = await (this.o.dispatch ?? NO_DISPATCHER)(id, turn)
    if ('held' in d) {
      await this.append(book, id, [{ id: ulid(this.now()), at: new Date(this.now()).toISOString(), leg: null, type: 'turn', turn, state: 'held', rule: d.held.rule, reason: d.held.reason }])
    }
    await this.publish(book, id, `turn ${turn} (${'held' in d ? 'held' : 'accepted'}) · ${app} · ${this.o.machine}`, true)
    return answer((await book.thread(id))!.journal.events, turn)
  }

  // -------------------------------------------------------------- search_weevbook

  private async search(book: Weevbook, a: SearchArgs): Promise<ToolResult> {
    const words = [...new Set(norm(a.query).split(' ').filter((w) => w.length >= 2))]
    if (!words.length) return fail('Search with at least one word of two letters or more.') // i18n-ignore
    const project = a.project !== undefined ? slugify(a.project) : undefined
    const hits: { t: Pick<IndexEntry, 'thread' | 'title' | 'project' | 'updated' | 'state'>; score: number }[] = []
    for (const t of (await this.index(book)).values()) {
      if (project !== undefined && t.project !== project) continue
      const hay = ` ${norm(`${t.title} ${t.project ?? ''}`)} ${t.thread.toLowerCase()} `
      const score = words.reduce((s, w) => s + (hay.includes(` ${w}`) ? 2 : hay.includes(w) ? 1 : 0), 0)
      if (score) hits.push({ t, score })
    }
    if (!hits.length) return ok(cut(`No thread matches "${a.query}". Try other words, or fewer.`, LIMITS.error)) // i18n-ignore
    hits.sort((x, y) => y.score - x.score || (x.t.updated < y.t.updated ? 1 : -1))
    const lines = hits.slice(0, Math.min(a.limit ?? 5, LIMITS.search)).map(({ t }) => cut(`${t.thread} · ${t.title || 'Untitled'} · ${t.project ?? 'no project'} · ${stamp(t.updated)} · ${t.state}`, 240)) // i18n-ignore
    return ok(lines.join('\n'))
  }

  // -------------------------------------------------------------- read_thread

  private async read(book: Weevbook, a: ReadArgs): Promise<ToolResult> {
    const th = await book.thread(a.thread)
    if (!th) return fail(`There is no thread ${a.thread}. Use search_weevbook to find the right one.`) // i18n-ignore
    const events = th.journal.events
    const m = deriveMeta(events)
    const messages = events.filter((e): e is MessageEvent => e.type === 'message')
    const head = `# ${m.title || 'Untitled'}\n\nProject: ${m.project ?? 'none'} · Started ${stamp(m.created)} · ${m.state} · ${plural(messages.length, 'message', 'messages')} · Thread ${m.thread}` // i18n-ignore
    const render = (list: MessageEvent[], room: number) => {
      if (!list.length) return ''
      const each = Math.max(200, Math.floor(room / list.length) - 60)
      return list.map((e) => `**${SPEAKER(e)}** · ${stamp(e.at)}\n\n${cut(e.text.trim(), each)}`).join('\n\n')
    }
    if (a.mode === 'recent') {
      const list = messages.slice(-(a.count ?? 6))
      return ok(cut(`${head}\n\n---\n\n${render(list, LIMITS.read - head.length - 10) || '(no messages)'}`, LIMITS.read)) // i18n-ignore
    }
    // summary: the handoff when there is one (docs/spec/04-resume.md); else the first request and the last exchanges.
    const handoff = await fsp.readFile(path.join(book.abs(th.path), 'handoff.md'), 'utf8').catch(() => null)
    if (handoff) return ok(cut(handoff, LIMITS.read))
    const first = messages.find((e) => e.role === 'user')
    const rest = messages.slice(-6).filter((e) => e !== first)
    const opening = first ? `\n\n## First request\n\n${cut(first.text.trim(), 3000)}` : '' // i18n-ignore
    const body = `${head}${opening}${rest.length ? `\n\n## Last messages\n\n${render(rest, LIMITS.read - head.length - opening.length - 40)}` : ''}` // i18n-ignore
    return ok(cut(body, LIMITS.read))
  }

  // -------------------------------------------------------------- thread_status

  private async status(book: Weevbook, a: StatusArgs, ctx: CallContext): Promise<ToolResult> {
    const id = a.thread ?? (await this.find(book, prefixOf(ctx.app, a.conversation!)))
    const th = id ? await book.thread(id) : undefined
    if (!th) return fail(a.thread ? `There is no thread ${a.thread}. Use search_weevbook to find the right one.` : 'No thread holds this conversation yet: save it with send_to_weevboss.') // i18n-ignore
    const events = th.journal.events
    const m = deriveMeta(events)
    let state = m.state === 'working' ? 'an agent is working on it' : 'waiting for you' // i18n-ignore
    if (m.state === 'paused') {
      const stuck = [...turnsOf(events).values()].findLast((t) => t.state === 'held' || t.state === 'failed')
      const why = stuck?.state === 'failed' ? 'it stopped before the end' : (HELD[stuck?.reason ?? ''] ?? stuck?.reason ?? 'it waits') // i18n-ignore
      state = `paused: ${why}; it starts again as soon as it can, or the user can continue it in weevils` // i18n-ignore
    }
    const reply = events.findLast((e): e is MessageEvent => e.type === 'message' && e.role === 'assistant')
    const last = reply ? ` Last reply: "${cut(reply.text.replace(/\s+/g, ' ').trim(), 300)}"` : '' // i18n-ignore
    const head = `"${cut(m.title || 'Untitled', 120)}" (${m.project ?? 'no project'}): ${state}.` // i18n-ignore
    return ok(cut(`${head}${last}`, LIMITS.status))
  }
}

interface SendArgs {
  conversation?: string
  thread?: string
  app: App
  title?: string
  project?: string
  offset: number
  messages: { role: 'user' | 'assistant'; text: string }[]
  final: boolean
}
interface ContinueArgs {
  thread?: string
  conversation?: string
  app?: App
  instruction: string
  request: string
  project?: string
}
interface SearchArgs {
  query: string
  project?: string
  limit?: number
}
interface ReadArgs {
  thread: string
  mode: 'summary' | 'recent'
  count?: number
}
interface StatusArgs {
  thread?: string
  conversation?: string
  app?: App
}
