// Two machines and a hub, end to end (docs/spec/03-sync-and-lease.md, 04-resume.md, steps 2 and 3): the laptop works
// on a thread and pushes it, dies mid-turn; the server steals the lease within the bound, restores the code, rebuilds
// the provider session, and resumes the turn with the preface; the laptop comes back and its late work becomes a note.
// Each machine has its own HOME and DATA_DIR; the provider is a fake CLI (test/fixtures/weevbook/fake-claude.mjs).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claudeSlug, rewritePaths } from '../bring.ts'
import { HubSync, checkpointHook } from './hub.ts'
import { parseJournal, validateJournal, type JournalEvent, type TurnEvent } from './journal.ts'
import { GRACE, LIFETIME, STEAL_BOUND, parseLease } from './lease.ts'
import { resumeThread, type Launch } from './resume.ts'
import { Sessions } from './sync.ts'
import { prefaceSign } from './turn.ts'
import { startWeevbookWriter } from './writer.ts'

const FAKE = path.resolve(import.meta.dirname, '../../test/fixtures/weevbook/fake-claude.mjs')
const SESSION = '3f6c1b2a-8d4e-4c1f-9a7b-2e5d6c8f0a12'
const T0 = Date.parse('2026-11-20T10:00:00Z')
const roots: string[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const run = (cwd: string, cmd: string, ...args: string[]) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const git = (cwd: string, ...args: string[]) => run(cwd, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args)
const hubGit = (hub: string, ...args: string[]) => run(hub, 'git', '--git-dir', hub, ...args)
const journal = (hub: string, spec: string): JournalEvent[] => parseJournal(hubGit(hub, 'cat-file', 'blob', `${spec}:events.jsonl`)).events

beforeAll(() => {
  const cfg = path.join(fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevils-e2e-cfg-')), 'gitconfig')
  roots.push(path.dirname(cfg))
  fs.writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

/** A machine: HOME with a clone of the project and a signed-in Claude account, DATA_DIR, writer, hub sync. */
function machine(root: string, name: string, origin: string, hub: string, clock: { t: number }, o: { here?: boolean; steals?: boolean } = {}) {
  const home = path.join(root, name)
  const data = path.join(home, '.local', 'share', 'weevils')
  const repo = path.join(home, 'projects', 'shop')
  const claudeDir = path.join(home, '.claude', 'projects')
  fs.mkdirSync(path.dirname(repo), { recursive: true })
  fs.mkdirSync(data, { recursive: true })
  git(path.dirname(repo), 'clone', '-q', origin, repo)
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: `account-of-${name}` } }))
  const logs: string[] = []
  const log = (l: string) => logs.push(l)
  const dir = path.join(data, 'weevbook')
  const sessions = path.join(data, 'weevbook-sessions.jsonl')
  const sources = () => {
    const out: { file: string; provider: 'claude' }[] = []
    for (const d of fs.existsSync(claudeDir) ? fs.readdirSync(claudeDir) : []) for (const f of fs.readdirSync(path.join(claudeDir, d))) if (f.endsWith('.jsonl')) out.push({ file: path.join(claudeDir, d, f), provider: 'claude' })
    return out
  }
  const writer = () =>
    startWeevbookWriter({ dir, sessions, machine: name, home, codexDir: path.join(home, '.codex', 'sessions'), roots: [path.join(home, 'projects')], sources, intervalMs: 3_600_000, quietMs: 300, composeMs: 3_600_000, log, checkpoint: checkpointHook({ dataDir: data, home, weevbookGitDir: path.join(dir, '.git'), log }) })
  const sync = () => new HubSync({ dir, dataDir: data, sessions, machine: name, hub: { url: hub, here: !!o.here }, steals: !!o.steals, now: () => clock.t, log })
  return { name, home, data, repo, claudeDir, dir, sessions, logs, writer, sync }
}

/** Lines of a Claude session, as Claude Code writes them (the fixtures' format). */
function claudeSession(home: string, cwd: string, session: string) {
  const file = path.join(home, '.claude', 'projects', claudeSlug(cwd), `${session}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let parent: string | null = null
  let n = 0
  const line = (type: 'user' | 'assistant', message: unknown) => {
    const uuid = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    fs.appendFileSync(file, `${JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.4', gitBranch: 'main', type, message, uuid, timestamp: new Date().toISOString() })}\n`)
    parent = uuid
  }
  const assistant = (content: unknown[], stop: string) => line('assistant', { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content, stop_reason: stop })
  return {
    file,
    user: (text: string) => line('user', { role: 'user', content: text }),
    tool: (id: string, name: string, input: unknown) => assistant([{ type: 'tool_use', id, name, input }], 'tool_use'),
    result: (id: string, text: string) => line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }),
    answer: (text: string) => assistant([{ type: 'text', text }], 'end_turn'),
  }
}

/** The writer reads what is new, then what the silence settles (a turn that ended is closed). */
async function settle(w: { flush: () => Promise<void> }) {
  await w.flush()
  await sleep(450)
  await w.flush()
}

describe('two machines, one hub: a turn resumed on another machine', () => {
  it('the laptop dies mid-turn; the server steals, restores, resumes with the preface; the laptop comes back as a note', async () => {
    const root = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevils-e2e-'))
    roots.push(root)
    const clock = { t: T0 }
    // The project's origin, with a first commit.
    const seed = path.join(root, 'seed')
    fs.mkdirSync(path.join(seed, 'src'), { recursive: true })
    fs.writeFileSync(path.join(seed, 'src', 'money.ts'), 'export const fmt = (n: number) => `${n}`\n')
    fs.writeFileSync(path.join(seed, 'src', 'cart.ts'), 'export const cart = (n: number) => `${n}`\n')
    git(seed, 'init', '-q')
    git(seed, 'add', '-A')
    git(seed, 'commit', '-qm', 'first')
    const origin = path.join(root, 'origin', 'shop.git')
    git(seed, 'clone', '-q', '--bare', seed, origin)
    const hub = path.join(root, 'server', '.local', 'share', 'weevils', 'hub.git')

    // The server keeps the hub and steals; the laptop pushes to it.
    const server = machine(root, 'server', origin, hub, clock, { here: true, steals: true })
    const laptop = machine(root, 'laptop', origin, hub, clock)
    const serverSync = server.sync()
    await serverSync.round()
    expect(serverSync.status.state).toBe('ok')
    const laptopSync = laptop.sync()
    const lw = laptop.writer()

    // Turn 1 on the laptop: a change to the code, a checkpoint, pushed.
    const a = claudeSession(laptop.home, laptop.repo, SESSION)
    a.user('Show prices with the currency')
    a.tool('toolu_a1', 'Edit', { file_path: path.join(laptop.repo, 'src/money.ts'), old_string: '${n}', new_string: '${n} €' })
    fs.writeFileSync(path.join(laptop.repo, 'src/money.ts'), 'export const fmt = (n: number) => `${n} €`\n')
    a.result('toolu_a1', 'edited')
    a.answer('Prices now show the currency.')
    await settle(lw)
    const sessionsA = new Sessions(laptop.sessions)
    await sessionsA.load()
    const id = sessionsA.get(`claude:${SESSION}`)!.thread
    expect(id).toBeTruthy()
    await laptopSync.round()
    expect(await laptopSync.checkpoints()).toBe(1)
    const turn1 = journal(hub, `refs/threads/${id}`)
    const ck1 = turn1.find((e) => e.type === 'checkpoint')!
    expect(ck1).toMatchObject({ type: 'checkpoint', turn: 1, kind: 'git', changed: 1 })
    expect(hubGit(hub, 'cat-file', '-t', (ck1 as { commit: string }).commit).trim()).toBe('commit')
    expect(parseLease(hubGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`))).toMatchObject({ holder: 'laptop', state: 'idle', epoch: 1 })

    // Turn 2 starts; the laptop renews its lease while the turn runs.
    a.user('Also show it on the cart')
    a.tool('toolu_a2', 'Read', { file_path: path.join(laptop.repo, 'src/cart.ts') })
    a.result('toolu_a2', 'export const cart = ...')
    await lw.flush()
    clock.t += 20_000
    await laptopSync.round()
    expect(parseLease(hubGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`))).toMatchObject({ holder: 'laptop', state: 'working', turn: 2, leg: 'L1' })
    const lastRenewal = clock.t
    // One more step, written down on the laptop only: it dies before its next push.
    a.tool('toolu_a3', 'Edit', { file_path: path.join(laptop.repo, 'src/cart.ts'), old_string: '${n}', new_string: '${n} EUR' })
    a.result('toolu_a3', 'edited')
    await lw.flush()
    lw.stop()

    // The server reads every working lease every 10 s, and steals once the rules allow it.
    let stoleAt = 0
    for (clock.t = lastRenewal + 10_000; clock.t <= lastRenewal + STEAL_BOUND + 10_000; clock.t += 10_000) {
      if ((await serverSync.observe()).includes(id)) {
        stoleAt = clock.t
        break
      }
    }
    const stealDelay = stoleAt - lastRenewal
    expect(stoleAt).toBeGreaterThan(0)
    expect(stealDelay).toBeGreaterThanOrEqual(LIFETIME + GRACE)
    expect(stealDelay).toBeLessThanOrEqual(STEAL_BOUND)
    const afterSteal = journal(hub, `refs/threads/${id}`)
    expect(afterSteal.slice(-2)).toMatchObject([
      { type: 'turn', turn: 2, state: 'failed', reason: 'machine-lost', effect: 'some', leg: 'L1' },
      { type: 'leg.end', reason: 'machine-lost', by: 'server', leg: 'L1' },
    ])
    expect(parseLease(hubGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`))).toMatchObject({ holder: 'server', state: 'idle', epoch: 2 })

    // The server resumes the thread: same provider, rung 2, the code of turn 1, the preface.
    const sw = server.writer()
    const launched: Launch[] = []
    const started = Date.now()
    const r = await resumeThread({
      thread: id, dir: server.dir, dataDir: server.data, sessions: server.sessions, machine: 'server', home: server.home,
      claudeDir: server.claudeDir, codexDir: path.join(server.home, '.codex', 'sessions'), roots: [path.join(server.home, 'projects')],
      projectsDir: path.join(server.home, 'projects'), hub: { url: hub, here: true }, sync: serverSync, now: () => clock.t,
      launch: async (l) => {
        launched.push(l)
        execFileSync('node', [FAKE, '--resume', l.session, l.text], { cwd: l.cwd, env: { ...process.env, HOME: server.home }, stdio: 'pipe' })
      },
    })
    const resumeMs = Date.now() - started
    expect(r).toMatchObject({ ok: true, turn: 2, attempt: 2, resume: true, rung: 2, rule: 'machine', leg: 'L2', cwd: server.repo, session: SESSION, stole: false, launched: true })
    if (!r.ok) return
    expect(r.restored).toEqual({ dir: server.repo, mode: 'in-place' })
    expect(fs.readFileSync(path.join(server.repo, 'src/money.ts'), 'utf8')).toContain('€')
    // RESUME-5: the session file is the raw segments, with only the folder changed.
    const raw = hubGit(hub, 'cat-file', 'blob', `${hubGit(hub, 'rev-parse', `refs/threads/${id}`).trim()}:raw/L1.claude.0001.jsonl`)
    const rebuilt = fs.readFileSync(path.join(server.claudeDir, claudeSlug(server.repo), `${SESSION}.jsonl`), 'utf8')
    expect(rebuilt.startsWith(rewritePaths(raw, laptop.repo, server.repo))).toBe(true)
    expect(rebuilt).not.toContain(laptop.home)
    // RESUME-8: the engine got the preface, not the user's message again.
    expect(launched).toHaveLength(1)
    expect(launched[0].text.startsWith(prefaceSign(id))).toBe(true)
    expect(launched[0].text).toContain('Also show it on the cart')
    expect(launched[0].text).toContain('machine-lost')

    // The server's writer reads the resumed turn; its sync pushes it with the new checkpoint.
    await settle(sw)
    await serverSync.round()
    expect(await serverSync.checkpoints()).toBe(1)
    const resumed = journal(hub, `refs/threads/${id}`)
    expect(validateJournal(resumed)).toEqual([])
    const turn2 = resumed.filter((e): e is TurnEvent => e.type === 'turn' && e.turn === 2).map((e) => [e.state, e.attempt ?? e.reason ?? null, e.leg])
    expect(turn2).toEqual([['accepted', null, 'L1'], ['assigned', 1, 'L1'], ['running', null, 'L1'], ['failed', 'machine-lost', 'L1'], ['assigned', 2, null], ['running', null, 'L2'], ['done', null, 'L2']])
    expect(resumed.find((e) => e.type === 'leg.start' && e.leg === 'L2')).toMatchObject({ rung: 2, cwd: server.repo, session: SESSION, epoch: 2, engine: expect.stringMatching(/^claude:[0-9a-f]{6}@server$/) })
    expect(resumed.filter((e) => e.type === 'message' && e.text === 'Also show it on the cart')).toHaveLength(1)
    expect(resumed.some((e) => e.type === 'message' && e.text.includes('[from:weevbook'))).toBe(false)
    expect(resumed.some((e) => e.type === 'message' && e.role === 'assistant' && e.leg === 'L2' && e.text.includes('cart shows the currency'))).toBe(true)
    const ck2 = resumed.findLast((e) => e.type === 'checkpoint')!
    expect(ck2).toMatchObject({ turn: 2, kind: 'git', leg: 'L2' })
    const ck2commit = (ck2 as { commit: string }).commit
    expect(hubGit(hub, 'show', `${ck2commit}:src/cart.ts`)).toContain('€')
    expect(hubGit(hub, 'show', `${ck2commit}:src/money.ts`)).toContain('€')
    expect(hubGit(hub, 'log', '-1', '--format=%P', ck2commit).trim().split(' ')[1]).toBe((ck1 as { commit: string }).commit)
    expect(parseLease(hubGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`))).toMatchObject({ holder: 'server', state: 'idle' })

    // The laptop comes back. What it wrote and never pushed goes to an orphan ref; it stops writing to the thread.
    const back = laptop.sync()
    const lw2 = laptop.writer()
    await lw2.flush()
    clock.t += 20_000
    await back.round()
    expect(back.status.lost.map((l) => l.thread)).toEqual([id])
    expect(hubGit(hub, 'for-each-ref', '--format=%(refname)', `refs/orphans/${id}/`).trim()).toBe(`refs/orphans/${id}/laptop-1`)
    await sessionsA.load()
    expect(sessionsA.get(`claude:${SESSION}`)?.moved).toBe(true)
    a.answer('A late answer from the laptop.')
    await settle(lw2)
    lw2.stop()
    expect(fs.readFileSync(path.join(laptop.dir, back.book.pathOf(id)!, 'events.jsonl'), 'utf8')).not.toContain('A late answer')

    // The server holds the lease: its next round files the orphan as one late note, and deletes the ref.
    clock.t += 60_000
    await serverSync.round()
    expect(hubGit(hub, 'for-each-ref', `refs/orphans/${id}/`).trim()).toBe('')
    const final = journal(hub, `refs/threads/${id}`)
    expect(validateJournal(final)).toEqual([])
    const notes = final.filter((e) => e.type === 'note' && e.kind === 'late')
    expect(notes).toHaveLength(1)
    // Nothing lost, nothing doubled: each step of the laptop is once in the thread or once in the note.
    const inNote = JSON.stringify(notes[0])
    for (const call of ['toolu_a1', 'toolu_a2']) {
      expect(final.filter((e) => e.type === 'tool' && e.call === call)).toHaveLength(1)
      expect(inNote).not.toContain(call)
    }
    expect(final.some((e) => e.type === 'tool' && e.call === 'toolu_a3')).toBe(false)
    expect(inNote).toContain('toolu_a3')
    sw.stop()

    // WEEVBOOK_E2E_REPORT=<file>: the timeline, for a pull request or a report.
    if (process.env.WEEVBOOK_E2E_REPORT) fs.writeFileSync(process.env.WEEVBOOK_E2E_REPORT, `steal delay ${stealDelay / 1000} s after the last renewal (simulated clock); resume ${resumeMs} ms (wall)\n${server.logs.concat(laptop.logs).join('\n')}\n`)
  }, 120_000)
})
