// The local weevbook: a git repository in DATA_DIR/weevbook (docs/spec/02-weevbook.md, 03-sync-and-lease.md).
//
//   weevbook/                       the files, laid out as `main` (README.md, index.json, projects/…): readable as is
//   weevbook/.git                   the repository (core.bare: no index, no checkout; git log and git show work)
//     refs/threads/<id>             one ref per thread: its folder's files at the root, fast-forward only
//     refs/heads/main               composed from the thread refs with git mktree, never read as truth
//     weevbook/index/<id>           a private index per thread, so that a commit hashes only what changed
//     weevbook/tx/<id>.json         a write in progress (below)
//   weevbook.lock                   one writer at a time: weevilsd's writer, or the weevils weevbook command
//
// Writing a thread changes several files at once: the journal and a raw segment grow, thread.md and meta.json are
// replaced, the folder may get a new name (its title changed). Before anything is touched, a small record of the write
// is saved with the size of each file that grows. The journal and the raw segments are appended to in place (a long
// session's segment is never copied), thread.md and meta.json are written beside and renamed (writeAtomic). The record
// is removed last. A record still there at the next start is a write a crash cut short: every file is cut back to its
// size before it, so the journal and its raw lines always move together, and the raw line count tells how far a
// provider session has been read. The session's next lines are read again from there.
//
// No hub in step 1: nothing is pushed. The refs are the ones a hub will receive (step 2).

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  FORMAT, Journal, JournalError, MAX_LINE_BYTES, MAX_RAW_BYTES, UNSORTED, attachmentFile, parseJournal, renderMeta, renderThread,
  serializeEvent, slugify, threadFolder, type EventDraft, type JournalEvent, type Provider, type ThreadMeta,
} from './journal.ts'
import { ulid } from './adapters/adapter.ts'
import { redactEvent } from './redact.ts'

/** The weevbook's own README.md (generated, the same on every machine). */
export const README = `# weevbook

This repository holds conversations with AI tools, one folder per thread. weevils writes it; you can read it.

- \`projects/<project>/<year-month>/<id>-<title>/\` is one thread. \`_unsorted\` holds threads without a project.
- \`index.json\` lists the threads and the commit each folder was taken from.
- \`thread.md\` is the thread as you would read it.
- \`events.jsonl\` is the journal: one event per line, only ever appended. It is the truth; the other files are
  rebuilt from it.
- \`meta.json\` is a summary of the journal: title, project, state.
- \`handoff.md\` is what another agent needs to continue the work.
- \`attachments/\` holds the files of the thread, named by their SHA-256.
- \`raw/\` holds the lines the AI tool itself wrote, kept to resume the thread on another machine.

Do not edit these files by hand: \`main\` is rebuilt from one git ref per thread (\`refs/threads/<id>\`).
Text that looks like a password or a key is replaced by \`[redacted]\` before it is written here.

Format: https://github.com/Sc4rville/weevils/tree/main/docs/spec
`

/** What one append brings to a thread. Events carry their leg; raw lines are already redacted (redactRawLine). */
export interface Batch {
  events: EventDraft[]
  raw?: { leg: string; provider: Provider; lines: string[] }
  /** The bytes of the attachment events, by SHA-256. An attachment without its bytes is not written. */
  contents?: Map<string, Buffer>
}

interface RawSegments {
  /** The last segment's number and size, and the bytes of all segments. */
  segment: number
  size: number
  bytes: number
}
interface ThreadState {
  id: string
  /** Its folder, from the weevbook's root. */
  path: string
  journal: Journal
  raw: Map<string, RawSegments>
}
export interface IndexEntry {
  thread: string
  path: string
  title: string
  project: string | null
  updated: string
  state: ThreadMeta['state']
  commit: string
}

const RAW_FILE = /^(L[1-9]\d*)\.(claude|codex)\.(\d{4})\.jsonl$/
const THREAD_DIR = /^([0-9A-HJKMNP-TV-Z]{26})-/
const exists = (p: string) => fsp.access(p).then(() => true, () => false)

/** One git command in the weevbook's repository; its output. Never interactive, never the user's hooks. */
function git(gitDir: string, args: string[], o: { cwd?: string; env?: Record<string, string>; input?: string | Buffer } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd: o.cwd ?? path.dirname(gitDir),
      env: { ...process.env, GIT_DIR: gitDir, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...o.env },
      maxBuffer: 1 << 30,
      encoding: 'utf8',
    }, (err, stdout, stderr) => (err ? reject(new Error(`git ${args[0]}: ${(stderr || err.message).trim()}`)) : resolve(stdout))) // i18n-ignore: git's own error, for the log
    // A command that exits before reading its input (an error) closes the pipe: its exit code says what happened.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(o.input ?? '')
  })
}

/** A file written beside its place and flushed: `<file>.next`. */
async function writeNext(file: string, write: (tmp: string) => Promise<void>) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.next`
  await write(tmp)
  const fh = await fsp.open(tmp, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
}
/** A small file replaced whole: written beside, flushed, renamed (docs/spec/02-weevbook.md#writing). */
export async function writeAtomic(file: string, data: string | Buffer) {
  await writeNext(file, (tmp) => fsp.writeFile(tmp, data))
  await fsp.rename(`${file}.next`, file)
}

/** The locks this process holds (one per Weevbook): their file says `<pid> <token>`. */
const HELD = new Set<string>()

/** The weevbook's lock is held by another live process. */
export class Locked extends Error {}

/** Text added at the end of a file, flushed to the disk before it returns. */
async function appendSync(file: string, text: string) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const fh = await fsp.open(file, 'a')
  try {
    await fh.write(text)
    await fh.sync()
  } finally {
    await fh.close()
  }
}

interface Tx {
  thread: string
  /** The folder before the write (null: a new thread) and after it. */
  from: string | null
  to: string
  /** Each file that grows (from the folder), and its size before the write: 0 for a file the write creates. */
  sizes: Record<string, number>
  /** Attachments the write adds. */
  created: string[]
}

export class Weevbook {
  readonly dir: string
  readonly gitDir: string
  readonly machine: string
  /** Where each thread's folder is, by id. */
  private paths = new Map<string, string>()
  /** Threads read lately (their journal in memory). */
  private cache = new Map<string, ThreadState>()
  private lockFile: string
  private stampFile: string
  private stamp = ''
  private locked = false
  private recovered = false
  private token = ''

  private constructor(dir: string, machine: string) {
    this.dir = path.resolve(dir)
    this.gitDir = path.join(this.dir, '.git')
    this.machine = machine
    this.lockFile = `${this.dir}.lock`
    this.stampFile = `${this.dir}.stamp`
  }

  /** The weevbook in `dir`, created when it is not there yet. Call under lock() for writes. */
  static async open(dir: string, machine: string): Promise<Weevbook> {
    const book = new Weevbook(dir, machine)
    await fsp.mkdir(book.dir, { recursive: true })
    if (!(await exists(path.join(book.gitDir, 'HEAD')))) {
      await git(book.gitDir, ['init', '-q', '--initial-branch=main'])
      await git(book.gitDir, ['config', 'core.bare', 'true'])
      if (!(await exists(path.join(book.dir, 'README.md')))) await writeAtomic(path.join(book.dir, 'README.md'), README)
    }
    await fsp.mkdir(path.join(book.gitDir, 'weevbook', 'index'), { recursive: true })
    await fsp.mkdir(path.join(book.gitDir, 'weevbook', 'tx'), { recursive: true })
    await book.scan()
    return book
  }

  // ---------------------------------------------------------------- one writer at a time

  /** Takes the weevbook's lock; false when another live process (or another Weevbook in this one) holds it. A lock
   *  left by a process that is gone is taken. */
  async lock(): Promise<boolean> {
    if (this.locked) return true
    const token = `${process.pid} ${crypto.randomBytes(6).toString('hex')}`
    for (let tries = 0; tries < 2; tries++) {
      try {
        await fsp.writeFile(this.lockFile, `${token}\n`, { flag: 'wx' })
        this.locked = true
        this.token = token
        HELD.add(token)
        // Another process wrote since this one last held the lock: what is in memory is stale.
        const stamp = await fsp.readFile(this.stampFile, 'utf8').catch(() => '')
        if (stamp !== this.stamp || !this.recovered) {
          this.recovered = true
          this.cache.clear()
          await this.recover()
          await this.scan()
          this.stamp = stamp
        }
        return true
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const held = (await fsp.readFile(this.lockFile, 'utf8').catch(() => '')).trim()
        const pid = Number(held.split(' ')[0])
        // This process: held by another Weevbook of it, or left by an earlier process with the same pid (a reboot).
        let alive = pid === process.pid ? HELD.has(held) : false
        if (pid > 0 && pid !== process.pid) {
          try {
            process.kill(pid, 0)
            alive = true
          } catch (err) {
            alive = (err as NodeJS.ErrnoException).code === 'EPERM'
          }
        }
        if (alive) return false
        await fsp.rm(this.lockFile, { force: true })
      }
    }
    return false
  }
  /** Waits for the lock (the command line: weevilsd's writer holds it a moment at a time). */
  async lockWait(ms = 120_000): Promise<boolean> {
    const until = Date.now() + ms
    while (!(await this.lock())) {
      if (Date.now() > until) return false
      await new Promise((r) => setTimeout(r, 200))
    }
    return true
  }
  async unlock(wrote: boolean) {
    if (!this.locked) return
    if (wrote) {
      this.stamp = crypto.randomBytes(8).toString('hex')
      await writeAtomic(this.stampFile, this.stamp)
    }
    await fsp.rm(this.lockFile, { force: true })
    HELD.delete(this.token)
    this.locked = false
  }

  // ---------------------------------------------------------------- reading

  /** Every thread folder on disk, by id. */
  private async scan() {
    this.paths.clear()
    const root = path.join(this.dir, 'projects')
    for (const project of await fsp.readdir(root).catch(() => [] as string[])) {
      for (const month of await fsp.readdir(path.join(root, project)).catch(() => [] as string[])) {
        for (const name of await fsp.readdir(path.join(root, project, month)).catch(() => [] as string[])) {
          const m = THREAD_DIR.exec(name)
          if (m && !this.paths.has(m[1])) this.paths.set(m[1], `projects/${project}/${month}/${name}`)
        }
      }
    }
  }

  threads(): { id: string; path: string }[] {
    return [...this.paths].map(([id, p]) => ({ id, path: p })).sort((a, b) => (a.id < b.id ? -1 : 1))
  }
  pathOf(id: string): string | undefined {
    return this.paths.get(id)
  }
  abs(rel: string) {
    return path.join(this.dir, rel)
  }

  /** A thread's journal and raw segments, read from its folder; undefined when there is no such folder. */
  async thread(id: string): Promise<ThreadState | undefined> {
    const cached = this.cache.get(id)
    if (cached) return cached
    const rel = this.paths.get(id)
    if (!rel) return undefined
    const dir = this.abs(rel)
    // Files a write left beside their place before it was recorded: that write never happened.
    for (const f of await walk(dir)) if (f.endsWith('.next')) await fsp.rm(path.join(dir, f), { force: true })
    const text = await fsp.readFile(path.join(dir, 'events.jsonl'), 'utf8').catch(() => '')
    const th: ThreadState = { id, path: rel, journal: new Journal(parseJournal(text).events), raw: new Map() }
    for (const name of await fsp.readdir(path.join(dir, 'raw')).catch(() => [] as string[])) {
      const m = RAW_FILE.exec(name)
      if (!m) continue
      const size = (await fsp.stat(path.join(dir, 'raw', name))).size
      const key = `${m[1]}.${m[2]}`
      const r = th.raw.get(key) ?? { segment: 0, size: 0, bytes: 0 }
      r.bytes += size
      if (Number(m[3]) > r.segment) Object.assign(r, { segment: Number(m[3]), size })
      th.raw.set(key, r)
    }
    this.remember(th)
    return th
  }
  private remember(th: ThreadState) {
    this.cache.delete(th.id)
    this.cache.set(th.id, th)
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
  }

  /** The bytes of a leg's raw segments, all of them. */
  async rawBytes(id: string, leg: string, provider: Provider): Promise<number> {
    return (await this.thread(id))?.raw.get(`${leg}.${provider}`)?.bytes ?? 0
  }
  /** How many lines a leg's raw segments hold: how far its provider session has been read. */
  async rawLines(id: string, leg: string, provider: Provider): Promise<number> {
    const th = await this.thread(id)
    const r = th?.raw.get(`${leg}.${provider}`)
    if (!th || !r) return 0
    let n = 0
    for (let s = 1; s <= r.segment; s++) {
      const buf = await fsp.readFile(path.join(this.abs(th.path), 'raw', `${leg}.${provider}.${String(s).padStart(4, '0')}.jsonl`)).catch(() => Buffer.alloc(0))
      for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) n++
    }
    return n
  }

  // ---------------------------------------------------------------- writing

  /**
   * Appends events and raw lines to a thread (created when it is not there yet). Every event is redacted and checked
   * against the journal (appendEvent); an event the journal refuses is kept in a `note` instead, never dropped
   * silently. Returns how many events were written and how many were refused.
   */
  async append(id: string, batch: Batch): Promise<{ written: number; refused: number }> {
    const th = (await this.thread(id)) ?? { id, path: '', journal: new Journal(), raw: new Map() }
    try {
      return await this.write(th, batch)
    } catch (e) {
      // Cut short (a full disk…): the files go back to where they were, and what is in memory is read again.
      this.cache.delete(id)
      await this.rollback(id).catch(() => undefined)
      throw e
    }
  }

  private async write(th: ThreadState, batch: Batch) {
    const lines: string[] = []
    const files = new Map<string, Buffer>()
    let refused = 0
    const add = (draft: EventDraft) => {
      try {
        const line = th.journal.append(draft)
        if (line) lines.push(line)
      } catch (e) {
        if (!(e instanceof JournalError)) throw e
        refused++
        const note = { id: ulid(Date.parse(draft.at)), at: draft.at, leg: null, type: 'note', kind: 'debug', text: `refused: ${e.message}`, data: { event: draft } } as EventDraft // i18n-ignore: journal text
        const line = th.journal.append(note)
        if (line) lines.push(line)
      }
    }
    for (const d of batch.events) {
      const draft = redactEvent(d)
      if (draft.type === 'attachment') {
        const data = batch.contents?.get(draft.sha256)
        // The event is not written until its file is in place (02-weevbook.md, failure cases).
        if (!data) continue
        files.set(attachmentFile(draft), data)
        add(draft)
      } else if (draft.type === 'message' && Buffer.byteLength(serializeEvent({ ...draft, v: FORMAT, seq: th.journal.events.length + 1 } as JournalEvent)) > MAX_LINE_BYTES) {
        // Longer than a journal line may be: the start in the event, the whole text as message.txt right after.
        const data = Buffer.from(draft.text)
        add({ ...draft, text: `${draft.text.slice(0, 4000)}…` })
        const sha256 = crypto.createHash('sha256').update(data).digest('hex')
        const attachment = { id: ulid(Date.parse(draft.at)), at: draft.at, leg: draft.leg, type: 'attachment', role: draft.role === 'assistant' ? 'assistant' : 'user', sha256, name: 'message.txt', mime: 'text/plain', bytes: data.byteLength } as EventDraft
        files.set(attachmentFile(attachment as { sha256: string; name: string }), data)
        add(attachment)
      } else add(draft)
    }

    // Raw: the current segment grows until the next line would pass 16 MiB; then the next one starts.
    const segments = new Map<string, { base: number; text: string[] }>()
    if (batch.raw?.lines.length) {
      const { leg, provider } = batch.raw
      const key = `${leg}.${provider}`
      const r = th.raw.get(key) ?? { segment: 1, size: 0, bytes: 0 }
      for (let line of batch.raw.lines) {
        let n = Buffer.byteLength(line) + 1
        if (n > MAX_RAW_BYTES) {
          line = JSON.stringify({ weevbook: 'omitted', reason: 'line over 16 MiB', bytes: n - 1, sha256: crypto.createHash('sha256').update(line).digest('hex') }) // i18n-ignore: raw marker
          n = Buffer.byteLength(line) + 1
        }
        if (r.size > 0 && r.size + n > MAX_RAW_BYTES) Object.assign(r, { segment: r.segment + 1, size: 0 })
        const name = `raw/${key}.${String(r.segment).padStart(4, '0')}.jsonl`
        const seg = segments.get(name) ?? { base: r.size, text: [] }
        seg.text.push(line, '\n')
        segments.set(name, seg)
        r.size += n
        r.bytes += n
      }
      th.raw.set(key, r)
    }
    if (!lines.length && !segments.size) return { written: 0, refused }

    const from = th.path || null
    const to = threadFolder(th.journal.events)
    const dir = this.abs(to)
    const sizes: Record<string, number> = {}
    const old = from ? this.abs(from) : dir
    if (lines.length) sizes['events.jsonl'] = (await fsp.stat(path.join(old, 'events.jsonl')).catch(() => null))?.size ?? 0
    for (const [rel, seg] of segments) sizes[rel] = seg.base
    const created: string[] = []
    for (const rel of files.keys()) if (!(await exists(path.join(old, rel)))) created.push(rel)

    const tx: Tx = { thread: th.id, from, to, sizes, created }
    await writeAtomic(this.txFile(th.id), JSON.stringify(tx))
    if (from && from !== to) await this.move(from, to)
    // The attachments first: an event never names a file that is not there (02-weevbook.md, failure cases).
    for (const rel of created) await writeAtomic(path.join(dir, rel), files.get(rel)!)
    if (lines.length) await appendSync(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n`)
    for (const [rel, seg] of segments) await appendSync(path.join(dir, rel), seg.text.join(''))
    await writeAtomic(path.join(dir, 'thread.md'), renderThread(th.journal.events))
    await writeAtomic(path.join(dir, 'meta.json'), renderMeta(th.journal.events))
    await fsp.rm(this.txFile(th.id), { force: true })
    th.path = to
    this.paths.set(th.id, to)
    this.remember(th)
    return { written: lines.length, refused }
  }

  private txFile(id: string) {
    return path.join(this.gitDir, 'weevbook', 'tx', `${id}.json`)
  }

  /** A thread's folder to its new name; the project and month folders it leaves are removed when empty. */
  private async move(from: string, to: string) {
    await fsp.mkdir(path.dirname(this.abs(to)), { recursive: true })
    await fsp.rename(this.abs(from), this.abs(to))
    await this.prune(path.dirname(this.abs(from)))
  }
  /** Empty month and project folders, from `dir` up. */
  private async prune(dir: string) {
    for (let p = dir; p.startsWith(path.join(this.dir, 'projects') + path.sep); p = path.dirname(p)) {
      if ((await fsp.readdir(p).catch(() => ['x'])).length) break
      await fsp.rmdir(p).catch(() => undefined)
    }
  }

  /** Undoes a write that was cut short (its record is still there): each file back to its size before, the added
   *  attachments removed, thread.md and meta.json rebuilt, the folder under the name its journal gives. */
  private async rollback(id: string) {
    let tx: Tx
    try {
      tx = JSON.parse(await fsp.readFile(this.txFile(id), 'utf8')) as Tx
    } catch {
      // No record, or one cut before it was renamed into place: that write never started.
      await fsp.rm(this.txFile(id), { force: true })
      return
    }
    this.cache.delete(id)
    const at = (await exists(this.abs(tx.to))) ? tx.to : tx.from && (await exists(this.abs(tx.from))) ? tx.from : null
    if (at && tx.from === null) {
      // A thread this write was creating: nothing of it was there before.
      await fsp.rm(this.abs(at), { recursive: true, force: true })
      await this.prune(path.dirname(this.abs(at)))
      this.paths.delete(id)
    } else if (at) {
      const dir = this.abs(at)
      for (const [rel, size] of Object.entries(tx.sizes)) {
        const file = path.join(dir, rel)
        if (size === 0) await fsp.rm(file, { force: true })
        else await fsp.truncate(file, size).catch(() => undefined)
      }
      for (const rel of tx.created) await fsp.rm(path.join(dir, rel), { force: true })
      for (const f of await walk(dir)) if (f.endsWith('.next')) await fsp.rm(path.join(dir, f), { force: true })
      const events = parseJournal(await fsp.readFile(path.join(dir, 'events.jsonl'), 'utf8').catch(() => '')).events
      await writeAtomic(path.join(dir, 'thread.md'), renderThread(events))
      await writeAtomic(path.join(dir, 'meta.json'), renderMeta(events))
      const name = threadFolder(events)
      if (name !== at) await this.move(at, name)
      this.paths.set(id, name)
    }
    await fsp.rm(this.txFile(id), { force: true })
  }

  /** Writes a crash cut short: undone. */
  private async recover() {
    for (const name of await fsp.readdir(path.join(this.gitDir, 'weevbook', 'tx')).catch(() => [] as string[])) {
      if (name.endsWith('.json')) await this.rollback(name.slice(0, -'.json'.length))
      else await fsp.rm(path.join(this.gitDir, 'weevbook', 'tx', name), { force: true })
    }
    // An adopt cut short (step 2): the new folder is put in place when the thread has none, then the rest goes.
    const adopting = path.join(this.gitDir, 'weevbook', 'adopt')
    for (const id of await fsp.readdir(adopting).catch(() => [] as string[])) {
      const next = path.join(adopting, id, 'next')
      if ((await exists(path.join(next, 'events.jsonl'))) && !this.paths.has(id)) {
        const events = parseJournal(await fsp.readFile(path.join(next, 'events.jsonl'), 'utf8')).events
        const rel = threadFolder(events)
        await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true })
        await fsp.rename(next, this.abs(rel)).catch(() => undefined)
      }
      await fsp.rm(path.join(adopting, id), { recursive: true, force: true })
    }
  }

  /**
   * The thread becomes the tree of `commit` (the hub's version of it, docs/spec/03-sync-and-lease.md): its folder is
   * written beside, then swapped in place of the one it had, and refs/threads/<id> is moved there, whatever it held
   * (what this machine wrote and the hub refused is in an orphan ref by then). Hook of the hub sync (step 2). Call
   * under lock().
   */
  async adopt(id: string, commit: string): Promise<string> {
    const events = parseJournal(await git(this.gitDir, ['cat-file', 'blob', `${commit}:events.jsonl`])).events
    const rel = threadFolder(events)
    const work = path.join(this.gitDir, 'weevbook', 'adopt', id)
    const next = path.join(work, 'next')
    await fsp.rm(work, { recursive: true, force: true })
    await fsp.mkdir(next, { recursive: true })
    const env = { GIT_INDEX_FILE: path.join(work, 'index'), GIT_WORK_TREE: next }
    await git(this.gitDir, ['read-tree', commit], { env })
    await git(this.gitDir, ['checkout-index', '-a', '-f'], { cwd: next, env })
    await fsp.rm(path.join(work, 'index'), { force: true })
    const old = this.paths.get(id)
    if (old) await fsp.rename(this.abs(old), path.join(work, 'old'))
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true })
    await fsp.rename(next, this.abs(rel))
    await fsp.rm(work, { recursive: true, force: true })
    if (old && old !== rel) await this.prune(path.dirname(this.abs(old)))
    await fsp.rm(path.join(this.gitDir, 'weevbook', 'index', id), { force: true })
    await git(this.gitDir, ['update-ref', `refs/threads/${id}`, commit])
    this.paths.set(id, rel)
    this.cache.delete(id)
    return rel
  }

  /** Rebuilds thread.md and meta.json from the journal (02-weevbook.md: « rebuilt … by weevils weevbook check »). */
  async rebuild(id: string): Promise<boolean> {
    const th = await this.thread(id)
    if (!th) return false
    const dir = this.abs(th.path)
    let changed = false
    for (const [name, body] of [['thread.md', renderThread(th.journal.events)], ['meta.json', renderMeta(th.journal.events)]] as const) {
      if ((await fsp.readFile(path.join(dir, name), 'utf8').catch(() => null)) === body) continue
      await writeAtomic(path.join(dir, name), body)
      changed = true
    }
    return changed
  }

  // ---------------------------------------------------------------- git

  private author() {
    return authorEnv(this.machine)
  }
  private async ref(name: string): Promise<string | null> {
    return (await git(this.gitDir, ['rev-parse', '-q', '--verify', `${name}^{commit}`]).catch(() => '')).trim() || null
  }

  /** The tree of a thread's folder as it is on disk (a private index: only changed files are hashed again). */
  async folderTree(id: string): Promise<string | null> {
    const rel = this.paths.get(id)
    if (!rel) return null
    const env = { GIT_WORK_TREE: this.abs(rel), GIT_INDEX_FILE: path.join(this.gitDir, 'weevbook', 'index', id) }
    await git(this.gitDir, ['add', '-A', '.'], { cwd: this.abs(rel), env })
    return (await git(this.gitDir, ['write-tree'], { env })).trim()
  }

  /** The commit of a thread's ref (null: none yet). */
  threadRef(id: string) {
    return this.ref(`refs/threads/${id}`)
  }

  /** Commits a thread's folder to refs/threads/<id>, fast-forward (03-sync-and-lease.md). The new commit, or the
   *  current one when nothing changed. */
  async commitThread(id: string, subject: string): Promise<string | null> {
    const tree = await this.folderTree(id)
    if (!tree) return null
    const old = await this.threadRef(id)
    if (old && (await git(this.gitDir, ['rev-parse', `${old}^{tree}`])).trim() === tree) return old
    const commit = (await git(this.gitDir, ['commit-tree', tree, ...(old ? ['-p', old] : []), '-m', subject], { env: this.author() })).trim()
    await git(this.gitDir, ['update-ref', `refs/threads/${id}`, commit, old ?? ''])
    return commit
  }

  /** The thread refs and the meta.json of each tip. */
  async refs(): Promise<{ id: string; commit: string; tree: string; meta: ThreadMeta }[]> {
    return threadRefs(this.gitDir)
  }

  /**
   * Composes `main` from the thread refs (03-sync-and-lease.md#composing-main): each thread's tree, as it is, at
   * projects/<project>/<YYYY-MM>/<id>-<slug>/, with README.md and index.json, built with git mktree and committed
   * with the previous main as parent. The files on disk follow. Returns the new commit, or null when nothing changed.
   */
  async compose(): Promise<string | null> {
    const r = await composeMain(this.gitDir, this.machine)
    await writeAtomic(path.join(this.dir, 'README.md'), README)
    await writeAtomic(path.join(this.dir, 'index.json'), r.indexJson)
    return r.commit
  }

  /** index.json of `main` (empty when main does not exist yet). */
  async mainIndex(): Promise<IndexEntry[] | null> {
    const text = await git(this.gitDir, ['cat-file', 'blob', 'refs/heads/main:index.json']).catch(() => null)
    return text === null ? null : (JSON.parse(text) as { threads: IndexEntry[] }).threads
  }
  /** The bytes of an object (`<commit>:<path>`); null when there is none. */
  async blob(spec: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      execFile('git', ['cat-file', 'blob', spec], { env: { ...process.env, GIT_DIR: this.gitDir }, encoding: 'buffer', maxBuffer: 1 << 30 }, (err, out) => resolve(err ? null : out))
    })
  }
  /** The tree of a commit. */
  async treeOf(commit: string): Promise<string> {
    return (await git(this.gitDir, ['rev-parse', `${commit}^{tree}`])).trim()
  }
  /** Whether `commit` is `tip` or one of its ancestors. */
  async isAncestor(commit: string, tip: string): Promise<boolean> {
    return git(this.gitDir, ['merge-base', '--is-ancestor', commit, tip]).then(() => true, () => false)
  }
  /** Packs loose objects once there are many (a long thread rewrites its raw segment at each turn). */
  async tidy() {
    await git(this.gitDir, ['gc', '--auto', '--quiet']).catch(() => undefined)
  }
}

const authorEnv = (machine: string) => {
  const who = { name: 'weevils', email: `weevils@${machine}` }
  return { GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email, GIT_COMMITTER_NAME: who.name, GIT_COMMITTER_EMAIL: who.email }
}

/** The thread refs of a repository (`refs/threads/*`) and the meta.json of each tip. */
export async function threadRefs(gitDir: string): Promise<{ id: string; commit: string; tree: string; meta: ThreadMeta }[]> {
  const list = (await git(gitDir, ['for-each-ref', '--format=%(objectname) %(tree) %(refname)', 'refs/threads/'])).trim()
  if (!list) return []
  const rows = list.split('\n').map((l) => {
    const [commit, tree, ref] = l.split(' ')
    return { id: ref.slice('refs/threads/'.length), commit, tree }
  })
  const out = await git(gitDir, ['cat-file', '--batch'], { input: rows.map((r) => `${r.commit}:meta.json\n`).join('') })
  const buf = Buffer.from(out)
  const metas: ThreadMeta[] = []
  let pos = 0
  for (let i = 0; i < rows.length; i++) {
    const nl = buf.indexOf(10, pos)
    const head = buf.subarray(pos, nl).toString().split(' ')
    const size = Number(head[2])
    metas.push(JSON.parse(buf.subarray(nl + 1, nl + 1 + size).toString()) as ThreadMeta)
    pos = nl + 1 + size + 1
  }
  return rows.map((r, i) => ({ ...r, meta: metas[i] }))
}

/**
 * `main` composed from a repository's thread refs, committed on its previous `main` (03-sync-and-lease.md#composing-
 * main): the weevbook's own, or the hub's on the machine that keeps it (hub.ts). `commit` is null when nothing changed.
 */
export async function composeMain(gitDir: string, machine: string): Promise<{ commit: string | null; indexJson: string }> {
  const refs = await threadRefs(gitDir)
  const index: IndexEntry[] = []
  const months = new Map<string, Map<string, string>>()
  for (const r of refs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const m = r.meta
    const project = m.project ?? UNSORTED
    const month = m.created.slice(0, 7)
    const name = `${m.thread}-${slugify(m.title) || 'untitled'}`
    index.push({ thread: m.thread, path: `projects/${project}/${month}/${name}`, title: m.title, project: m.project, updated: m.updated, state: m.state, commit: r.commit })
    const key = `${project}/${month}`
    if (!months.has(key)) months.set(key, new Map())
    months.get(key)!.set(name, r.tree)
  }
  const mktree = async (entries: string[]) => (await git(gitDir, ['mktree'], { input: entries.join('\n') + (entries.length ? '\n' : '') })).trim()
  const blob = async (data: string) => (await git(gitDir, ['hash-object', '-w', '--stdin'], { input: data })).trim()
  const projects = new Map<string, string[]>()
  for (const [key, threads] of months) {
    const [project, month] = key.split('/')
    const tree = await mktree([...threads].map(([name, t]) => `040000 tree ${t}\t${name}`))
    projects.set(project, [...(projects.get(project) ?? []), `040000 tree ${tree}\t${month}`])
  }
  const projectEntries: string[] = []
  for (const [project, entries] of projects) projectEntries.push(`040000 tree ${await mktree(entries)}\t${project}`)
  const indexJson = `${JSON.stringify({ v: 1, threads: index }, null, 2)}\n`
  const root = [`100644 blob ${await blob(README)}\tREADME.md`, `100644 blob ${await blob(indexJson)}\tindex.json`]
  if (projectEntries.length) root.push(`040000 tree ${await mktree(projectEntries)}\tprojects`)
  const tree = await mktree(root)
  const old = (await git(gitDir, ['rev-parse', '-q', '--verify', 'refs/heads/main^{commit}']).catch(() => '')).trim() || null
  if (old && (await git(gitDir, ['rev-parse', `${old}^{tree}`])).trim() === tree) return { commit: null, indexJson }
  // The message lists the thread commits added since the previous main.
  const before = new Map<string, string>()
  if (old) {
    const prev = await git(gitDir, ['cat-file', 'blob', `${old}:index.json`]).catch(() => '')
    for (const t of (prev ? (JSON.parse(prev) as { threads: IndexEntry[] }).threads : [])) before.set(t.thread, t.commit)
  }
  const added = index.filter((t) => before.get(t.thread) !== t.commit)
  const message = [`compose · ${machine} · ${added.length} thread${added.length === 1 ? '' : 's'}`, '', ...added.map((t) => `${t.commit.slice(0, 12)} ${t.thread} ${t.title}`)].join('\n') // i18n-ignore: commit message
  const commit = (await git(gitDir, ['commit-tree', tree, ...(old ? ['-p', old] : []), '-m', message], { env: authorEnv(machine) })).trim()
  await git(gitDir, ['update-ref', 'refs/heads/main', commit, old ?? ''])
  return { commit, indexJson }
}

/** Every file under `dir`, by path inside it. */
export async function walk(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) await walk(p, base, out)
    else out.push(path.relative(base, p))
  }
  return out
}
