// The weevbook's writer inside weevilsd, in shadow (step 1 of docs/spec/README.md): it follows the provider sessions
// the app reads and appends to their threads as turns complete. On only with WEEVILS_WEEVBOOK=1.
//
// It must never change what the app shows or does, nor slow it down: it reads the session files itself (never the
// app's transcripts), works from its own timer, one session at a time with a pause between lines, in a bounded queue,
// and every error stays here (logged once, never thrown into the app's loop). When `weevils weevbook backfill` holds
// the weevbook's lock, it waits for its turn.

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Provider } from './journal.ts'
import { Weevbook } from './store.ts'
import { REF_MS, Sessions, accountOf, codexNames, commitSubject, sessionKey, syncSession, type Follow, type Source } from './sync.ts'

export interface WriterOptions {
  /** DATA_DIR/weevbook */
  dir: string
  /** DATA_DIR/weevbook-sessions.jsonl */
  sessions: string
  machine: string
  home: string
  codexDir: string
  roots: string[]
  /** The provider sessions the app reads now (TranscriptStore's files). */
  sources: () => Source[]
  intervalMs?: number
  quietMs?: number
  staleMs?: number
  /** How often main is composed again after threads changed. */
  composeMs?: number
  log?: (line: string) => void
  now?: () => number
}

const MAX_QUEUE = 256
const RETRY_MS = 60_000
type Level = 0 | 1 | 2 // nothing settled, a quiet session settled, a session over settled

export function startWeevbookWriter(o: WriterOptions) {
  const interval = o.intervalMs ?? 3000
  const quietMs = o.quietMs ?? 10_000
  const staleMs = o.staleMs ?? 30 * 60_000
  const composeMs = o.composeMs ?? 60_000
  const now = o.now ?? Date.now
  const log = o.log ?? ((l: string) => console.error(l))
  const codexHome = path.dirname(o.codexDir)
  const sessions = new Sessions(o.sessions)
  const follows = new Map<string, Follow>()
  /** Each file as last synced: its size, what its silence had settled, and when to try again after an error. */
  const seen = new Map<string, { size: number; level: Level; retryAt?: number }>()
  const queue = new Map<string, Source>()
  /** Threads whose folder is ahead of their ref, and whose session is no longer followed: committed next round. */
  const unpublished = new Map<string, string>()
  const logged = new Set<string>()
  let book: Weevbook | null = null
  let busy = false
  let stopped = false
  let dirty = false
  let composedAt = 0
  let names = new Map<string, string>()
  let namesAt = 0
  const accounts = new Map<Provider, string>()
  let accountsAt = 0
  let idle: Promise<void> = Promise.resolve()

  const once = (key: string, e: unknown) => {
    const line = `[weevbook] ${key}: ${(e as Error)?.message ?? e}`
    if (logged.has(line)) return
    if (logged.size > 1000) logged.clear()
    logged.add(line)
    log(line)
  }
  const levelOf = (quiet: number): Level => (quiet >= staleMs ? 2 : quiet >= quietMs ? 1 : 0)

  async function scan() {
    for (const src of o.sources()) {
      if (queue.size >= MAX_QUEUE) break
      const st = await fsp.stat(src.file).catch(() => null)
      if (!st) continue
      const s = seen.get(src.file)
      const f = follows.get(sessionKey(src))
      // New lines, a silence long enough to settle something, or a running turn whose ref is due (REF_MS).
      const due = !s || st.size !== s.size || levelOf(now() - st.mtimeMs) > s.level || (!!f?.dirty && now() - f.refAt >= REF_MS) || (s.retryAt !== undefined && now() >= s.retryAt)
      if (due) queue.set(src.file, src)
    }
    // Sessions the app no longer reads: nothing to keep in memory for them, once their ref holds their folder.
    const live = new Set(o.sources().map(sessionKey))
    for (const [k, f] of follows) {
      if (live.has(k)) continue
      if (f.dirty && f.thread) unpublished.set(f.thread, commitSubject(f.adapter, o.machine))
      follows.delete(k)
    }
  }

  async function work() {
    book ??= await Weevbook.open(o.dir, o.machine)
    if (now() - namesAt > 60_000) {
      names = codexNames(codexHome)
      namesAt = now()
    }
    if (now() - accountsAt > 10 * 60_000) {
      accounts.clear()
      accountsAt = now()
    }
    const account = (p: Provider) => accounts.get(p) ?? accounts.set(p, accountOf(p, o.home, codexHome)).get(p)!
    for (const [file, src] of queue) {
      if (stopped) return
      if (!(await book.lock())) return // the command line holds it: next time
      let wrote = false
      try {
        queue.delete(file)
        await sessions.load()
        const st = await fsp.stat(file)
        const r = await syncSession(book, sessions, src, { now: now(), quietMs, staleMs, roots: o.roots, machine: o.machine, account, codexNames: names }, follows)
        wrote = r.created || r.events > 0 || r.lines > 0
        dirty ||= wrote
        seen.set(file, { size: st.size, level: levelOf(now() - st.mtimeMs) })
      } catch (e) {
        once(file, e)
        // Read from the start next time, when the file grows or in a minute: what is in memory may not match the
        // disk, and a file that fails every time must not be read again every 3 s.
        follows.delete(sessionKey(src))
        const cur = await fsp.stat(file).catch(() => null)
        seen.set(file, { size: cur?.size ?? -1, level: cur ? levelOf(now() - cur.mtimeMs) : 0, retryAt: now() + RETRY_MS })
      } finally {
        await book.unlock(wrote).catch((e) => once('unlock', e))
      }
      await new Promise<void>((r) => setImmediate(r))
    }
    if (unpublished.size && (await book.lock())) {
      try {
        for (const [thread, subject] of unpublished) {
          await book.commitThread(thread, subject).catch((e) => once(thread, e))
          unpublished.delete(thread)
        }
        dirty = true
      } finally {
        await book.unlock(false).catch((e) => once('unlock', e))
      }
    }
    if (dirty && now() - composedAt >= composeMs && (await book.lock())) {
      let composed = false
      try {
        composed = (await book.compose()) !== null
        await book.tidy()
        dirty = false
        composedAt = now()
      } catch (e) {
        once('main', e)
      } finally {
        await book.unlock(composed).catch((e) => once('unlock', e))
      }
    }
  }

  function round() {
    if (busy || stopped) return
    busy = true
    idle = (async () => {
      try {
        await scan()
        await work()
      } catch (e) {
        once('writer', e)
      } finally {
        busy = false
      }
    })()
  }

  const timer = setInterval(round, interval)
  timer.unref?.()
  setTimeout(round, Math.min(interval, 1000)).unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    /** One round now, and its end (tests). */
    async flush() {
      await idle
      round()
      await idle
    },
  }
}
