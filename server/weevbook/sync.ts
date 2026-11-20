// A provider session → its thread in the weevbook (step 1 of docs/spec/README.md, « shadow »). Used by the writer in
// weevilsd (writer.ts) and by `weevils weevbook backfill` (backfill.ts): the same code, so a session backfilled and
// then followed live gives one thread.
//
// One provider session is one thread with one leg, L1, of the engine that ran it. The session's lines go to raw, in
// order, and through its adapter into events. The raw line count is how far the session has been read: the journal
// and the raw segments are written together (store.ts), and only at a point where every line read is in the events
// (Adapter.safe). So nothing else needs to remember where the adapter stood: after a restart its lines are read again
// by the reader alone (feed), and its turn is taken from the journal (restore).
//
// The mapping provider session → thread is DATA_DIR/weevbook-sessions.jsonl: one line per session when its thread is
// made, and one per sync with how far it was read (the last line of a session wins). It is written before the thread,
// so that a crash never makes two threads for one session.

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { place } from '../projects.ts'
import { Adapter, ulid, type Out } from './adapters/adapter.ts'
import { ClaudeAdapter } from './adapters/claude.ts'
import { CodexAdapter } from './adapters/codex.ts'
import { slugify, type EventDraft, type Provider } from './journal.ts'
import { redactRawLine } from './redact.ts'
import type { Weevbook } from './store.ts'

export interface Source {
  file: string
  provider: Provider
}
export interface SessionRecord {
  key: string
  thread: string
  leg: string
  provider: Provider
  file: string
  /** Read so far: lines (= raw lines), the byte after the last of them, and the raw segments' bytes then. */
  lines?: number
  offset?: number
  rawBytes?: number
}

/** A session's key: provider and the session id of its file name. */
export function sessionKey(src: Source): string {
  const base = path.basename(src.file, '.jsonl')
  const id = src.provider === 'claude' ? base : (base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)?.[0] ?? base)
  return `${src.provider}:${id}`
}

/** DATA_DIR/weevbook-sessions.jsonl: provider session → thread, and how far it was read. Append-only, last wins. */
export class Sessions {
  readonly file: string
  private map = new Map<string, SessionRecord>()
  private lines = 0
  private mtime = -1
  constructor(file: string) {
    this.file = file
  }
  /** Reads the file again when another process wrote it. */
  async load() {
    const st = await fsp.stat(this.file).catch(() => null)
    if (!st || st.mtimeMs === this.mtime) return
    this.mtime = st.mtimeMs
    this.map.clear()
    this.lines = 0
    for (const line of (await fsp.readFile(this.file, 'utf8')).split('\n')) {
      if (!line) continue
      this.lines++
      try {
        const r = JSON.parse(line) as Partial<SessionRecord> & { key: string }
        const prev = this.map.get(r.key)
        if (prev || r.thread) this.map.set(r.key, { ...prev, ...r } as SessionRecord)
      } catch {
        /* a line cut by a crash */
      }
    }
    // Mostly progress lines superseded since: written again, one line per session.
    if (this.lines > 4 * this.map.size + 1000) {
      const tmp = `${this.file}.next`
      await fsp.writeFile(tmp, [...this.map.values()].map((r) => JSON.stringify(r) + '\n').join(''))
      await fsp.rename(tmp, this.file)
      this.lines = this.map.size
      this.mtime = (await fsp.stat(this.file)).mtimeMs
    }
  }
  get(key: string) {
    return this.map.get(key)
  }
  all() {
    return [...this.map.values()]
  }
  async record(r: Partial<SessionRecord> & { key: string }) {
    const merged = { ...this.map.get(r.key), ...r } as SessionRecord
    this.map.set(r.key, merged)
    const fh = await fsp.open(this.file, 'a')
    try {
      await fh.write(JSON.stringify(r) + '\n')
      await fh.sync()
    } finally {
      await fh.close()
    }
    this.lines++
    this.mtime = (await fsp.stat(this.file)).mtimeMs
  }
}

/** The account part of an engine id: the first six hex characters of the SHA-256 of the provider's own account id
 *  (01-thread.md). `unknown` when this machine's provider files do not say. */
export function accountOf(provider: Provider, home: string, codexHome: string): string {
  const read = (f: string) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch {
      return null
    }
  }
  const id = provider === 'claude' ? read(path.join(home, '.claude.json'))?.oauthAccount?.accountUuid : read(path.join(codexHome, 'auth.json'))?.tokens?.account_id
  return typeof id === 'string' && id ? crypto.createHash('sha256').update(id).digest('hex').slice(0, 6) : 'unknown'
}

/** A machine id as an engine id takes it. */
export const machinePart = (m: string) => m.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || 'machine'

/** The project of a folder (06-dispatch.md, « which thread »): the repository it is in, under a project root. */
export function projectOf(cwd: string | undefined, roots: string[]): string | null {
  if (!cwd) return null
  const p = place(cwd, roots)
  return p.kind === 'repo' && p.repo ? slugify(p.repo) || null : null
}

/** Codex's thread names (~/.codex/session_index.jsonl), by session id: its tail, the latest name wins. */
export function codexNames(codexHome: string): Map<string, string> {
  const names = new Map<string, string>()
  try {
    const idx = path.join(codexHome, 'session_index.jsonl')
    const size = fs.statSync(idx).size
    const len = Math.min(size, 1 << 18)
    const buf = Buffer.alloc(len)
    const fd = fs.openSync(idx, 'r')
    try {
      fs.readSync(fd, buf, 0, len, size - len)
    } finally {
      fs.closeSync(fd)
    }
    for (const line of buf.toString('utf8').split('\n')) {
      try {
        const o = JSON.parse(line) as { id?: string; thread_name?: string }
        if (o.id && typeof o.thread_name === 'string' && o.thread_name.trim()) names.set(o.id, o.thread_name.trim())
      } catch {
        /* a cut line */
      }
    }
  } catch {
    /* no index */
  }
  return names
}

/** Complete lines of a file from `start`, with the byte after each; blank lines are skipped. The rest after the last
 *  line feed is `partial` (a line still being written). */
async function* linesOf(file: string, start: number, end: number): AsyncGenerator<{ text: string; end: number } | { partial: string; at: number }> {
  const fh = await fsp.open(file, 'r')
  try {
    let pos = start
    let carry = Buffer.alloc(0)
    let carryAt = start
    const CHUNK = 4 << 20
    while (pos < end) {
      const buf = Buffer.alloc(Math.min(CHUNK, end - pos))
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      pos += bytesRead
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
      let from = 0
      for (let nl = data.indexOf(10); nl >= 0; nl = data.indexOf(10, from)) {
        const text = data.subarray(from, nl).toString('utf8')
        from = nl + 1
        if (text.trim()) yield { text, end: carryAt + from }
      }
      carry = Buffer.from(data.subarray(from))
      carryAt += from
    }
    if (carry.length) yield { partial: carry.toString('utf8'), at: carryAt }
  } finally {
    await fh.close()
  }
}

export interface SyncOptions {
  now: number
  /** Silence after which a reply waiting for its end is written and an ended turn closed (10 s). */
  quietMs?: number
  /** Silence after which the session is over: a turn still running is closed (30 min, the app's STALE_MS). */
  staleMs?: number
  /** Settle now, whatever the silence (backfill: the end of the file is the end of what there is). */
  final?: boolean
  roots: string[]
  machine: string
  account: (p: Provider) => string
  /** Codex thread names by session id. */
  codexNames?: Map<string, string>
}
export interface SyncResult {
  key: string
  thread?: string
  created: boolean
  events: number
  lines: number
  refused: number
  /** No message yet: no thread. */
  empty: boolean
  /** The thread's folder is ahead of its ref (a running turn, committed at its end or within REF_MS). */
  dirty: boolean
}

/** A session followed in memory (the writer): its adapter, how far it has read, what is read but not committed. */
export interface Follow {
  key: string
  adapter: Adapter
  /** The adapter has read the session's lines (false: only its turn state was restored, nothing new to read). */
  parsed: boolean
  offset: number
  committedLines: number
  raw: string[]
  outs: Out[]
  /** The last safe point among them. */
  mark: { raw: number; outs: number; offset: number }
  /** Its thread, once there is one. */
  thread?: string
  /** The thread's ref: the turn and state it was last committed at, when, and whether the folder is ahead of it. */
  refKey: string
  refAt: number
  dirty: boolean
}

/** How often a running turn's ref follows its folder (03-sync-and-lease.md: a commit at each lease renewal that has
 *  new events; there is no lease in step 1, the same pace). */
export const REF_MS = 60_000

const QUIET_MS = 10_000
const STALE_MS = 30 * 60_000
const YIELD_EVERY = 400
const COMMIT_BYTES = 32 << 20
const tick = () => new Promise<void>((r) => setImmediate(r))

function adapterFor(src: Source, engine: string, mtime: number): Adapter {
  const o = { file: src.file, engine, fallbackAt: mtime }
  return src.provider === 'claude' ? new ClaudeAdapter(o) : new CodexAdapter(o)
}
const parse = (text: string): { value: unknown } | 'not-json' => {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return 'not-json'
  }
}

/**
 * Brings one provider session's thread up to date: the lines written since the last time, and what the silence
 * since then settles. `follows` keeps the state of sessions between calls (the writer); without it, everything read
 * is settled and committed (backfill). Call under the weevbook's lock.
 */
export async function syncSession(book: Weevbook, sessions: Sessions, src: Source, o: SyncOptions, follows?: Map<string, Follow>): Promise<SyncResult> {
  const key = sessionKey(src)
  const rec = sessions.get(key)
  const st = await fsp.stat(src.file)
  const result: SyncResult = { key, thread: rec?.thread, created: false, events: 0, lines: 0, refused: 0, empty: false, dirty: false }
  const thread = rec ? await book.thread(rec.thread) : undefined
  const leg = rec?.leg ?? 'L1'

  // How far the weevbook says the session was read: the raw lines of its leg.
  let committed = 0
  let knownOffset: number | undefined
  if (rec && thread) {
    const bytes = await book.rawBytes(rec.thread, leg, src.provider)
    if (rec.lines !== undefined && rec.offset !== undefined && rec.rawBytes === bytes) {
      committed = rec.lines
      knownOffset = rec.offset
    } else committed = await book.rawLines(rec.thread, leg, src.provider)
  }
  let f = follows?.get(key)
  if (f && f.committedLines !== committed) f = undefined
  const grew = (at: number) => st.size > at
  if (f && !f.parsed && grew(f.offset)) f = undefined
  if (!f) {
    const engine = `${src.provider}:${o.account(src.provider)}@${machinePart(o.machine)}`
    const adapter = adapterFor(src, engine, st.mtimeMs)
    f = { key, adapter, parsed: true, offset: 0, committedLines: committed, raw: [], outs: [], mark: { raw: 0, outs: 0, offset: 0 }, thread: thread ? rec?.thread : undefined, refKey: '', refAt: 0, dirty: false }
    if (committed > 0 && thread) {
      if (knownOffset !== undefined && !grew(knownOffset)) {
        // Nothing new: the turn's state is enough to settle it.
        f.parsed = false
        f.offset = knownOffset
      } else {
        // The lines already in the weevbook, read again by the reader alone, then the turn from the journal.
        let n = 0
        for await (const l of linesOf(src.file, 0, st.size)) {
          if (!('text' in l)) break
          const p = parse(l.text)
          adapter.feed(p === 'not-json' ? undefined : p.value)
          f.offset = l.end
          if (++n === committed) break
          if (n % YIELD_EVERY === 0) await tick()
        }
        if (n < committed) throw new Error(`${src.file}: the weevbook has ${committed} lines of this session, the file ${n}`) // i18n-ignore: log line
      }
      adapter.restore(thread.journal.events, leg)
    }
    f.mark = { raw: 0, outs: 0, offset: f.offset }
    follows?.set(key, f)
  }
  const a = f.adapter
  const markIfSafe = () => {
    if (a.safe) f.mark = { raw: f.raw.length, outs: f.outs.length, offset: f.offset }
  }
  if (src.provider === 'codex') {
    f.outs.push(...a.setExternalTitle(o.codexNames?.get(a.t.id || key.slice('codex:'.length))))
    markIfSafe()
  }

  const commit = async () => {
    const m = f.mark
    const outs = f.outs.slice(0, m.outs)
    const raw = f.raw.slice(0, m.raw)
    if (!outs.length && !raw.length) return
    // A session that has said nothing yet (only its provider's bookkeeping) makes no thread.
    if (!result.thread || !(await book.thread(result.thread))) {
      if (!outs.some((x) => x.event.type === 'message' || x.event.type === 'tool')) return
    }
    const events: EventDraft[] = []
    let id = result.thread
    if (!id || !(await book.thread(id))) {
      id ??= ulid(a.firstAt ?? st.mtimeMs)
      if (!rec) await sessions.record({ key, thread: id, leg, provider: src.provider, file: src.file })
      result.thread = id
      f.thread = id
      result.created = true
      const at = new Date(a.firstAt ?? st.mtimeMs).toISOString()
      const project = projectOf(a.cwd, o.roots)
      events.push({ id: ulid(a.firstAt ?? st.mtimeMs), at, leg: null, type: 'meta', thread: id, ...(project ? { project } : {}) })
      events.push({ id: ulid(a.firstAt ?? st.mtimeMs), at, leg: leg as `L${number}`, type: 'leg.start', engine: a.engine, session: a.t.id || key.slice(key.indexOf(':') + 1), cwd: a.cwd ?? '', rung: 0, epoch: 1 })
    }
    const contents = new Map<string, Buffer>()
    for (const x of outs) {
      events.push({ ...x.event, leg: leg as `L${number}` } as EventDraft)
      if (x.content && x.event.type === 'attachment') contents.set(x.event.sha256, x.content)
    }
    const r = await book.append(id, { events, raw: { leg, provider: src.provider, lines: raw }, contents })
    result.events += r.written
    result.refused += r.refused
    result.lines += raw.length
    f.committedLines += raw.length
    f.raw.splice(0, m.raw)
    f.outs.splice(0, m.outs)
    f.mark = { raw: 0, outs: 0, offset: m.offset }
    await sessions.record({ key, lines: f.committedLines, offset: m.offset, rawBytes: await book.rawBytes(id, leg, src.provider) })
  }

  // The new lines.
  let partial: { partial: string; at: number } | undefined
  if (grew(f.offset)) {
    let n = 0
    let bytes = 0
    for await (const l of linesOf(src.file, f.offset, st.size)) {
      if (!('text' in l)) {
        partial = l
        break
      }
      const p = parse(l.text)
      f.raw.push(redactRawLine(l.text, p))
      f.outs.push(...a.line(p === 'not-json' ? undefined : p.value))
      f.offset = l.end
      bytes += l.text.length
      markIfSafe()
      if (bytes > COMMIT_BYTES && f.mark.raw > 0) {
        await commit()
        bytes = 0
      }
      if (++n % YIELD_EVERY === 0) await tick()
    }
  }

  // What the silence settles.
  const quiet = o.now - a.lastAt
  const hard = quiet >= (o.staleMs ?? STALE_MS)
  if (o.final || hard || quiet >= (o.quietMs ?? QUIET_MS)) {
    // A session over for good whose last line was never ended by a line feed: that line too.
    if (hard && partial?.partial.trim()) {
      const p = parse(partial.partial)
      f.raw.push(redactRawLine(partial.partial, p))
      f.outs.push(...a.line(p === 'not-json' ? undefined : p.value))
      f.offset = st.size
    }
    f.outs.push(...a.settle(hard))
    markIfSafe()
  }
  await commit()
  if (!result.thread || !(await book.thread(result.thread))) result.empty = true
  else {
    // The thread's ref follows its folder when a turn starts or ends, every REF_MS while one runs, and on a backfill
    // (which also makes the commit a crash missed).
    const k = refKey(a)
    const wrote = result.lines > 0 || result.events > 0
    if (o.final || ((wrote || f.dirty) && (k !== f.refKey || o.now - f.refAt >= REF_MS))) {
      await book.commitThread(result.thread, commitSubject(a, o.machine))
      Object.assign(f, { refKey: k, refAt: o.now, dirty: false })
    } else if (wrote) f.dirty = true
  }
  result.dirty = f.dirty
  return result
}

/** A turn and its state, as far as commits go: a turn ended whose last lines may still come is still running. */
const refKey = (a: Adapter) => `${a.turn}:${a.state === 'ended' || a.state === 'starting' ? 'running' : a.state}`

/** The subject of a thread commit (03-sync-and-lease.md): `turn 2 · claude · laptop`, `(running)` before its end. */
export function commitSubject(adapter: Adapter, machine: string): string {
  if (!adapter.turn) return `meta · ${machine}`
  const running = adapter.state === 'running' || adapter.state === 'ended'
  return `turn ${adapter.turn}${running ? ' (running)' : ''} · ${adapter.provider} · ${machine}`
}
