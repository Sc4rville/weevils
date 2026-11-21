// The vault, step 3 (docs/spec/07-vault.md): slim raw lines in the raw repositories, the map, the access each machine
// gets, the checkpoints as encrypted bundles, and a thread resumed from them on a machine that never ran it. Real git,
// bare repositories in a temporary folder, a stand-in for `gh`; no network.

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeSlug, rewritePaths } from '../bring.ts'
import { keepInWeevbook, restoreCheckpoint, takeCheckpoint } from './checkpoint.ts'
import { checkpointHook } from './hub.ts'
import { parseJournal, validateJournal, type EventDraft, type JournalEvent, type TurnEvent } from './journal.ts'
import { placeAndRestore, rebuild, resumeThread, type Launch } from './resume.ts'
import { slimRaw } from './slim.ts'
import { Weevbook } from './store.ts'
import { Sessions } from './sync.ts'
import { prefaceSign } from './turn.ts'
import { ghRunner } from './vault-github.ts'
import { fetchCheckpoint, fetchRaw, rawRemote, readMap, vaultSource } from './vault-raw.ts'
import { newKey, pushVault, restoreVault, startVaultPusher, vaultStatus, writeKey, type VaultOptions } from './vault.ts'
import { vaultMain } from './vault-cli.ts'
import { startWeevbookWriter } from './writer.ts'

// Dozens of git commands a test, on a machine that may be busy (the publish gate runs the whole suite beside other work).
vi.setConfig({ testTimeout: 60_000 })

const MACHINE = 'alex-macbook-7'
const FAKE = path.resolve(import.meta.dirname, '../../test/fixtures/weevbook/fake-claude.mjs')
const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, PATH: process.env.PATH }
let tmp: string
let cfgRoot: string
beforeAll(() => {
  // No global git configuration of the machine that runs the tests (a signing key, a hook path).
  cfgRoot = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevbook-raw-cfg-'))
  fs.writeFileSync(path.join(cfgRoot, 'gitconfig'), '')
})
afterAll(() => fs.rmSync(cfgRoot, { recursive: true, force: true }))
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevbook-raw-'))
  process.env.GIT_CONFIG_GLOBAL = path.join(cfgRoot, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
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
const run = (cwd: string, cmd: string, ...args: string[]) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 })
const git = (gitDir: string, ...args: string[]) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()
const work = (cwd: string, ...args: string[]) => run(cwd, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args).trim()
const allObjects = (gitDir: string) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', '--batch-all-objects', '--batch'], { maxBuffer: 1 << 28 })
const objectIds = (gitDir: string) => new Set(git(gitDir, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split('\n').filter(Boolean))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const big = (len: number, c = 'x') => c.repeat(len)
const noise = (bytes: number) => crypto.randomBytes(bytes).toString('base64')

/** The vault's remote: a folder, with its raw repositories beside it. */
function vaultRemote(name = 'github') {
  const dir = path.join(tmp, name, 'weevbook-vault.git')
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', dir])
  return dir
}
const opts = (name: string, remote: string, key: Buffer, more: Partial<VaultOptions> = {}): VaultOptions => ({ dir: path.join(tmp, name, 'weevbook'), staging: path.join(tmp, name, 'vault.git'), remote, key, machine: name === 'a' ? MACHINE : name, ...more })

const SECRETS = {
  cwd: '/home/alex/projects/zorblax-payroll',
  ask: 'Fix the Zorblax cart rounding',
  thought: 'The rounding bug is in /home/alex/projects/zorblax-payroll/src/cart.ts, é 😀 "quoted"',
  signature: 'EqQBCkYIBxgCKkDu9SIGNATUREzorblaxAAA==',
  output: 'PURPLE-HEDGEHOG-4471',
}

/** A Claude session as Claude Code writes it: a signed thinking block, tool calls, a long output with Claude Code's
 *  own copy of it, a picture read from disk. Each line names its parent. */
function claudeLines(cwd: string, session: string, more = 0): string[] {
  const out: string[] = []
  let parent: string | null = null
  let k = 0
  const line = (type: 'user' | 'assistant', message: unknown, extra: Record<string, unknown> = {}) => {
    const uuid = `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`
    out.push(JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.327', gitBranch: 'main', type, message, ...extra, uuid, timestamp: at(k) }))
    parent = uuid
  }
  const assistant = (content: unknown[], stop: string) => line('assistant', { id: `msg_${k}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content, stop_reason: stop })
  line('user', { role: 'user', content: SECRETS.ask })
  assistant([{ type: 'thinking', thinking: SECRETS.thought, signature: SECRETS.signature }, { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: `cat ${cwd}/src/cart.ts` } }], 'tool_use')
  const long = `${SECRETS.output}\n${big(60_000)}\nend of ${cwd}/src/cart.ts`
  line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: long }] }, { toolUseResult: { stdout: long, stderr: '', interrupted: false, isImage: false } })
  assistant([{ type: 'thinking', thinking: 'Now the screenshot.', signature: `${SECRETS.signature}2` }, { type: 'tool_use', id: 'toolu_02', name: 'Read', input: { file_path: `${cwd}/shot.png` } }], 'tool_use')
  const png = big(80_000, 'A')
  line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }] }, { toolUseResult: { type: 'image', file: { base64: png, type: 'image/png', originalSize: 60_000 } } })
  assistant([{ type: 'text', text: 'Fixed the rounding.' }], 'end_turn')
  for (let i = 0; i < more; i++) {
    line('user', { role: 'user', content: `one more ${i}` })
    assistant([{ type: 'tool_use', id: `toolu_1${i}`, name: 'Bash', input: { command: 'ls' } }], 'tool_use')
    line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_1${i}`, content: big(30_000, 'q') }] })
    assistant([{ type: 'text', text: `done ${i}` }], 'end_turn')
  }
  return out
}

function start(thread: string, session: string, cwd: string, title: string): EventDraft[] {
  return [
    { id: eid(), at: at(), leg: null, type: 'meta', thread, project: 'zorblax-payroll' },
    { id: eid(), at: at(), leg: 'L1', type: 'leg.start', engine: `claude:abc123@${MACHINE}`, session, cwd, rung: 0, epoch: 1 },
    { id: eid(), at: at(1), leg: 'L1', type: 'meta', title },
    { id: eid(), at: at(2), leg: 'L1', type: 'message', role: 'user', text: 'hello', source: 'claude' },
  ]
}

/** A weevbook with threads that have raw lines (one segment each, leg L1). */
async function makeBook(name: string, threads: { id: string; lines: string[]; session?: string }[], machine = MACHINE) {
  const book = await Weevbook.open(path.join(tmp, name, 'weevbook'), machine)
  expect(await book.lock()).toBe(true)
  for (const t of threads) {
    await book.append(t.id, { events: start(t.id, t.session ?? `session-${t.id.slice(-2)}`, SECRETS.cwd, `Thread ${t.id.slice(-2)}`), raw: { leg: 'L1', provider: 'claude', lines: t.lines } })
    await book.commitThread(t.id, `turn 1 · claude · ${machine}`)
  }
  await book.unlock(true)
  return book
}
async function more(book: Weevbook, id: string, lines: string[], s = 30) {
  expect(await book.lock()).toBe(true)
  await book.append(id, { events: [{ id: eid(), at: at(s), leg: 'L1', type: 'message', role: 'user', text: `again ${s}`, source: 'claude' }], raw: { leg: 'L1', provider: 'claude', lines } })
  await book.commitThread(id, 'turn 2')
  await book.unlock(true)
}
const rawOf = (lines: string[]) => Buffer.from(`${lines.join('\n')}\n`)
const SEG = 'L1.claude.0001.jsonl'

describe('slim raw in the raw repositories', () => {
  it('VAULT-1, VAULT-2, VAULT-3 for raw: nothing readable; a new machine gets the slim of the source byte for byte; a second push only adds', async () => {
    const [T1, T2] = [tid(1), tid(2)]
    const lines = claudeLines(SECRETS.cwd, 's1')
    const a = await makeBook('a', [{ id: T1, lines }, { id: T2, lines: claudeLines(SECRETS.cwd, 's2') }])
    const remote = vaultRemote()
    const key = newKey()
    const r = await pushVault(opts('a', remote, key))
    expect(r.raw).toMatchObject({ sealed: 2, chunks: 2, pushes: 1, pushed: 2, waiting: 0, noRepo: 0, differ: [], failed: [], repos: 1 })
    expect(r.raw!.error).toBeUndefined()
    const raw1 = rawRemote(remote, 1)
    expect(raw1).toBe(path.join(tmp, 'github', 'weevbook-raw-001.git'))
    expect(git(raw1, 'for-each-ref', '--format=%(refname)').split('\n')).toEqual([`refs/raw/${T1}`, `refs/raw/${T2}`])
    expect(git(raw1, 'ls-tree', '-r', '--name-only', `refs/raw/${T1}`)).toMatch(/^c\/[0-9a-f]{64}\nm$/)
    expect(git(raw1, 'log', '--format=%an <%ae> %ad %s', `refs/raw/${T1}`)).toBe('vault <vault@weevils.invalid> Sat Jan 1 00:00:00 2000 +0000 vault')
    // VAULT-1: neither the raw repository nor the vault's map says anything.
    for (const repo of [raw1, remote]) {
      const hay = allObjects(repo)
      for (const s of [SECRETS.cwd, 'zorblax', SECRETS.ask, 'rounding bug', SECRETS.signature, SECRETS.output, MACHINE, 'toolu_01', 'weevbook-raw', 'ssh-ed25519']) expect(hay.includes(s), s).toBe(false)
    }
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/map/')).toBe('refs/map/raw')

    // VAULT-2: a machine that holds the key and the vault's address only.
    const b = opts('b', remote, key)
    const got = await fetchRaw(b, T1)
    expect([...got.keys()]).toEqual([SEG])
    const slim = await slimRaw(rawOf(lines), 'claude', MACHINE)
    expect(got.get(SEG)!.equals(slim)).toBe(true)
    expect(slim.length).toBeLessThan(rawOf(lines).length / 5)
    expect(got.get(SEG)!.toString()).toContain(`KB kept on ${MACHINE} …]`)
    // Only that thread was fetched.
    expect(git(b.staging, 'for-each-ref', '--format=%(refname)', 'refs/vault-remote/raw/')).toBe(`refs/vault-remote/raw/${T1}`)

    // VAULT-3: one more turn. The remote only grows, by one chunk; what the first push sealed is still there.
    const before = objectIds(raw1)
    const oldChunks = git(raw1, 'ls-tree', '-r', `refs/raw/${T1}`, 'c')
    const tip = git(raw1, 'rev-parse', `refs/raw/${T1}`)
    const t2 = git(raw1, 'rev-parse', `refs/raw/${T2}`)
    const extra = claudeLines(SECRETS.cwd, 's1', 2).slice(lines.length)
    await more(a, T1, extra)
    const again = await pushVault(opts('a', remote, key))
    expect(again.raw).toMatchObject({ sealed: 1, chunks: 1, pushes: 1, pushed: 1 })
    const after = objectIds(raw1)
    for (const o of before) expect(after.has(o)).toBe(true)
    expect(after.size - before.size).toBe(5) // one chunk, one manifest, two trees, one commit
    for (const l of oldChunks.split('\n')) expect(git(raw1, 'ls-tree', '-r', `refs/raw/${T1}`, 'c').split('\n')).toContain(l)
    expect(git(raw1, 'rev-parse', `refs/raw/${T1}^`)).toBe(tip)
    expect(git(raw1, 'rev-parse', `refs/raw/${T2}`)).toBe(t2)
    const whole = await slimRaw(rawOf([...lines, ...extra]), 'claude', MACHINE)
    expect((await fetchRaw(b, T1)).get(SEG)!.equals(whole)).toBe(true)

    // Nothing new: nothing sealed, nothing sent, not one object more (VAULT-5 for raw).
    const idle = await pushVault(opts('a', remote, key))
    expect(idle.raw).toMatchObject({ sealed: 0, pushes: 0, pushed: 0 })
    expect(objectIds(raw1).size).toBe(after.size)
    expect(await vaultStatus({ dir: a.dir, staging: opts('a', remote, key).staging, remote, key: true })).toMatchObject({ rawPending: 0, checkpointsPending: 0 })
  })

  it('VAULT-4: a Claude session rebuilt from slim raw in another folder keeps every thinking block and signature, every tool pair, the parent chain', async () => {
    const T1 = tid(1)
    const lines = claudeLines(SECRETS.cwd, 's1', 1)
    await makeBook('a', [{ id: T1, lines, session: 's1' }])
    const remote = vaultRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    // The other machine: the journal from the vault, then the session rebuilt where its project lives there.
    const b = opts('b', remote, key)
    await restoreVault(b)
    const book = await Weevbook.open(b.dir, 'b')
    const th = (await book.thread(T1))!
    expect(fs.existsSync(path.join(book.abs(th.path), 'raw'))).toBe(false)
    const there = '/srv/work/payroll'
    const text = await rebuild(book, T1, th.journal.events, 'claude', 's1', there, await fetchRaw(b, T1))
    const built = text.split('\n').filter(Boolean)
    expect(built).toHaveLength(lines.length)
    type Block = { type: string; id?: string; tool_use_id?: string; thinking?: string; signature?: string }
    type Line = { uuid: string; parentUuid: string | null; cwd: string; toolUseResult?: unknown; message: { content: Block[] | string } }
    const src = lines.map((l) => JSON.parse(l) as Line)
    const out = built.map((l) => JSON.parse(l) as Line)
    const blocks = (ls: Line[], type: string) => ls.flatMap((l) => (Array.isArray(l.message.content) ? l.message.content.filter((c) => c.type === type) : []))
    // Every signed block, value for value, and as the very same bytes in its line.
    expect(blocks(out, 'thinking')).toEqual(blocks(src, 'thinking'))
    expect(blocks(out, 'thinking')).toHaveLength(2)
    for (const t of blocks(src, 'thinking')) expect(built.some((l) => l.includes(JSON.stringify(t)))).toBe(true)
    expect(text).toContain(JSON.stringify(SECRETS.thought)) // the old folder inside a thinking block is not rewritten
    // The chain and the order.
    expect(out.map((l) => l.uuid)).toEqual(src.map((l) => l.uuid))
    expect(out.map((l) => l.parentUuid)).toEqual(src.map((l) => l.parentUuid))
    out.forEach((l, i) => expect(l.parentUuid).toBe(i ? out[i - 1].uuid : null))
    // Every tool call still has its result, after it.
    const uses = blocks(out, 'tool_use').map((c) => c.id)
    expect(uses).toEqual(blocks(src, 'tool_use').map((c) => c.id))
    expect(blocks(out, 'tool_result').map((c) => c.tool_use_id)).toEqual(uses)
    for (const id of uses) expect(out.findIndex((l) => blocks([l], 'tool_use').some((c) => c.id === id))).toBeLessThan(out.findIndex((l) => blocks([l], 'tool_result').some((c) => c.tool_use_id === id)))
    // The folder is the new one everywhere else; the two cuts happened.
    expect(out.every((l) => l.cwd === there)).toBe(true)
    expect(out.every((l) => l.toolUseResult === undefined)).toBe(true)
    expect(text.length).toBeLessThan(rawOf(lines).length / 4)
    // A line that was not cut and holds no path is the identical bytes.
    expect(built.at(-1)).toBe(rewritePaths(lines.at(-1)!, SECRETS.cwd, there))
  })

  it('VAULT-7: the next raw repository opens at the size given, and the map finds every thread from the key alone', async () => {
    const ids = [1, 2, 3, 4, 5, 6].map(tid)
    // Lines that do not compress, under the cut: about 30 KB sealed a thread.
    const content = new Map(ids.map((id) => [id, [1, 2, 3].map((i) => JSON.stringify({ type: 'user', uuid: `${id}-${i}`, message: { role: 'user', content: noise(10_000) } }))]))
    const a = await makeBook('a', ids.slice(0, 5).map((id) => ({ id, lines: content.get(id)! })))
    const remote = vaultRemote()
    const key = newKey()
    const roll = 100_000
    const r = await pushVault(opts('a', remote, key, { rollBytes: roll }))
    expect(r.raw).toMatchObject({ sealed: 5, pushed: 5, repos: 2, noRepo: 0 })
    expect(r.raw!.error).toBeUndefined()
    const [raw1, raw2] = [rawRemote(remote, 1), rawRemote(remote, 2)]
    const refs = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname)', 'refs/raw/').split('\n').filter(Boolean)
    // Newest threads first: four fill the first repository past its size, the fifth opens the second.
    expect(refs(raw1)).toHaveLength(4)
    expect(refs(raw2)).toHaveLength(1)
    const size = (repo: string) => Number(run(repo, 'du', '-sb', path.join(repo, 'objects')).split('\t')[0])
    expect(size(raw1)).toBeGreaterThan(roll)
    expect(size(raw1)).toBeLessThan(roll * 1.6) // never more than a quarter over, plus git's own overhead
    // A thread that grows stays where it is; a new one goes to the newest repository.
    await more(a, ids[4], [JSON.stringify({ type: 'user', uuid: 'late', message: { role: 'user', content: noise(2000) } })])
    await makeBook('a', [{ id: ids[5], lines: content.get(ids[5])! }])
    const again = await pushVault(opts('a', remote, key, { rollBytes: roll }))
    expect(again.raw).toMatchObject({ sealed: 2, pushed: 2, repos: 2 })
    expect(refs(raw1)).toHaveLength(4)
    expect(refs(raw2)).toHaveLength(2)

    // A machine that holds the key and the vault's address: the map, and every thread's lines.
    const b = opts('b', remote, key)
    for (const id of ids) {
      const got = await fetchRaw(b, id)
      const want = id === ids[4] ? [...content.get(id)!, JSON.stringify({ type: 'user', uuid: 'late', message: { role: 'user', content: '' } })] : content.get(id)!
      expect(got.get(SEG)!.toString().split('\n').filter(Boolean)).toHaveLength(want.length)
      expect(got.get(SEG)!.toString().startsWith(`${content.get(id)!.join('\n')}\n`)).toBe(true)
    }
    const map = await readMap(b)
    expect([...map.repos].sort()).toEqual([1, 2])
    expect(ids.map((id) => map.threads.get(id))).toEqual([2, 1, 1, 1, 1, 2])
    expect(map.bytes.get(1)!.get(MACHINE)).toBeGreaterThan(roll)
    // The map itself: one ref of the vault, sealed.
    expect(allObjects(remote).includes(ids[0])).toBe(false)
  })

  it('a push that is cut goes on where it stopped: what was sealed is sent as it is, nothing twice', async () => {
    const ids = [1, 2, 3].map(tid)
    await makeBook('a', ids.map((id) => ({ id, lines: claudeLines(SECRETS.cwd, `s-${id}`) })))
    const remote = vaultRemote()
    const key = newKey()
    // The raw repository refuses every push for now.
    const raw1 = rawRemote(remote, 1)
    execFileSync('git', ['init', '-q', '--bare', raw1])
    fs.writeFileSync(path.join(raw1, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const o = opts('a', remote, key)
    const cut = await pushVault(o)
    expect(cut.pushed).toBe(3 + 1) // the journals went, with main
    expect(cut.raw!.error).toMatch(/git push/)
    expect(cut.raw!.pushed).toBe(0)
    expect(await vaultStatus({ dir: o.dir, staging: o.staging, remote, key: true })).toMatchObject({ pending: 0, rawPending: 3 })
    const staged = git(o.staging, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/raw/')
    expect(staged.split('\n')).toHaveLength(3)
    fs.rmSync(path.join(raw1, 'hooks', 'pre-receive'))
    const done = await pushVault(o)
    expect(done.raw).toMatchObject({ sealed: 0, chunks: 0, pushes: 1, pushed: 3 })
    expect(done.raw!.error).toBeUndefined()
    expect(git(raw1, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/raw/')).toBe(staged)
    for (const id of ids) expect(git(raw1, 'ls-tree', '-r', '--name-only', `refs/raw/${id}`).split('\n')).toHaveLength(2)
  })

  it('Codex lines go too, cut by the same rule, and a thread without raw lines is left alone', async () => {
    const [T1, T2] = [tid(1), tid(2)]
    const book = await Weevbook.open(path.join(tmp, 'a', 'weevbook'), MACHINE)
    const codex = [
      JSON.stringify({ timestamp: at(), type: 'session_meta', payload: { id: 'c1', cwd: SECRETS.cwd } }),
      JSON.stringify({ timestamp: at(1), type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: big(30_000, 'Q') } }),
      JSON.stringify({ timestamp: at(2), type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: big(90_000, 'o') } }),
    ]
    expect(await book.lock()).toBe(true)
    await book.append(T1, {
      events: [{ id: eid(), at: at(), leg: null, type: 'meta', thread: T1 }, { id: eid(), at: at(), leg: 'L1', type: 'leg.start', engine: 'codex:c81d2e@old-server', session: 'c1', cwd: SECRETS.cwd, rung: 0, epoch: 1 }, { id: eid(), at: at(1), leg: 'L1', type: 'message', role: 'user', text: 'hi', source: 'codex' }],
      raw: { leg: 'L1', provider: 'codex', lines: codex },
    })
    await book.commitThread(T1, 'turn 1')
    await book.append(T2, { events: [{ id: eid(), at: at(), leg: null, type: 'meta', thread: T2 }, { id: eid(), at: at(1), leg: null, type: 'message', role: 'user', text: 'a chat, no engine', source: 'import' }] })
    await book.commitThread(T2, 'chat')
    await book.unlock(true)
    const remote = vaultRemote()
    const key = newKey()
    const r = await pushVault(opts('a', remote, key))
    expect(r.raw).toMatchObject({ sealed: 1, pushed: 1 })
    const got = (await fetchRaw(opts('b', remote, key), T1)).get('L1.codex.0001.jsonl')!.toString().split('\n').filter(Boolean)
    expect(got[0]).toBe(codex[0])
    expect(got[1]).toBe(codex[1]) // what the provider encrypted: byte for byte
    // The marker names the machine the leg ran on (the journal says), not the one that pushed.
    expect((JSON.parse(got[2]) as { payload: { output: string } }).payload.output).toMatch(/^o{8192}\n\[… 72 KB kept on old-server …\]\no{8192}$/)
    expect((await fetchRaw(opts('b', remote, key), T2)).size).toBe(0)
  })
})

describe('checkpoints in the vault, as encrypted bundles', () => {
  /** A project with an origin, cloned on machine `name`. */
  function project(name: string, origin?: string) {
    if (!origin) {
      const seed = path.join(tmp, 'seed')
      fs.mkdirSync(path.join(seed, 'src'), { recursive: true })
      fs.writeFileSync(path.join(seed, 'src', 'money.ts'), 'export const fmt = (n: number) => `${n}`\n')
      fs.writeFileSync(path.join(seed, 'src', 'old.ts'), 'export const old = 1\n')
      fs.writeFileSync(path.join(seed, 'README.md'), `# shop\n${noise(40_000)}\n`)
      work(seed, 'init', '-q')
      work(seed, 'add', '-A')
      work(seed, 'commit', '-qm', 'first')
      origin = path.join(tmp, 'origin', 'shop.git')
      work(seed, 'clone', '-q', '--bare', seed, origin)
    }
    const repo = path.join(tmp, name, 'projects', 'shop')
    fs.mkdirSync(path.dirname(repo), { recursive: true })
    work(path.dirname(repo), 'clone', '-q', origin, repo)
    return { origin, repo }
  }
  const files = (dir: string) => run(dir, 'sh', '-c', 'find . -path ./.git -prune -o -type f -print | sort | xargs sha256sum')

  /** The checkpoint of a turn, as the writer's hook takes it, with its event in the thread's journal. */
  async function checkpoint(book: Weevbook, name: string, T: string, turn: number, repo: string) {
    const data = path.join(tmp, name)
    const t = await takeCheckpoint({ cwd: repo, thread: T, turn, home: data, dataDir: data })
    expect(t.fields.kind).toBe('git')
    await keepInWeevbook(book.gitDir, t.gitDir!, T)
    expect(await book.lock()).toBe(true)
    await book.append(T, { events: [{ id: eid(), at: at(turn * 10), leg: 'L1', type: 'message', role: 'user', text: `turn ${turn}`, source: 'claude' }] })
    await book.commitThread(T, `turn ${turn}`)
    await book.unlock(true)
    return t.fields as { kind: 'git'; commit: string; base: string; branch?: string; repo: string; changed: number }
  }

  it('VAULT-2 for checkpoints: a machine that clones the project from its origin restores the same tree; each bundle carries only the turn', async () => {
    const T = tid(1)
    const a = project('a')
    const book = await makeBook('a', [{ id: T, lines: claudeLines(a.repo, 's1') }])
    // Turn 1: a tracked change, a new file, a deleted file, and a commit the person has not pushed.
    fs.writeFileSync(path.join(a.repo, 'src', 'local.ts'), 'export const local = "ZORBLAX-LOCAL-COMMIT"\n')
    work(a.repo, 'add', '-A')
    work(a.repo, 'commit', '-qm', 'not pushed')
    fs.writeFileSync(path.join(a.repo, 'src', 'money.ts'), 'export const fmt = (n: number) => `${n} € ZORBLAX-TRACKED`\n')
    fs.writeFileSync(path.join(a.repo, 'src', 'new.ts'), 'export const fresh = "ZORBLAX-UNTRACKED"\n')
    fs.rmSync(path.join(a.repo, 'src', 'old.ts'))
    const c1 = await checkpoint(book, 'a', T, 1, a.repo)
    const remote = vaultRemote()
    const key = newKey()
    const r = await pushVault(opts('a', remote, key))
    expect(r.checkpoints).toMatchObject({ sent: 1, pushes: 1, pushed: 1, skipped: [], failed: [] })
    expect(r.checkpoints!.error).toBeUndefined()
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/checkpoints/${T}`)).toMatch(/^b\/[0-9a-f]{64}\nm$/)
    // Sealed: no file name, no content; and small: the origin's history (40 KB that do not compress) is not in it.
    const hay = allObjects(remote)
    for (const s of ['ZORBLAX', 'money.ts', 'not pushed', a.repo]) expect(hay.includes(s), s).toBe(false)
    expect(r.checkpoints!.bytes).toBeLessThan(10_000)
    // RESUME-2: the checkpoint went to the vault, never to the project's own remote.
    expect(git(a.origin, 'for-each-ref', '--format=%(refname)')).toBe('refs/heads/main')

    // Another machine: its own clone of the origin, then the vault's bundle.
    const b = project('b', a.origin)
    const vb = opts('b', remote, key)
    const got = (await fetchCheckpoint(vb, T, path.join(tmp, 'b', 'bundles')))!
    expect(got.tips).toEqual([c1.commit])
    expect(got.skipped).toBeUndefined()
    expect(run(b.repo, 'git', 'bundle', 'list-heads', got.bundles[0]).trim()).toBe(`${c1.commit} refs/checkpoints/${T}`)
    const restored = await restoreCheckpoint({ kind: 'git', commit: c1.commit, base: c1.base, branch: c1.branch, thread: T, slug: 'x', dir: b.repo, fresh: true, source: '', bundles: got.bundles, dataDir: path.join(tmp, 'b') })
    expect(restored).toMatchObject({ dir: b.repo, mode: 'new' })
    expect(files(b.repo)).toBe(files(a.repo))
    expect(work(b.repo, 'rev-parse', `${c1.commit}^{tree}`)).toBe(work(a.repo, 'rev-parse', `${c1.commit}^{tree}`))
    expect(work(b.repo, 'rev-parse', 'HEAD')).toBe(c1.base) // the commit that was never pushed travelled with it

    // Turn 2: one more change. The second bundle stands on the first, and adds nothing else.
    fs.writeFileSync(path.join(a.repo, 'src', 'cart.ts'), 'export const cart = 2\n')
    const c2 = await checkpoint(book, 'a', T, 2, a.repo)
    const before = objectIds(remote)
    const again = await pushVault(opts('a', remote, key))
    expect(again.checkpoints).toMatchObject({ sent: 1, pushed: 1 })
    for (const o of before) expect(objectIds(remote).has(o)).toBe(true)
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/checkpoints/${T}`).split('\n')).toHaveLength(3)
    // A third machine takes both, in order, on a clone of the origin.
    const c = project('c', a.origin)
    const both = (await fetchCheckpoint(opts('c', remote, key), T, path.join(tmp, 'c', 'bundles')))!
    expect(both.tips).toEqual([c1.commit, c2.commit])
    await restoreCheckpoint({ kind: 'git', commit: c2.commit, base: c2.base, branch: c2.branch, thread: T, slug: 'x', dir: c.repo, fresh: true, source: '', bundles: both.bundles, dataDir: path.join(tmp, 'c') })
    expect(files(c.repo)).toBe(files(a.repo))
    // Pushed again with nothing new: nothing sent.
    expect((await pushVault(opts('a', remote, key))).checkpoints).toMatchObject({ sent: 0, pushes: 0 })
  })

  it('a bundle over the limit is not sent, and the thread says it can only continue on its machine', async () => {
    const T = tid(1)
    const a = project('a')
    const book = await makeBook('a', [{ id: T, lines: claudeLines(a.repo, 's1') }])
    fs.writeFileSync(path.join(a.repo, 'big.bin'), noise(200_000))
    const c1 = await checkpoint(book, 'a', T, 1, a.repo)
    expect(await book.lock()).toBe(true)
    expect(await book.append(T, { events: [{ id: eid(), at: at(50), leg: 'L1', type: 'checkpoint', turn: 1, ...c1 } as EventDraft] })).toEqual({ written: 1, refused: 0 })
    await book.commitThread(T, 'checkpoint')
    await book.unlock(true)
    const remote = vaultRemote()
    const key = newKey()
    const o = opts('a', remote, key, { bundleMax: 50_000 })
    const r = await pushVault(o)
    expect(r.checkpoints).toMatchObject({ sent: 0, pushed: 1 })
    expect(r.checkpoints!.skipped).toHaveLength(1)
    expect(r.checkpoints!.skipped[0]).toMatchObject({ thread: T })
    expect(r.checkpoints!.skipped[0].bytes).toBeGreaterThan(50_000)
    // Only the manifest is in the vault: it says where the code stayed.
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/checkpoints/${T}`)).toBe('m')
    const vb = opts('b', remote, key)
    const got = (await fetchCheckpoint(vb, T, path.join(tmp, 'b', 'bundles')))!
    expect(got).toMatchObject({ bundles: [], tips: [], skipped: { tip: c1.commit, machine: MACHINE } })
    // Not tried again until the code moves.
    expect((await pushVault(o)).checkpoints).toMatchObject({ sent: 0, pushes: 0, skipped: [] })

    // On another machine the thread is held: the same reason as a folder that could not be checkpointed.
    await restoreVault(vb)
    const bookB = await Weevbook.open(vb.dir, 'b')
    const events = (await bookB.thread(T))!.journal.events
    const b = project('b', a.origin)
    const placed = await placeAndRestore({
      thread: T, events, cwd: a.repo, gitDir: bookB.gitDir, git: async (args) => ({ code: 1, stdout: '', stderr: String(args[0]) }), hub: false, vault: vaultSource(vb),
      dataDir: path.join(tmp, 'b'), home: path.join(tmp, 'b'), projectsDir: path.dirname(b.repo), roots: [path.dirname(b.repo)], claudeDir: path.join(tmp, 'b', '.claude'), codexDir: path.join(tmp, 'b', '.codex'),
    })
    expect(placed.restored).toBeNull()
    expect(placed.onlyThere).toMatch(new RegExp(`can only continue on ${MACHINE}`))
    expect(fs.existsSync(path.join(b.repo, 'big.bin'))).toBe(false)
  })
})

describe('access to the raw repositories (a stand-in for gh, and a folder git reaches in place of github.com)', () => {
  function github() {
    const root = path.join(tmp, 'github')
    const bin = path.join(tmp, 'bin')
    const keys = path.join(tmp, 'gh-keys')
    for (const d of [bin, keys, path.join(root, 'alex')]) fs.mkdirSync(d, { recursive: true })
    const log = path.join(tmp, 'gh.log')
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >>"${log}"
keysof() { printf '%s/%s' "${keys}" "$(printf '%s' "$1" | tr '/' '_')"; }
case "$1 $2" in
  "api user") echo alex ;;
  "repo view") [ -d "${root}/$3.git" ] ;;
  "repo create") git init -q --bare "${root}/$3.git" ;;
  "api -X") for a in "$@"; do case "$a" in key=*) printf '%s\\n' "\${a#key=}" >>"$(keysof "$4")" ;; esac; done ;;
  "api repos/"*) f="$(keysof "$2")"; [ ! -f "$f" ] || cat "$f" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    // A machine where nobody signed in to GitHub.
    fs.writeFileSync(path.join(bin, 'gh-signed-out'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    fs.writeFileSync(path.join(cfgRoot, 'gitconfig-github'), `[url "${root}/"]\n\tinsteadOf = git@github.com:\n`)
    process.env.PATH = `${bin}${path.delimiter}${saved.PATH}`
    process.env.GIT_CONFIG_GLOBAL = path.join(cfgRoot, 'gitconfig-github')
    return {
      repo: (name: string) => path.join(root, 'alex', `${name}.git`),
      asked: () => fs.readFileSync(log, 'utf8').trim().split('\n'),
      keys: (repo: string) => fs.readFileSync(path.join(keys, `repos_alex_${repo}_keys`), 'utf8').trim().split('\n').filter(Boolean),
      signedOut: ghRunner(path.join(bin, 'gh-signed-out')),
    }
  }
  const pub = (name: string, file: string) => fs.readFileSync(path.join(tmp, `${name}-config`, `${file}.pub`), 'utf8').trim().split(' ').slice(0, 2).join(' ')
  const cli = async (name: string, ...args: string[]) => {
    const out: string[] = []
    const code = await vaultMain(['vault', ...args, '--data-dir', path.join(tmp, name), '--config-dir', path.join(tmp, `${name}-config`)], (l) => out.push(l))
    return { code, out: out.join('\n') }
  }
  const keygen = (() => {
    try {
      return !!execFileSync('sh', ['-c', 'command -v ssh-keygen'])
    } catch {
      return false
    }
  })()

  it.skipIf(!keygen)('each machine has one key per raw repository; the machine signed in to GitHub makes the repository and registers every key; the other one then pushes', async () => {
    const gh = github()
    const [T1, T2] = [tid(1), tid(2)]
    const linesA = claudeLines(SECRETS.cwd, 's1')
    await makeBook('a', [{ id: T1, lines: linesA }])
    expect((await cli('a', 'setup')).code).toBe(0)
    const pushed = await cli('a', 'push')
    expect(pushed.code).toBe(0)
    expect(pushed.out).toMatch(/raw lines: 1 threads sent in 1 pushes \(.* MB sealed\) · 1 raw repository/)
    expect(gh.asked()).toContain('repo create alex/weevbook-raw-001 --private --description Encrypted copy kept by weevils')
    expect(fs.existsSync(gh.repo('weevbook-raw-001'))).toBe(true)
    // One key per repository: GitHub takes a deploy key on one repository only.
    expect(gh.keys('weevbook-vault')).toEqual([pub('a', 'vault-deploy')])
    expect(gh.keys('weevbook-raw-001')).toEqual([pub('a', 'vault-deploy-raw-001')])
    expect(new Set([pub('a', 'vault-deploy'), pub('a', 'vault-deploy-raw-001'), pub('a', 'vault-deploy-raw-002')]).size).toBe(3)
    expect(fs.statSync(path.join(tmp, 'a-config', 'vault-deploy-raw-001')).mode & 0o777).toBe(0o600)
    expect(git(gh.repo('weevbook-raw-001'), 'for-each-ref', '--format=%(refname)')).toBe(`refs/raw/${T1}`)

    // A second machine, joined: the vault's address, its key, its own deploy key on the vault; nobody signed in there.
    const cfgB = path.join(tmp, 'b-config')
    fs.mkdirSync(cfgB, { recursive: true })
    fs.copyFileSync(path.join(tmp, 'a-config', 'vault.key'), path.join(cfgB, 'vault.key'))
    fs.writeFileSync(path.join(cfgB, 'vault.json'), JSON.stringify({ remote: 'git@github.com:alex/weevbook-vault.git' }))
    const linesB = claudeLines(SECRETS.cwd, 's2', 1)
    await makeBook('b', [{ id: T2, lines: linesB }], 'b')
    const key = fs.readFileSync(path.join(cfgB, 'vault.key'), 'utf8')
    const ob: VaultOptions = { dir: path.join(tmp, 'b', 'weevbook'), staging: path.join(tmp, 'b', 'vault.git'), remote: 'git@github.com:alex/weevbook-vault.git', key: Buffer.from(key.trim(), 'base64'), machine: 'b', keyDir: cfgB, gh: gh.signedOut }
    const first = await pushVault(ob)
    // Its journals went; its lines wait for access, which it asked for in the map. Nothing was asked of anybody.
    expect(first.pushed).toBe(1)
    expect(first.raw).toMatchObject({ pushed: 0, noRepo: 1, repos: 1 })
    expect(first.raw!.error).toBeUndefined()
    expect(gh.keys('weevbook-raw-001')).toHaveLength(1)
    // The machine signed in to GitHub, at its next round, with nothing new of its own: every key the map holds.
    const round = await cli('a', 'push')
    expect(round.code).toBe(0)
    expect(gh.keys('weevbook-raw-001')).toEqual([pub('a', 'vault-deploy-raw-001'), pub('b', 'vault-deploy-raw-001')])
    const second = await pushVault(ob)
    expect(second.raw).toMatchObject({ pushed: 1, noRepo: 0 })
    expect(git(gh.repo('weevbook-raw-001'), 'for-each-ref', '--format=%(refname)').split('\n')).toEqual([`refs/raw/${T1}`, `refs/raw/${T2}`])
    // Each machine reads the other's lines.
    expect((await fetchRaw(ob, T1)).get(SEG)!.equals(await slimRaw(rawOf(linesA), 'claude', MACHINE))).toBe(true)
    // Keys never leave in clear: the map is sealed like the rest.
    expect(allObjects(gh.repo('weevbook-vault')).includes('ssh-ed25519')).toBe(false)
    // The next repository's keys are already in the map: when it opens, both machines write it at once.
    const map = await readMap(ob)
    expect(map.keys.get(2)!.size).toBe(2)
    expect(map.keys.get(2)!.has('b')).toBe(true)
    expect(gh.asked().filter((l) => l.startsWith('repo create'))).toHaveLength(2) // the vault, the first raw repository
  })
})

describe('in weevilsd', () => {
  it('journals go at once, raw lines once the thread is quiet; an error of the raw push is logged once and the journals still go', async () => {
    const T1 = tid(1)
    const a = await makeBook('a', [{ id: T1, lines: claudeLines(SECRETS.cwd, 's1') }])
    const remote = vaultRemote()
    const keyFile = path.join(tmp, 'cfg', 'vault.key')
    writeKey(keyFile, newKey())
    const logs: string[] = []
    const p = startVaultPusher({ dir: a.dir, staging: path.join(tmp, 'a', 'vault.git'), remote, keyFile, machine: MACHINE, intervalMs: 3_600_000, retryMs: 0, rawQuietMs: 2500, log: (l) => logs.push(l) })
    await p.flush()
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/threads/')).toBe(`refs/threads/${T1}`)
    const raw1 = rawRemote(remote, 1)
    expect(git(raw1, 'for-each-ref', '--format=%(refname)')).toBe('') // the turn was written a moment ago
    await sleep(3600)
    await p.flush()
    expect(git(raw1, 'for-each-ref', '--format=%(refname)')).toBe(`refs/raw/${T1}`)
    expect(logs.some((l) => /^\[vault\] raw lines: 1 threads in 1 pushes/.test(l))).toBe(true)
    p.stop()

    // The raw repository refuses: said once, tried again, and the journal of the new turn is in the vault all the same.
    fs.writeFileSync(path.join(raw1, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await more(a, T1, claudeLines(SECRETS.cwd, 's1', 1).slice(6))
    const tip = git(remote, 'rev-parse', `refs/threads/${T1}`)
    logs.length = 0
    const q = startVaultPusher({ dir: a.dir, staging: path.join(tmp, 'a', 'vault.git'), remote, keyFile, machine: MACHINE, intervalMs: 3_600_000, retryMs: 0, rawQuietMs: 1, log: (l) => logs.push(l) })
    await sleep(1100)
    await q.flush()
    await q.flush()
    await q.flush()
    expect(git(remote, 'rev-parse', `refs/threads/${T1}^`)).toBe(tip)
    expect(logs.filter((l) => /git push/.test(l))).toHaveLength(1)
    fs.rmSync(path.join(raw1, 'hooks', 'pre-receive'))
    await q.flush()
    expect(git(raw1, 'rev-list', '--count', `refs/raw/${T1}`)).toBe('2')
    q.stop()
  })
})

describe('a thread resumed from the vault on a machine that never ran it', () => {
  const SESSION = '3f6c1b2a-8d4e-4c1f-9a7b-2e5d6c8f0a12'

  /** A machine: its HOME with a clone of the project and a signed-in Claude account, its DATA_DIR, its writer. No hub. */
  function machine(name: string, origin: string) {
    const home = path.join(tmp, name)
    const data = path.join(home, '.local', 'share', 'weevils')
    const repo = path.join(home, 'projects', 'shop')
    const claudeDir = path.join(home, '.claude', 'projects')
    fs.mkdirSync(path.dirname(repo), { recursive: true })
    fs.mkdirSync(data, { recursive: true })
    work(path.dirname(repo), 'clone', '-q', origin, repo)
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
    const vault = (remote: string, key: Buffer): VaultOptions => ({ dir, staging: path.join(data, 'vault.git'), remote, key, machine: name })
    return { name, home, data, repo, claudeDir, dir, sessions, logs, writer, vault }
  }

  /** Lines of a Claude session, as Claude Code writes them. */
  function claudeSession(home: string, cwd: string, session: string) {
    const file = path.join(home, '.claude', 'projects', claudeSlug(cwd), `${session}.jsonl`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let parent: string | null = null
    let k = 0
    const line = (type: 'user' | 'assistant', message: unknown, extra: Record<string, unknown> = {}) => {
      const uuid = `00000000-0000-4000-8000-${String(++k).padStart(12, '0')}`
      fs.appendFileSync(file, `${JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.4', gitBranch: 'main', type, message, ...extra, uuid, timestamp: new Date().toISOString() })}\n`)
      parent = uuid
    }
    const assistant = (content: unknown[], stop: string) => line('assistant', { id: `msg_${k}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content, stop_reason: stop })
    return {
      file,
      user: (text: string) => line('user', { role: 'user', content: text }),
      tool: (id: string, name: string, input: unknown, thinking?: string) => assistant([...(thinking ? [{ type: 'thinking', thinking, signature: `sig-${id}` }] : []), { type: 'tool_use', id, name, input }], 'tool_use'),
      result: (id: string, text: string, copy = false) => line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, copy ? { toolUseResult: { stdout: text, stderr: '' } } : {}),
      answer: (text: string) => assistant([{ type: 'text', text }], 'end_turn'),
    }
  }
  async function settle(w: { flush: () => Promise<void> }) {
    await w.flush()
    await sleep(450)
    await w.flush()
  }

  it('the laptop stops mid-turn; the server, which only has the vault, fetches that thread, restores the code, rebuilds the session and goes on', async () => {
    const seed = path.join(tmp, 'seed')
    fs.mkdirSync(path.join(seed, 'src'), { recursive: true })
    fs.writeFileSync(path.join(seed, 'src', 'money.ts'), 'export const fmt = (n: number) => `${n}`\n')
    fs.writeFileSync(path.join(seed, 'src', 'cart.ts'), 'export const cart = (n: number) => `${n}`\n')
    work(seed, 'init', '-q')
    work(seed, 'add', '-A')
    work(seed, 'commit', '-qm', 'first')
    const origin = path.join(tmp, 'origin', 'shop.git')
    work(seed, 'clone', '-q', '--bare', seed, origin)
    const remote = vaultRemote()
    const key = newKey()
    const laptop = machine('laptop', origin)
    const server = machine('server', origin)

    // Turn 1 on the laptop: a change to the code and a long output; turn 2 starts, then the laptop stops.
    const lw = laptop.writer()
    const a = claudeSession(laptop.home, laptop.repo, SESSION)
    a.user('Show prices with the currency')
    a.tool('toolu_a1', 'Edit', { file_path: path.join(laptop.repo, 'src/money.ts'), old_string: '${n}', new_string: '${n} €' }, `I will edit ${laptop.repo}/src/money.ts`)
    fs.writeFileSync(path.join(laptop.repo, 'src/money.ts'), 'export const fmt = (n: number) => `${n} €`\n')
    a.result('toolu_a1', `edited\n${big(70_000, 'l')}`, true)
    a.answer('Prices now show the currency.')
    await settle(lw)
    const sessionsA = new Sessions(laptop.sessions)
    await sessionsA.load()
    const id = sessionsA.get(`claude:${SESSION}`)!.thread
    a.user('Also show it on the cart')
    a.tool('toolu_a2', 'Read', { file_path: path.join(laptop.repo, 'src/cart.ts') })
    a.result('toolu_a2', 'export const cart = ...')
    await lw.flush()
    lw.stop()
    // Another conversation of the laptop, which nobody resumes.
    const other = claudeSession(laptop.home, laptop.repo, '11111111-2222-4333-8444-555555555555')
    other.user('Something else')
    other.answer('Sure.')
    const lw2 = laptop.writer()
    await settle(lw2)
    lw2.stop()
    const sent = await pushVault(laptop.vault(remote, key))
    expect(sent.raw).toMatchObject({ pushed: 2, repos: 1 })
    expect(sent.checkpoints).toMatchObject({ sent: 2, skipped: [] }) // each conversation's turn left the folder as it is
    expect(sent.raw!.error ?? sent.checkpoints!.error).toBeUndefined()
    const sourceRaw = fs.readFileSync(a.file)

    // The server: the history from the vault (journals only), then one thread resumed.
    const vs = server.vault(remote, key)
    expect(await restoreVault(vs)).toMatchObject({ threads: 2, restored: 2 })
    const bookS = await Weevbook.open(server.dir, 'server')
    expect(fs.existsSync(path.join(bookS.abs(bookS.pathOf(id)!), 'raw'))).toBe(false)
    expect(git(vs.staging, 'for-each-ref', '--format=%(refname)', 'refs/vault-remote/raw/', 'refs/vault-remote/checkpoints/')).toBe('')
    const sw = server.writer()
    const launched: Launch[] = []
    const base = {
      thread: id, dir: server.dir, dataDir: server.data, sessions: server.sessions, machine: 'server', home: server.home,
      claudeDir: server.claudeDir, codexDir: path.join(server.home, '.codex', 'sessions'), roots: [path.join(server.home, 'projects')],
      projectsDir: path.join(server.home, 'projects'), vault: vaultSource(vs),
      launch: async (l: Launch) => {
        launched.push(l)
        execFileSync('node', [FAKE, '--resume', l.session, l.text], { cwd: l.cwd, env: { ...process.env, HOME: server.home }, stdio: 'pipe' })
      },
    }
    // No lease on the vault yet: a turn written a moment ago on another machine is not taken.
    const held = await resumeThread(base)
    expect(held).toMatchObject({ ok: false, why: 'held', holder: 'laptop' })
    expect(launched).toHaveLength(0)
    const r = await resumeThread({ ...base, silentMs: 0 })
    expect(r).toMatchObject({ ok: true, turn: 2, attempt: 2, resume: true, rung: 2, rule: 'machine', leg: 'L2', cwd: server.repo, session: SESSION, stole: true, launched: true })
    if (!r.ok) return
    // The code of turn 1, from the bundle, on the server's own clone.
    expect(r.restored).toEqual({ dir: server.repo, mode: 'in-place' })
    expect(fs.readFileSync(path.join(server.repo, 'src/money.ts'), 'utf8')).toContain('€')
    // The session: the slim of the laptop's lines, with only the folder changed; the signed block as it was.
    const slim = await slimRaw(sourceRaw, 'claude', 'laptop')
    const rebuilt = fs.readFileSync(path.join(server.claudeDir, claudeSlug(server.repo), `${SESSION}.jsonl`), 'utf8')
    expect(rebuilt.startsWith(rewritePaths(slim.toString(), laptop.repo, server.repo))).toBe(true)
    expect(slim.length).toBeLessThan(sourceRaw.length / 3)
    expect(rebuilt).toContain(JSON.stringify({ type: 'thinking', thinking: `I will edit ${laptop.repo}/src/money.ts`, signature: 'sig-toolu_a1' }))
    expect(rebuilt).toContain('KB kept on laptop …]')
    expect(rebuilt).not.toContain('toolUseResult')
    // The engine got the preface, not the person's message again.
    expect(launched).toHaveLength(1)
    expect(launched[0].text.startsWith(prefaceSign(id))).toBe(true)
    expect(launched[0].text).toContain('Also show it on the cart')
    expect(launched[0].text).toContain('machine-lost')
    // Only the resumed thread's lines and code were fetched.
    expect(git(vs.staging, 'for-each-ref', '--format=%(refname)', 'refs/vault-remote/raw/', 'refs/vault-remote/checkpoints/').split('\n')).toEqual([`refs/vault-remote/checkpoints/${id}`, `refs/vault-remote/raw/${id}`])

    // The server's writer reads the resumed turn; its journal is whole, and goes to the vault with its lines and code.
    await settle(sw)
    sw.stop()
    const journal = (await (await Weevbook.open(server.dir, 'server')).thread(id))!.journal.events as JournalEvent[]
    expect(validateJournal(journal)).toEqual([])
    const turn2 = journal.filter((e): e is TurnEvent => e.type === 'turn' && e.turn === 2).map((e) => [e.state, e.attempt ?? e.reason ?? null, e.leg])
    expect(turn2).toEqual([['accepted', null, 'L1'], ['assigned', 1, 'L1'], ['running', null, 'L1'], ['failed', 'machine-lost', 'L1'], ['assigned', 2, null], ['running', null, 'L2'], ['done', null, 'L2']])
    expect(journal.find((e) => e.type === 'leg.start' && e.leg === 'L2')).toMatchObject({ rung: 2, cwd: server.repo, session: SESSION, epoch: 2, engine: expect.stringMatching(/^claude:[0-9a-f]{6}@server$/) as string })
    expect(journal.filter((e) => e.type === 'message' && e.text === 'Also show it on the cart')).toHaveLength(1)
    expect(journal.findLast((e) => e.type === 'checkpoint')).toMatchObject({ turn: 2, kind: 'git', leg: 'L2' })
    const back = await pushVault(vs)
    expect(back).toMatchObject({ differ: [], failed: [] })
    expect(back.raw).toMatchObject({ pushed: 1, differ: [] })
    expect(back.checkpoints).toMatchObject({ sent: 1 })
    expect(back.raw!.error ?? back.checkpoints!.error).toBeUndefined()

    // A third machine, from the key alone: both legs' lines, and the code as the server left it.
    const desk = machine('desk', origin)
    const vd = desk.vault(remote, key)
    await restoreVault(vd)
    const lines = await fetchRaw(vd, id)
    expect([...lines.keys()].sort()).toEqual(['L1.claude.0001.jsonl', 'L2.claude.0001.jsonl'])
    expect(lines.get('L1.claude.0001.jsonl')!.equals(slim)).toBe(true)
    expect(lines.get('L2.claude.0001.jsonl')!.toString()).toContain('the cart shows the currency')
    const all = parseJournal(fs.readFileSync(path.join(desk.dir, (await Weevbook.open(desk.dir, 'desk')).pathOf(id)!, 'events.jsonl'), 'utf8')).events
    const placed = await placeAndRestore({
      thread: id, events: all, cwd: server.repo, gitDir: path.join(desk.dir, '.git'), git: async () => ({ code: 1, stdout: '', stderr: '' }), hub: false, vault: vaultSource(vd),
      dataDir: desk.data, home: desk.home, projectsDir: path.join(desk.home, 'projects'), roots: [path.join(desk.home, 'projects')], claudeDir: desk.claudeDir, codexDir: path.join(desk.home, '.codex', 'sessions'),
    })
    expect(placed.restored).toEqual({ dir: desk.repo, mode: 'in-place' })
    expect(fs.readFileSync(path.join(desk.repo, 'src/cart.ts'), 'utf8')).toContain('€')
    expect(fs.readFileSync(path.join(desk.repo, 'src/money.ts'), 'utf8')).toContain('€')
  }, 120_000)
})
