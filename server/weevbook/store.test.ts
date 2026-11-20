import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_RAW_BYTES, parseJournal, renderThread, validateFolder, validateJournal, type EventDraft } from './journal.ts'
import { README, Weevbook, walk } from './store.ts'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weevbook-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const T = '01M7HSBBM02XDK5FKDXG64FE62'
let n = 0
const id = () => `01M7HSBBM0${String(++n).padStart(16, '0')}`
const at = (s = 0) => new Date(Date.parse('2026-11-16T09:00:00Z') + s * 1000).toISOString()
const start = (): EventDraft[] => [
  { id: id(), at: at(), leg: null, type: 'meta', thread: T, project: 'shop-app' },
  { id: id(), at: at(), leg: 'L1', type: 'leg.start', engine: 'claude:abc123@laptop', session: 's1', cwd: '/home/alex/projects/shop-app', rung: 0, epoch: 1 },
]
const said = (text: string, s = 1): EventDraft => ({ id: id(), at: at(s), leg: 'L1', type: 'message', role: 'user', text, source: 'claude' })
const titled = (title: string, s = 1): EventDraft => ({ id: id(), at: at(s), leg: 'L1', type: 'meta', title })
const git = (book: Weevbook, ...args: string[]) => execFileSync('git', args, { env: { ...process.env, GIT_DIR: book.gitDir }, encoding: 'utf8' }).trim()

async function book() {
  const b = await Weevbook.open(path.join(dir, 'weevbook'), 'laptop')
  expect(await b.lock()).toBe(true)
  return b
}
async function folder(b: Weevbook, thread = T) {
  const rel = b.pathOf(thread)!
  const files: Record<string, Uint8Array> = {}
  for (const f of await walk(b.abs(rel))) files[f] = fs.readFileSync(path.join(b.abs(rel), f))
  return { path: rel, files }
}

describe('the local weevbook', () => {
  it('writes a thread in its folder, laid out as main, and commits it to refs/threads/<id>', async () => {
    const b = await book()
    await b.append(T, { events: [...start(), said('Add a dark mode toggle'), titled('Add a dark mode toggle')], raw: { leg: 'L1', provider: 'claude', lines: ['{"type":"user"}'] } })
    expect(b.pathOf(T)).toBe(`projects/shop-app/2026-11/${T}-add-a-dark-mode-toggle`)
    const f = await folder(b)
    expect(Object.keys(f.files).sort()).toEqual(['events.jsonl', 'meta.json', 'raw/L1.claude.0001.jsonl', 'thread.md'])
    expect(validateFolder(f)).toEqual([])
    const commit = await b.commitThread(T, 'turn 1 · claude · laptop')
    expect(git(b, 'log', '--format=%s', `refs/threads/${T}`)).toBe('turn 1 · claude · laptop')
    expect(git(b, 'ls-tree', '--name-only', commit!)).toBe('events.jsonl\nmeta.json\nraw\nthread.md')
    // Nothing changed: no new commit.
    expect(await b.commitThread(T, 'again')).toBe(commit)
    // The repository has no work tree of its own: nothing is ever checked out over the files.
    expect(git(b, 'config', 'core.bare')).toBe('true')
    expect(fs.readFileSync(path.join(b.dir, 'README.md'), 'utf8')).toBe(README)
  })

  it('composes main from the thread refs, with index.json', async () => {
    const b = await book()
    await b.append(T, { events: [...start(), said('Add a dark mode toggle'), titled('Add a dark mode toggle')] })
    const c1 = await b.commitThread(T, 'turn 1 · claude · laptop')
    const main = await b.compose()
    expect(main).toBeTruthy()
    const index = JSON.parse(git(b, 'cat-file', 'blob', 'refs/heads/main:index.json'))
    expect(index).toEqual({ v: 1, threads: [{ thread: T, path: b.pathOf(T), title: 'Add a dark mode toggle', project: 'shop-app', updated: at(1), state: 'waiting', commit: c1 }] })
    // The folder in main is the thread's tree, as it is.
    expect(git(b, 'rev-parse', `refs/heads/main:${b.pathOf(T)}`)).toBe(git(b, 'rev-parse', `${c1}^{tree}`))
    expect(fs.readFileSync(path.join(b.dir, 'index.json'), 'utf8')).toBe(git(b, 'cat-file', 'blob', 'refs/heads/main:index.json') + '\n')
    expect(await b.compose()).toBeNull()
    // A new title moves the folder; main follows, with the previous main as parent.
    await b.append(T, { events: [{ id: id(), at: at(5), leg: 'L1', type: 'meta', title: 'Dark mode' }] })
    expect(b.pathOf(T)).toBe(`projects/shop-app/2026-11/${T}-dark-mode`)
    expect(fs.existsSync(b.abs(`projects/shop-app/2026-11/${T}-add-a-dark-mode-toggle`))).toBe(false)
    await b.commitThread(T, 'meta · laptop')
    const main2 = await b.compose()
    expect(git(b, 'rev-parse', `${main2}^`)).toBe(main)
    expect(git(b, 'ls-tree', '-r', '--name-only', 'refs/heads/main')).toContain(`projects/shop-app/2026-11/${T}-dark-mode/events.jsonl`)
    expect(git(b, 'log', '-1', '--format=%B', 'refs/heads/main')).toContain(`${T} Dark mode`)
  })

  it('keeps an event the journal refuses in a note, never drops it', async () => {
    const b = await book()
    const r = await b.append(T, { events: [...start(), said('one'), { id: id(), at: at(2), leg: 'L1', type: 'turn', turn: 1, state: 'done' }] })
    expect(r).toEqual({ written: 4, refused: 1 })
    const events = (await b.thread(T))!.journal.events
    expect(events.at(-1)).toMatchObject({ type: 'note', kind: 'debug', data: { event: { type: 'turn', state: 'done' } } })
    expect(validateJournal(events)).toEqual([])
  })

  it('writes an event again with the same key only once', async () => {
    const b = await book()
    const m = { ...said('one'), key: 'k1' } as EventDraft
    await b.append(T, { events: [...start(), m] })
    expect(await b.append(T, { events: [{ ...m, id: id() }] })).toEqual({ written: 0, refused: 0 })
  })

  it('cuts a message over 1 MiB and keeps it whole as message.txt (02, failure cases)', async () => {
    const b = await book()
    const text = 'a'.repeat(1_200_000)
    await b.append(T, { events: [...start(), said(text)] })
    const f = await folder(b)
    expect(validateFolder(f)).toEqual([])
    const { events } = parseJournal(Buffer.from(f.files['events.jsonl']).toString())
    expect(events[2]).toMatchObject({ type: 'message', text: `${'a'.repeat(4000)}…` })
    expect(events[3]).toMatchObject({ type: 'attachment', name: 'message.txt', mime: 'text/plain', bytes: text.length })
    const file = Object.keys(f.files).find((k) => k.startsWith('attachments/'))!
    expect(Buffer.from(f.files[file]).toString()).toBe(text)
  })

  it('writes an attachment event only with its file', async () => {
    const b = await book()
    const data = Buffer.from('png bytes')
    const sha = 'f'.repeat(64)
    const real = (await import('node:crypto')).createHash('sha256').update(data).digest('hex')
    await b.append(T, {
      events: [...start(), said('see'), { id: id(), at: at(1), leg: 'L1', type: 'attachment', role: 'user', sha256: sha, name: 'a.png', mime: 'image/png', bytes: 9 }, { id: id(), at: at(1), leg: 'L1', type: 'attachment', role: 'user', sha256: real, name: 'b.png', mime: 'image/png', bytes: 9 }],
      contents: new Map([[real, data]]),
    })
    const f = await folder(b)
    expect(Object.keys(f.files).filter((k) => k.startsWith('attachments/'))).toEqual([`attachments/${real}.png`])
    expect(validateFolder(f)).toEqual([])
  })

  it('starts a new raw segment before one would pass 16 MiB', async () => {
    const b = await book()
    const big = JSON.stringify({ type: 'user', text: 'x'.repeat(7 << 20) })
    await b.append(T, { events: [...start(), said('big')], raw: { leg: 'L1', provider: 'claude', lines: [big, big] } })
    await b.append(T, { events: [], raw: { leg: 'L1', provider: 'claude', lines: [big, '{"n":1}'] } })
    const raw = fs.readdirSync(path.join(b.abs(b.pathOf(T)!), 'raw')).sort()
    expect(raw).toEqual(['L1.claude.0001.jsonl', 'L1.claude.0002.jsonl'])
    for (const r of raw) expect(fs.statSync(path.join(b.abs(b.pathOf(T)!), 'raw', r)).size).toBeLessThanOrEqual(MAX_RAW_BYTES)
    expect(await b.rawLines(T, 'L1', 'claude')).toBe(4)
    // Read again from the disk, by another process.
    const other = await Weevbook.open(b.dir, 'laptop')
    expect(await other.rawLines(T, 'L1', 'claude')).toBe(4)
    expect(await other.rawBytes(T, 'L1', 'claude')).toBe(3 * (big.length + 1) + 8)
  })

  it('undoes a write a crash cut short: the journal and raw go back together', async () => {
    const b = await book()
    await b.append(T, { events: [...start(), said('one')], raw: { leg: 'L1', provider: 'claude', lines: ['{"a":1}'] } })
    const rel = b.pathOf(T)!
    const before = Object.fromEntries((await walk(b.abs(rel))).map((f) => [f, fs.readFileSync(path.join(b.abs(rel), f), 'utf8')]))
    // The record of a write, then the crash halfway: the journal grew, raw grew, thread.md not yet.
    fs.writeFileSync(path.join(b.gitDir, 'weevbook/tx', `${T}.json`), JSON.stringify({ thread: T, from: rel, to: rel, sizes: { 'events.jsonl': before['events.jsonl'].length, 'raw/L1.claude.0001.jsonl': before['raw/L1.claude.0001.jsonl'].length }, created: [] }))
    fs.appendFileSync(path.join(b.abs(rel), 'events.jsonl'), '{"v":1,"seq":4,"id":"01M7HSBBM0000000000000000X","at":"2026-11-16T09:00:09Z","leg":"L1","type":"mess')
    fs.appendFileSync(path.join(b.abs(rel), 'raw/L1.claude.0001.jsonl'), '{"b":2}\n')
    fs.writeFileSync(path.join(b.abs(rel), 'thread.md.next'), 'half')
    await b.unlock(true)
    fs.writeFileSync(`${b.dir}.lock`, '999999999\n') // left by the process that crashed
    const again = await Weevbook.open(b.dir, 'laptop')
    expect(await again.lock()).toBe(true)
    const after = Object.fromEntries((await walk(again.abs(rel))).map((f) => [f, fs.readFileSync(path.join(again.abs(rel), f), 'utf8')]))
    expect(after).toEqual(before)
    expect(fs.readdirSync(path.join(b.gitDir, 'weevbook/tx'))).toEqual([])
    // And it goes on from there.
    await again.append(T, { events: [said('two', 2)], raw: { leg: 'L1', provider: 'claude', lines: ['{"b":2}'] } })
    expect(validateFolder(await folder(again))).toEqual([])
  })

  it('undoes the creation of a thread a crash cut short', async () => {
    const b = await book()
    const rel = `projects/shop-app/2026-11/${T}-one`
    fs.mkdirSync(b.abs(rel), { recursive: true })
    fs.writeFileSync(path.join(b.abs(rel), 'events.jsonl'), '{"v":1,"seq":1')
    fs.writeFileSync(path.join(b.gitDir, 'weevbook/tx', `${T}.json`), JSON.stringify({ thread: T, from: null, to: rel, sizes: { 'events.jsonl': 0 }, created: [] }))
    await b.unlock(true)
    const again = await Weevbook.open(b.dir, 'laptop')
    await again.lock()
    expect(again.threads()).toEqual([])
    expect(fs.existsSync(again.abs('projects/shop-app'))).toBe(false)
  })

  it('lets one process write at a time', async () => {
    const b = await book()
    const other = await Weevbook.open(b.dir, 'laptop')
    expect(await other.lock()).toBe(false)
    await b.unlock(false)
    expect(await other.lock()).toBe(true)
    // A lock left by a process that is gone is taken.
    await other.unlock(false)
    const child = spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(`${b.dir}.lock`)}, process.pid + '\\n')`])
    expect(child.status).toBe(0)
    expect(await b.lock()).toBe(true)
  })

  it('reads again what another process wrote', async () => {
    const b = await book()
    await b.append(T, { events: [...start(), said('one')] })
    await b.unlock(true)
    const other = await Weevbook.open(b.dir, 'laptop')
    await other.lock()
    await other.append(T, { events: [said('two', 2)] })
    await other.unlock(true)
    await b.lock()
    expect((await b.thread(T))!.journal.events.map((e) => e.type === 'message' && e.text).filter(Boolean)).toEqual(['one', 'two'])
    expect(fs.readFileSync(path.join(b.abs(b.pathOf(T)!), 'thread.md'), 'utf8')).toBe(renderThread((await b.thread(T))!.journal.events))
  })
})
