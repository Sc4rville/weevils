// The vault (docs/spec/07-vault.md, step 1): an encrypted copy of every thread's journal and attachments, pushed to a
// git remote the person owns (their private GitHub repository `weevbook-vault`), and restored from it on a new machine.
//
// Layout of the remote ("The format on GitHub"): per thread, refs/threads/<id> → a commit whose tree is
//   m            the manifest, encrypted: the ordered chunk names, the journal's length and SHA-256, the attachments
//   c/<sha256>   one chunk: the journal bytes appended since the previous push, compressed then encrypted, immutable
//   a/<sha256>   one attachment, encrypted
//   h            handoff.md as the journal last recorded it, encrypted (step 2: a model wrote it, the journal cannot rebuild it)
// refs/leases/<id> → a commit with one file, `l`: the thread's lease, encrypted (step 4, vault-lease.ts); every push of
// a thread carries it, compare-and-swap, so that one machine at a time writes a thread;
// and refs/heads/main → a README only. Names are hashes of the ciphertext; commits have a fixed neutral author, date
// and message: no title, project, path, machine or account name leaves in clear.
//
// Every file is sealed with AES-256-GCM under the 32-byte vault key, a random 12-byte nonce, and as associated data
// the thread id and the file's kind (m, c, a or h): a chunk moved to another thread, or put in place of a manifest, fails
// to open. The plain text is compressed first (zstd when this Node has it, else gzip; a format byte says which).
//
// Pushing builds the commits in a local bare repository (DATA_DIR/vault.git) from the weevbook's own thread refs, then
// pushes them atomically. Only what is new is sealed: a push never rewrites a chunk (VAULT-3), and a push with nothing
// new sends nothing (VAULT-5).
//
// Step 3 (vault-raw.ts) adds, in the same push: the provider's own lines, slim, in the raw repositories
// (`weevbook-raw-NNN`, refs/raw/<id>), the map that says which repository holds which thread (refs/map/raw here), and
// the checkpoints of the code as encrypted git bundles (refs/checkpoints/<id> here).

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { deriveMeta, ownTask, parseEngine, parseJournal } from './journal.ts'
import { Locked, Weevbook, threadRefs } from './store.ts'
import { linesDue, pushLines, readLines, type CheckpointsReport, type LinesJob, type LinesReport, type RawReport } from './vault-raw.ts'
import { ghRunner, type Gh } from './vault-github.ts'
import { intentAt, renewVaultLeases, vaultLeases } from './vault-lease.ts'
import { parseLease, type LeaseClient } from './lease.ts'

// ---------------------------------------------------------------- sealing

const VERSION = 1
const ZSTD = 1
const GZIP = 2
/** m, c, a, h: a thread's manifest, journal chunk, attachment, handoff. Step 3: rm and rc, a thread's raw manifest and
 *  raw chunk; km and kb, its checkpoints' manifest and one bundle; x, a piece of the raw map. Step 4: l, its lease. */
export type Kind = 'm' | 'c' | 'a' | 'h' | 'rm' | 'rc' | 'km' | 'kb' | 'x' | 'l'
const hasZstd = typeof (zlib as { zstdCompressSync?: unknown }).zstdCompressSync === 'function'

export class VaultError extends Error {}

const aad = (thread: string, kind: Kind, format: number) => Buffer.from(`weevils-vault/${VERSION}\0${kind}\0${thread}\0${format}`)

/** One file of the vault: [version, format, nonce(12), ciphertext, tag(16)]. */
export function seal(key: Buffer, thread: string, kind: Kind, plain: Buffer): Buffer {
  const format = hasZstd ? ZSTD : GZIP
  return encrypt(key, thread, kind, format, format === ZSTD ? zlib.zstdCompressSync(plain) : zlib.gzipSync(plain, { level: 9 }))
}

/** The same file, compressed off the main thread: for the megabytes of raw lines and bundles weevilsd's pusher seals. */
export async function sealLarge(key: Buffer, thread: string, kind: Kind, plain: Buffer): Promise<Buffer> {
  const format = hasZstd ? ZSTD : GZIP
  const packed = await new Promise<Buffer>((resolve, reject) => {
    const done = (e: Error | null, out: Buffer) => (e ? reject(e) : resolve(out))
    if (format === ZSTD) zlib.zstdCompress(plain, done)
    else zlib.gzip(plain, { level: 6 }, done)
  })
  return encrypt(key, thread, kind, format, packed)
}

function encrypt(key: Buffer, thread: string, kind: Kind, format: number, packed: Buffer): Buffer {
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

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

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
export const NEUTRAL = {
  GIT_AUTHOR_NAME: 'vault', GIT_AUTHOR_EMAIL: 'vault@weevils.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'vault', GIT_COMMITTER_EMAIL: 'vault@weevils.invalid', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
}

export interface GitOpts { input?: string | Buffer; env?: Record<string, string>; timeoutMs?: number; allowFail?: boolean }
export function git(gitDir: string, args: string[], o: GitOpts = {}): Promise<{ code: number; out: Buffer; err: string }> {
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
export const text = async (gitDir: string, args: string[], o: GitOpts = {}) => (await git(gitDir, args, o)).out.toString().trim()
export async function revParse(gitDir: string, ref: string): Promise<string | null> {
  const r = await git(gitDir, ['rev-parse', '-q', '--verify', `${ref}^{commit}`], { allowFail: true })
  return r.code === 0 ? r.out.toString().trim() || null : null
}
export async function isAncestor(gitDir: string, a: string, b: string) {
  return (await git(gitDir, ['merge-base', '--is-ancestor', a, b], { allowFail: true })).code === 0
}
export async function refsUnder(gitDir: string, prefix: string): Promise<Map<string, string>> {
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
  /** Step 3: slim raw lines and checkpoints go too (default: yes; `false` keeps a push to journals, as in step 1). */
  raw?: boolean
  /** Where this machine keeps one deploy key per raw repository (CONFIG_DIR/vault-deploy-raw-NNN), for a vault on
   *  GitHub. Without it the raw repositories are reached as the vault is. */
  keyDir?: string
  /** `gh` on the machine where the person signed in: it makes the raw repositories and gives every machine's
   *  published key access to them. */
  gh?: Gh
  /** A raw repository that passed this gets no new thread: the next one opens (default 700 MB). */
  rollBytes?: number
  /** A checkpoint bundle over this is not sent (default 50 MB). */
  bundleMax?: number
  /** A thread's raw lines wait until its last commit is this old (default 0: a command pushes at once; weevilsd's
   *  pusher waits for the turn to go quiet), but never longer than `rawEveryMs` since they last went (15 min). */
  rawQuietMs?: number
  rawEveryMs?: number
  /** The pieces of work between which the event loop gets its turn (ms of slimming at a stretch; default 8). */
  yieldMs?: number
  now?: () => number
  /** Progress of a long push (the first one of an existing weevbook), one line per batch sent. */
  progress?: (line: string) => void
  /** Step 4: this machine syncs with a hub (03): where the hub's lease names it, the vault's lease follows. */
  hub?: boolean
  /** Step 4: the lease client of this process (weevilsd's pusher keeps one: it remembers the leases it holds, to
   *  renew them). Default: one for this push. */
  leases?: LeaseClient
}

interface Manifest {
  v: 1
  thread: string
  journal: { bytes: number; sha256: string }
  /** Chunk names in order, with the bytes of the journal each one holds. */
  chunks: { n: string; b: number }[]
  /** The thread's attachment files (attachments/<sha256>.<ext>) → their name in a/. */
  attachments: Record<string, string>
  /** handoff.md, in `h`: the SHA-256 of its text (the one the journal's last `handoff` event records, BOOK-8). */
  handoff?: string
}

interface State {
  /** By thread: the weevbook commit the staging ref was last built from. */
  threads: Record<string, string>
  /** Every thread was looked at for its handoff.md (step 2): threads pushed before carry none in the vault. */
  handoffs?: boolean
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

export async function openStaging(staging: string) {
  if (!fs.existsSync(path.join(staging, 'HEAD'))) {
    await fsp.mkdir(staging, { recursive: true })
    await git(staging, ['init', '-q', '--bare', '--initial-branch=main'])
  }
}

/** One vault command at a time on this machine (weevilsd and the command line). `name`: the journals' lock, or the
 *  one of the raw lines and checkpoints (`lines.lock`), which are pushed apart so that neither waits for the other. */
export async function lockStaging(staging: string, name = 'lock'): Promise<() => Promise<void>> {
  const file = `${staging}.${name}`
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
      if (alive && pid !== process.pid) throw new Locked(`vault.${name}`)
      await fsp.rm(file, { force: true })
    }
  }
  throw new Locked(`vault.${name}`)
}

/** The vault's refs as the remote has them, in refs/vault-remote/ of the staging repository: the threads, their leases
 *  and `main`. Never the raw lines or the checkpoints: those are fetched for one thread, when it is resumed. */
async function fetchRemote(o: VaultOptions) {
  await git(o.staging, ['fetch', '-q', '--no-tags', '--prune', o.remote, '+refs/threads/*:refs/vault-remote/threads/*', '+refs/leases/*:refs/vault-remote/leases/*', '+refs/heads/*:refs/vault-remote/heads/*'], {
    env: o.ssh ? { GIT_SSH_COMMAND: o.ssh } : {}, timeoutMs: o.netMs ?? 300_000,
  })
}

async function readManifest(o: VaultOptions, thread: string, commit: string): Promise<Manifest> {
  const sealed = (await git(o.staging, ['cat-file', 'blob', `${commit}:m`])).out
  const m = JSON.parse(open(o.key, thread, 'm', sealed).toString()) as Manifest
  if (m.thread !== thread) throw new VaultError(`manifest of ${thread} names ${m.thread}`) // i18n-ignore: technical error
  return m
}

export async function writeBlob(gitDir: string, data: Buffer): Promise<string> {
  return text(gitDir, ['hash-object', '-w', '--stdin'], { input: data })
}
export async function mktree(gitDir: string, entries: string[]): Promise<string> {
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
  /** Step 4: threads not sent because another machine holds their lease (they continue there). */
  elsewhere: { thread: string; holder: string | null }[]
  /** Step 3: what went to the raw repositories and to refs/checkpoints (absent: a push of journals only). */
  raw?: RawReport
  checkpoints?: CheckpointsReport
}

/** Seals what is new in every thread and pushes it to the vault: the journals first (they are small, and they are
 *  what a new machine shows), then the raw lines and the checkpoints (step 3), unless `raw` is false. */
export async function pushVault(o: VaultOptions): Promise<PushReport> {
  await openStaging(o.staging)
  const unlock = await lockStaging(o.staging)
  let report: PushReport
  try {
    report = await push(o)
  } finally {
    await unlock()
  }
  if (o.raw !== false) Object.assign(report, await pushLines(o))
  return report
}

async function push(o: VaultOptions): Promise<PushReport> {
  const book = path.join(path.resolve(o.dir), '.git')
  const report: PushReport = { threads: 0, sealed: 0, chunks: 0, attachments: 0, pushed: 0, differ: [], failed: [], elsewhere: [] }
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
  if (!report.failed.length) state.handoffs = true
  await writeState(o.staging, state)
  return send(o, state, remote, report)

  async function sealThread(id: string, src: string) {
    const mine = local.get(id) ?? null
    const theirs = remote.get(id) ?? null
    // Nothing moved since the last push (a thread pushed before step 2 is looked at once more, for its handoff.md).
    if (state.threads[id] === src && mine && mine === theirs && (state.handoffs || !(await text(book, ['ls-tree', src, '--', 'handoff.md'])))) return
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
    // handoff.md, when it is not the one the vault holds (a manifest an older weevils rewrote may name one its tree lost).
    let handoff: Buffer | null = null
    const hOid = (await text(book, ['ls-tree', src, '--', 'handoff.md'])).split(/\s+/)[2]
    if (hOid) {
      const plain = (await git(book, ['cat-file', 'blob', hOid])).out
      if (sha256(plain) !== m.handoff || !base || !(await text(o.staging, ['ls-tree', base, '--', 'h']))) handoff = plain
    }
    if (!tail.length && !newFiles.length && !handoff) {
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
    if (handoff) {
      entries.set('h', await writeBlob(o.staging, seal(o.key, id, 'h', handoff)))
      m.handoff = sha256(handoff)
    }
    entries.set('m', await writeBlob(o.staging, seal(o.key, id, 'm', Buffer.from(JSON.stringify(m)))))
    const sub = async (dir: 'c' | 'a') => {
      const list = [...entries].filter(([k]) => k.startsWith(`${dir}/`)).map(([k, oid]) => `100644 blob ${oid}\t${k.slice(2)}`)
      return list.length ? `040000 tree ${await mktree(o.staging, list)}\t${dir}` : null
    }
    const root = [`100644 blob ${entries.get('m')}\tm`, entries.has('h') ? `100644 blob ${entries.get('h')}\th` : null, await sub('c'), await sub('a')].filter((x): x is string => !!x)
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
  const env: Record<string, string> = o.ssh ? { GIT_SSH_COMMAND: o.ssh } : {}
  if (!(await revParse(o.staging, 'refs/vault-remote/heads/main'))) {
    const readme = await readmeCommit(o.staging)
    await git(o.staging, ['update-ref', 'refs/heads/main', readme])
    await git(o.staging, ['push', '-q', '--no-verify', o.remote, `${readme}:refs/heads/main`], { env, timeoutMs: o.netMs ?? 600_000 })
    await git(o.staging, ['update-ref', 'refs/vault-remote/heads/main', readme])
    report.pushed++
  }
  // Each thread goes with its lease, compare-and-swap (step 4): taken when it has none, taken over when it is idle,
  // renewed when it is this machine's. A thread another machine holds at work, or took meanwhile, is left out.
  const leases = o.leases ?? vaultLeases(o)
  if (send.length) await leases.readAll(false)
  const book = path.join(path.resolve(o.dir), '.git')
  for (let i = 0; i < send.length; i += 100) {
    const group = send.slice(i, i + 100)
    const items = []
    for (const [id, oid] of group) items.push({ thread: id, intent: { ...(await intentAt(book, state.threads[id] ?? '', o.machine)), tip: oid } })
    const out = await leases.hold(items)
    for (const [id, oid] of group) {
      const r = out.get(id)
      if (r?.ok) {
        await git(o.staging, ['update-ref', `refs/vault-remote/threads/${id}`, oid])
        report.pushed++
      } else if (!r || r.why === 'unreachable') throw new VaultError('git push: the vault did not answer') // i18n-ignore: for the log
      else if (r.why === 'refused' && o.hub && (await hubHolds(book, id, o.machine))) {
        // With a hub on a machine, the hub's lease says who writes the thread (03): the vault's follows it.
        const led = await leases.steal(id, items.find((x) => x.thread === id)!.intent, { order: true })
        if (!led.ok) throw new VaultError('git push: the vault moved meanwhile') // i18n-ignore: for the log
        await git(o.staging, ['update-ref', `refs/vault-remote/threads/${id}`, oid])
        report.pushed++
      } else if (r.why === 'refused') report.elsewhere.push({ thread: id, holder: leases.seen(id)?.lease?.holder ?? null })
      else if (r.holder && r.holder !== o.machine) report.elsewhere.push({ thread: id, holder: r.holder })
      // Refused for another reason than its lease (the thread moved on the vault under this push): tried again later.
      else throw new VaultError('git push: the vault moved meanwhile') // i18n-ignore: for the log
    }
  }
  state.pushedAt = new Date().toISOString()
  state.error = null
  await writeState(o.staging, state)
  return report
}

/** This machine holds the thread's lease on its hub (03-sync-and-lease.md), as the weevbook last read or pushed it. */
async function hubHolds(book: string, thread: string, machine: string): Promise<boolean> {
  const r = await git(book, ['cat-file', 'blob', `refs/hub/leases/${thread}:lease.json`], { allowFail: true })
  return r.code === 0 && parseLease(r.out.toString())?.holder === machine
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

/** The SHA-256 the journal's last `handoff` event records for handoff.md (null: no handoff yet). */
function lastHandoff(journal: Buffer): string | null {
  if (!journal.includes('"type":"handoff"')) return null
  for (const line of journal.toString().split('\n').reverse()) {
    if (!line.includes('"type":"handoff"')) continue
    try {
      const e = JSON.parse(line) as { type?: string; sha256?: unknown }
      if (e.type === 'handoff' && typeof e.sha256 === 'string') return e.sha256
    } catch {
      /* a cut line */
    }
  }
  return null
}

/** A thread's journal as the vault holds it at `tip`: its chunks opened and joined, checked against the manifest. */
async function readJournal(o: VaultOptions, id: string, tip: string): Promise<{ m: Manifest; journal: Buffer }> {
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
  return { m, journal }
}

/**
 * Fetches the vault and decrypts every journal, attachment and handoff.md into the local weevbook. On a machine that
 * already has threads it merges, thread by thread: the same journal is left alone, a longer one here stays (this
 * machine pushes it next), a shorter one here is completed, and one that differs is left out and counted.
 */
export async function restoreVault(o: VaultOptions, only: { only?: string } = {}): Promise<RestoreReport> {
  await openStaging(o.staging)
  const unlock = await lockStaging(o.staging)
  try {
    return await restore(o, only.only)
  } finally {
    await unlock()
  }
}

/** `only`: that thread alone (a resume brings its journal up to date; the others wait for a restore). */
async function restore(o: VaultOptions, only?: string): Promise<RestoreReport> {
  await fetchRemote(o)
  const remote = await refsUnder(o.staging, 'refs/vault-remote/threads/')
  if (only) for (const id of [...remote.keys()]) if (id !== only) remote.delete(id)
  const book = await Weevbook.open(o.dir, o.machine)
  const report: RestoreReport = { threads: remote.size, restored: 0, same: 0, ahead: 0, differ: [], main: null }
  const state = await readState(o.staging)
  const idx = path.join(o.staging, `restore-index-${process.pid}`)
  const staged = await refsUnder(o.staging, 'refs/threads/')
  const here = await refsUnder(book.gitDir, 'refs/threads/')
  for (const [id, tip] of remote) {
    // Built from, or already checked against, this very commit of the weevbook: nothing to read again.
    if (here.has(id) && staged.get(id) === tip && state.threads[id] === here.get(id)) {
      report.same++
      continue
    }
    const { m, journal } = await readJournal(o, id, tip)
    // handoff.md comes back when the vault holds the one this journal last recorded.
    const want = lastHandoff(journal)
    const sealedH = want && m.handoff === want ? await git(o.staging, ['cat-file', 'blob', `${tip}:h`], { allowFail: true }) : null
    const kept = sealedH?.code === 0 ? want : null
    if (!(await book.lockWait())) throw new Locked('weevbook.lock')
    let wrote = false
    try {
      const mine = await book.threadRef(id)
      const have = mine ? (await git(book.gitDir, ['cat-file', 'blob', `${mine}:events.jsonl`], { allowFail: true })).out : Buffer.alloc(0)
      const haveFiles = new Set(mine ? (await text(book.gitDir, ['ls-tree', '-r', '--name-only', mine, '--', 'attachments/'])).split('\n').filter(Boolean) : [])
      const missing = Object.keys(m.attachments).filter((f) => !haveFiles.has(f))
      const haveHandoff = mine ? await git(book.gitDir, ['cat-file', 'blob', `${mine}:handoff.md`], { allowFail: true }) : null
      const needHandoff = !!kept && !(haveHandoff?.code === 0 && sha256(haveHandoff.out) === kept)
      const equal = have.equals(journal)
      if (equal && !missing.length && !needHandoff) {
        report.same++
        // Checked once: the next restore and the next push pass over it (unless this machine holds files the vault lacks).
        if (mine && haveFiles.size === Object.keys(m.attachments).length) {
          await git(o.staging, ['update-ref', `refs/threads/${id}`, tip])
          state.threads[id] = mine
        }
      } else if (!equal && have.length >= journal.length && have.subarray(0, journal.length).equals(journal) && !missing.length) report.ahead++
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
        if (needHandoff) {
          const plain = open(o.key, id, 'h', sealedH!.out)
          if (sha256(plain) !== kept) throw new VaultError(`handoff.md of ${id} does not match its manifest`) // i18n-ignore: technical error
          await add('handoff.md', plain)
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
  /** Step 3: threads whose raw lines, and whose checkpoint, are not in the vault yet. */
  rawPending: number
  checkpointsPending: number
}

export async function vaultStatus(o: { dir: string; staging: string; remote: string; key: boolean }): Promise<VaultStatus> {
  const book = path.join(path.resolve(o.dir), '.git')
  const sources = fs.existsSync(path.join(book, 'HEAD')) ? await refsUnder(book, 'refs/threads/') : new Map<string, string>()
  const has = fs.existsSync(path.join(o.staging, 'HEAD'))
  const state: State = has ? await readState(o.staging) : { threads: {} }
  const lines = await readLines(o.staging)
  const remote = has ? await refsUnder(o.staging, 'refs/vault-remote/threads/') : new Map<string, string>()
  const local = has ? await refsUnder(o.staging, 'refs/threads/') : new Map<string, string>()
  let pending = 0
  let rawPending = 0
  for (const [id, src] of sources) {
    if (state.threads[id] !== src || local.get(id) !== remote.get(id)) pending++
    if (lines.raw[id] !== src) rawPending++
  }
  let checkpointsPending = 0
  if (sources.size) for (const [id, tip] of await refsUnder(book, 'refs/checkpoints/')) if (lines.checkpoints[id] !== tip) checkpointsPending++
  return { remote: o.remote, key: o.key, threads: sources.size, pending, remoteThreads: remote.size, pushedAt: state.pushedAt ?? null, error: state.error ?? null, rawPending, checkpointsPending }
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
  /** Step 3 (VaultOptions): this machine's keys for the raw repositories, the path of `gh`, the sizes. */
  keyDir?: string
  gh?: string
  rollBytes?: number
  bundleMax?: number
  /** A thread's raw lines go once its last commit is this old: between turns, not while one is written (2 min). */
  rawQuietMs?: number
  /** Where `gh` is signed in: a round at least this often even when nothing moved here, so that a machine that
   *  joined gets its access to the raw repositories within that time (15 min). */
  idleMs?: number
  /** This machine syncs with a hub (VaultOptions.hub). */
  hub?: boolean
  /** The clock (tests). */
  now?: () => number
  /** The priority of the process that pushes the raw lines and the checkpoints: 19, the lowest (a test that waits
   *  for it beside a whole suite runs it at 0). */
  priority?: number
}

/**
 * weevilsd's vault pusher: every `intervalMs` it looks at the weevbook's thread and checkpoint refs (one git command),
 * and pushes when they changed since the last push (the writer's turn commits, the hub's adoptions, a backfill).
 * Journals go at once, from here. The raw lines (a thread's, once it has been quiet for `rawQuietMs`) and the
 * checkpoints go from a process of their own at the lowest priority (vault-worker.ts): megabytes are read, slimmed
 * and sealed there, never in the app's loop, and the journals never wait for them. Errors are logged once and never
 * thrown into the app's loop.
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
  /** The raw lines and checkpoints: when those that waited for quiet are due, when a round last ran for them, the
   *  process at work, its last error. */
  let dueAt = 0
  let ranAt = 0
  let linesFailedAt = 0
  let linesError = ''
  let worker: ChildProcess | null = null
  let working: Promise<void> = Promise.resolve()
  const clock = o.now ?? Date.now
  const gh = o.gh ? ghRunner(o.gh, 20_000) : null
  const idleMs = gh ? (o.idleMs ?? 15 * 60_000) : 0
  const rawQuietMs = o.rawQuietMs ?? 120_000
  /** Step 4: this machine's leases on the vault. One client for the life of the pusher: it remembers what it holds. */
  let leases: LeaseClient | null = null
  let leasesRead = false
  let leasesAt = 0
  let leaseError = ''
  const elsewhere = new Set<string>()

  /** The working leases of this machine, renewed every five minutes while their turn runs (vault-lease.ts). */
  async function renew(now: number) {
    try {
      const key = leases ? null : readKey(o.keyFile)
      if (!leases && key) leases = vaultLeases({ staging: o.staging, remote: o.remote, key, machine: o.machine, ssh: o.ssh, now: clock })
      if (!leases) return
      // After a start, what this machine holds is read from the vault once (again five minutes later when it is away).
      if (!leasesRead && now - leasesAt >= retryMs) {
        leasesAt = now
        await openStaging(o.staging)
        const unlock = await lockStaging(o.staging)
        try {
          leasesRead = !!(await leases.readAll(true))
        } finally {
          await unlock()
        }
      }
      const r = await renewVaultLeases({ dir: o.dir, staging: o.staging, machine: o.machine, now: clock }, leases)
      for (const l of r.lost) log(`[vault] ${l.thread} continues on ${l.to ?? 'another machine'}: this machine no longer writes it to the vault`)
      leaseError = ''
    } catch (e) {
      if (e instanceof Locked) return
      const msg = (e as Error)?.message ?? String(e)
      if (msg !== leaseError) log(`[vault] leases: ${msg}`)
      leaseError = msg
    }
  }

  async function snapshot() {
    if (!fs.existsSync(path.join(book, 'HEAD'))) return ''
    return sha256(await text(book, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/threads/', 'refs/checkpoints/']))
  }

  /** The raw lines and the checkpoints, in their own process. One at a time; its report is logged when it ends. */
  function lines() {
    if (worker || stopped) return
    const job: LinesJob = { dir: o.dir, staging: o.staging, remote: o.remote, keyFile: o.keyFile, machine: o.machine, ssh: o.ssh, keyDir: o.keyDir, gh: o.gh, rollBytes: o.rollBytes, bundleMax: o.bundleMax, rawQuietMs, at: clock() }
    // Its own process group: stopping the pusher stops it with the git commands it runs.
    const child = spawn(process.execPath, [...process.execArgv, path.join(path.dirname(fileURLToPath(import.meta.url)), 'vault-worker.ts'), JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    worker = child
    if (child.pid) {
      try {
        os.setPriority(child.pid, o.priority ?? 19)
      } catch {
        /* not allowed: it runs at the normal priority */
      }
    }
    let out = ''
    let err = ''
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
    working = new Promise<void>((resolve) => {
      const done = (problem: string | null) => {
        if (worker !== child) return
        worker = null
        let late = problem
        try {
          const r = JSON.parse(out) as LinesReport
          if (r.raw.pushed) log(`[vault] raw lines: ${r.raw.pushed} threads in ${r.raw.pushes} pushes (${(r.raw.bytes / 1e6).toFixed(1)} MB sealed)${r.raw.differ.length ? ` · ${r.raw.differ.length} differ from the vault` : ''}`)
          if (r.checkpoints.pushed) log(`[vault] checkpoints: ${r.checkpoints.pushed} threads (${r.checkpoints.sent} bundles, ${(r.checkpoints.bytes / 1e6).toFixed(1)} MB sealed)`)
          for (const k of r.checkpoints.skipped) log(`[vault] checkpoint of ${k.thread} is ${(k.bytes / 1e6).toFixed(0)} MB, over the limit: not sent, this thread can only continue on this machine`)
          if (r.raw.later !== undefined) dueAt = clock() + r.raw.later + 1000
          late = r.raw.error ?? r.checkpoints.error ?? r.raw.failed[0]?.error ?? r.checkpoints.failed[0]?.error ?? null
          // Lines that wait for a raw repository this machine can write (the machine signed in to GitHub gives the
          // access at its next round): looked at again later, without a word.
          if (!late && r.raw.noRepo && !r.raw.pushed) {
            linesFailedAt = clock()
            return resolve()
          }
        } catch {
          late ??= err.trim().split('\n').at(-1) || 'the push of the raw lines stopped'
        }
        // What the lines or the code could not do is said once, and tried again later. The journals went all the same.
        if (late && !stopped) {
          linesFailedAt = clock()
          if (late !== linesError) log(`[vault] ${late}`)
          linesError = late
        } else if (!late) {
          linesFailedAt = 0
          linesError = ''
        }
        resolve()
      }
      child.on('error', (e) => done(e.message))
      child.on('exit', (code) => done(code ? `the push of the raw lines stopped (${code})` : null))
    })
  }

  function round() {
    if (busy || stopped) return
    busy = true
    idle = (async () => {
      try {
        const snap = await snapshot()
        if (!snap) return
        const now = clock()
        // 0. The leases of the turns that run here.
        await renew(now)
        // 1. The journals, when the refs moved (or after a failure, once `retryMs` passed).
        if ((snap !== last || failedAt) && !(failedAt && now - failedAt < retryMs)) {
          const key = readKey(o.keyFile)
          if (!key) throw new VaultError(`no vault key in ${o.keyFile}: run weevils weevbook vault setup or vault restore`) // i18n-ignore: log line
          const r = await pushVault({ dir: o.dir, staging: o.staging, remote: o.remote, key, machine: o.machine, ssh: o.ssh, raw: false, now: clock, hub: o.hub, ...(leases ? { leases } : {}) })
          for (const x of r.elsewhere) {
            if (!elsewhere.has(x.thread)) log(`[vault] ${x.thread} continues on ${x.holder ?? 'another machine'}: not pushed from here`)
            elsewhere.add(x.thread)
          }
          last = snap
          failedAt = 0
          lastError = ''
          dueAt ||= 1 // the lines and the code are looked at below
          if (r.sealed || r.pushed) log(`[vault] pushed ${r.pushed} refs (${r.sealed} threads, ${r.chunks} chunks, ${r.attachments} attachments)${r.differ.length ? ` · ${r.differ.length} threads differ from the vault` : ''}${r.failed.length ? ` · ${r.failed.length} threads unreadable (${r.failed[0].thread}: ${r.failed[0].error})` : ''}`)
        }
        // 2. The raw lines and the checkpoints: when the refs moved, when a thread that waited went quiet, after a
        //    failure, and, where the person signed in to GitHub, now and then even when nothing moved here: another
        //    machine may wait for its access to a raw repository (asked of `gh` itself, no network).
        if (worker || failedAt || (linesFailedAt && now - linesFailedAt < retryMs)) return
        let go = !!linesFailedAt
        if (!go && dueAt && now >= dueAt) {
          const d = await linesDue({ dir: o.dir, staging: o.staging, remote: o.remote, rawQuietMs, now })
          dueAt = d.later !== undefined ? now + d.later + 1000 : 0
          go = d.due
        }
        if (!go && gh && idleMs && now - ranAt >= idleMs) {
          ranAt = now
          go = (await gh(['auth', 'token'])).code === 0
        }
        if (go) {
          ranAt = now
          lines()
        }
      } catch (e) {
        if (e instanceof Locked) return
        failedAt = clock()
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
      if (worker?.pid) {
        try {
          process.kill(-worker.pid, 'SIGTERM')
        } catch {
          worker.kill()
        }
      }
    },
    /** One round now, to its end: the journals, then the raw lines and checkpoints when they are due. */
    async flush() {
      await idle
      await working
      round()
      await idle
      await working
    },
  }
}

/**
 * The pusher from the moment this machine has a vault: now, or as soon as `vault setup`, `vault restore` or a join
 * saves the remote and the key while weevilsd runs (weevboss sets the vault up in its chat: no restart).
 */
export function startVaultPusherWhenSet(o: Omit<PusherOptions, 'remote' | 'ssh' | 'keyDir'> & { remote: () => string | null; deployKey: string; pollMs?: number }) {
  const log = o.log ?? ((l: string) => console.error(l))
  let pusher: ReturnType<typeof startVaultPusher> | null = null
  let timer: NodeJS.Timeout | null = null
  const begin = () => {
    const remote = o.remote()
    if (!remote || !fs.existsSync(o.keyFile)) return false
    pusher = startVaultPusher({ ...o, remote, ssh: vaultSsh(o.deployKey), keyDir: path.dirname(o.deployKey) })
    log('[vault] pusher on')
    return true
  }
  if (!begin()) {
    timer = setInterval(() => {
      if (begin() && timer) clearInterval(timer)
    }, o.pollMs ?? 30_000)
    timer.unref?.()
  }
  return {
    started: () => !!pusher,
    stop() {
      if (timer) clearInterval(timer)
      pusher?.stop()
    },
  }
}

// ---------------------------------------------------------------- summary

/** What weevboss needs for its sentence once the history is in (docs/spec/07-vault.md, « The history »). */
export interface VaultSummary {
  /** This machine has a vault (a remote and its key). */
  vault: boolean
  /** Where the conversations live: `owner/repo` on GitHub, else the remote as it is. */
  remote: string | null
  conversations: number
  /** The machines they come from. */
  machines: string[]
  by_machine: Record<string, number>
  /** Provider accounts, by provider: { claude: 2, codex: 1 }. */
  accounts: Record<string, number>
  /** The oldest conversation's first day (ISO), null without any. */
  oldest: string | null
  /** Claude Code's own cleanup (30 days by default) likely cut the history: say "the last 30 days", never "everything". */
  claude_window: boolean
  /** This machine's first import: still reading its sessions, or done. */
  import: 'running' | 'done'
  /** Conversations of this machine not in the vault yet. */
  pending: number
  /** The vault was read just now (false: no vault, or it could not be reached: the numbers are this machine's last view). */
  fetched: boolean
}

interface Facts { tip: string; own: boolean; created: string; updated: string; engines: string[] }

/** `owner/repo` of a remote on github.com (null: another host, or a path). */
export const githubRepo = (remote: string) => /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote)?.[1] ?? null

/**
 * Every conversation this machine has and every one the vault holds from the other machines, counted once. The
 * vault's threads that are not here are opened in memory (nothing is written to the weevbook) and their few facts kept
 * by commit in the staging repository, so the next summary only reads what moved.
 */
export async function vaultSummary(o: { dir: string; staging: string; remote: string | null; key: Buffer | null; machine: string; ssh?: string; imported: boolean; now?: number; windowDays?: number; netMs?: number }): Promise<VaultSummary> {
  const now = o.now ?? Date.now()
  const book = path.join(path.resolve(o.dir), '.git')
  const facts = new Map<string, Omit<Facts, 'tip'>>()
  if (fs.existsSync(path.join(book, 'HEAD'))) {
    for (const r of await threadRefs(book)) facts.set(r.id, { own: ownTask(r.meta.title), created: r.meta.created, updated: r.meta.updated, engines: r.meta.legs.map((l) => l.engine) })
  }
  let fetched = false
  let pending = 0
  if (o.remote && o.key) {
    const vo: VaultOptions = { dir: o.dir, staging: o.staging, remote: o.remote, key: o.key, machine: o.machine, ssh: o.ssh, netMs: o.netMs ?? 60_000 }
    await openStaging(o.staging)
    try {
      const unlock = await lockStaging(o.staging)
      try {
        await fetchRemote(vo)
        fetched = true
      } finally {
        await unlock()
      }
    } catch {
      /* the pusher holds it, or the network is away: this machine's last view of the vault */
    }
    const file = path.join(o.staging, 'weevils-summary.json')
    let cache: Record<string, Facts> = {}
    try {
      cache = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, Facts>
    } catch {
      /* first summary */
    }
    const next: Record<string, Facts> = {}
    for (const [id, tip] of await refsUnder(o.staging, 'refs/vault-remote/threads/')) {
      if (facts.has(id)) continue
      let f = cache[id]?.tip === tip ? cache[id] : null
      if (!f) {
        const meta = deriveMeta(parseJournal((await readJournal(vo, id, tip)).journal.toString()).events)
        f = { tip, own: ownTask(meta.title), created: meta.created, updated: meta.updated, engines: meta.legs.map((l) => l.engine) }
      }
      next[id] = f
      facts.set(id, f)
    }
    await fsp.writeFile(file, JSON.stringify(next)).catch(() => undefined)
    pending = (await vaultStatus({ dir: o.dir, staging: o.staging, remote: o.remote, key: true })).pending
  }
  const byMachine = new Map<string, number>()
  const accounts = new Map<string, Set<string>>()
  let conversations = 0
  let oldest: string | null = null
  let claudeQuietest = Infinity
  for (const f of facts.values()) {
    if (f.own || !f.created) continue
    conversations++
    if (!oldest || f.created < oldest) oldest = f.created
    const seen = new Set<string>()
    let claude = false
    for (const e of f.engines) {
      const p = parseEngine(e)
      if (!p) continue
      seen.add(p.machine)
      if (p.provider === 'claude') claude = true
      if (!accounts.has(p.provider)) accounts.set(p.provider, new Set())
      accounts.get(p.provider)!.add(p.account)
    }
    for (const m of seen) byMachine.set(m, (byMachine.get(m) ?? 0) + 1)
    if (claude) claudeQuietest = Math.min(claudeQuietest, Date.parse(f.updated) || Infinity)
  }
  // Claude Code deletes a session `cleanupPeriodDays` (30) after its last line: when the Claude conversation that has
  // been quiet the longest is about that old, older ones were very likely deleted before weevils could read them.
  const window = o.windowDays ?? 30
  const quiet = (now - claudeQuietest) / 86_400_000
  const machines = [...byMachine.keys()].sort((a, b) => (byMachine.get(b)! - byMachine.get(a)!) || (a < b ? -1 : 1))
  return {
    vault: !!(o.remote && o.key),
    remote: o.remote ? (githubRepo(o.remote) ?? o.remote) : null,
    conversations,
    machines,
    by_machine: Object.fromEntries(machines.map((m) => [m, byMachine.get(m)!])),
    // An account weevils could not name (signed out when its sessions were read) counts only when it is the only one.
    accounts: Object.fromEntries([...accounts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, set]) => [p, Math.max(1, [...set].filter((a) => a !== 'unknown').length)])),
    oldest,
    claude_window: Number.isFinite(quiet) && quiet >= window - 7 && quiet <= window + 3,
    import: o.imported ? 'done' : 'running',
    pending,
    fetched,
  }
}
