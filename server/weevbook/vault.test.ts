import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventDraft } from './journal.ts'
import { backfill, backfillMarker, startFirstBackfill, wanted } from './backfill.ts'
import { check } from './check.ts'
import { main as weevbookMain } from './cli.ts'
import { handoffEvent, journalHandoff } from './handoff.ts'
import { Weevbook, threadRefs } from './store.ts'
import { VaultError, githubRepo, keyFromCode, newKey, open, pushVault, readKey, recoveryCode, restoreVault, seal, startVaultPusher, startVaultPusherWhenSet, vaultSummary, writeKey, type VaultOptions } from './vault.ts'
import { vaultMain } from './vault-cli.ts'

const FX = path.resolve(import.meta.dirname, '../../test/fixtures/weevbook/home')
const MACHINE = 'alex-macbook-7'
let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weevbook-vault-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const T1 = '01M7HSBBM02XDK5FKDXG64FE62'
const T2 = '01M7HSBBM02XDK5FKDXG64FE63'
let n = 0
const id = () => `01M7HSBBM0${String(++n).padStart(16, '0')}`
const at = (s = 0) => new Date(Date.parse('2026-11-16T09:00:00Z') + s * 1000).toISOString()
const git = (gitDir: string, ...args: string[]) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

const SECRETS = {
  title: 'Quarterly payroll migration for Zorblax',
  project: 'zorblax-payroll',
  cwd: '/home/alex/projects/zorblax-payroll',
  command: 'psql --host=db.zorblax.internal -c "DROP TABLE salaries_2026"',
  secret: 'ghp_9fK2mZqX7vLp3RtY8wNb4HcJ6sDa1EeU0oIg',
  plain: 'the vendor code is PURPLE-HEDGEHOG-4471',
  attachment: 'diagram of the Zorblax ledger flow',
  title2: 'Fix the invoice exporter crash',
}

function start(thread: string, project: string, title: string): EventDraft[] {
  return [
    { id: id(), at: at(), leg: null, type: 'meta', thread, project },
    { id: id(), at: at(), leg: 'L1', type: 'leg.start', engine: `claude:abc123@${MACHINE}`, session: 's1', cwd: SECRETS.cwd, rung: 0, epoch: 1 },
    { id: id(), at: at(1), leg: 'L1', type: 'meta', title },
  ]
}
const said = (text: string, s = 2, role: 'user' | 'assistant' = 'user'): EventDraft => ({ id: id(), at: at(s), leg: 'L1', type: 'message', role, text, source: 'claude' })

async function makeBook(name: string) {
  const book = await Weevbook.open(path.join(tmp, name, 'weevbook'), MACHINE)
  expect(await book.lock()).toBe(true)
  const png = Buffer.from(SECRETS.attachment)
  const sha = crypto.createHash('sha256').update(png).digest('hex')
  await book.append(T1, {
    events: [
      ...start(T1, SECRETS.project, SECRETS.title),
      said(`run ${SECRETS.command}`),
      said(`token ${SECRETS.secret}`, 3),
      said(SECRETS.plain, 4, 'assistant'),
      { id: id(), at: at(5), leg: 'L1', type: 'attachment', role: 'user', sha256: sha, name: 'flow.png', mime: 'image/png', bytes: png.length },
    ],
    contents: new Map([[sha, png]]),
  })
  await book.commitThread(T1, `turn 1 · claude · ${MACHINE}`)
  await book.append(T2, { events: [...start(T2, 'invoices', SECRETS.title2), said('the exporter crashes on empty rows')] })
  await book.commitThread(T2, `turn 1 · claude · ${MACHINE}`)
  await book.unlock(true)
  return book
}

function bareRemote(name = 'remote.git') {
  const dir = path.join(tmp, name)
  execFileSync('git', ['init', '-q', '--bare', dir])
  return dir
}
const opts = (name: string, remote: string, key: Buffer): VaultOptions => ({ dir: path.join(tmp, name, 'weevbook'), staging: path.join(tmp, name, 'vault.git'), remote, key, machine: MACHINE })
/** Every object of a repository, bytes and all. */
const allObjects = (gitDir: string) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', '--batch-all-objects', '--batch'], { maxBuffer: 1 << 28 })
const objectIds = (gitDir: string) => new Set(git(gitDir, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname)').split('\n').filter(Boolean))
const journal = (gitDir: string, thread: string) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', `refs/threads/${thread}:events.jsonl`])

// Every test here runs dozens of git commands against real repositories: seconds on a busy machine (the publish gate
// runs the whole suite beside other work), far over the default 5 s.
vi.setConfig({ testTimeout: 60_000 })

describe('sealing (docs/spec/07-vault.md)', () => {
  it('round-trips, and refuses a wrong key, another thread, another kind or a changed byte', () => {
    const key = newKey()
    const plain = Buffer.from('{"type":"message"}\n'.repeat(50))
    const s = seal(key, T1, 'c', plain)
    expect(open(key, T1, 'c', s).equals(plain)).toBe(true)
    expect(s.length).toBeLessThan(plain.length) // compressed first
    expect(() => open(newKey(), T1, 'c', s)).toThrow(VaultError)
    expect(() => open(key, T2, 'c', s)).toThrow(VaultError) // a chunk moved to another thread (AAD)
    expect(() => open(key, T1, 'm', s)).toThrow(VaultError)
    const bad = Buffer.from(s)
    bad[20] ^= 1
    expect(() => open(key, T1, 'c', bad)).toThrow(VaultError)
    // A random nonce: the same text sealed twice is two different files.
    expect(seal(key, T1, 'c', plain).equals(s)).toBe(false)
  })

  it('gives the key as 24 words and back; a wrong word or checksum is refused', () => {
    const key = newKey()
    const code = recoveryCode(key)
    const words = code.split(' ')
    expect(words).toHaveLength(24)
    expect(keyFromCode(code).equals(key)).toBe(true)
    expect(keyFromCode(`  ${code.toUpperCase().replaceAll(' ', '\n')} `).equals(key)).toBe(true)
    // BIP39 test vector: 32 zero bytes.
    expect(recoveryCode(Buffer.alloc(32))).toBe(`${'abandon '.repeat(23)}art`)
    expect(() => keyFromCode(words.slice(1).join(' '))).toThrow(/24 words/)
    expect(() => keyFromCode([...words.slice(0, 23), 'notaword'].join(' '))).toThrow(/not a word/)
    // Another valid word in place of one: the checksum catches it (a 1 in 256 chance it does not: pick one that fails).
    const swapped = [...words]
    for (const w of ['zoo', 'abandon', 'ability', 'able', 'about']) {
      swapped[3] = w
      if (w === words[3]) continue
      try {
        if (keyFromCode(swapped.join(' ')).equals(key)) throw new Error('same key')
      } catch (e) {
        expect(e).toBeInstanceOf(VaultError)
        expect((e as Error).message).toMatch(/does not check out/)
        return
      }
    }
    throw new Error('no swap failed the checksum')
  })

  it('keeps the key 0600 and never over another one', () => {
    const file = path.join(tmp, 'cfg', 'vault.key')
    const key = newKey()
    writeKey(file, key)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(readKey(file)!.equals(key)).toBe(true)
    writeKey(file, key)
    expect(() => writeKey(file, newKey())).toThrow(/another vault key/)
  })
})

describe('the vault on a git remote', () => {
  it('VAULT-1: no title, path, command, secret or machine name readable in any object or name of the remote', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const key = newKey()
    const r = await pushVault(opts('a', remote, key))
    expect(r).toMatchObject({ threads: 2, sealed: 2, chunks: 2, attachments: 1, pushed: 3, differ: [], failed: [] })
    const bytes = allObjects(remote)
    const hay = [bytes.toString('latin1'), bytes.toString('utf8'), git(remote, 'for-each-ref', '--format=%(refname) %(authorname) %(authoremail) %(subject)')].join('\n')
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const needles = [...Object.values(SECRETS), slug(SECRETS.title), slug(SECRETS.title2), MACHINE, 'zorblax', 'Zorblax', 'alex', 'payroll', 'events.jsonl', 'flow.png', 'attachments/']
    for (const s of needles) expect(hay.includes(s), s).toBe(false)
    // Names: thread ids and main only; commits from the neutral author with a fixed message.
    expect(git(remote, 'for-each-ref', '--format=%(refname)').split('\n').sort()).toEqual(['refs/heads/main', `refs/threads/${T1}`, `refs/threads/${T2}`])
    expect(git(remote, 'log', '--format=%an <%ae> %ad %s', `refs/threads/${T1}`)).toBe('vault <vault@weevils.invalid> Sat Jan 1 00:00:00 2000 +0000 vault')
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/threads/${T1}`).split('\n').map((p) => p.replace(/[0-9a-f]{64}/, 'H'))).toEqual(['a/H', 'c/H', 'm'])
    expect(git(remote, 'ls-tree', '--name-only', 'refs/heads/main')).toBe('README.md')
  })

  it('VAULT-2 (journals): a fresh machine with the recovery code gets every events.jsonl and attachment byte for byte', async () => {
    const a = await makeBook('a')
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    const code = recoveryCode(key)

    // The new machine: nothing but the remote and the 24 words, through the command line.
    const cfg = path.join(tmp, 'b-config')
    const lines: string[] = []
    expect(await vaultMain(['vault', 'restore', '--remote', remote, '--code', code, '--data-dir', path.join(tmp, 'b'), '--config-dir', cfg], (l) => lines.push(l))).toBe(0)
    expect(readKey(path.join(cfg, 'vault.key'))!.equals(key)).toBe(true)
    const b = await Weevbook.open(path.join(tmp, 'b', 'weevbook'), 'other')
    for (const t of [T1, T2]) expect(journal(b.gitDir, t).equals(journal(a.gitDir, t))).toBe(true)
    expect(b.pathOf(T1)).toBe(a.pathOf(T1))
    const att = git(a.gitDir, 'ls-tree', '-r', '--name-only', `refs/threads/${T1}`, '--', 'attachments/')
    expect(git(b.gitDir, 'rev-parse', `refs/threads/${T1}:${att}`)).toBe(git(a.gitDir, 'rev-parse', `refs/threads/${T1}:${att}`))
    // The folder is whole: thread.md and meta.json rebuilt, main composed.
    expect(fs.existsSync(path.join(b.abs(b.pathOf(T1)!), 'thread.md'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(b.dir, 'index.json'), 'utf8')).threads).toHaveLength(2)
    // Restoring again changes nothing, and the next push from there sends nothing.
    const again: string[] = []
    await vaultMain(['vault', 'restore', '--data-dir', path.join(tmp, 'b'), '--config-dir', cfg], (l) => again.push(l))
    expect(again.join('\n')).toMatch(/0 restored · 2 already the same/)
    const before = objectIds(remote)
    const p = await pushVault(opts('b', remote, key))
    expect(p).toMatchObject({ sealed: 0, pushed: 0 })
    expect(objectIds(remote)).toEqual(before)

    // A wrong key reads nothing.
    await expect(restoreVault(opts('c', remote, newKey()))).rejects.toThrow(VaultError)
  })

  it('VAULT-3: a second push after one more turn only adds the new chunk; nothing pushed before changes', async () => {
    const a = await makeBook('a')
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    const before = objectIds(remote)
    const oldTree = git(remote, 'ls-tree', '-r', `refs/threads/${T1}`, 'c', 'a')
    const oldTip = git(remote, 'rev-parse', `refs/threads/${T1}`)
    const t2 = git(remote, 'rev-parse', `refs/threads/${T2}`)

    expect(await a.lock()).toBe(true)
    await a.append(T1, { events: [said('one more turn', 10), said('done', 11, 'assistant')] })
    await a.commitThread(T1, 'turn 2')
    await a.unlock(true)
    const r = await pushVault(opts('a', remote, key))
    expect(r).toMatchObject({ sealed: 1, chunks: 1, attachments: 0, pushed: 1 })
    const after = objectIds(remote)
    for (const o of before) expect(after.has(o)).toBe(true)
    // One chunk, one manifest, two trees (c and the root), one commit.
    expect(after.size - before.size).toBe(5)
    const newTree = git(remote, 'ls-tree', '-r', `refs/threads/${T1}`, 'c', 'a')
    for (const l of oldTree.split('\n')) expect(newTree.split('\n')).toContain(l)
    expect(git(remote, 'rev-parse', `refs/threads/${T1}^`)).toBe(oldTip)
    expect(git(remote, 'rev-parse', `refs/threads/${T2}`)).toBe(t2)

    // The restored journal is the whole one, chunks joined in order.
    await restoreVault(opts('b', remote, key))
    expect(journal(path.join(tmp, 'b', 'weevbook', '.git'), T1).equals(journal(a.gitDir, T1))).toBe(true)
  })

  it('VAULT-5: a backfill run twice, pushed twice, sends nothing the second time', async () => {
    const paths = {
      dir: path.join(tmp, 'a', 'weevbook'), sessions: path.join(tmp, 'a', 'weevbook-sessions.jsonl'),
      claudeDir: path.join(FX, 'claude', 'projects'), codexDir: path.join(FX, 'codex', 'sessions'),
      home: path.join(tmp, 'home'), machine: MACHINE, roots: ['/home/alex/projects'],
    }
    const first = await backfill(paths, { now: Date.parse('2026-11-20T00:00:00Z') })
    expect(first.created).toBeGreaterThan(0)
    const remote = bareRemote()
    const key = newKey()
    const r1 = await pushVault(opts('a', remote, key))
    expect(r1.sealed).toBe(first.created)
    const before = objectIds(remote)
    const refs = git(remote, 'for-each-ref')
    await backfill(paths, { now: Date.parse('2026-11-21T00:00:00Z') })
    const r2 = await pushVault(opts('a', remote, key))
    expect(r2).toMatchObject({ sealed: 0, chunks: 0, attachments: 0, pushed: 0 })
    expect(objectIds(remote)).toEqual(before)
    expect(git(remote, 'for-each-ref')).toBe(refs)
    // The fixture's sessions come back whole on another machine.
    await restoreVault(opts('b', remote, key))
    for (const t of git(remote, 'for-each-ref', '--format=%(refname:lstrip=2)', 'refs/threads/').split('\n')) {
      expect(journal(path.join(tmp, 'b', 'weevbook', '.git'), t).equals(journal(path.join(tmp, 'a', 'weevbook', '.git'), t))).toBe(true)
    }
  })

  it('two machines push their own threads to one vault, and each restores the other\'s', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    const other = await Weevbook.open(path.join(tmp, 'b', 'weevbook'), 'server')
    await other.lock()
    const T3 = '01M7HSBBM02XDK5FKDXG64FE64'
    await other.append(T3, { events: [...start(T3, 'infra', 'Rotate the backups'), said('rotate them')] })
    await other.commitThread(T3, 'turn 1')
    await other.unlock(true)
    const r = await pushVault(opts('b', remote, key))
    expect(r).toMatchObject({ sealed: 1, pushed: 1 })
    const back = await restoreVault(opts('a', remote, key))
    expect(back).toMatchObject({ threads: 3, restored: 1, same: 2 })
    // A chunk put in another thread's tree does not open.
    const chunk = git(remote, 'ls-tree', '-r', `refs/threads/${T3}`, 'c').split(/\s+/)[2]
    const sealed = execFileSync('git', ['--git-dir', remote, 'cat-file', 'blob', chunk])
    expect(() => open(key, T1, 'c', sealed)).toThrow(VaultError)
    expect(open(key, T3, 'c', sealed).toString()).toContain('rotate them')
  })

  it('setup with --remote makes the key once and prints its recovery code once; push and status work from there', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const cfg = path.join(tmp, 'cfg')
    const args = ['--data-dir', path.join(tmp, 'a'), '--config-dir', cfg]
    const out: string[] = []
    expect(await vaultMain(['vault', 'setup', '--remote', remote, ...args], (l) => out.push(l))).toBe(0)
    const key = readKey(path.join(cfg, 'vault.key'))!
    expect(out).toContain(recoveryCode(key))
    expect(out.join('\n')).not.toContain(key.toString('base64'))
    const again: string[] = []
    expect(await vaultMain(['vault', 'setup', '--remote', remote, ...args], (l) => again.push(l))).toBe(0)
    expect(again).not.toContain(recoveryCode(key))
    const pushed: string[] = []
    expect(await vaultMain(['vault', 'push', ...args], (l) => pushed.push(l))).toBe(0)
    expect(pushed.join('\n')).toMatch(/3 refs sent/)
    const st: string[] = []
    expect(await vaultMain(['vault', 'status', ...args], (l) => st.push(l))).toBe(0)
    expect(st.join('\n')).toMatch(/2 threads here · 0 to send · 2 in the vault/)
    // Another machine's setup against a vault that exists, without the key: told to restore, no new key.
    const cfg2 = path.join(tmp, 'cfg2')
    const other: string[] = []
    expect(await vaultMain(['vault', 'setup', '--remote', remote, '--data-dir', path.join(tmp, 'z'), '--config-dir', cfg2], (l) => other.push(l))).toBe(1)
    expect(other.join('\n')).toMatch(/vault restore/)
    expect(fs.existsSync(path.join(cfg2, 'vault.key'))).toBe(false)
  })
})

/** One more request in a thread of a book; `leg`: in a new leg (the one before was closed by a handoff). */
async function turn(book: Weevbook, thread: string, text: string, s: number, leg?: 'L2') {
  expect(await book.lock()).toBe(true)
  const opening: EventDraft[] = leg ? [{ id: id(), at: at(s), leg, type: 'leg.start', engine: `claude:abc123@${MACHINE}`, session: 's2', cwd: SECRETS.cwd, rung: 0, epoch: 2 }] : []
  const r = await book.append(thread, { events: [...opening, { ...said(text, s), leg: leg ?? 'L1' }] })
  expect(r.refused).toBe(0)
  await book.commitThread(thread, `turn · ${MACHINE}`)
  await book.unlock(true)
}
/** handoff.md written the way weevilsd does after a turn (threads.ts): the leg closed, the text, and the event that
 *  records its hash. */
async function handoff(book: Weevbook, thread: string, s: number, leg: 'L1' | 'L2' = 'L1'): Promise<string> {
  expect(await book.lock()).toBe(true)
  const events = (await book.thread(thread))!.journal.events
  const now = Date.parse(at(s))
  const text = journalHandoff(thread, events, now)
  const r = await book.append(thread, { events: [{ id: id(), at: at(s), leg, type: 'leg.end', reason: 'closed', by: MACHINE }, handoffEvent(text, events.at(-1)!.seq, 'journal', now, id())], handoff: text })
  expect(r.refused).toBe(0)
  await book.commitThread(thread, `handoff · ${MACHINE}`)
  await book.unlock(true)
  return text
}
const file = (gitDir: string, thread: string, name: string) => execFileSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', `refs/threads/${thread}:${name}`])

describe('a new machine from the vault (step 2)', () => {
  it('handoff.md comes back as the journal recorded it, encrypted on the way, and again after it was rewritten', async () => {
    const a = await makeBook('a')
    const first = await handoff(a, T1, 30)
    expect(first).toContain(SECRETS.title)
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    expect(git(remote, 'ls-tree', '-r', '--name-only', `refs/threads/${T1}`).split('\n').map((p) => p.replace(/[0-9a-f]{64}/, 'H'))).toEqual(['a/H', 'c/H', 'h', 'm'])
    // VAULT-1 holds for it: its title and goal are not readable in the remote.
    const bytes = allObjects(remote)
    for (const s of [SECRETS.title, 'Handoff', '## Goal', 'handoff.md']) expect(bytes.includes(s), s).toBe(false)

    const r = await restoreVault(opts('b', remote, key))
    expect(r).toMatchObject({ threads: 2, restored: 2 })
    const b = await Weevbook.open(path.join(tmp, 'b', 'weevbook'), 'other')
    expect(file(b.gitDir, T1, 'handoff.md').toString()).toBe(first)
    expect(fs.readFileSync(path.join(b.abs(b.pathOf(T1)!), 'handoff.md'), 'utf8')).toBe(first)
    // The restored weevbook is sound: BOOK-8 (handoff.md is the one the journal recorded) included.
    expect((await check(path.join(tmp, 'b', 'weevbook'), 'other')).byInvariant).toEqual({})

    // A turn later, the handoff is rewritten: one more push, and the other machine gets the new one.
    await turn(a, T1, 'ship it', 40, 'L2')
    const second = await handoff(a, T1, 50, 'L2')
    expect(second).not.toBe(first)
    expect(await pushVault(opts('a', remote, key))).toMatchObject({ sealed: 1, pushed: 1 })
    expect(await restoreVault(opts('b', remote, key))).toMatchObject({ restored: 1, same: 1 })
    expect(file(path.join(tmp, 'b', 'weevbook', '.git'), T1, 'handoff.md').toString()).toBe(second)
    expect((await check(path.join(tmp, 'b', 'weevbook'), 'other')).byInvariant).toEqual({})
    // Nothing left to send from either side, and a third restore reads nothing.
    expect(await pushVault(opts('b', remote, key))).toMatchObject({ sealed: 0, pushed: 0 })
    expect(await pushVault(opts('a', remote, key))).toMatchObject({ sealed: 0, pushed: 0 })
    expect(await restoreVault(opts('b', remote, key))).toMatchObject({ restored: 0, same: 2 })

    // A thread pushed before step 2 (its vault commit has no `h`, its manifest names none) and not touched since:
    // the next push adds its handoff.md, once.
    const staging = path.join(tmp, 'a', 'vault.git')
    const tip = git(remote, 'rev-parse', `refs/threads/${T1}`)
    const m = JSON.parse(open(key, T1, 'm', execFileSync('git', ['--git-dir', remote, 'cat-file', 'blob', `${tip}:m`])).toString())
    delete m.handoff
    const blob = execFileSync('git', ['--git-dir', remote, 'hash-object', '-w', '--stdin'], { input: seal(key, T1, 'm', Buffer.from(JSON.stringify(m))) }).toString().trim()
    const entries = git(remote, 'ls-tree', tip).split('\n').filter((l) => !/\t[hm]$/.test(l))
    const tree = execFileSync('git', ['--git-dir', remote, 'mktree'], { input: [...entries, `100644 blob ${blob}\tm`].join('\n') + '\n' }).toString().trim()
    const old = execFileSync('git', ['--git-dir', remote, 'commit-tree', tree, '-m', 'vault'], { env: { ...process.env, GIT_AUTHOR_NAME: 'vault', GIT_AUTHOR_EMAIL: 'v@x', GIT_COMMITTER_NAME: 'vault', GIT_COMMITTER_EMAIL: 'v@x' } }).toString().trim()
    git(remote, 'update-ref', `refs/threads/${T1}`, old)
    git(staging, 'fetch', '-q', remote, `+refs/threads/${T1}:refs/threads/${T1}`, `+refs/threads/${T1}:refs/vault-remote/threads/${T1}`)
    const state = JSON.parse(fs.readFileSync(path.join(staging, 'weevils-state.json'), 'utf8'))
    expect(state.handoffs).toBe(true)
    fs.writeFileSync(path.join(staging, 'weevils-state.json'), JSON.stringify({ ...state, handoffs: undefined }))
    expect(await pushVault(opts('a', remote, key))).toMatchObject({ sealed: 1, chunks: 0, pushed: 1 })
    expect(git(remote, 'ls-tree', '--name-only', `refs/threads/${T1}`).split('\n')).toContain('h')
    expect(git(remote, 'rev-parse', `refs/threads/${T1}^`)).toBe(old)
    expect(await pushVault(opts('a', remote, key))).toMatchObject({ sealed: 0, pushed: 0 })

    // The same journal here, without its handoff.md (a weevbook restored before step 2): only the handoff is added.
    await restoreVault(opts('c', remote, key))
    const c = await Weevbook.open(path.join(tmp, 'c', 'weevbook'), 'third')
    expect(await c.lock()).toBe(true)
    fs.rmSync(path.join(c.abs(c.pathOf(T1)!), 'handoff.md'))
    await c.commitThread(T1, 'lost')
    await c.unlock(true)
    expect(await restoreVault(opts('c', remote, key))).toMatchObject({ restored: 1, same: 1 })
    expect(file(c.gitDir, T1, 'handoff.md').toString()).toBe(second)
    expect(journal(c.gitDir, T1).equals(journal(a.gitDir, T1))).toBe(true)
  })

  it('on a machine that already has threads it merges: the same is left, ahead stays and is pushed next, a differing one is left out', async () => {
    const T3 = '01M7HSBBM02XDK5FKDXG64FE64'
    const T4 = '01M7HSBBM02XDK5FKDXG64FE65'
    const T5 = '01M7HSBBM02XDK5FKDXG64FE66'
    const a = await makeBook('a') // T1, T2
    expect(await a.lock()).toBe(true)
    for (const [t, title] of [[T3, 'Rotate the backups'], [T4, 'Only in the vault']] as const) {
      await a.append(t, { events: [...start(t, 'infra', title), said(`about ${title}`)] })
      await a.commitThread(t, 'turn 1')
    }
    await a.unlock(true)
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))

    // Machine b: T1 the same (restored earlier), T2 one turn ahead, T3 written differently, T5 its own; no T4.
    await restoreVault(opts('b', remote, key))
    const b = await Weevbook.open(path.join(tmp, 'b', 'weevbook'), 'server')
    for (const t of [T3, T4]) fs.rmSync(b.abs(b.pathOf(t)!), { recursive: true })
    for (const t of [T3, T4]) git(b.gitDir, 'update-ref', '-d', `refs/threads/${t}`)
    fs.rmSync(path.join(tmp, 'b', 'vault.git'), { recursive: true }) // and no memory of that restore
    const b2 = await Weevbook.open(path.join(tmp, 'b', 'weevbook'), 'server')
    await turn(b2, T2, 'one more here', 20)
    expect(await b2.lock()).toBe(true)
    await b2.append(T3, { events: [...start(T3, 'infra', 'Rotate the backups'), said('written on this machine, another way')] })
    await b2.commitThread(T3, 'turn 1')
    await b2.append(T5, { events: [...start(T5, 'infra', 'Only on this machine'), said('local only')] })
    await b2.commitThread(T5, 'turn 1')
    await b2.unlock(true)
    const before = Object.fromEntries([T1, T2, T3, T5].map((t) => [t, journal(b2.gitDir, t).toString()]))

    const r = await restoreVault(opts('b', remote, key))
    expect(r).toMatchObject({ threads: 4, restored: 1, same: 1, ahead: 1, differ: [T3] })
    // Nothing this machine had was changed; what it lacked is there.
    for (const t of [T1, T2, T3, T5]) expect(journal(b2.gitDir, t).toString()).toBe(before[t])
    expect(journal(b2.gitDir, T4).equals(journal(a.gitDir, T4))).toBe(true)
    // Its next push sends what it has more (T2's turn, T5), and leaves the differing thread out.
    const p = await pushVault(opts('b', remote, key))
    expect(p).toMatchObject({ sealed: 2, pushed: 2, differ: [T3] })
    expect(await restoreVault(opts('a', remote, key))).toMatchObject({ threads: 5, restored: 2, same: 3 })
    expect(journal(a.gitDir, T2).toString()).toBe(before[T2])
    expect(journal(a.gitDir, T3).toString()).not.toBe(before[T3])
  })

  it('after a restore the thread list has the whole history: every title, project and state, read where the app reads them', async () => {
    const a = await makeBook('a')
    await handoff(a, T2, 30)
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    await restoreVault(opts('b', remote, key))
    // What /api/threads lists (threads.ts lines()): the thread refs, their meta.json, and handoff.md for the search.
    const gitDir = path.join(tmp, 'b', 'weevbook', '.git')
    const rows = (await threadRefs(gitDir)).map((r) => ({ id: r.id, title: r.meta.title, project: r.meta.project, state: r.meta.state, handoff: !!r.meta.handoff }))
    expect(rows).toEqual([
      { id: T1, title: SECRETS.title, project: SECRETS.project, state: 'waiting', handoff: false },
      { id: T2, title: SECRETS.title2, project: 'invoices', state: 'waiting', handoff: true },
    ])
    expect(file(gitDir, T2, 'handoff.md').toString()).toContain('exporter crashes')
    expect(file(gitDir, T1, 'thread.md').toString()).toContain(SECRETS.command)
  })

  it('restore --code with the words of another vault keeps no key, so the right words can be given next', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const key = newKey()
    await pushVault(opts('a', remote, key))
    const cfg = path.join(tmp, 'b-config')
    const args = ['--remote', remote, '--data-dir', path.join(tmp, 'b'), '--config-dir', cfg]
    const out: string[] = []
    expect(await vaultMain(['vault', 'restore', '--code', recoveryCode(newKey()), ...args], (l) => out.push(l))).toBe(1)
    expect(out.join('\n')).toMatch(/cannot decrypt/)
    expect(fs.existsSync(path.join(cfg, 'vault.key'))).toBe(false)
    // A word that is not one: refused before anything is fetched or saved.
    expect(await vaultMain(['vault', 'restore', '--code', 'not the words', ...args], () => undefined)).toBe(1)
    expect(await vaultMain(['vault', 'restore', '--code', recoveryCode(key), ...args], () => undefined)).toBe(0)
    expect(readKey(path.join(cfg, 'vault.key'))!.equals(key)).toBe(true)
  })
})

describe('with GitHub (a stand-in for gh, and a folder git reaches in place of github.com)', () => {
  const env = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM }
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]
    else process.env[k] = v
  })
  function github() {
    const root = path.join(tmp, 'github')
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.mkdirSync(path.join(root, 'alex'), { recursive: true })
    const log = path.join(tmp, 'gh.log')
    const keys = path.join(tmp, 'gh.keys')
    fs.writeFileSync(keys, '')
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >>"${log}"
case "$1 $2" in
  "api user") echo alex ;;
  "repo view") [ -d "${root}/$3.git" ] ;;
  "repo create") git init -q --bare "${root}/$3.git" ;;
  "api repos/alex/weevbook-vault/keys") cat "${keys}" ;;
  "api -X") for a in "$@"; do case "$a" in key=*) printf '%s\\n' "\${a#key=}" >>"${keys}" ;; esac; done ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    fs.writeFileSync(path.join(tmp, 'gitconfig'), `[url "${root}/"]\n\tinsteadOf = git@github.com:\n`)
    process.env.PATH = `${bin}${path.delimiter}${env.PATH}`
    process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'gitconfig')
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    return { repo: path.join(root, 'alex', 'weevbook-vault.git'), asked: () => fs.readFileSync(log, 'utf8').trim().split('\n'), keys: () => fs.readFileSync(keys, 'utf8').trim().split('\n').filter(Boolean) }
  }
  const run = async (name: string, ...args: string[]) => {
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

  it.skipIf(!keygen)('setup makes the private repository and this machine\'s deploy key; a new install gets everything back from the 24 words alone', async () => {
    const gh = github()
    await makeBook('a')
    const made = await run('a', 'setup')
    expect(made.code).toBe(0)
    expect(made.out).toMatch(/private repository created: alex\/weevbook-vault/)
    expect(fs.existsSync(gh.repo)).toBe(true)
    expect(gh.asked()).toContain('repo create alex/weevbook-vault --private --description Encrypted copy kept by weevils')
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'a-config', 'vault.json'), 'utf8'))).toEqual({ remote: 'git@github.com:alex/weevbook-vault.git' })
    const pubA = fs.readFileSync(path.join(tmp, 'a-config', 'vault-deploy.pub'), 'utf8').trim().split(' ').slice(0, 2).join(' ')
    expect(gh.keys()).toEqual([pubA])
    const code = recoveryCode(readKey(path.join(tmp, 'a-config', 'vault.key'))!)
    expect(made.out).toContain(code)
    expect((await run('a', 'push')).code).toBe(0)

    // A new install whose weevboss tried « setup » first: told a vault exists, no second key made, then the words.
    const again = await run('b', 'setup')
    expect(again.code).toBe(1)
    expect(again.out).toMatch(/already holds a vault/)
    expect(fs.existsSync(path.join(tmp, 'b-config', 'vault.key'))).toBe(false)
    expect((await run('b', 'restore', '--code', code)).out).toMatch(/2 threads in the vault · 2 restored/)

    // A new install that goes straight to the words: the vault is found on GitHub, this machine's key added, no
    // repository ever created.
    const before = gh.asked().length
    const back = await run('c', 'restore', '--code', code)
    expect(back.code).toBe(0)
    expect(back.out).toMatch(/repository: alex\/weevbook-vault/)
    expect(back.out).toMatch(/2 threads in the vault · 2 restored/)
    expect(gh.keys()).toHaveLength(3)
    expect(gh.asked().slice(before).join('\n')).not.toMatch(/repo create/)
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'c-config', 'vault.json'), 'utf8'))).toEqual({ remote: 'git@github.com:alex/weevbook-vault.git' })
    for (const t of [T1, T2]) expect(journal(path.join(tmp, 'c', 'weevbook', '.git'), t).equals(journal(path.join(tmp, 'a', 'weevbook', '.git'), t))).toBe(true)
  })

  it('restore on an account with no vault says so and creates nothing', async () => {
    const gh = github()
    const r = await run('z', 'restore', '--code', recoveryCode(newKey()))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no vault on this GitHub account \(alex\/weevbook-vault does not exist\)/)
    expect(fs.existsSync(gh.repo)).toBe(false)
    expect(fs.existsSync(path.join(tmp, 'z-config'))).toBe(false)
  })
})

describe('what weevboss says once the history is in (vault summary)', () => {
  const day = 86_400_000
  /** A conversation of `engine`, started and last active on the given days before `now`. */
  async function conversation(book: Weevbook, thread: string, engine: string, title: string, now: number, startedDaysAgo: number, quietDays: number) {
    const t0 = new Date(now - startedDaysAgo * day).toISOString()
    const t1 = new Date(now - quietDays * day).toISOString()
    await book.append(thread, {
      events: [
        { id: id(), at: t0, leg: null, type: 'meta', thread, project: 'shop' },
        { id: id(), at: t0, leg: 'L1', type: 'leg.start', engine, session: `s-${thread.slice(-4)}`, cwd: '/home/alex/projects/shop', rung: 0, epoch: 1 },
        { id: id(), at: t0, leg: 'L1', type: 'meta', title },
        { id: id(), at: t0, leg: 'L1', type: 'message', role: 'user', text: `about ${title}`, source: engine.startsWith('codex') ? 'codex' : 'claude' },
        { id: id(), at: t1, leg: 'L1', type: 'message', role: 'user', text: 'and one more thing', source: engine.startsWith('codex') ? 'codex' : 'claude' },
      ],
    })
    await book.commitThread(thread, 'turn 1')
  }
  const T = (n: number) => `01M7HSBBM02XDK5FKDXG64FE${70 + n}`

  it('counts every conversation once, here and from the other machines, by machine and account, without writing to the weevbook', async () => {
    const now = Date.parse('2026-11-21T12:00:00Z')
    const laptop = await Weevbook.open(path.join(tmp, 'laptop', 'weevbook'), 'macbook')
    await laptop.lock()
    await conversation(laptop, T(1), 'claude:aaa111@macbook', 'Checkout prices', now, 12, 10)
    await conversation(laptop, T(2), 'claude:bbb222@macbook', 'Other account', now, 5, 5)
    await conversation(laptop, T(3), 'codex:ccc333@macbook', 'Codex one', now, 3, 3)
    await conversation(laptop, T(4), 'claude:aaa111@macbook', 'Background task started by weevils: tidy', now, 2, 2)
    await laptop.unlock(true)
    const server = await Weevbook.open(path.join(tmp, 'server', 'weevbook'), 'server')
    await server.lock()
    await conversation(server, T(5), 'claude:aaa111@server', 'On the server', now, 1, 1)
    await conversation(server, T(6), 'claude:unknown@server', 'Signed out then', now, 1, 1)
    await server.unlock(true)
    const remote = bareRemote()
    const key = newKey()
    await pushVault({ ...opts('laptop', remote, key), machine: 'macbook' })
    await pushVault({ ...opts('server', remote, key), machine: 'server' })

    const refs = git(server.gitDir, 'for-each-ref')
    const s = await vaultSummary({ dir: path.join(tmp, 'server', 'weevbook'), staging: path.join(tmp, 'server', 'vault.git'), remote, key, machine: 'server', imported: true, now })
    expect(s).toEqual({
      vault: true, remote, conversations: 5, machines: ['macbook', 'server'], by_machine: { macbook: 3, server: 2 },
      accounts: { claude: 2, codex: 1 }, oldest: new Date(now - 12 * day).toISOString(), claude_window: false, import: 'done', pending: 0, fetched: true,
    })
    // Read in memory: the laptop's threads are not in the server's weevbook.
    expect(git(server.gitDir, 'for-each-ref')).toBe(refs)
    // The second time reads only what moved (the facts are kept by commit), and says the same.
    expect(await vaultSummary({ dir: path.join(tmp, 'server', 'weevbook'), staging: path.join(tmp, 'server', 'vault.git'), remote, key, machine: 'server', imported: true, now })).toEqual(s)
    // No vault: this machine's own conversations, and the import still running.
    expect(await vaultSummary({ dir: path.join(tmp, 'server', 'weevbook'), staging: path.join(tmp, 'none', 'vault.git'), remote: null, key: null, machine: 'server', imported: false, now })).toMatchObject({
      vault: false, remote: null, conversations: 2, machines: ['server'], accounts: { claude: 1 }, import: 'running', fetched: false,
    })
    expect(githubRepo('git@github.com:alex/weevbook-vault.git')).toBe('alex/weevbook-vault')
    expect(githubRepo('https://github.com/alex/weevbook-vault')).toBe('alex/weevbook-vault')
    expect(githubRepo('/srv/git/vault.git')).toBeNull()
  })

  it('claude_window: the Claude conversation quiet the longest is about 30 days old → "the last 30 days", never "everything"', async () => {
    const now = Date.parse('2026-11-21T12:00:00Z')
    const book = await Weevbook.open(path.join(tmp, 'w', 'weevbook'), 'server')
    const sum = (windowDays?: number) => vaultSummary({ dir: path.join(tmp, 'w', 'weevbook'), staging: path.join(tmp, 'w', 'vault.git'), remote: null, key: null, machine: 'server', imported: true, now, windowDays })
    await book.lock()
    await conversation(book, T(1), 'claude:aaa111@server', 'Ten days', now, 10, 10)
    await conversation(book, T(2), 'codex:ccc333@server', 'An old Codex one', now, 200, 200)
    expect((await sum()).claude_window).toBe(false) // a young Claude history; Codex deletes nothing
    await conversation(book, T(3), 'claude:aaa111@server', 'Started long ago, quiet for 29 days', now, 45, 29)
    expect(await sum()).toMatchObject({ claude_window: true, conversations: 3 })
    // A longer cleanup period set in Claude Code: 29 days is not its edge.
    expect((await sum(365)).claude_window).toBe(false)
    await conversation(book, T(4), 'claude:aaa111@server', 'Kept for months', now, 120, 110)
    expect((await sum()).claude_window).toBe(false) // older ones survived: nothing was cut at 30 days
    await book.unlock(true)
  })

  it('`vault summary --json` prints it for weevboss, with the computers plugged in without the vault', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const cfg = path.join(tmp, 'cfg')
    const args = ['--data-dir', path.join(tmp, 'a'), '--config-dir', cfg]
    await vaultMain(['vault', 'setup', '--remote', remote, ...args], () => undefined)
    fs.writeFileSync(path.join(tmp, 'a', 'vault-machines.json'), JSON.stringify({ desk: { at: at(), vault: 'no-github' }, laptop: { at: at(), vault: 'ok' } }))
    const out: string[] = []
    expect(await vaultMain(['vault', 'summary', '--json', ...args], (l) => out.push(l))).toBe(0)
    expect(out).toHaveLength(1)
    const j = JSON.parse(out[0])
    expect(j).toMatchObject({ vault: true, remote, conversations: 2, machines: [MACHINE], accounts: { claude: 1 }, claude_window: false, import: 'running', pending: 2, missing: [{ machine: 'desk', why: 'no-github' }] })
    expect(Object.keys(j).sort()).toEqual(['accounts', 'by_machine', 'claude_window', 'conversations', 'fetched', 'import', 'machines', 'missing', 'oldest', 'pending', 'remote', 'vault'])
    expect(out[0]).not.toContain(readKey(path.join(cfg, 'vault.key'))!.toString('base64'))
    await vaultMain(['vault', 'push', ...args], () => undefined)
    const after: string[] = []
    await vaultMain(['vault', 'summary', '--json', ...args], (l) => after.push(l))
    expect(JSON.parse(after[0])).toMatchObject({ pending: 0, fetched: true })
    // Without --json: one plain line and where they live.
    const plain: string[] = []
    await vaultMain(['vault', 'summary', ...args], (l) => plain.push(l))
    expect(plain[0]).toBe(`2 conversations · machines: ${MACHINE} · since 2026-11-16`)
  })
})

describe('the import choices (backfill --since, --match)', () => {
  const paths = (name: string) => ({
    dir: path.join(tmp, name, 'weevbook'), sessions: path.join(tmp, name, 'weevbook-sessions.jsonl'),
    claudeDir: path.join(FX, 'claude', 'projects'), codexDir: path.join(FX, 'codex', 'sessions'),
    home: path.join(tmp, 'home'), machine: MACHINE, roots: ['/home/alex/projects'],
  })
  const titles = async (name: string) => (await threadRefs(path.join(tmp, name, 'weevbook', '.git'))).map((r) => r.meta.title).sort()

  it('the default stays everything; --since keeps the sessions active since that day', async () => {
    const all = await backfill(paths('all'), { now: Date.parse('2026-11-20T00:00:00Z') })
    expect(all).toMatchObject({ sessions: 5, skipped: 0 })
    const since = await backfill(paths('since'), { now: Date.parse('2026-11-20T00:00:00Z'), since: Date.parse('2026-11-18') })
    expect(since).toMatchObject({ sessions: 3, skipped: 2 })
    expect(since.created).toBeLessThan(all.created)
    const kept = await titles('since')
    expect(kept).toContain('Summarize meeting.md in three bullets.')
    expect(kept.join('\n')).not.toMatch(/Checkout|Itinerary/)
    // Everything again, after a narrower import: the rest comes in, nothing twice.
    const rest = await backfill(paths('since'), { now: Date.parse('2026-11-20T00:00:00Z') })
    expect(rest.created).toBe(all.created - since.created)
    expect(await titles('since')).toEqual(await titles('all'))
  })

  it('--match keeps the sessions whose title or first request holds every word, whatever the case or the accents', async () => {
    const src = (await import('./backfill.ts')).allSessions
    const sessions = await src(path.join(FX, 'claude', 'projects'), path.join(FX, 'codex', 'sessions'))
    const names = new Map([['0193a7c2-5e1d-7b8a-9c4f-2d6e8a1b3c5d', 'Itinerary PDF export']])
    const hits = async (match: string) => {
      const out: string[] = []
      for (const s of sessions) if (await wanted(s, { match }, names)) out.push(path.basename(s.file).slice(0, 8))
      return out.sort()
    }
    expect(await hits('checkout')).toEqual(['3f6c1b2a']) // its title (« Checkout fixes ») and its first request
    expect(await hits('CURRENCY  Chéckout')).toEqual(['3f6c1b2a']) // the title Claude gave, any case, accents ignored
    expect(await hits('itinerary pdf')).toEqual(['rollout-']) // Codex's own name for the session
    expect(await hits('button itinerary')).toEqual(['rollout-']) // its first request
    expect(await hits('meeting bullets')).toEqual(['5a1e9c40'])
    expect(await hits('checkout itinerary')).toEqual([]) // every word, in one session
    expect(await hits('   ')).toHaveLength(5)

    const r = await backfill(paths('match'), { now: Date.parse('2026-11-20T00:00:00Z'), match: 'checkout' })
    expect(r).toMatchObject({ sessions: 1, skipped: 4, created: 1 })
    expect(await titles('match')).toEqual(['Checkout fixes'])
  })

  it('on the command line: --since and --match, a date that is not one refused, and --once takes what the join line left', async () => {
    const dirs = ['--claude-dir', path.join(FX, 'claude', 'projects'), '--codex-dir', path.join(FX, 'codex', 'sessions')]
    const out: string[] = []
    expect(await weevbookMain(['backfill', '--since', 'last week', '--data-dir', path.join(tmp, 'x'), ...dirs], (l) => out.push(l))).toBe(2)
    expect(out.join('\n')).toMatch(/--since takes a date/)
    expect(fs.existsSync(path.join(tmp, 'x', 'weevbook'))).toBe(false)
    expect(await weevbookMain(['backfill', '--match', 'itinerary export', '--data-dir', path.join(tmp, 'm'), ...dirs], (l) => out.push(l))).toBe(0)
    expect(out.join('\n')).toMatch(/4 sessions left out by --since or --match/)
    expect(await titles('m')).toEqual(['Itinerary PDF export'])
    // The import at install, on a machine whose join line said --since 2026-11-18 (server/join.sh wrote the file).
    const cfg = path.join(tmp, 'cfg')
    fs.mkdirSync(cfg)
    fs.writeFileSync(path.join(cfg, 'backfill.json'), '{"since":"2026-11-18"}\n')
    const once: string[] = []
    expect(await weevbookMain(['backfill', '--once', '--data-dir', path.join(tmp, 'o'), '--config-dir', cfg, ...dirs], (l) => once.push(l))).toBe(0)
    expect(once.join('\n')).toMatch(/^3 sessions: /)
    expect(fs.existsSync(backfillMarker(path.join(tmp, 'o')))).toBe(true)
    // By hand, without --once, the file is not read: everything.
    const hand: string[] = []
    await weevbookMain(['backfill', '--data-dir', path.join(tmp, 'h'), '--config-dir', cfg, ...dirs], (l) => hand.push(l))
    expect(hand.join('\n')).toMatch(/^5 sessions: /)
  })
})

describe('in weevilsd', () => {
  it('a vault set up while weevilsd runs starts being pushed without a restart', async () => {
    await makeBook('a')
    const remote = bareRemote()
    const cfg = path.join(tmp, 'cfg')
    const logs: string[] = []
    const saved = () => {
      try {
        return (JSON.parse(fs.readFileSync(path.join(cfg, 'vault.json'), 'utf8')) as { remote: string }).remote
      } catch {
        return null
      }
    }
    const p = startVaultPusherWhenSet({ dir: path.join(tmp, 'a', 'weevbook'), staging: path.join(tmp, 'a', 'vault.git'), remote: saved, keyFile: path.join(cfg, 'vault.key'), deployKey: path.join(cfg, 'vault-deploy'), machine: MACHINE, intervalMs: 50, pollMs: 20, log: (l) => logs.push(l) })
    await new Promise((r) => setTimeout(r, 80))
    expect(p.started()).toBe(false)
    expect(logs).toEqual([])
    // weevboss runs the setup in its chat.
    expect(await vaultMain(['vault', 'setup', '--remote', remote, '--data-dir', path.join(tmp, 'a'), '--config-dir', cfg], () => undefined)).toBe(0)
    for (let i = 0; i < 200 && !git(remote, 'for-each-ref', '--format=%(refname)', 'refs/threads/'); i++) await new Promise((r) => setTimeout(r, 50))
    expect(p.started()).toBe(true)
    expect(logs[0]).toBe('[vault] pusher on')
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/threads/').split('\n')).toHaveLength(2)
    p.stop()
  })

  it('the pusher pushes when the thread refs move, logs an error once, and never throws', async () => {
    const a = await makeBook('a')
    const remote = bareRemote()
    const keyFile = path.join(tmp, 'cfg', 'vault.key')
    const logs: string[] = []
    const base = { dir: path.join(tmp, 'a', 'weevbook'), staging: path.join(tmp, 'a', 'vault.git'), remote, keyFile, machine: MACHINE, intervalMs: 3_600_000, retryMs: 0, log: (l: string) => logs.push(l) }
    const p = startVaultPusher(base)
    await p.flush()
    await p.flush()
    expect(logs.filter((l) => l.includes('no vault key'))).toHaveLength(1)
    p.stop()
    writeKey(keyFile, newKey())
    const q = startVaultPusher(base)
    await q.flush()
    expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/threads/').split('\n')).toHaveLength(2)
    expect(await a.lock()).toBe(true)
    await a.append(T2, { events: [said('again', 20)] })
    await a.commitThread(T2, 'turn 2')
    await a.unlock(true)
    const tip = git(remote, 'rev-parse', `refs/threads/${T2}`)
    await q.flush()
    expect(git(remote, 'rev-parse', `refs/threads/${T2}^`)).toBe(tip)
    q.stop()
  })

  it('the first start backfills every session once, in a low-priority process, and writes its marker', async () => {
    const home = process.env.HOME!
    fs.cpSync(path.join(FX, 'claude'), path.join(home, '.claude'), { recursive: true })
    const data = path.join(tmp, 'data')
    fs.mkdirSync(data)
    const child = startFirstBackfill({ dataDir: data, log: () => undefined })!
    expect(child).not.toBeNull()
    await new Promise((r) => child.on('exit', r))
    expect(fs.existsSync(backfillMarker(data))).toBe(true)
    const book = await Weevbook.open(path.join(data, 'weevbook'), 'test')
    expect(book.threads().length).toBeGreaterThan(0)
    expect(startFirstBackfill({ dataDir: data, log: () => undefined })).toBeNull()
  }, 60_000)
})
