import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateJournal, type JournalEvent } from './journal.ts'
import { Weevbook, walk } from './store.ts'
import { Sessions, syncSession, type Follow, type Source } from './sync.ts'
import { startWeevbookWriter } from './writer.ts'

const FX = path.resolve(import.meta.dirname, '../../test/fixtures/weevbook/home')
const CLAUDE = 'claude/projects/-home-alex-projects-shop-app/3f6c1b2a-8d4e-4c1f-9a7b-2e5d6c8f0a11.jsonl'
const CODEX = 'codex/sessions/2026/11/17/rollout-2026-11-17T10-00-00-0193a7c2-5e1d-7b8a-9c4f-2d6e8a1b3c5d.jsonl'
const LATER = Date.parse('2026-11-20T00:00:00Z')

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weevbook-sync-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const opts = (now: number, extra: object = {}) => ({ now, roots: ['/home/alex/projects'], machine: 'laptop', account: () => 'abc123', ...extra })
async function open(name: string) {
  const book = await Weevbook.open(path.join(tmp, name, 'weevbook'), 'laptop')
  await book.lock()
  return { book, sessions: new Sessions(path.join(tmp, name, 'weevbook-sessions.jsonl')) }
}
/** The events of a thread without what differs between two writes of it: ids, and the ids events name. */
function shape(events: readonly JournalEvent[]) {
  const index = new Map(events.map((e, i) => [e.id, i]))
  return events.map((e) => {
    const { id: _id, ...rest } = e as JournalEvent & Record<string, unknown>
    if (rest.type === 'meta' && rest.thread) rest.thread = 'T'
    if (rest.type === 'turn' && typeof rest.message === 'string') rest.message = `#${index.get(rest.message)}`
    return JSON.stringify(rest)
  })
}
async function only(book: Weevbook) {
  const [t] = book.threads()
  const th = (await book.thread(t.id))!
  const dir = book.abs(th.path)
  const raw = Object.fromEntries((await walk(path.join(dir, 'raw'))).map((f) => [f, fs.readFileSync(path.join(dir, 'raw', f), 'utf8')]))
  return { id: t.id, events: th.journal.events, raw, path: th.path }
}
/** The session's file as the provider writes it: whole lines, the last one maybe not finished yet. */
function chunks(rel: string) {
  const text = fs.readFileSync(path.join(FX, rel), 'utf8')
  const parts = text.split(/(?<=\n)/)
  const times = parts.map((p) => {
    const m = /"timestamp":"([^"]+)"/.exec(p)
    return m ? Date.parse(m[1]) : NaN
  })
  return { parts, times }
}

describe('following a session (the writer in weevilsd)', () => {
  for (const [rel, provider] of [[CLAUDE, 'claude'], [CODEX, 'codex']] as const) {
    it(`line by line, ${provider}: the same journal and raw as a backfill, also when restarted at every line`, async () => {
      const whole: Source = { file: path.join(FX, rel), provider }
      const a = await open('a')
      await syncSession(a.book, a.sessions, whole, opts(LATER, { final: true }))
      const expected = await only(a.book)
      expect(validateJournal(expected.events)).toEqual([])

      for (const restart of [false, true]) {
        const name = restart ? 'c' : 'b'
        const b = await open(name)
        const file = path.join(tmp, name, path.basename(rel))
        fs.writeFileSync(file, '')
        const src: Source = { file, provider }
        const follows = new Map<string, Follow>()
        const { parts, times } = chunks(rel)
        let last = times.find(Number.isFinite)!
        for (let i = 0; i < parts.length; i++) {
          fs.appendFileSync(file, parts[i])
          if (Number.isFinite(times[i])) last = times[i]
          // A second after the line: nothing settles yet. Every few lines, a silence of 15 s settles a reply, when the
          // next line comes that much later (lines written together are read together).
          const next = times.slice(i + 1).find(Number.isFinite) ?? Infinity
          const now = i % 4 === 3 ? Math.min(last + 15_000, next - 1) : last + 1000
          await syncSession(b.book, b.sessions, src, opts(now), restart ? new Map() : follows)
        }
        // Then the session is over (30 min of silence).
        await syncSession(b.book, b.sessions, src, opts(last + 31 * 60_000), restart ? new Map() : follows)
        const got = await only(b.book)
        expect(validateJournal(got.events)).toEqual([])
        expect(shape(got.events)).toEqual(shape(expected.events))
        expect(got.raw).toEqual(expected.raw)
      }
    })
  }

  it('commits the thread ref when a turn starts and ends, not at every line', async () => {
    const b = await open('b')
    const file = path.join(tmp, 'b', path.basename(CLAUDE))
    fs.writeFileSync(file, '')
    const follows = new Map<string, Follow>()
    const { parts, times } = chunks(CLAUDE)
    let last = times.find(Number.isFinite)!
    for (let i = 0; i < parts.length; i++) {
      fs.appendFileSync(file, parts[i])
      if (Number.isFinite(times[i])) last = times[i]
      await syncSession(b.book, b.sessions, { file, provider: 'claude' }, opts(last + 1000), follows)
    }
    await syncSession(b.book, b.sessions, { file, provider: 'claude' }, opts(last + 31 * 60_000), follows)
    const { id } = await only(b.book)
    const log = execFileSync('git', ['log', '--reverse', '--format=%s', `refs/threads/${id}`], { env: { ...process.env, GIT_DIR: b.book.gitDir }, encoding: 'utf8' }).trim().split('\n')
    expect(log.length).toBeLessThan(parts.length / 2)
    expect(log).toContain('turn 1 (running) · claude · laptop')
    expect(log.at(-1)).toBe('turn 4 · claude · laptop')
    // The last commit holds the folder as it is.
    expect(await b.book.treeOf(`refs/threads/${id}`)).toBe(await b.book.folderTree(id))
  })

  it('a backfill while the session runs, then the writer: one thread, nothing twice', async () => {
    const dir = path.join(tmp, 'home')
    const file = path.join(dir, 'claude', path.basename(CLAUDE))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const { parts, times } = chunks(CLAUDE)
    const cut = 20
    fs.writeFileSync(file, parts.slice(0, cut).join(''))
    const now = times.slice(0, cut).filter(Number.isFinite).at(-1)! + 2000
    const p = { dir: path.join(tmp, 'd', 'weevbook'), sessions: path.join(tmp, 'd', 'weevbook-sessions.jsonl'), claudeDir: path.join(dir, 'claude-none'), codexDir: path.join(dir, 'codex-none'), home: dir, machine: 'laptop', roots: ['/home/alex/projects'] }
    const b = await Weevbook.open(p.dir, 'laptop')
    await b.lock()
    await syncSession(b, new Sessions(p.sessions), { file, provider: 'claude' }, opts(now, { final: true }))
    await b.unlock(true)
    fs.appendFileSync(file, parts.slice(cut).join(''))
    const w = startWeevbookWriter({ ...p, codexDir: p.codexDir, intervalMs: 3_600_000, sources: () => [{ file, provider: 'claude' }], now: () => LATER, log: () => undefined })
    await w.flush()
    w.stop()
    const c = await Weevbook.open(p.dir, 'laptop')
    await c.lock()
    expect(c.threads()).toHaveLength(1)
    const got = await only(c)
    expect(validateJournal(got.events)).toEqual([])
    const a = await open('a')
    await syncSession(a.book, a.sessions, { file: path.join(FX, CLAUDE), provider: 'claude' }, opts(LATER, { final: true }))
    const messages = (ev: readonly JournalEvent[]) => ev.flatMap((e) => (e.type === 'message' || e.type === 'tool' ? [JSON.stringify([e.type, e.type === 'message' ? e.text : e.summary])] : []))
    expect(messages(got.events)).toEqual(messages((await only(a.book)).events))
    expect(got.raw).toEqual((await only(a.book)).raw)
  })
})

describe('the writer in weevilsd', () => {
  it('never throws into the app: an error is logged once', async () => {
    const logs: string[] = []
    const gone = path.join(tmp, 'gone.jsonl')
    fs.writeFileSync(gone, '{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-11-16T09:00:00Z"}\n')
    const w = startWeevbookWriter({ dir: path.join(tmp, 'w', 'weevbook'), sessions: path.join(tmp, 'w', 'sessions.jsonl'), machine: 'laptop', home: tmp, codexDir: path.join(tmp, 'codex'), roots: [], intervalMs: 3_600_000, sources: () => [{ file: gone, provider: 'claude' }], log: (l) => logs.push(l) })
    await w.flush()
    // The weevbook's folder becomes a file: every write fails.
    fs.rmSync(path.join(tmp, 'w', 'weevbook', 'projects'), { recursive: true, force: true })
    fs.writeFileSync(path.join(tmp, 'w', 'weevbook', 'projects'), '')
    fs.appendFileSync(gone, '{"type":"user","message":{"role":"user","content":"again"},"timestamp":"2026-11-16T09:01:00Z"}\n')
    await w.flush()
    fs.appendFileSync(gone, '{"type":"user","message":{"role":"user","content":"and again"},"timestamp":"2026-11-16T09:02:00Z"}\n')
    await w.flush()
    w.stop()
    expect(logs.length).toBeGreaterThan(0)
    expect(new Set(logs).size).toBe(logs.length)
    expect(logs.every((l) => l.startsWith('[weevbook]'))).toBe(true)
  })

  it('waits while the command line holds the lock', async () => {
    const file = path.join(tmp, 's.jsonl')
    fs.writeFileSync(file, '{"type":"user","message":{"role":"user","content":"hi"},"timestamp":"2026-11-16T09:00:00Z"}\n')
    const dir = path.join(tmp, 'w', 'weevbook')
    const cli = await Weevbook.open(dir, 'laptop')
    await cli.lock()
    const w = startWeevbookWriter({ dir, sessions: path.join(tmp, 'w', 'sessions.jsonl'), machine: 'laptop', home: tmp, codexDir: path.join(tmp, 'codex'), roots: [], intervalMs: 3_600_000, sources: () => [{ file, provider: 'claude' }], now: () => LATER, log: () => undefined })
    await w.flush()
    expect(cli.threads()).toHaveLength(0)
    await cli.unlock(false)
    await w.flush()
    w.stop()
    const again = await Weevbook.open(dir, 'laptop')
    expect(again.threads()).toHaveLength(1)
  })
})
