// The vault, step 4 (docs/spec/07-vault.md): the lease on the vault, sealed and slow; no steal without the person's
// agreement or order (VAULT-6); proposals that survive a restart and are never asked twice; direct orders. Two
// machines, two weevbooks, one vault in a folder (real git, bare repositories in a temporary folder; no network).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Weevils } from '../core.ts'
import { proposalLine, startMoves } from '../moves-app.ts'
import { main as cli } from './cli.ts'
import { parseJournal, type EventDraft, type JournalEvent } from './journal.ts'
import { serializeLease, type Lease } from './lease.ts'
import { askMove, openProposals, proposals, settle, watchOnce, type Proposal } from './proposals.ts'
import { Weevbook } from './store.ts'
import { VAULT_RENEW_EVERY, renewVaultLeases, vaultLeases } from './vault-lease.ts'
import { prefaceSign } from './turn.ts'
import { vaultSource } from './vault-raw.ts'
import { newKey, pushVault, restoreVault, type VaultOptions } from './vault.ts'

// Dozens of git commands a test, on a machine that may be busy (the publish gate runs the whole suite beside other work).
vi.setConfig({ testTimeout: 120_000 })

const LAPTOP = 'alex-laptop-7'
const SERVER = 'box-quux'
const TITLE = 'Fix the Zorblax cart rounding'
const CWD = '/home/alex/projects/zorblax-payroll'
const SESSION = '5e551011-aaaa-4bbb-8ccc-000000000001'
const MIN = 60_000
const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM }
let tmp: string
let cfgRoot: string
let clock: { t: number }
beforeAll(() => {
  // No global git configuration of the machine that runs the tests (a signing key, a hook path).
  cfgRoot = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevbook-lease-cfg-'))
  fs.writeFileSync(path.join(cfgRoot, 'gitconfig'), '')
})
afterAll(() => fs.rmSync(cfgRoot, { recursive: true, force: true }))
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevbook-lease-'))
  process.env.GIT_CONFIG_GLOBAL = path.join(cfgRoot, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  clock = { t: Date.parse('2026-11-21T10:00:00Z') }
})
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]
  else process.env[k] = v
  fs.rmSync(tmp, { recursive: true, force: true })
})

let n = 0
const eid = () => `01M7HSBBM0${String(++n).padStart(16, '0')}`
const tid = (i: number) => `01M7HSBBM02XDK5FKDXG64FE${String(60 + i)}`
const at = (s = 0) => new Date(Date.parse('2026-11-16T09:00:00Z') + s * 1000).toISOString()
const git = (gitDir: string, ...args: string[]) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const allObjects = (gitDir: string) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', '--batch-all-objects', '--batch'], { maxBuffer: 1 << 28 })

/** An empty bare repository to read the vault into. */
function bare(name: string) {
  const dir = path.join(tmp, name)
  execFileSync('git', ['init', '-q', '--bare', dir])
  return dir
}

/** The vault's remote: a folder, with its raw repositories beside it. */
function vaultRemote() {
  const dir = path.join(tmp, 'github', 'weevbook-vault.git')
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', dir])
  return dir
}

/** One machine: its home, its data, its vault options on the clock of the test. */
function machine(name: string, remote: string, key: Buffer) {
  const home = path.join(tmp, name)
  const data = path.join(home, 'data')
  fs.mkdirSync(data, { recursive: true })
  const vault: VaultOptions = { dir: path.join(data, 'weevbook'), staging: path.join(data, 'vault.git'), remote, key, machine: name, now: () => clock.t }
  return { name, home, data, vault, dir: vault.dir, claudeDir: path.join(home, '.claude', 'projects'), codexDir: path.join(home, '.codex', 'sessions'), projects: path.join(home, 'projects'), file: path.join(data, 'weevbook-proposals.json') }
}

const claudeLines = (ask: string) => [
  JSON.stringify({ parentUuid: null, cwd: CWD, sessionId: SESSION, type: 'user', message: { role: 'user', content: ask }, uuid: '00000000-0000-4000-8000-000000000001', timestamp: at(2) }),
  JSON.stringify({ parentUuid: '00000000-0000-4000-8000-000000000001', cwd: CWD, sessionId: SESSION, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] }, uuid: '00000000-0000-4000-8000-000000000002', timestamp: at(3) }),
]

/** The end of turn 1: its checkpoint (one the vault never got: the folder is then used as found), then `done`. */
const ended = (s: number): EventDraft[] => [
  { id: eid(), at: at(s), leg: 'L1', type: 'checkpoint', turn: 1, kind: 'shadow', commit: 'a'.repeat(40) },
  { id: eid(), at: at(s), leg: 'L1', type: 'turn', turn: 1, state: 'done' },
]

/** A thread of the laptop: one turn, at work (`running`) or done, with the lines of its Claude session. */
async function thread(m: ReturnType<typeof machine>, id: string, state: 'running' | 'done', title = TITLE) {
  const book = await Weevbook.open(m.dir, m.name)
  const engine = `claude:abc123@${m.name}`
  const msg = eid()
  const events: EventDraft[] = [
    { id: eid(), at: at(), leg: null, type: 'meta', thread: id, project: 'zorblax-payroll' },
    { id: eid(), at: at(), leg: 'L1', type: 'leg.start', engine, session: SESSION, cwd: CWD, rung: 0, epoch: 1 },
    { id: eid(), at: at(1), leg: 'L1', type: 'meta', title },
    { id: msg, at: at(2), leg: 'L1', type: 'message', role: 'user', text: 'Round the cart total', source: 'claude' },
    { id: eid(), at: at(2), leg: 'L1', type: 'turn', turn: 1, state: 'accepted', message: msg },
    { id: eid(), at: at(2), leg: 'L1', type: 'turn', turn: 1, state: 'assigned', engine, attempt: 1, rule: 'shadow', reason: 'test' },
    { id: eid(), at: at(2), leg: 'L1', type: 'turn', turn: 1, state: 'running' },
    ...(state === 'done' ? [{ id: eid(), at: at(3), leg: 'L1', type: 'message', role: 'assistant', text: 'Done.' } as EventDraft, ...ended(3)] : []),
  ]
  expect(await book.lock()).toBe(true)
  const r = await book.append(id, { events, raw: { leg: 'L1', provider: 'claude', lines: claudeLines('Round the cart total') } })
  expect(r.refused, JSON.stringify((await book.thread(id))?.journal.events.filter((e) => e.type === 'note'))).toBe(0)
  await book.commitThread(id, `turn 1 · claude · ${m.name}`)
  await book.unlock(true)
  return book
}

/** The lease of a thread as the vault holds it, opened with the key (through a client of its own). */
async function leaseOn(m: ReturnType<typeof machine>, id: string): Promise<{ lease: Lease | null; commit: string | null }> {
  const f = await vaultLeases({ ...m.vault, staging: bare(`peek-${++n}.git`) }).fetch(id)
  return { lease: f?.seen.lease ?? null, commit: f?.seen.commit ?? null }
}
const journalOf = async (m: ReturnType<typeof machine>, id: string): Promise<JournalEvent[]> => parseJournal(git(path.join(m.dir, '.git'), 'cat-file', 'blob', `refs/threads/${id}:events.jsonl`)).events

/** weevilsd's wiring of moves on a machine (server/moves-app.ts), with engines that only record what they are given. */
function movesOn(m: ReturnType<typeof machine>) {
  const launched: { session: string; text: string }[] = []
  const said: string[] = []
  const w = {
    remotes: [],
    setup: { say: (text: string) => void said.push(text) },
    push: { enabled: false },
    send: async (session: string, text: string) => void launched.push({ session, text }),
    resumeIn: async () => undefined,
  } as unknown as Weevils
  const moves = startMoves({ w, machine: { id: m.name, name: m.name }, dataDir: m.data, home: m.home, claudeDir: m.claudeDir, codexDir: m.codexDir, roots: [m.projects], projectsDir: m.projects, vault: () => m.vault, watch: false })
  return { ...moves, launched, said }
}

/** One look of the watch (what weevilsd does every two minutes), with the client that remembers what it has seen. */
function watchOf(m: ReturnType<typeof machine>) {
  const leases = vaultLeases(m.vault)
  const said: { made: Proposal[]; minutes: number }[] = []
  const look = () => watchOnce({ vault: m.vault, leases, file: m.file, say: (made, minutes) => void said.push({ made, minutes }), refresh: (t) => vaultSource(m.vault).refresh(t) })
  return { look, said }
}

describe('the lease on the vault (07-vault.md, step 4)', () => {
  it('VAULT-6: a machine goes silent, nothing moves; weevboss proposes in one line; on the yes the thread resumes on the other machine with the lease taken', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const id = tid(1)
    await thread(laptop, id, 'running')
    const mine = vaultLeases(laptop.vault)
    expect(await pushVault({ ...laptop.vault, leases: mine })).toMatchObject({ pushed: 2, elsewhere: [] })
    const first = await leaseOn(server, id)
    expect(first.lease).toMatchObject({ holder: LAPTOP, epoch: 1, state: 'working', turn: 1, engine: `claude:abc123@${LAPTOP}` })
    const tip = git(remote, 'rev-parse', `refs/threads/${id}`)

    // The server serves the app: it watches. The laptop renews once, five minutes later, then goes silent.
    const watch = watchOf(server)
    expect(await watch.look()).toEqual([])
    clock.t += 5 * MIN
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [id], lost: [] })
    const renewed = await leaseOn(server, id)
    expect(await watch.look()).toEqual([])
    clock.t += 9 * MIN // 9 min after the last renewal: not silent yet
    expect(await watch.look()).toEqual([])
    expect(openProposals(server.file)).toEqual([])
    clock.t += 2 * MIN // 11 min: past `expires` + 30 s, and unchanged for 10 min on the server's own clock

    // Silent: a proposal, said once in one line. Nothing moved: the lease, the thread and the server's weevbook.
    const made = await watch.look()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ id: 'm1', kind: 'silent', thread: id, title: TITLE, from: LAPTOP, to: SERVER, state: 'open' })
    expect(watch.said).toHaveLength(1)
    expect(watch.said[0].minutes).toBe(11)
    expect(proposalLine(watch.said[0].made, 11, SERVER)).toBe(`**${LAPTOP}** has been silent for 11 min. Shall I continue “${TITLE}” here, on ${SERVER}?`)
    expect((await leaseOn(server, id)).commit).toBe(renewed.commit)
    expect(git(remote, 'rev-parse', `refs/threads/${id}`)).toBe(tip)
    expect((await journalOf(server, id)).filter((e) => e.type === 'leg.start')).toHaveLength(1)
    // Looked at again, and again after a restart of weevilsd (a new watch, the same file): asked once, still open.
    clock.t += 2 * MIN
    expect(await watch.look()).toEqual([])
    const after = watchOf(server)
    expect(await after.look()).toEqual([])
    expect(after.said).toEqual([])
    expect(openProposals(server.file).map((p) => p.id)).toEqual(['m1'])
    expect((await leaseOn(server, id)).commit).toBe(renewed.commit)

    // The yes: the steal of 03, then the resume of 04, on the server.
    const moves = movesOn(server)
    expect(await moves.agree()).toEqual([{ id: 'm1', title: TITLE, ok: true, what: 'moved', machine: SERVER }])
    expect(proposals(server.file)[0]).toMatchObject({ state: 'agreed', result: `continues on ${SERVER}` })
    const taken = await leaseOn(laptop, id)
    expect(taken.lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'working', turn: 1, engine: expect.stringMatching(new RegExp(`^claude:[0-9a-z]+@${SERVER}$`)) as string })
    const events = await journalOf(server, id)
    expect(events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? [e.state, e.state === 'failed' ? e.reason : null] : null))).toEqual([['accepted', null], ['assigned', null], ['running', null], ['failed', 'machine-lost'], ['assigned', null], ['running', null]])
    expect(events.filter((e) => e.type === 'leg.end')).toMatchObject([{ leg: 'L1', reason: 'machine-lost', by: SERVER }])
    expect(events.findLast((e) => e.type === 'leg.start')).toMatchObject({ leg: 'L2', rung: 2, session: SESSION, epoch: 2, cwd: path.join(server.projects, 'zorblax-payroll') })
    // The engine gets the preface of a turn that had started, never the person's message as if it were new.
    expect(moves.launched).toHaveLength(1)
    expect(moves.launched[0].session).toBe(SESSION)
    expect(moves.launched[0].text.startsWith(prefaceSign(id))).toBe(true)
    expect(moves.launched[0].text).toContain('Round the cart total')
    expect(moves.launched[0].text).toContain('machine-lost')
    // The journal with the new leg is on the vault already, pushed with the lease.
    expect(git(remote, 'rev-parse', `refs/threads/${id}`)).not.toBe(tip)

    // The laptop comes back with one more line of its own: the vault takes nothing of it any more.
    const book = await Weevbook.open(laptop.dir, LAPTOP)
    expect(await book.lock()).toBe(true)
    expect((await book.append(id, { events: [{ id: eid(), at: at(9), leg: 'L1', type: 'message', role: 'assistant', text: 'Still here.' }] })).refused).toBe(0)
    await book.commitThread(id, 'late')
    await book.unlock(true)
    const vaultTip = git(remote, 'rev-parse', `refs/threads/${id}`)
    expect(await pushVault({ ...laptop.vault, leases: mine, raw: false })).toMatchObject({ pushed: 0, differ: [id] })
    // Its renewal is refused, once: it learns there that the thread went on elsewhere.
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [], lost: [{ thread: id, to: SERVER }] })
    clock.t += VAULT_RENEW_EVERY
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [], lost: [] })
    expect(git(remote, 'rev-parse', `refs/threads/${id}`)).toBe(vaultTip)
    expect((await leaseOn(laptop, id)).lease).toMatchObject({ holder: SERVER, epoch: 2 })
  })

  it('renews a working lease every five minutes, not before, and lets it go idle with the push that ends the turn', async () => {
    const remote = vaultRemote()
    const laptop = machine(LAPTOP, remote, newKey())
    const id = tid(2)
    const book = await thread(laptop, id, 'running')
    const mine = vaultLeases(laptop.vault)
    await pushVault({ ...laptop.vault, leases: mine, raw: false })
    const t0 = clock.t
    const c0 = (await leaseOn(laptop, id)).commit
    clock.t += VAULT_RENEW_EVERY - 1000
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [], lost: [] })
    expect((await leaseOn(laptop, id)).commit).toBe(c0)
    clock.t += 1000
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [id], lost: [] })
    const l1 = await leaseOn(laptop, id)
    expect(l1.commit).not.toBe(c0)
    expect(l1.lease).toMatchObject({ holder: LAPTOP, epoch: 1, state: 'working', renewed: new Date(t0 + VAULT_RENEW_EVERY).toISOString().replace('.000Z', 'Z'), expires: new Date(t0 + VAULT_RENEW_EVERY + 10 * MIN).toISOString().replace('.000Z', 'Z') })
    // A push with nothing new renews nothing; the push of the turn's end carries the lease, idle.
    expect(await pushVault({ ...laptop.vault, leases: mine, raw: false })).toMatchObject({ pushed: 0 })
    expect((await leaseOn(laptop, id)).commit).toBe(l1.commit)
    expect(await book.lock()).toBe(true)
    expect((await book.append(id, { events: ended(5) })).refused).toBe(0)
    await book.commitThread(id, 'turn 1')
    await book.unlock(true)
    clock.t += MIN
    expect(await pushVault({ ...laptop.vault, leases: mine, raw: false })).toMatchObject({ pushed: 1, elsewhere: [] })
    expect((await leaseOn(laptop, id)).lease).toMatchObject({ holder: LAPTOP, epoch: 1, state: 'idle' })
    clock.t += 20 * MIN
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [], lost: [] })
  })

  it('a declined proposal is not asked again for the same silence; a machine that came back withdraws the question', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const id = tid(3)
    await thread(laptop, id, 'running')
    const mine = vaultLeases(laptop.vault)
    await pushVault({ ...laptop.vault, leases: mine })
    const watch = watchOf(server)
    await watch.look()
    clock.t += 11 * MIN
    expect(await watch.look()).toHaveLength(1)
    const lease = (await leaseOn(server, id)).commit

    // No: nothing moves, and the same silence never asks again, in this run or after a restart.
    expect(settle(server.file, undefined, 'declined', clock.t).map((p) => p.id)).toEqual(['m1'])
    clock.t += 30 * MIN
    expect(await watch.look()).toEqual([])
    expect(await watchOf(server).look()).toEqual([])
    expect(watch.said).toHaveLength(1)
    expect(proposals(server.file).map((p) => p.state)).toEqual(['declined'])
    expect((await leaseOn(server, id)).commit).toBe(lease)
    expect(await movesOn(server).agree()).toEqual([])

    // The laptop comes back (it renews), then goes silent again: another silence, asked once more.
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [id], lost: [] })
    expect(await watch.look()).toEqual([])
    clock.t += 11 * MIN
    const again = await watch.look()
    expect(again.map((p) => p.id)).toEqual(['m2'])
    // …and back once more before any answer: the open question is withdrawn, a late yes moves nothing.
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [id], lost: [] })
    expect(await watch.look()).toEqual([])
    expect(proposals(server.file).map((p) => p.state)).toEqual(['declined', 'withdrawn'])
    expect(await movesOn(server).agree()).toEqual([])
    expect((await leaseOn(server, id)).lease).toMatchObject({ holder: LAPTOP, epoch: 1, state: 'working' })
  })

  it('a direct order moves at once: an idle thread is taken over; one still at work is refused, then taken with --force', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const idle = tid(4)
    const busy = tid(5)
    await thread(laptop, idle, 'done')
    await pushVault(laptop.vault)
    expect((await leaseOn(server, idle)).lease).toMatchObject({ holder: LAPTOP, epoch: 1, state: 'idle' })
    const moves = movesOn(server)
    expect(openProposals(server.file)).toEqual([])

    // "Continue this on the server": no proposal, no steal; the leg moves, nothing is started (no turn was waiting).
    expect(await moves.move({ thread: idle, to: SERVER })).toEqual({ ok: true, thread: idle, machine: SERVER, turn: null, engine: expect.stringContaining(`@${SERVER}`) as string, stole: false, launched: false })
    expect((await leaseOn(laptop, idle)).lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'idle' })
    expect((await journalOf(server, idle)).filter((e) => e.type === 'leg.end')).toMatchObject([{ leg: 'L1', reason: 'moved', by: SERVER }])
    expect(moves.launched).toEqual([])
    expect(proposals(server.file)).toEqual([])
    // Named by its session, as weevboss knows it; here already: refused, nothing written.
    expect(await moves.move({ thread: SESSION.slice(0, 8), to: SERVER })).toMatchObject({ ok: false, why: 'own-leg' })
    expect(await moves.move({ thread: idle, to: 'no-such-box' })).toMatchObject({ ok: false, why: 'unknown-machine' })
    expect(await moves.move({ thread: 'ffffffff', to: SERVER })).toMatchObject({ ok: false, why: 'unknown' })

    // At work on the laptop, renewed a minute ago: refused without the person's word, and nothing changed.
    fs.rmSync(laptop.dir, { recursive: true, force: true })
    fs.rmSync(laptop.vault.staging, { recursive: true, force: true })
    await thread(laptop, busy, 'running', 'Another one')
    await pushVault(laptop.vault)
    clock.t += MIN
    const before = (await leaseOn(server, busy)).commit
    expect(await moves.move({ thread: busy, to: SERVER })).toMatchObject({ ok: false, why: 'held', holder: LAPTOP })
    expect(await moves.move({ thread: busy, to: SERVER, engine: 'codex', force: true })).toMatchObject({ ok: false, why: 'other-provider' })
    expect((await leaseOn(server, busy)).commit).toBe(before)
    expect(moves.launched).toEqual([])
    // "Yes, take it": stolen on the person's order, whatever the clock says.
    expect(await moves.move({ thread: busy, to: SERVER, engine: 'claude', force: true })).toMatchObject({ ok: true, machine: SERVER, turn: 1, stole: true, launched: true })
    expect((await leaseOn(laptop, busy)).lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'working', turn: 1 })
    expect(moves.launched).toHaveLength(1)
  })

  it('a thread whose lease another machine holds is left out of this machine\'s pushes, and its renewal is lost, not forced', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const id = tid(8)
    const book = await thread(laptop, id, 'running')
    const mine = vaultLeases(laptop.vault)
    await pushVault({ ...laptop.vault, leases: mine, raw: false })
    const tip = git(remote, 'rev-parse', `refs/threads/${id}`)
    // The server takes the lease on the person's order (the first half of a move), and has pushed nothing yet.
    expect(await vaultSource(server.vault).claim(id)).toMatchObject({ ok: false, why: 'held', holder: LAPTOP })
    expect(await vaultSource(server.vault).claim(id, true)).toEqual({ ok: true, stole: true, epoch: 2 })
    // The laptop was alive after all: its next lines stay with it.
    expect(await book.lock()).toBe(true)
    expect((await book.append(id, { events: [{ id: eid(), at: at(9), leg: 'L1', type: 'message', role: 'assistant', text: 'Still here.' }] })).refused).toBe(0)
    await book.commitThread(id, 'late')
    await book.unlock(true)
    clock.t += VAULT_RENEW_EVERY
    expect(await renewVaultLeases(laptop.vault, mine)).toEqual({ renewed: [], lost: [{ thread: id, to: SERVER }] })
    expect(await pushVault({ ...laptop.vault, leases: mine, raw: false })).toMatchObject({ pushed: 0, differ: [], elsewhere: [{ thread: id, holder: SERVER }] })
    expect(git(remote, 'rev-parse', `refs/threads/${id}`)).toBe(tip)
    expect((await leaseOn(laptop, id)).lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'working', turn: 0 })
    // The move did not happen after all: the server gives the lease back, idle, and the laptop's lines go.
    await vaultSource(server.vault).release(id)
    expect((await leaseOn(laptop, id)).lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'idle' })
    expect(await pushVault({ ...laptop.vault, leases: mine, raw: false })).toMatchObject({ pushed: 1, elsewhere: [] })
    expect((await leaseOn(server, id)).lease).toMatchObject({ holder: LAPTOP, epoch: 3, state: 'working', turn: 1 })
  })

  it('hub installs unchanged: where a hub\'s lease names this machine, the vault\'s lease follows it instead of holding the push back', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const id = tid(10)
    await thread(laptop, id, 'running')
    await pushVault({ ...laptop.vault, raw: false })
    // The server has the thread (as its hub gave it) and went on with it: the hub stole the laptop's lease for it.
    expect(await restoreVault(server.vault)).toMatchObject({ restored: 1 })
    const book = await Weevbook.open(server.dir, SERVER)
    expect(await book.lock()).toBe(true)
    expect((await book.append(id, { events: [{ id: eid(), at: at(9), leg: 'L1', type: 'turn', turn: 1, state: 'failed', reason: 'machine-lost', effect: 'some' }, { id: eid(), at: at(9), leg: 'L1', type: 'leg.end', reason: 'machine-lost', by: SERVER }] })).refused).toBe(0)
    await book.commitThread(id, 'machine-lost')
    await book.unlock(true)
    // With no hub, the laptop's working lease on the vault holds the push back (nothing is taken by itself).
    expect(await pushVault({ ...server.vault, raw: false })).toMatchObject({ pushed: 0, elsewhere: [{ thread: id, holder: LAPTOP }] })
    // With the hub's lease in this machine's name (refs/hub/leases, plain, as hub.ts keeps it), the vault follows.
    const gitDir = path.join(server.dir, '.git')
    const hubLease = serializeLease({ v: 1, thread: id, holder: SERVER, engine: null, leg: null, epoch: 2, state: 'idle', taken: '2026-11-21T10:00:00Z', renewed: '2026-11-21T10:00:00Z', expires: '2026-11-21T10:01:00Z', tip: null })
    const blob = execFileSync('git', ['--git-dir', gitDir, 'hash-object', '-w', '--stdin'], { input: hubLease, encoding: 'utf8' }).trim()
    const tree = execFileSync('git', ['--git-dir', gitDir, 'mktree'], { input: `100644 blob ${blob}\tlease.json\n`, encoding: 'utf8' }).trim()
    const commit = execFileSync('git', ['--git-dir', gitDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', tree, '-m', 'lease'], { encoding: 'utf8' }).trim()
    git(gitDir, 'update-ref', `refs/hub/leases/${id}`, commit)
    expect(await pushVault({ ...server.vault, raw: false })).toMatchObject({ pushed: 0, elsewhere: [{ thread: id, holder: LAPTOP }] }) // a ref left from an old hub is not one
    expect(await pushVault({ ...server.vault, raw: false, hub: true })).toMatchObject({ pushed: 1, elsewhere: [] })
    expect((await leaseOn(laptop, id)).lease).toMatchObject({ holder: SERVER, epoch: 2, state: 'idle' })
  })

  it('VAULT-1 with leases: no machine, engine, title or state readable in any object or name of the remote', async () => {
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine(LAPTOP, remote, key)
    const server = machine(SERVER, remote, key)
    const id = tid(6)
    await thread(laptop, id, 'running')
    await pushVault(laptop.vault)
    expect((await movesOn(server).move({ thread: id, to: SERVER, force: true })).ok).toBe(true)
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/leases/')).toBe(`refs/leases/${id}`)
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/leases/${id}`)).toBe('l')
    expect(git(remote, 'log', '--format=%an <%ae> %ad %cn <%ce> %cd %s', `refs/leases/${id}`)).toBe('vault <vault@weevils.invalid> Sat Jan 1 00:00:00 2000 +0000 vault <vault@weevils.invalid> Sat Jan 1 00:00:00 2000 +0000 vault')
    const bytes = allObjects(remote)
    const hay = [bytes.toString('latin1'), bytes.toString('utf8'), git(remote, 'for-each-ref', '--format=%(refname) %(authorname) %(authoremail) %(subject)')].join('\n')
    for (const s of [LAPTOP, SERVER, 'laptop', 'quux', 'abc123', 'claude:', 'holder', 'epoch', 'working', 'lease.json', 'Zorblax', 'zorblax', SESSION, 'machine-lost']) expect(hay.includes(s), s).toBe(false)
    // …and a machine without the key reads nothing of it.
    const stranger = vaultLeases({ ...server.vault, key: newKey(), staging: bare('stranger.git') })
    const seen = (await stranger.fetch(id))!.seen
    expect(seen.commit).not.toBeNull()
    expect(seen.lease).toBeNull()
  })
})

describe("the dispatcher's moves as proposals (06-dispatch.md, 07 step 4)", () => {
  it('a move is asked once with the table\'s own reason, waits while open, goes when agreed, and is never asked again when declined', () => {
    const file = path.join(tmp, 'proposals.json')
    const said: Proposal[] = []
    const m = { thread: tid(7), turn: 2, rule: 'account', from: 'claude:a3f9c1@server', engine: 'claude:7b20d4@server', reason: 'claude a3f9c1 is at its 5-hour limit until 17:00 UTC; claude 7b20d4 is at 40 %', title: 'Add CSV export' }
    expect(askMove(file, m, 1, (p) => said.push(p))).toBe('open')
    expect(askMove(file, m, 2, (p) => said.push(p))).toBe('open')
    expect(said).toHaveLength(1)
    expect(said[0]).toMatchObject({ id: 'm1', kind: 'account', thread: m.thread, from: m.from, to: '7b20d4', reason: m.reason, state: 'open' })
    expect(proposalLine(said, 0, 'server', 'second@example.com')).toBe('This subscription is nearly used up. Shall I continue “Add CSV export” on second@example.com?')
    settle(file, 'm1', 'agreed', 3)
    expect(askMove(file, m, 4, (p) => said.push(p))).toBe('agreed')
    // Another turn, another machine: its own question; declined, it stays declined across a restart (the file).
    const other = { ...m, turn: 3, rule: 'machine', engine: 'claude:a3f9c1@laptop' }
    expect(askMove(file, other, 5, (p) => said.push(p))).toBe('open')
    expect(said[1]).toMatchObject({ id: 'm2', kind: 'machine', to: 'laptop' })
    settle(file, undefined, 'declined', 6)
    expect(askMove(file, other, 7, (p) => said.push(p))).toBe('declined')
    expect(said).toHaveLength(2)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).proposals.map((p: Proposal) => p.state)).toEqual(['agreed', 'declined'])
  })
})

describe('weevils weevbook proposals | decline (what weevboss runs)', () => {
  it('lists the open proposals in words and as JSON, declines one or all, and says so when none waits', async () => {
    const data = path.join(tmp, 'cli')
    const file = path.join(data, 'weevbook-proposals.json')
    const lines: string[] = []
    const run = async (...args: string[]) => {
      lines.length = 0
      return cli([...args, '--data-dir', data], (l) => lines.push(l))
    }
    expect(await run('proposals')).toBe(0)
    expect(lines).toEqual(['no move waits for an answer'])
    const m = { thread: tid(9), turn: 1, rule: 'machine', from: 'claude:a3f9c1@laptop', engine: 'claude:a3f9c1@server', reason: 'laptop has been silent since 13:53', title: 'Add CSV export' }
    askMove(file, m, 1, () => undefined)
    askMove(file, { ...m, turn: 2, rule: 'provider', engine: 'codex:c81d2e@laptop' }, 2, () => undefined)
    expect(await run('proposals')).toBe(0)
    expect(lines).toEqual(['m1 · open · “Add CSV export”: claude:a3f9c1@laptop → server (laptop has been silent since 13:53)', 'm2 · open · “Add CSV export”: claude:a3f9c1@laptop → codex (laptop has been silent since 13:53)'])
    expect(await run('proposals', '--json')).toBe(0)
    expect((JSON.parse(lines[0]) as { open: Proposal[] }).open.map((p) => [p.id, p.kind, p.to])).toEqual([['m1', 'machine', 'server'], ['m2', 'provider', 'codex']])
    expect(await run('decline', 'm2')).toBe(0)
    expect(lines).toEqual(['m2 declined: “Add CSV export” stays where it is, and it will not be asked again'])
    expect(await run('decline', 'm2')).toBe(1)
    expect(await run('decline')).toBe(0)
    expect(openProposals(file)).toEqual([])
    expect(await run('agree')).toBe(0) // nothing open: no call to weevilsd, nothing moves
    expect(lines).toEqual(['no move waits for an answer'])
    expect(await run('move', tid(9))).toBe(2) // no --to: the usage, nothing asked of weevilsd
  })
})
