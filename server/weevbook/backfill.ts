// `weevils weevbook backfill`: every Claude Code and Codex session of this machine into the weevbook (decision D5 of
// docs/spec/README.md, taken at step 1: through the same adapters, one thread with one leg each, no checkpoint).
// Idempotent: a session already read is not read again, and running it twice writes nothing the second time.
// The default is everything. `--since <date>` keeps the sessions still active on or after that day, `--match <words>`
// those whose title or first request holds every word (docs/spec/07-vault.md, « The history »: a date, or a few
// conversations the person has in mind for another computer).

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTranscriptText } from '../transcripts.ts'
import type { Provider } from './journal.ts'
import { Locked, Weevbook } from './store.ts'
import { Sessions, accountOf, codexNames, syncSession, type Source, type SyncResult } from './sync.ts'

export interface BookPaths {
  /** DATA_DIR/weevbook */
  dir: string
  /** DATA_DIR/weevbook-sessions.jsonl */
  sessions: string
  claudeDir: string
  codexDir: string
  home: string
  machine: string
  roots: string[]
}

/** Every provider session file of this machine, oldest first: ~/.claude/projects/<folder>/<id>.jsonl (as the app
 *  reads them) and every day of ~/.codex/sessions. */
export async function allSessions(claudeDir: string, codexDir: string): Promise<Source[]> {
  const out: (Source & { mtime: number })[] = []
  const add = async (file: string, provider: Provider) => {
    const st = await fsp.stat(file).catch(() => null)
    if (st?.isFile()) out.push({ file, provider, mtime: st.mtimeMs })
  }
  for (const d of await fsp.readdir(claudeDir).catch(() => [] as string[])) {
    for (const f of await fsp.readdir(path.join(claudeDir, d)).catch(() => [] as string[])) if (f.endsWith('.jsonl')) await add(path.join(claudeDir, d, f), 'claude')
  }
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.jsonl')) await add(p, 'codex')
    }
  }
  await walk(codexDir)
  return out.sort((a, b) => a.mtime - b.mtime || (a.file < b.file ? -1 : 1)).map(({ file, provider }) => ({ file, provider }))
}

/** Which sessions an import takes: all of them by default. */
export interface BackfillFilter {
  /** Only sessions whose last line is at or after this time (ms). */
  since?: number
  /** Only sessions whose title or first request holds every one of these words (case and accents ignored). */
  match?: string
}

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const HEAD = 256 << 10
const TAIL = 64 << 10

/** Whether a session passes the filter, from its first and last lines only (its titles, its first request, its last
 *  line's time; the file's own date when no line says). */
export async function wanted(src: Source, filter: BackfillFilter, codexTitles: Map<string, string> = new Map()): Promise<boolean> {
  const words = plain(filter.match ?? '').split(/\s+/).filter(Boolean)
  if (filter.since === undefined && !words.length) return true
  const fd = await fsp.open(src.file, 'r').catch(() => null)
  if (!fd) return false
  try {
    const { size, mtimeMs } = await fd.stat()
    const head = Buffer.alloc(Math.min(size, HEAD))
    await fd.read(head, 0, head.length, 0)
    const tail = Buffer.alloc(size > HEAD ? Math.min(size - HEAD, TAIL) : 0)
    if (tail.length) await fd.read(tail, 0, tail.length, size - tail.length)
    // A line cut at either end is dropped.
    const h = size > head.length ? head.subarray(0, head.lastIndexOf(10) + 1) : head
    const t = tail.subarray(tail.indexOf(10) + 1)
    const tr = parseTranscriptText(src.file, src.provider, `${h.toString()}\n${t.toString()}`)
    if (filter.since !== undefined && (tr.lastActivityAt || mtimeMs) < filter.since) return false
    if (!words.length) return true
    const hay = plain([tr.customTitle, tr.title, codexTitles.get(tr.id), tr.firstPrompt].filter(Boolean).join('\n'))
    return words.every((w) => hay.includes(w))
  } finally {
    await fd.close()
  }
}

export interface BackfillReport {
  /** Sessions read (after the filter). */
  sessions: number
  /** Sessions the filter left out. */
  skipped: number
  created: number
  updated: number
  unchanged: number
  empty: number
  events: number
  lines: number
  refused: number
  failed: { file: string; error: string }[]
  main: string | null
}

export async function backfill(p: BookPaths, o: BackfillFilter & { now?: number; onSession?: (r: SyncResult, i: number, n: number) => void } = {}): Promise<BackfillReport> {
  const book = await Weevbook.open(p.dir, p.machine)
  const sessions = new Sessions(p.sessions)
  const codexHome = path.dirname(p.codexDir)
  const names = codexNames(codexHome)
  const accounts = new Map<Provider, string>()
  const account = (provider: Provider) => accounts.get(provider) ?? accounts.set(provider, accountOf(provider, p.home, codexHome)).get(provider)!
  const every = await allSessions(p.claudeDir, p.codexDir)
  const sources: Source[] = []
  for (const src of every) if (await wanted(src, o, names)) sources.push(src)
  const report: BackfillReport = { sessions: sources.length, skipped: every.length - sources.length, created: 0, updated: 0, unchanged: 0, empty: 0, events: 0, lines: 0, refused: 0, failed: [], main: null }
  let i = 0
  for (const src of sources) {
    i++
    // One session at a time under the lock: weevilsd's writer can go on between two.
    if (!(await book.lockWait())) throw new Locked('weevbook.lock')
    let wrote = false
    try {
      await sessions.load()
      const r = await syncSession(book, sessions, src, { now: o.now ?? Date.now(), final: true, roots: p.roots, machine: p.machine, account, codexNames: names })
      wrote = r.created || r.events > 0 || r.lines > 0
      if (r.empty) report.empty++
      else if (r.created) report.created++
      else if (wrote) report.updated++
      else report.unchanged++
      report.events += r.events
      report.lines += r.lines
      report.refused += r.refused
      o.onSession?.(r, i, sources.length)
    } catch (e) {
      report.failed.push({ file: src.file, error: (e as Error).message })
    } finally {
      await book.unlock(wrote)
    }
  }
  if (await book.lockWait()) {
    try {
      report.main = await book.compose()
      await book.tidy()
    } finally {
      await book.unlock(report.main !== null)
    }
  }
  return report
}

/** DATA_DIR/weevbook-backfilled: written once the first backfill of this machine went through. */
export const backfillMarker = (dataDir: string) => path.join(dataDir, 'weevbook-backfilled')

/**
 * The import at install (docs/spec/07-vault.md#the-history-retroactive-import): when this machine's weevbook was never
 * backfilled, `weevils weevbook backfill --once` runs in its own process at the lowest priority, so weevilsd and the
 * agents keep the CPU. It writes the marker when done; cut short (weevilsd stopped), it runs again next start and
 * reads only what it had not read (backfill is idempotent).
 */
export function startFirstBackfill(o: { dataDir: string; log?: (line: string) => void }): ChildProcess | null {
  const log = o.log ?? ((l: string) => console.error(l))
  const marker = backfillMarker(o.dataDir)
  if (fs.existsSync(marker)) return null
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.ts')
  const child = spawn(process.execPath, [...process.execArgv, cli, 'backfill', '--once', '--data-dir', o.dataDir], { stdio: 'ignore' })
  if (child.pid) {
    try {
      os.setPriority(child.pid, 19)
    } catch {
      /* not allowed: it runs at the normal priority */
    }
  }
  child.on('error', (e) => log(`[weevbook] first backfill: ${e.message}`))
  child.on('exit', (code) => log(`[weevbook] first backfill ${fs.existsSync(marker) ? 'done' : `stopped (${code})`}`))
  log('[weevbook] first backfill of this machine started, in the background')
  return child
}
