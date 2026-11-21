import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EventDraft } from './journal.ts'
import { backfill, backfillMarker, startFirstBackfill } from './backfill.ts'
import { Weevbook } from './store.ts'
import { VaultError, keyFromCode, newKey, open, pushVault, readKey, recoveryCode, restoreVault, seal, startVaultPusher, writeKey, type VaultOptions } from './vault.ts'
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

describe('in weevilsd', () => {
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
