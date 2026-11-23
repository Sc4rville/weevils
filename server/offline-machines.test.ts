import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../shared/api.ts'
import { weevbookDetail, weevbookRows } from './offline-machines.ts'
import { Remote } from './remotes.ts'

let tmp = ''
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-offline-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const T = '01M7V1DX8NBSBZ201Y4K777STZ'
const SESSION = '644790bf-86ed-4087-b25b-9a290dc1140f'
const NOW = Date.parse('2026-11-23T15:00:00Z')

const row = (o: Partial<Session> = {}): Session => ({
  id: SESSION, projectId: 'notes', repo: 'notes', machineId: 'laptop', tool: 'claude', title: 'Notes and the Claude subscription', status: 'working',
  cwd: '/home/user/projects/notes', openedAt: NOW - 3_600_000, lastActivityAt: NOW - 60_000, workStartedAt: NOW - 60_000, origin: 'terminal',
  controllable: true, live: true, hasScreen: true, subagents: [], background: 0, messageCount: 4, queued: 0, thread: T, ...o,
})

/** A weevbook with one thread ref whose last leg is still open on `machine`, as a vault restore leaves it here. */
function weevbook(machine: string, updated = new Date(NOW - 3_600_000).toISOString(), ended: string | null = null) {
  const dir = path.join(tmp, 'weevbook')
  const gitDir = path.join(dir, '.git')
  execFileSync('git', ['init', '-q', '--bare', gitDir])
  const at = new Date(NOW - 7_200_000).toISOString()
  const ev = (seq: number, e: Record<string, unknown>) => JSON.stringify({ v: 1, seq, id: `01M7V1DX8N${String(seq).padStart(16, '0')}`, at, ...e })
  const events = [
    ev(1, { leg: null, type: 'meta', thread: T }),
    ev(2, { leg: 'L1', type: 'leg.start', engine: `claude:9e2bff@${machine}`, session: SESSION, cwd: '/home/user', rung: 0, epoch: 1 }),
    ev(3, { leg: 'L1', type: 'message', role: 'user', text: 'can you plug notes into my Claude subscription?' }),
    ev(4, { leg: 'L1', type: 'tool', call: 'toolu_1', name: 'Bash', summary: 'Bash · ssh vps' }),
    ev(5, { leg: 'L1', type: 'message', role: 'assistant', text: 'It is live on notes.example.com.' }),
    ...(ended ? [ev(6, { leg: 'L1', type: 'leg.end', reason: 'moved', by: 'vps' })] : []),
  ].join('\n')
  const meta = JSON.stringify({ v: 1, thread: T, title: 'Notes et abonnement Claude', project: null, created: at, updated, state: 'waiting', turns: 1, events: 5, sources: ['claude'], legs: [{ leg: 'L1', engine: `claude:9e2bff@${machine}`, rung: 0, started: at, ended }], checkpoint: null, handoff: null })
  const blob = (text: string) => execFileSync('git', ['--git-dir', gitDir, 'hash-object', '-w', '--stdin'], { input: text, encoding: 'utf8' }).trim()
  const tree = execFileSync('git', ['--git-dir', gitDir, 'mktree'], { input: `100644 blob ${blob(`${events}\n`)}\tevents.jsonl\n100644 blob ${blob(meta)}\tmeta.json\n`, encoding: 'utf8' }).trim()
  const commit = execFileSync('git', ['--git-dir', gitDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', tree, '-m', 'vault restore'], { encoding: 'utf8' }).trim()
  execFileSync('git', ['--git-dir', gitDir, 'update-ref', `refs/threads/${T}`, commit])
  return { dir, gitDir }
}

/** A machine's weevilsd that answers /api/snapshot with one conversation, until it is stopped. */
async function machine(sessions: Session[]) {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ version: 7, machines: [{ id: 'laptop', name: 'laptop', online: true }], sessions, h24: [], projects: [] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stop: () => new Promise<void>((r) => server.close(() => r())) }
}

describe('the conversations of a machine that stops answering', () => {
  it('stay listed, marked offline, never at work or written to; a restart of this weevilsd meanwhile does not forget them', async () => {
    const book = weevbook('laptop')
    const pc = await machine([row()])
    let changes = 0
    const r = new Remote('laptop', pc.url, () => changes++, { dataDir: path.join(tmp, 'data'), weevbookDir: book.dir })
    await r.poll()
    expect(r.online).toBe(true)
    expect(r.offlineRows()).toEqual([]) // it answers: its own rows are the ones shown
    await pc.stop()
    await r.poll()
    expect(r.online).toBe(false)
    const [s] = r.offlineRows()
    expect(s).toMatchObject({ id: SESSION, title: 'Notes and the Claude subscription', projectId: 'notes', machineId: 'laptop', thread: T, offline: true, status: 'idle', live: false, controllable: false, hasScreen: false, workStartedAt: null })
    expect(r.offlineRows()).toHaveLength(1) // the same thread from the weevbook is not a second row

    // This weevilsd restarts while the PC is still away: the rows come back from disk before it ever answers.
    const again = new Remote('laptop', pc.url, () => undefined, { dataDir: path.join(tmp, 'data'), weevbookDir: book.dir })
    expect(again.offlineRows()).toEqual([expect.objectContaining({ id: SESSION, title: s.title, projectId: 'notes', thread: T, offline: true, live: false, status: 'idle' })])
  })

  it('a thread synced here whose leg is open on that machine is a row even if this weevilsd never saw the machine answer', async () => {
    const book = weevbook('laptop')
    const r = new Remote('laptop', 'http://127.0.0.1:9', () => undefined, { dataDir: path.join(tmp, 'data'), weevbookDir: book.dir })
    await r.poll()
    expect(r.offlineRows()).toEqual([expect.objectContaining({ id: SESSION, title: 'Notes et abonnement Claude', thread: T, offline: true, messageCount: 2, lastMessage: 'It is live on notes.example.com.' })])
    // Moved elsewhere (its leg ended), or quiet for more than a week: not a conversation of that machine any more.
    fs.rmSync(book.dir, { recursive: true })
    expect(await weevbookRows(weevbook('laptop', undefined, new Date(NOW).toISOString()).gitDir, 'laptop', NOW)).toEqual([])
    fs.rmSync(path.join(tmp, 'weevbook'), { recursive: true })
    expect(await weevbookRows(weevbook('laptop', new Date(NOW - 8 * 24 * 3_600_000).toISOString()).gitDir, 'laptop', NOW)).toEqual([])
  })

  it('opens: its history is read from the weevbook, by its thread or by its session', async () => {
    const book = weevbook('laptop')
    const want = [
      { role: 'user', text: 'can you plug notes into my Claude subscription?' },
      { role: 'assistant', text: 'It is live on notes.example.com.' },
    ]
    const byThread = await weevbookDetail(book.gitDir, row({ offline: true }))
    expect(byThread?.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual(want)
    const bySession = await weevbookDetail(book.gitDir, row({ thread: undefined, offline: true }))
    expect(bySession?.session.thread).toBe(T)
    expect(bySession?.messages).toHaveLength(2)
    expect(await weevbookDetail(book.gitDir, row({ id: 'never-synced', thread: undefined }))).toBeNull()
  })
})
