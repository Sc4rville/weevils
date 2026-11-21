// The vault (docs/spec/07-vault.md, step 1): an encrypted copy of every thread's journal and attachments, pushed to a
// git remote the person owns (their private GitHub repository `weevbook-vault`), and restored from it on a new machine.
//
// Layout of the remote ("The format on GitHub"): per thread, refs/threads/<id> → a commit whose tree is
//   m            the manifest, encrypted: the ordered chunk names, the journal's length and SHA-256, the attachments
//   c/<sha256>   one chunk: the journal bytes appended since the previous push, compressed then encrypted, immutable
//   a/<sha256>   one attachment, encrypted
// and refs/heads/main → a README only. Names are hashes of the ciphertext; commits have a fixed neutral author, date
// and message: no title, project, path, machine or account name leaves in clear.
//
// Every file is sealed with AES-256-GCM under the 32-byte vault key, a random 12-byte nonce, and as associated data
// the thread id and the file's kind (m, c or a): a chunk moved to another thread, or put in place of a manifest, fails
// to open. The plain text is compressed first (zstd when this Node has it, else gzip; a format byte says which).
//
// Pushing builds the commits in a local bare repository (DATA_DIR/vault.git) from the weevbook's own thread refs, then
// pushes them atomically. Only what is new is sealed: a push never rewrites a chunk (VAULT-3), and a push with nothing
// new sends nothing (VAULT-5).

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { Locked, Weevbook } from './store.ts'

// ---------------------------------------------------------------- sealing

const VERSION = 1
const ZSTD = 1
const GZIP = 2
type Kind = 'm' | 'c' | 'a'
const hasZstd = typeof (zlib as { zstdCompressSync?: unknown }).zstdCompressSync === 'function'

export class VaultError extends Error {}

const aad = (thread: string, kind: Kind, format: number) => Buffer.from(`weevils-vault/${VERSION}\0${kind}\0${thread}\0${format}`)

/** One file of the vault: [version, format, nonce(12), ciphertext, tag(16)]. */
export function seal(key: Buffer, thread: string, kind: Kind, plain: Buffer): Buffer {
  const format = hasZstd ? ZSTD : GZIP
  const packed = format === ZSTD ? zlib.zstdCompressSync(plain) : zlib.gzipSync(plain, { level: 9 })
  const nonce = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
  c.setAAD(aad(thread, kind, format))
  const body = Buffer.concat([c.update(packed), c.final()])
  return Buffer.concat([Buffer.from([VERSION, format]), nonce, body, c.getAuthTag()])
}

/** The plain text of a sealed file; throws a VaultError when the key, the thread or the kind is not the one it was
 *  sealed with, or when a byte changed. */
export function open(key: Buffer, thread: string, kind: Kind, sealed: Buffer): Buffer {
  if (sealed.length < 2 + 12 + 16 || sealed[0] !== VERSION) throw new VaultError('not a vault file') // i18n-ignore: technical error
  const format = sealed[1]
  const nonce = sealed.subarray(2, 14)
  const tag = sealed.subarray(sealed.length - 16)
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  d.setAAD(aad(thread, kind, format))
  d.setAuthTag(tag)
  let packed: Buffer
  try {
    packed = Buffer.concat([d.update(sealed.subarray(14, sealed.length - 16)), d.final()])
  } catch {
    throw new VaultError('cannot decrypt: wrong vault key, or a file moved or changed') // i18n-ignore: technical error
  }
  if (format === ZSTD) {
    if (!hasZstd) throw new VaultError('this vault needs a Node.js with zstd (22.15 or later)') // i18n-ignore: technical error
    return zlib.zstdDecompressSync(packed)
  }
  if (format === GZIP) return zlib.gunzipSync(packed)
  throw new VaultError(`unknown format ${format}`) // i18n-ignore: technical error
}

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

// ---------------------------------------------------------------- the key and its recovery code

let words: string[] | null = null
function wordlist(): string[] {
  if (words) return words
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'bip39-english.txt')
  const list = fs.readFileSync(file, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean)
  if (list.length !== 2048) throw new VaultError('the recovery wordlist is damaged') // i18n-ignore: technical error
  return (words = list)
}

/** The key as 24 words (BIP39: 256 bits and an 8-bit checksum, 11 bits a word). */
export function recoveryCode(key: Buffer): string {
  if (key.length !== 32) throw new VaultError('a vault key is 32 bytes') // i18n-ignore: technical error
  const list = wordlist()
  const bits = [...key].map((b) => b.toString(2).padStart(8, '0')).join('') + crypto.createHash('sha256').update(key).digest()[0].toString(2).padStart(8, '0')
  const out: string[] = []
  for (let i = 0; i < bits.length; i += 11) out.push(list[parseInt(bits.slice(i, i + 11), 2)])
  return out.join(' ')
}

/** The key back from its 24 words; throws a VaultError on an unknown word, a wrong count or a wrong checksum. */
export function keyFromCode(code: string): Buffer {
  const list = wordlist()
  const ws = code.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (ws.length !== 24) throw new VaultError(`a recovery code has 24 words, not ${ws.length}`) // i18n-ignore: technical error
  let bits = ''
  for (const w of ws) {
    const i = list.indexOf(w)
    if (i < 0) throw new VaultError(`"${w}" is not a word of the recovery code`) // i18n-ignore: technical error
    bits += i.toString(2).padStart(11, '0')
  }
  const key = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  const check = crypto.createHash('sha256').update(key).digest()[0].toString(2).padStart(8, '0')
  if (bits.slice(256) !== check) throw new VaultError('the recovery code does not check out: a word is wrong') // i18n-ignore: technical error
  return key
}

/** The vault key of this machine (null: none yet). */
export function readKey(file: string): Buffer | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
  const key = Buffer.from(text, 'base64')
  if (key.length !== 32) throw new VaultError(`${file} does not hold a vault key`) // i18n-ignore: technical error
  return key
}

/** Writes the key (0600), never over another one. */
export function writeKey(file: string, key: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const old = readKey(file)
  if (old) {
    if (old.equals(key)) return
    throw new VaultError(`${file} already holds another vault key`) // i18n-ignore: technical error
  }
  fs.writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' })
}

export const newKey = () => crypto.randomBytes(32)

// ---------------------------------------------------------------- git, in bytes

const INHERITED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX']
/** The commits of the vault: the same author, date and message on every machine. */
const NEUTRAL = {
  GIT_AUTHOR_NAME: 'vault', GIT_AUTHOR_EMAIL: 'vault@weevils.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'vault', GIT_COMMITTER_EMAIL: 'vault@weevils.invalid', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
}

interface GitOpts { input?: string | Buffer; env?: Record<string, string>; timeoutMs?: number; allowFail?: boolean }
function git(gitDir: string, args: string[], o: GitOpts = {}): Promise<{ code: number; out: Buffer; err: string }> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env }
    for (const k of INHERITED) delete env[k]
    Object.assign(env, { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, o.env)
    const child = execFile('git', ['--git-dir', gitDir, ...args], { env, encoding: 'buffer', maxBuffer: 1 << 30, timeout: o.timeoutMs ?? 120_000, killSignal: 'SIGKILL' }, (e, stdout, stderr) => {
      const code = !e ? 0 : (e as { killed?: boolean }).killed ? 124 : typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : 1
      const err = String(stderr)
      if (code && !o.allowFail) reject(new VaultError(`git ${args[0]}: ${(err || String(e?.message)).trim().split('\n').slice(-2).join(' ')}`)) // i18n-ignore: git's own error, for the log
      else resolve({ code, out: stdout, err })
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(o.input ?? '')
  })
}
const text = async (gitDir: string, args: string[], o: GitOpts = {}) => (await git(gitDir, args, o)).out.toString().trim()
async function revParse(gitDir: string, ref: string): Promise<string | null> {
  const r = await git(gitDir, ['rev-parse', '-q', '--verify', `${ref}^{commit}`], { allowFail: true })
  return r.code === 0 ? r.out.toString().trim() || null : null
}
async function isAncestor(gitDir: string, a: string, b: string) {
  return (await git(gitDir, ['merge-base', '--is-ancestor', a, b], { allowFail: true })).code === 0
}
async function refsUnder(gitDir: string, prefix: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const l of (await text(gitDir, ['for-each-ref', '--format=%(objectname) %(refname)', prefix])).split('\n')) {
    if (!l) continue
    const [oid, ref] = l.split(' ')
    out.set(ref.slice(prefix.length), oid)
  }
  return out
}

/** The ssh git uses for the vault: this machine's deploy key only, never a question. */
export function vaultSsh(deployKey: string | null): string | undefined {
  if (!deployKey || !fs.existsSync(deployKey)) return undefined
  return `ssh -i ${deployKey} -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new`
}

// ---------------------------------------------------------------- the staging repository

export const VAULT_README = `# weevbook-vault

This repository is an encrypted copy of conversations kept by weevils (https://github.com/Sc4rville/weevils).
Nothing here is readable without the vault key, which never leaves the person's machines. Do not edit it by hand.
`

export interface VaultOptions {
  /** DATA_DIR/weevbook */
  dir: string
  /** DATA_DIR/vault.git: the local staging repository. */
  staging: string
  /** The vault's git URL or path. */
  remote: string
  key: Buffer
  machine: string
  /** GIT_SSH_COMMAND for the remote (vaultSsh). */
  ssh?: string
  netMs?: number
}

interface Manifest {
  v: 1
  thread: string
  journal: { bytes: number; sha256: string }
  /** Chunk names in order, with the bytes of the journal each one holds. */
  chunks: { n: string; b: number }[]
  /** The thread's attachment files (attachments/<sha256>.<ext>) → their name in a/. */
  attachments: Record<string, string>
}

interface State {
  /** By thread: the weevbook commit the staging ref was last built from. */
  threads: Record<string, string>
  pushedAt?: string
  error?: string | null
}

const stateFile = (staging: string) => path.join(staging, 'weevils-state.json')
async function readState(staging: string): Promise<State> {
  try {
    return { threads: {}, ...(JSON.parse(await fsp.readFile(stateFile(staging), 'utf8')) as Partial<State>) }
  } catch {
    return { threads: {} }
  }
}
async function writeState(staging: string, s: State) {
  const tmp = `${stateFile(staging)}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(s))
  await fsp.rename(tmp, stateFile(staging))
}

async function openStaging(staging: string) {
  if (!fs.existsSync(path.join(staging, 'HEAD'))) {
    await fsp.mkdir(staging, { recursive: true })
    await git(staging, ['init', '-q', '--bare', '--initial-branch=main'])
  }
}

/** One vault command at a time on this machine (weevilsd and the command line). */
async function lockStaging(staging: string): Promise<() => Promise<void>> {
  const file = `${staging}.lock`
  for (let i = 0; i < 2; i++) {
    try {
      await fsp.writeFile(file, String(process.pid), { flag: 'wx' })
      return () => fsp.rm(file, { force: true })
    } catch {
      const pid = Number(await fsp.readFile(file, 'utf8').catch(() => ''))
      let alive = false
      try {
        if (pid) process.kill(pid, 0)
        alive = !!pid
      } catch (e) {
        alive = (e as NodeJS.ErrnoException).code === 'EPERM'
      }
      if (alive && pid !== process.pid) throw new Locked('vault.lock')
      await fsp.rm(file, { force: true })
    }
  }
  throw new Locked('vault.lock')
}

/** The vault's refs as the remote has them, in refs/vault-remote/ of the staging repository. */
async function fetchRemote(o: VaultOptions) {
  await git(o.staging, ['fetch', '-q', '--no-tags', '--prune', o.remote, '+refs/threads/*:refs/vault-remote/threads/*', '+refs/heads/*:refs/vault-remote/heads/*'], {
    env: o.ssh ? { GIT_SSH_COMMAND: o.ssh } : {}, timeoutMs: o.netMs ?? 300_000,
  })
}

async function readManifest(o: VaultOptions, thread: string, commit: string): Promise<Manifest> {
  const sealed = (await git(o.staging, ['cat-file', 'blob', `${commit}:m`])).out
  const m = JSON.parse(open(o.key, thread, 'm', sealed).toString()) as Manifest
  if (m.thread !== thread) throw new VaultError(`manifest of ${thread} names ${m.thread}`) // i18n-ignore: technical error
  return m
}

async function writeBlob(gitDir: string, data: Buffer): Promise<string> {
  return text(gitDir, ['hash-object', '-w', '--stdin'], { input: data })
}
async function mktree(gitDir: string, entries: string[]): Promise<string> {
  return text(gitDir, ['mktree'], { input: entries.join('\n') + (entries.length ? '\n' : '') })
}

/** main: the README alone, the same commit on every machine. */
async function readmeCommit(staging: string): Promise<string> {
  const blob = await writeBlob(staging, Buffer.from(VAULT_README))
  const tree = await mktree(staging, [`100644 blob ${blob}\tREADME.md`])
  return text(staging, ['commit-tree', tree, '-m', 'vault'], { env: NEUTRAL })
}

export interface PushReport {
  threads: number
  /** Threads that got a new commit this time. */
  sealed: number
  chunks: number
  attachments: number
  /** Refs sent to the remote. */
  pushed: number
  /** Threads left out: their journal differs from what the vault holds (another machine wrote it). */
  differ: string[]
  /** Threads that could not be read this time. */
  failed: { thread: string; error: string }[]
}

/** Seals what is new in every thread and pushes it to the vault. */
export async function pushVault(o: VaultOptions): Promise<PushReport> {
  await openStaging(o.staging)
  const unlock = await lockStaging(o.staging)
  try {
    return await push(o)
  } finally {
    await unlock()
  }
}

async function push(o: VaultOptions): Promise<PushReport> {
  const book = path.join(path.resolve(o.dir), '.git')
  const report: PushReport = { threads: 0, sealed: 0, chunks: 0, attachments: 0, pushed: 0, differ: [], failed: [] }
  const state = await readState(o.staging)
  await fetchRemote(o)
  const sources = fs.existsSync(path.join(book, 'HEAD')) ? await refsUnder(book, 'refs/threads/') : new Map<string, string>()
  const local = await refsUnder(o.staging, 'refs/threads/')
  const remote = await refsUnder(o.staging, 'refs/vault-remote/threads/')
  report.threads = sources.size
  for (const [id, src] of sources) {
    try {
      await sealThread(id, src)
    } catch (e) {
      // One thread that cannot be read (a damaged commit) does not hold the others back; it is tried again next time.
      if (e instanceof VaultError && /cannot decrypt/.test(e.message)) throw e
      report.failed.push({ thread: id, error: (e as Error).message })
    }
  }
  await writeState(o.staging, state)
  return send(o, state, remote, report)

  async function sealThread(id: string, src: string) {
    const mine = local.get(id) ?? null
    const theirs = remote.get(id) ?? null
    if (state.threads[id] === src && mine && mine === theirs) return
    let base = mine
    if (theirs && theirs !== mine && (!mine || !(await isAncestor(o.staging, theirs, mine)))) base = theirs // ahead of us, or another machine's
    const m: Manifest = base ? await readManifest(o, id, base) : { v: 1, thread: id, journal: { bytes: 0, sha256: sha256('') }, chunks: [], attachments: {} }
    const journal = (await git(book, ['cat-file', 'blob', `${src}:events.jsonl`])).out
    if (journal.length < m.journal.bytes || sha256(journal.subarray(0, m.journal.bytes)) !== m.journal.sha256) {
      report.differ.push(id)
      if (base !== mine && base) await git(o.staging, ['update-ref', `refs/threads/${id}`, base])
      state.threads[id] = src
      return
    }
    const files = (await text(book, ['ls-tree', '-r', src, '--', 'attachments/'])).split('\n').filter(Boolean).map((l) => {
      const [meta, name] = l.split('\t')
      return { oid: meta.split(' ')[2], name }
    })
    const newFiles = files.filter((f) => !(f.name in m.attachments))
    const tail = journal.subarray(m.journal.bytes)
    if (!tail.length && !newFiles.length) {
      if (base && base !== mine) await git(o.staging, ['update-ref', `refs/threads/${id}`, base])
      state.threads[id] = src
      return
    }
    // What the base already holds, kept as it is.
    const entries = new Map<string, string>()
    if (base) {
      for (const l of (await text(o.staging, ['ls-tree', '-r', base])).split('\n')) {
        if (!l) continue
        const [meta, name] = l.split('\t')
        entries.set(name, meta.split(' ')[2])
      }
    }
    if (tail.length) {
      const sealed = seal(o.key, id, 'c', tail)
      const n = sha256(sealed)
      entries.set(`c/${n}`, await writeBlob(o.staging, sealed))
      m.chunks.push({ n, b: tail.length })
      m.journal = { bytes: journal.length, sha256: sha256(journal) }
      report.chunks++
    }
    for (const f of newFiles) {
      const plain = (await git(book, ['cat-file', 'blob', f.oid])).out
      const sealed = seal(o.key, id, 'a', plain)
      const n = sha256(sealed)
      entries.set(`a/${n}`, await writeBlob(o.staging, sealed))
      m.attachments[f.name] = n
      report.attachments++
    }
    entries.set('m', await writeBlob(o.staging, seal(o.key, id, 'm', Buffer.from(JSON.stringify(m)))))
    const sub = async (dir: 'c' | 'a') => {
      const list = [...entries].filter(([k]) => k.startsWith(`${dir}/`)).map(([k, oid]) => `100644 blob ${oid}\t${k.slice(2)}`)
      return list.length ? `040000 tree ${await mktree(o.staging, list)}\t${dir}` : null
    }
    const root = [`100644 blob ${entries.get('m')}\tm`, await sub('c'), await sub('a')].filter((x): x is string => !!x)
    const tree = await mktree(o.staging, root)
    const commit = await text(o.staging, ['commit-tree', tree, ...(base ? ['-p', base] : []), '-m', 'vault'], { env: NEUTRAL })
    await git(o.staging, ['update-ref', `refs/threads/${id}`, commit])
    state.threads[id] = src
    report.sealed++
  }
}

async function send(o: VaultOptions, state: State, remote: Map<string, string>, report: PushReport): Promise<PushReport> {
  // Send every ref the remote does not have yet, newest threads first, in atomic groups.
  const now = await refsUnder(o.staging, 'refs/threads/')
  const send = [...now].filter(([id, oid]) => remote.get(id) !== oid).sort(([a], [b]) => (a < b ? 1 : -1))
  const specs: { spec: string; ref: string; oid: string }[] = []
  const remoteMain = await revParse(o.staging, 'refs/vault-remote/heads/main')
  if (!remoteMain) {
    const readme = await readmeCommit(o.staging)
    await git(o.staging, ['update-ref', 'refs/heads/main', readme])
    specs.push({ spec: `${readme}:refs/heads/main`, ref: 'refs/vault-remote/heads/main', oid: readme })
  }
  for (const [id, oid] of send) specs.push({ spec: `${oid}:refs/threads/${id}`, ref: `refs/vault-remote/threads/${id}`, oid })
  for (let i = 0; i < specs.length; i += 100) {
    const group = specs.slice(i, i + 100)
    await git(o.staging, ['push', '-q', '--atomic', '--no-verify', o.remote, ...group.map((s) => s.spec)], { env: o.ssh ? { GIT_SSH_COMMAND: o.ssh } : {}, timeoutMs: o.netMs ?? 600_000 })
    for (const s of group) await git(o.staging, ['update-ref', s.ref, s.oid])
    report.pushed += group.length
  }
  state.pushedAt = new Date().toISOString()
  state.error = null
  await writeState(o.staging, state)
  return report
}

// ---------------------------------------------------------------- restore

export interface RestoreReport {
  threads: number
  restored: number
  same: number
  /** This machine's journal is longer: it pushes it next. */
  ahead: number
  differ: string[]
  main: string | null
}

/** Fetches the vault and decrypts every journal and attachment into the local weevbook. */
export async function restoreVault(o: VaultOptions): Promise<RestoreReport> {
  await openStaging(o.staging)
  const unlock = await lockStaging(o.staging)
  try {
    return await restore(o)
  } finally {
    await unlock()
  }
}

async function restore(o: VaultOptions): Promise<RestoreReport> {
  await fetchRemote(o)
  const remote = await refsUnder(o.staging, 'refs/vault-remote/threads/')
  const book = await Weevbook.open(o.dir, o.machine)
  const report: RestoreReport = { threads: remote.size, restored: 0, same: 0, ahead: 0, differ: [], main: null }
  const state = await readState(o.staging)
  const idx = path.join(o.staging, `restore-index-${process.pid}`)
  for (const [id, tip] of remote) {
    const m = await readManifest(o, id, tip)
    const parts: Buffer[] = []
    for (const c of m.chunks) {
      const sealed = (await git(o.staging, ['cat-file', 'blob', `${tip}:c/${c.n}`])).out
      const plain = open(o.key, id, 'c', sealed)
      if (plain.length !== c.b) throw new VaultError(`chunk ${c.n} of ${id} has ${plain.length} bytes, not ${c.b}`) // i18n-ignore: technical error
      parts.push(plain)
    }
    const journal = Buffer.concat(parts)
    if (journal.length !== m.journal.bytes || sha256(journal) !== m.journal.sha256) throw new VaultError(`the journal of ${id} does not match its manifest`) // i18n-ignore: technical error
    if (!(await book.lockWait())) throw new Locked('weevbook.lock')
    let wrote = false
    try {
      const mine = await book.threadRef(id)
      const have = mine ? (await git(book.gitDir, ['cat-file', 'blob', `${mine}:events.jsonl`], { allowFail: true })).out : Buffer.alloc(0)
      const haveFiles = new Set(mine ? (await text(book.gitDir, ['ls-tree', '-r', '--name-only', mine, '--', 'attachments/'])).split('\n').filter(Boolean) : [])
      const missing = Object.keys(m.attachments).filter((f) => !haveFiles.has(f))
      if (have.equals(journal) && !missing.length) report.same++
      else if (have.length >= journal.length && have.subarray(0, journal.length).equals(journal) && !missing.length) report.ahead++
      else if (have.length > journal.length || !journal.subarray(0, have.length).equals(have)) report.differ.push(id)
      else {
        // The local tree (raw lines…) with the vault's journal and the attachments it lacks.
        const env = { GIT_INDEX_FILE: idx }
        await fsp.rm(idx, { force: true })
        await git(book.gitDir, mine ? ['read-tree', mine] : ['read-tree', '--empty'], { env })
        const add = async (name: string, data: Buffer) => {
          const oid = await writeBlob(book.gitDir, data)
          await git(book.gitDir, ['update-index', '--add', '--cacheinfo', `100644,${oid},${name}`], { env })
        }
        await add('events.jsonl', journal)
        for (const f of missing) {
          const sealed = (await git(o.staging, ['cat-file', 'blob', `${tip}:a/${m.attachments[f]}`])).out
          await add(f, open(o.key, id, 'a', sealed))
        }
        const tree = await text(book.gitDir, ['write-tree'], { env })
        await fsp.rm(idx, { force: true })
        const commit = await text(book.gitDir, ['commit-tree', tree, ...(mine ? ['-p', mine] : []), '-m', `vault restore · ${o.machine}`], { env: NEUTRAL }) // i18n-ignore: commit subject
        await book.adopt(id, commit)
        await book.rebuild(id)
        const done = await book.commitThread(id, `vault restore · ${o.machine}`) // i18n-ignore: commit subject
        await git(o.staging, ['update-ref', `refs/threads/${id}`, tip])
        if (done) state.threads[id] = done
        report.restored++
        wrote = true
      }
    } finally {
      await book.unlock(wrote)
    }
  }
  await writeState(o.staging, state)
  if (report.restored && (await book.lockWait())) {
    try {
      report.main = await book.compose()
      await book.tidy()
    } finally {
      await book.unlock(report.main !== null)
    }
  }
  return report
}

// ---------------------------------------------------------------- status

export interface VaultStatus {
  remote: string
  key: boolean
  threads: number
  /** Threads whose last commit is not sealed yet. */
  pending: number
  /** Thread refs the remote holds, as of the last fetch. */
  remoteThreads: number
  pushedAt: string | null
  error: string | null
}

export async function vaultStatus(o: { dir: string; staging: string; remote: string; key: boolean }): Promise<VaultStatus> {
  const book = path.join(path.resolve(o.dir), '.git')
  const sources = fs.existsSync(path.join(book, 'HEAD')) ? await refsUnder(book, 'refs/threads/') : new Map<string, string>()
  const has = fs.existsSync(path.join(o.staging, 'HEAD'))
  const state = has ? await readState(o.staging) : { threads: {} as Record<string, string> }
  const remote = has ? await refsUnder(o.staging, 'refs/vault-remote/threads/') : new Map<string, string>()
  const local = has ? await refsUnder(o.staging, 'refs/threads/') : new Map<string, string>()
  let pending = 0
  for (const [id, src] of sources) if (state.threads[id] !== src || local.get(id) !== remote.get(id)) pending++
  return { remote: o.remote, key: o.key, threads: sources.size, pending, remoteThreads: remote.size, pushedAt: (state as State).pushedAt ?? null, error: (state as State).error ?? null }
}

/** Records the last error of weevilsd's pusher, for `vault status`. */
export async function noteError(staging: string, error: string | null) {
  if (!fs.existsSync(path.join(staging, 'HEAD'))) return
  const s = await readState(staging)
  s.error = error
  await writeState(staging, s).catch(() => undefined)
}

/** Whether the remote already holds a vault (thread refs), before a key is made for it. */
export async function remoteHasVault(staging: string, remote: string, ssh?: string): Promise<boolean> {
  await openStaging(staging)
  const r = await git(staging, ['ls-remote', remote, 'refs/threads/*'], { env: ssh ? { GIT_SSH_COMMAND: ssh } : {}, timeoutMs: 60_000 })
  return r.out.toString().trim().length > 0
}

// ---------------------------------------------------------------- in weevilsd

export interface PusherOptions {
  dir: string
  staging: string
  remote: string
  keyFile: string
  machine: string
  ssh?: string
  intervalMs?: number
  /** After a failure, the next try waits this long. */
  retryMs?: number
  log?: (line: string) => void
}

/**
 * weevilsd's vault pusher: every `intervalMs` it looks at the weevbook's thread refs (one git command), and pushes
 * when they changed since the last push (the writer's turn commits, the hub's adoptions, a backfill). Errors are
 * logged once and never thrown into the app's loop.
 */
export function startVaultPusher(o: PusherOptions) {
  const interval = o.intervalMs ?? 30_000
  const retryMs = o.retryMs ?? 5 * 60_000
  const log = o.log ?? ((l: string) => console.error(l))
  const book = path.join(path.resolve(o.dir), '.git')
  let last = ''
  let failedAt = 0
  let busy = false
  let stopped = false
  let lastError = ''
  let idle: Promise<void> = Promise.resolve()

  async function snapshot() {
    if (!fs.existsSync(path.join(book, 'HEAD'))) return ''
    return sha256(await text(book, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/threads/']))
  }

  function round() {
    if (busy || stopped) return
    busy = true
    idle = (async () => {
      try {
        const snap = await snapshot()
        if (!snap || (snap === last && !failedAt)) return
        if (failedAt && Date.now() - failedAt < retryMs) return
        const key = readKey(o.keyFile)
        if (!key) throw new VaultError(`no vault key in ${o.keyFile}: run weevils weevbook vault setup or vault restore`) // i18n-ignore: log line
        const r = await pushVault({ dir: o.dir, staging: o.staging, remote: o.remote, key, machine: o.machine, ssh: o.ssh })
        last = snap
        failedAt = 0
        lastError = ''
        if (r.sealed || r.pushed) log(`[vault] pushed ${r.pushed} refs (${r.sealed} threads, ${r.chunks} chunks, ${r.attachments} attachments)${r.differ.length ? ` · ${r.differ.length} threads differ from the vault` : ''}${r.failed.length ? ` · ${r.failed.length} threads unreadable (${r.failed[0].thread}: ${r.failed[0].error})` : ''}`)
      } catch (e) {
        if (e instanceof Locked) return
        failedAt = Date.now()
        const msg = (e as Error)?.message ?? String(e)
        if (msg !== lastError) log(`[vault] ${msg}`)
        lastError = msg
        await noteError(o.staging, msg).catch(() => undefined)
      } finally {
        busy = false
      }
    })()
  }

  const timer = setInterval(round, interval)
  timer.unref?.()
  setTimeout(round, Math.min(interval, 5000)).unref?.()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    async flush() {
      await idle
      round()
      await idle
    },
  }
}
