// `weevils weevbook compare`: the shadow comparison of step 1. For every provider session, what the app shows (the
// messages server/transcripts.ts makes of it, the same reader the live app uses) against what the weevbook holds for
// the same lines (its journal, as thread.md renders it). A message missing or altered is a loss.
//
// Differences that are intended, and counted apart:
// - redacted: the journal holds the text with what looks like a secret replaced (02-weevbook.md#redaction); the app
//   shows the provider's text.
// - long: a message over 1 MiB is cut in its event, the whole text is its message.txt attachment (02, failure cases).
// - error: the sentence a provider writes when it stops on an error (a usage limit) is a reply in the app; in the
//   journal it is the turn's `failed` state, not a message (01-thread.md, the adapter contract).
// - steps: Codex tool steps are compared by their call id, since the app labels them in the reader's language and the
//   journal does not translate (01-thread.md: the same lines give the same journal on every machine).
// Not compared: what the app adds from its own ledgers after reading (authors of relayed messages, server/message-
// origins.ts), and which messages a turn holds (the app has no turns).

import fsp from 'node:fs/promises'
import { parseTranscriptText } from '../transcripts.ts'
import { parseJournal, type JournalEvent, type Provider } from './journal.ts'
import { redactText } from './redact.ts'
import { Locked, Weevbook } from './store.ts'
import { Sessions, sessionKey, type Source } from './sync.ts'
import { allSessions } from './backfill.ts'

type Item =
  | { kind: 'said'; role: string; author?: string; text: string }
  | { kind: 'reply'; text: string }
  | { kind: 'step'; key: string }
  | { kind: 'failed' }

export interface SessionDiff {
  key: string
  file: string
  thread?: string
  appItems: number
  identical: number
  intended: Record<'redacted' | 'long' | 'error', number>
  missing: Item[]
  altered: { app: Item; book: Item }[]
  extra: Item[]
  /** Lines of the session not in the weevbook yet (a turn the writer has not committed). */
  unread: number
}
export interface CompareReport {
  sessions: number
  compared: number
  identical: number
  empty: number
  withoutThread: number
  messages: number
  identicalMessages: number
  intended: Record<'redacted' | 'long' | 'error', number>
  missing: Record<string, number>
  altered: Record<string, number>
  extra: Record<string, number>
  losses: number
  diffs: SessionDiff[]
}

/** The first `n` non-blank lines of a file, and how many more there are. */
async function head(file: string, n: number): Promise<{ text: string; more: number }> {
  const lines = (await fsp.readFile(file, 'utf8')).split('\n')
  const kept: string[] = []
  let more = 0
  for (const l of lines) {
    if (!l.trim()) continue
    if (kept.length < n) kept.push(l)
    else more++
  }
  return { text: kept.join('\n'), more }
}

function appItems(file: string, provider: Provider, text: string, cwd: string): Item[] {
  const t = parseTranscriptText(file, provider, text, Infinity)
  return t.messages.flatMap((m): Item[] => {
    if (m.role === 'event') return [{ kind: 'step', key: provider === 'claude' ? (cwd ? m.text.replaceAll(`${cwd}/`, '') : m.text) : m.id }]
    if (m.role === 'assistant') return [{ kind: 'reply', text: m.text }]
    if (m.role === 'orchestrator' && m.author === 'weevbook') return []
    return [{ kind: 'said', role: m.role, ...(m.role === 'orchestrator' ? { author: m.author ?? 'weevboss' } : {}), text: m.text }]
  })
}

function bookItems(events: readonly JournalEvent[], leg: string, provider: Provider): (Item & { long?: boolean })[] {
  const out: (Item & { long?: boolean })[] = []
  for (const e of events) {
    if (e.leg !== leg) continue
    if (e.type === 'message') {
      const item: Item = e.role === 'assistant' ? { kind: 'reply', text: e.text } : { kind: 'said', role: e.role, ...(e.author ? { author: e.author } : {}), text: e.text }
      out.push(item)
    } else if (e.type === 'attachment' && e.name === 'message.txt' && out.length) out[out.length - 1].long = true
    else if (e.type === 'tool') out.push({ kind: 'step', key: provider === 'claude' ? e.summary : e.call })
    else if (e.type === 'turn' && e.state === 'failed') out.push({ kind: 'failed' })
  }
  return out
}

/** How `a` (the app's) and `b` (the weevbook's) relate: the same, the same once redacted or cut, or not. */
function relate(a: Item, b: Item & { long?: boolean }): 'identical' | 'redacted' | 'long' | null {
  if (a.kind !== b.kind) return null
  if (a.kind === 'step') return a.key === (b as typeof a).key ? 'identical' : null
  if (a.kind === 'failed') return 'identical'
  const bt = (b as { text: string }).text
  if (a.kind === 'said' && (a.role !== (b as typeof a).role || a.author !== (b as typeof a).author)) return null
  if (a.text === bt) return 'identical'
  const red = redactText(a.text)
  if (red === bt) return 'redacted'
  if (b.long && bt === `${red.slice(0, 4000)}…`) return 'long'
  return null
}

export function diffSession(app: Item[], book: (Item & { long?: boolean })[]): Pick<SessionDiff, 'identical' | 'intended' | 'missing' | 'altered' | 'extra'> {
  const d = { identical: 0, intended: { redacted: 0, long: 0, error: 0 }, missing: [] as Item[], altered: [] as { app: Item; book: Item }[], extra: [] as Item[] }
  const WINDOW = 64
  let i = 0
  let j = 0
  while (i < app.length || j < book.length) {
    const a = app[i]
    const b = book[j]
    if (b?.kind === 'failed') {
      // The provider's own sentence about the failure: a reply in the app, the failed turn in the journal.
      if (a?.kind === 'reply' && !book.slice(j + 1, j + 1 + WINDOW).some((x) => relate(a, x))) {
        d.intended.error++
        i++
      }
      j++
      continue
    }
    if (a && b) {
      const r = relate(a, b)
      if (r) {
        if (r === 'identical') d.identical++
        else d.intended[r]++
        i++
        j++
        continue
      }
    }
    const jj = a ? book.slice(j, j + WINDOW).findIndex((x) => x.kind !== 'failed' && relate(a, x)) : -1
    const ii = b ? app.slice(i, i + WINDOW).findIndex((x) => relate(x, b)) : -1
    if (jj > 0 && (ii < 0 || jj <= ii)) {
      d.extra.push(...book.slice(j, j + jj).filter((x) => x.kind !== 'failed'))
      j += jj
    } else if (ii > 0) {
      d.missing.push(...app.slice(i, i + ii))
      i += ii
    } else if (a && b) {
      d.altered.push({ app: a, book: b })
      i++
      j++
    } else if (a) {
      d.missing.push(a)
      i++
    } else {
      d.extra.push(b)
      j++
    }
  }
  return d
}

export async function compare(p: { dir: string; sessions: string; claudeDir: string; codexDir: string; machine: string }): Promise<CompareReport> {
  const book = await Weevbook.open(p.dir, p.machine)
  // Under the lock: what it reads is not being written (weevilsd's writer waits for its next round).
  if (!(await book.lockWait())) throw new Locked('weevbook.lock')
  try {
    return await compareAll(book, p)
  } finally {
    await book.unlock(false)
  }
}

async function compareAll(book: Weevbook, p: { sessions: string; claudeDir: string; codexDir: string }): Promise<CompareReport> {
  const sessions = new Sessions(p.sessions)
  await sessions.load()
  const report: CompareReport = {
    sessions: 0, compared: 0, identical: 0, empty: 0, withoutThread: 0, messages: 0, identicalMessages: 0,
    intended: { redacted: 0, long: 0, error: 0 }, missing: {}, altered: {}, extra: {}, losses: 0, diffs: [],
  }
  const count = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1)
  for (const src of await allSessions(p.claudeDir, p.codexDir)) {
    report.sessions++
    const r = await compareSession(book, sessions, src)
    if (!r) {
      report.empty++
      continue
    }
    report.messages += r.appItems
    if (!r.thread) report.withoutThread++
    else report.compared++
    report.identicalMessages += r.identical
    for (const k of ['redacted', 'long', 'error'] as const) report.intended[k] += r.intended[k]
    for (const m of r.missing) count(report.missing, m.kind)
    for (const m of r.altered) count(report.altered, m.app.kind)
    for (const m of r.extra) count(report.extra, m.kind)
    report.losses += r.missing.length + r.altered.length
    if (!r.missing.length && !r.altered.length && !r.extra.length) report.identical++
    else report.diffs.push(r)
  }
  return report
}

/** One session: undefined when the app shows nothing for it (no message: no thread either). */
export async function compareSession(book: Weevbook, sessions: Sessions, src: Source): Promise<SessionDiff | undefined> {
  const key = sessionKey(src)
  const rec = sessions.get(key)
  const th = rec ? await book.thread(rec.thread) : undefined
  const leg = rec?.leg ?? 'L1'
  const lines = th && rec ? await book.rawLines(rec.thread, leg, src.provider) : Infinity
  const { text, more } = await head(src.file, lines)
  const events = th ? parseJournal(await fsp.readFile(book.abs(`${th.path}/events.jsonl`), 'utf8')).events : []
  const start = events.find((e) => e.type === 'leg.start' && e.leg === leg)
  const app = appItems(src.file, src.provider, text, start?.type === 'leg.start' ? start.cwd : '')
  if (!app.length) return undefined
  const base = { key, file: src.file, appItems: app.length, unread: Number.isFinite(lines) ? more : 0 }
  if (!th || !rec) return { ...base, identical: 0, intended: { redacted: 0, long: 0, error: 0 }, missing: app, altered: [], extra: [] }
  return { ...base, thread: rec.thread, ...diffSession(app, bookItems(events, leg, src.provider)) }
}
