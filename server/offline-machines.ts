// The conversations of a machine that stops answering (a PC asleep, its tunnel cut, this weevilsd restarted meanwhile)
// stay in the list and stay readable: never gone, never a dead row. Two sources, in this order:
//
// - the rows that machine showed the last time it answered, kept on disk (a restart here does not forget them);
// - the weevbook: a thread synced here whose last leg is still open on that machine is a row too, and its history is
//   read from the thread's journal (refs/threads/<id>), whatever this machine knew of it before.
//
// Such a row is marked `offline`: nothing runs it from here, its history is the synced one, and a move
// (`weevils weevbook move`) is how it continues elsewhere.

import fs from 'node:fs'
import path from 'node:path'
import type { Message, Session, SessionDetail, Tool } from '../shared/api.ts'
import { MISC } from './projects.ts'
import { runGit } from './weevbook/gitrun.ts'
import { parseEngine, parseJournal, type JournalEvent, type ThreadMeta } from './weevbook/journal.ts'
import { threadRefs } from './weevbook/store.ts'

/** A thread synced here counts as a conversation of an offline machine while it was active in the last week. */
export const OFFLINE_KEEP_MS = 7 * 24 * 3600_000

/** The rows a machine showed the last time it answered, on disk. */
export class KeptRows {
  private last = ''
  private readonly file: string
  constructor(file: string) {
    this.file = file
  }
  load(): Session[] {
    try {
      const rows = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown
      return Array.isArray(rows) ? (rows as Session[]).filter((s) => s && typeof s.id === 'string' && typeof s.machineId === 'string') : []
    } catch {
      return []
    }
  }
  /** Written only when it changed (a machine that answers every 2 s does not rewrite the file every 2 s). */
  save(rows: Session[]) {
    const text = JSON.stringify(rows)
    if (text === this.last) return
    this.last = text
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(`${this.file}.next`, text)
      fs.renameSync(`${this.file}.next`, this.file)
    } catch {
      // A full disk: the rows stay in memory, the file catches up at the next change.
    }
  }
}

/** A row of a machine that does not answer: readable, never live, never at work, never written to from here. */
export function offlineRow(s: Session): Session {
  return {
    ...s,
    offline: true,
    live: false,
    controllable: false,
    hasScreen: false,
    status: s.status === 'working' || s.status === 'needs_user' ? 'idle' : s.status,
    turnWorking: false,
    workStartedAt: null,
    queued: 0,
    subagents: [],
    background: 0,
    choices: undefined,
    attention: undefined,
    attentionDetail: undefined,
    // Nothing can be answered from here: what its last message asked is not shown as waiting for you.
    asksYou: undefined,
  }
}

const machineOf = (engine: string) => parseEngine(engine)?.machine ?? engine.slice(engine.lastIndexOf('@') + 1)

async function journal(gitDir: string, ref: string): Promise<JournalEvent[] | null> {
  const r = await runGit(['--git-dir', gitDir, 'cat-file', 'blob', `${ref}:events.jsonl`], { timeoutMs: 30_000 })
  return r.code === 0 ? parseJournal(r.stdout).events : null
}

const openOn = (meta: ThreadMeta, machine: string) => {
  const leg = meta.legs.at(-1)
  return !!leg && leg.ended === null && machineOf(leg.engine) === machine
}

/** The threads synced here whose last leg is still open on `machine` and that moved in the last week, as rows. */
export async function weevbookRows(gitDir: string, machine: string, now: number): Promise<Session[]> {
  const refs = await threadRefs(gitDir).catch(() => [])
  const rows: Session[] = []
  for (const r of refs) {
    const m = r.meta
    const updated = Date.parse(m.updated)
    if (!openOn(m, machine) || !(now - updated < OFFLINE_KEEP_MS)) continue
    const events = await journal(gitDir, r.commit)
    const start = events?.findLast((e) => e.type === 'leg.start')
    if (!events || start?.type !== 'leg.start') continue
    const tool: Tool = parseEngine(start.engine)?.provider === 'codex' ? 'codex' : 'claude'
    const said = events.filter((e) => e.type === 'message')
    const last = said.at(-1)
    rows.push(offlineRow({
      id: start.session, projectId: m.project ?? MISC, repo: m.project, machineId: machine, tool, title: m.title || start.session.slice(0, 8),
      status: 'idle', cwd: start.cwd, openedAt: Date.parse(m.created), lastActivityAt: updated, workStartedAt: null, origin: 'weevbook',
      controllable: false, live: false, hasScreen: false, subagents: [], background: 0, messageCount: said.length, queued: 0, thread: r.id,
      ...(last?.type === 'message' ? { lastMessage: last.text.slice(0, 300) } : {}),
    }))
  }
  return rows
}

/** The thread a session of `machine` carries, found in the weevbook (its legs, then the session of each leg there). */
async function threadOf(gitDir: string, row: Session): Promise<string | null> {
  if (row.thread) return row.thread
  for (const r of await threadRefs(gitDir).catch(() => [])) {
    if (!r.meta.legs.some((l) => machineOf(l.engine) === row.machineId)) continue
    const events = await journal(gitDir, r.commit)
    if (events?.some((e) => e.type === 'leg.start' && e.session === row.id)) return r.id
  }
  return null
}

/** The history of an offline machine's conversation, as the weevbook has it here (null: never synced here). */
export async function weevbookDetail(gitDir: string, row: Session): Promise<SessionDetail | null> {
  const thread = await threadOf(gitDir, row)
  if (!thread) return null
  const events = await journal(gitDir, `refs/threads/${thread}`)
  if (!events) return null
  const messages: Message[] = events.flatMap((e) =>
    e.type === 'message' ? [{ id: e.id, role: e.role, text: e.text, at: Date.parse(e.at), ...(e.author ? { author: e.author } : {}) }] : [],
  )
  return { session: { ...row, thread, messageCount: messages.length }, messages }
}
