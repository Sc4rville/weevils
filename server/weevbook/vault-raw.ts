// The vault, step 3 (docs/spec/07-vault.md): the provider's own lines and the code's checkpoints, encrypted, and
// fetched back for one thread when it is resumed on a machine that never ran it.
//
//   weevbook-raw-NNN   refs/raw/<thread>          → m (the manifest) + c/<sha256>: per raw segment, the bytes appended
//                                                   since the last push, slim (slim.ts), compressed, sealed, immutable
//   weevbook-vault     refs/map/raw               → one sealed file per write: which raw repository holds which thread,
//                                                   which repositories exist, each machine's key for each of them and
//                                                   whether it was given access, the bytes each machine pushed
//                      refs/checkpoints/<thread>  → m + b/<sha256>: git bundles of the thread's checkpoint commits,
//                                                   each one without what the bundles before it and the project's own
//                                                   origin already hold, sealed
//
// Access (« Access to GitHub »). GitHub takes a deploy key on one repository only, so each machine has one key per raw
// repository (CONFIG_DIR/vault-deploy-raw-NNN). A machine writes the public half of its key for every raw repository,
// and for the next one, in the map; the machine where the person signed in with `gh` makes a repository when the map
// has none or the last one passed its size, and registers every key the map holds. Nobody is asked anything. A vault
// in a folder (a path, as the tests and a home server use) needs no key: the next repository is a folder beside it.
//
// Nothing here reads or writes the weevbook's folders or takes its lock: sources are the commits of its thread refs.
// The journals (vault.ts) and these are pushed apart, each under its own lock and with its own record of what went
// (weevils-lines.json in the staging repository): in weevilsd the journals go from the app's process, the lines and
// the code from a process of their own at the lowest priority (vault-worker.ts), and neither waits for the other.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hubRef, originNote, projectRef } from './checkpoint.ts'
import { runGit } from './gitrun.ts'
import { parseEngine, type Provider } from './journal.ts'
import { slimRaw } from './slim.ts'
import { Locked } from './store.ts'
import { addDeployKey, ghLogin, type Gh } from './vault-github.ts'
import { claimLease, releaseLease, type Claim } from './vault-lease.ts'
import { NEUTRAL, VaultError, git, githubRepo, isAncestor, lockStaging, mktree, open, openStaging, pushVault, refsUnder, restoreVault, revParse, seal, sealLarge, sha256, text, vaultSsh, writeBlob, type VaultOptions } from './vault.ts'

/** A raw repository that passed this gets no new thread (under GitHub's 1 GB recommendation, VAULT-7). */
export const ROLL_BYTES = 700_000_000
/** A checkpoint bundle over this stays on its machine. */
export const BUNDLE_MAX = 50 << 20
/** One push carries at most this many sealed bytes and refs. */
const GROUP_BYTES = 48 << 20
const GROUP_REFS = 100
/** Threads given a raw repository in one write of the map, at most. */
const WINDOW_THREADS = 200
/** A thread whose turn never goes quiet has its raw lines sent this often all the same. */
const RAW_EVERY = 15 * 60_000
/** How long the answer of `gh api user` is kept. */
const LOGIN_FOR = 10 * 60_000

const RAW_FILE = /^(L[1-9]\d*)\.(claude|codex)\.(\d{4})\.jsonl$/
const MAP_REF = 'refs/map/raw'
const MAP_TRACK = 'refs/vault-remote/map/raw'
/** What stands for the thread id in the map's associated data. */
const MAP_ID = 'raw-map'
const pad = (n: number) => String(n).padStart(3, '0')
const sshEnv = (ssh?: string): Record<string, string> => (ssh ? { GIT_SSH_COMMAND: ssh } : {})
const yieldNow = () => new Promise<void>((r) => setImmediate(r))

// ---------------------------------------------------------------- what went, on this machine

/** What this machine pushed of the raw lines and the checkpoints (the staging repository's weevils-lines.json). */
interface State {
  /** By thread: the weevbook commit whose raw lines are in the vault (sealed and pushed). */
  raw: Record<string, string>
  /** By thread: when its raw lines last went (ms): a turn that never goes quiet is still sent now and then. */
  rawAt: Record<string, number>
  /** By thread: the checkpoint commit (refs/checkpoints/<id> of the weevbook) that is in the vault, or was too large. */
  checkpoints: Record<string, string>
  /** By raw repository: the sealed bytes this machine pushed to it, and what it last wrote of that in the map. */
  rawBytes: Record<string, number>
  rawTold: Record<string, number>
}
const linesFile = (staging: string) => path.join(staging, 'weevils-lines.json')
export async function readLines(staging: string): Promise<State> {
  const empty: State = { raw: {}, rawAt: {}, checkpoints: {}, rawBytes: {}, rawTold: {} }
  try {
    return { ...empty, ...(JSON.parse(await fsp.readFile(linesFile(staging), 'utf8')) as Partial<State>) }
  } catch {
    return empty
  }
}
async function writeState(staging: string, s: State) {
  const tmp = `${linesFile(staging)}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(s))
  await fsp.rename(tmp, linesFile(staging))
}

/** When a thread was made: the time its id holds (a ULID). */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function born(id: string): number {
  let t = 0
  for (const c of id.slice(0, 10)) t = t * 32 + B32.indexOf(c)
  return t > 0 && Number.isFinite(t) ? t : 0
}

// ---------------------------------------------------------------- where the raw repositories are

type Host = { kind: 'github'; owner: string } | { kind: 'path' } | null
function hostOf(remote: string): Host {
  const gh = githubRepo(remote)
  if (gh) return { kind: 'github', owner: gh.split('/')[0] }
  return path.isAbsolute(remote) ? { kind: 'path' } : null
}
export const rawRepoName = (n: number) => `weevbook-raw-${pad(n)}`
/** The n-th raw repository: beside the vault, under the same owner or in the same folder. */
export const rawRemote = (remote: string, n: number) => remote.replace(/[^/:]+?(\.git)?\/?$/, (_m, ext?: string) => `${rawRepoName(n)}${ext ?? ''}`)
/** `main` of a raw repository: what it is, and nothing else. */
const RAW_README = `# weevbook-raw

This repository holds part of an encrypted copy of conversations kept by weevils (https://github.com/Sc4rville/weevils):
what the AI tools themselves wrote. Nothing here is readable without the vault key, which never leaves the person's
machines. Do not edit it by hand.
`
const keyFile = (keyDir: string, n: number) => path.join(keyDir, `vault-deploy-raw-${pad(n)}`)
/** The ssh git uses for the n-th raw repository: this machine's key for that repository only. */
function rawSsh(o: VaultOptions, n: number): string | undefined {
  if (hostOf(o.remote)?.kind !== 'github' || !o.keyDir) return o.ssh
  return vaultSsh(keyFile(o.keyDir, n))
}

/** The public half of this machine's key for the n-th raw repository, made the first time (null: no ssh-keygen). */
async function myKey(keyDir: string, n: number): Promise<string | null> {
  const file = keyFile(keyDir, n)
  if (!fs.existsSync(file) || !fs.existsSync(`${file}.pub`)) {
    await fsp.mkdir(keyDir, { recursive: true, mode: 0o700 })
    await fsp.rm(file, { force: true })
    await fsp.rm(`${file}.pub`, { force: true })
    const failed = await new Promise<boolean>((resolve) => execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'weevils-vault', '-f', file], (e) => resolve(!!e)))
    if (failed) return null
  }
  return (await fsp.readFile(`${file}.pub`, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
}

// ---------------------------------------------------------------- the map

type Rec =
  /** The n-th raw repository exists. */
  | { k: 'repo'; n: number }
  /** A thread's raw lines live in the n-th repository, for good. */
  | { k: 'thread'; t: string; n: number }
  /** The sealed bytes machine `m` pushed to the n-th repository so far. */
  | { k: 'bytes'; n: number; m: string; b: number }
  /** Machine `m`'s public key for the n-th repository, and that key registered on it. */
  | { k: 'key'; n: number; m: string; pub: string }
  | { k: 'access'; n: number; m: string; pub: string }

export interface RawMap {
  tip: string | null
  /** The map's files: name → blob. */
  files: Map<string, string>
  repos: Set<number>
  threads: Map<string, number>
  bytes: Map<number, Map<string, number>>
  keys: Map<number, Map<string, Set<string>>>
  access: Set<string>
}

const emptyMap = (): RawMap => ({ tip: null, files: new Map(), repos: new Set(), threads: new Map(), bytes: new Map(), keys: new Map(), access: new Set() })
const accessKey = (n: number, pub: string) => `${n} ${pub}`

function fold(map: RawMap, recs: readonly Rec[]) {
  for (const r of recs) {
    if (r.k === 'repo') map.repos.add(r.n)
    // Written once, by the machine that pushed the map first; were there ever two, every machine reads the same one.
    else if (r.k === 'thread') map.threads.set(r.t, Math.min(r.n, map.threads.get(r.t) ?? r.n))
    else if (r.k === 'bytes') {
      const by = map.bytes.get(r.n) ?? new Map<string, number>()
      by.set(r.m, Math.max(r.b, by.get(r.m) ?? 0))
      map.bytes.set(r.n, by)
    } else if (r.k === 'key') {
      const by = map.keys.get(r.n) ?? new Map<string, Set<string>>()
      by.set(r.m, (by.get(r.m) ?? new Set<string>()).add(r.pub))
      map.keys.set(r.n, by)
    } else if (r.k === 'access') map.access.add(accessKey(r.n, r.pub))
  }
}

/** Several blobs in one git process. */
async function blobs(gitDir: string, oids: string[]): Promise<Buffer[]> {
  if (!oids.length) return []
  const out = (await git(gitDir, ['cat-file', '--batch'], { input: `${oids.join('\n')}\n` })).out
  const res: Buffer[] = []
  let pos = 0
  for (const oid of oids) {
    const nl = out.indexOf(10, pos)
    const head = out.subarray(pos, nl).toString().split(' ')
    if (nl < 0 || head[1] !== 'blob') throw new VaultError(`${oid} is missing from the vault's copy here`) // i18n-ignore: technical error
    const size = Number(head[2])
    res.push(out.subarray(nl + 1, nl + 1 + size))
    pos = nl + 1 + size + 1
  }
  return res
}

/** The records of the map's files already opened in this process, by blob. */
const opened = new Map<string, Rec[]>()

/** The raw map as this machine last fetched it (fetchRemote of vault.ts, or fetchMap). */
export async function readMap(o: Pick<VaultOptions, 'staging' | 'key'>): Promise<RawMap> {
  const map = emptyMap()
  map.tip = await revParse(o.staging, MAP_TRACK)
  if (!map.tip) return map
  for (const l of (await text(o.staging, ['ls-tree', map.tip])).split('\n')) {
    if (!l) continue
    const [meta, name] = l.split('\t')
    map.files.set(name, meta.split(' ')[2])
  }
  const todo = [...new Set(map.files.values())].filter((oid) => !opened.has(oid))
  const got = await blobs(o.staging, todo)
  todo.forEach((oid, i) => opened.set(oid, JSON.parse(open(o.key, MAP_ID, 'x', got[i]).toString()) as Rec[]))
  for (const oid of map.files.values()) fold(map, opened.get(oid)!)
  return map
}

/** Adds records to the map and pushes it: on the vault's tip or not at all (another machine wrote it first: the next
 *  round reads theirs and decides again). */
async function addToMap(o: VaultOptions, map: RawMap, recs: Rec[]): Promise<RawMap> {
  if (!recs.length) return map
  const sealed = seal(o.key, MAP_ID, 'x', Buffer.from(JSON.stringify(recs)))
  const name = sha256(sealed)
  const oid = await writeBlob(o.staging, sealed)
  const tree = await mktree(o.staging, [...[...map.files].map(([n, b]) => `100644 blob ${b}\t${n}`), `100644 blob ${oid}\t${name}`])
  const commit = await text(o.staging, ['commit-tree', tree, ...(map.tip ? ['-p', map.tip] : []), '-m', 'vault'], { env: NEUTRAL })
  const r = await git(o.staging, ['push', '-q', '--no-verify', o.remote, `${commit}:${MAP_REF}`], { env: sshEnv(o.ssh), timeoutMs: o.netMs ?? 120_000, allowFail: true })
  if (r.code) throw new VaultError(`the vault's map was not written (another machine wrote it meanwhile, or the vault did not answer): ${r.err.trim().split('\n').at(-1) ?? ''}`) // i18n-ignore: log line
  await git(o.staging, ['update-ref', MAP_TRACK, commit])
  opened.set(oid, recs)
  map.tip = commit
  map.files.set(name, oid)
  fold(map, recs)
  return map
}

const logins = new WeakMap<Gh, { at: number; login: string | null }>()
/** The GitHub account `gh` is signed in with here, asked at most every ten minutes. */
async function loginOf(gh: Gh, now: number): Promise<string | null> {
  const known = logins.get(gh)
  if (known && now - known.at < LOGIN_FOR) return known.login
  const login = await ghLogin(gh).catch(() => null)
  logins.set(gh, { at: now, login })
  return login
}

/** A raw repository that was just made gets its `main`: a README (a repository with no branch looks broken on
 *  github.com). Best effort: the lines do not need it. */
async function readme(o: VaultOptions, n: number) {
  const blob = await writeBlob(o.staging, Buffer.from(RAW_README))
  const commit = await text(o.staging, ['commit-tree', await mktree(o.staging, [`100644 blob ${blob}\tREADME.md`]), '-m', 'vault'], { env: NEUTRAL })
  await git(o.staging, ['push', '-q', '--no-verify', rawRemote(o.remote, n), `${commit}:refs/heads/main`], { env: sshEnv(rawSsh(o, n)), timeoutMs: o.netMs ?? 120_000, allowFail: true })
}

/** The sealed bytes the n-th repository holds: what the other machines wrote in the map, and this machine's count. */
function held(map: RawMap, state: State, machine: string, n: number): number {
  let sum = Math.max(state.rawBytes[n] ?? 0, map.bytes.get(n)?.get(machine) ?? 0)
  for (const [m, b] of map.bytes.get(n) ?? []) if (m !== machine) sum += b
  return sum
}

/**
 * What every push does for access, before any raw line goes: this machine's keys written in the map (one for each raw
 * repository, one for the next), and, where it can, the next repository made when there is none or the last one is
 * full, and every key the map holds registered on its repository.
 */
async function upkeep(o: VaultOptions, map: RawMap, state: State, now: number): Promise<RawMap> {
  const host = hostOf(o.remote)
  if (!host) return map
  const recs: Rec[] = []
  const last = Math.max(0, ...map.repos)
  const next = last === 0 || held(map, state, o.machine, last) >= (o.rollBytes ?? ROLL_BYTES) ? last + 1 : 0
  if (host.kind === 'path') {
    if (next) {
      const dir = rawRemote(o.remote, next)
      if (!fs.existsSync(path.join(dir, 'HEAD'))) {
        await fsp.mkdir(dir, { recursive: true })
        await git(dir, ['init', '-q', '--bare', '--initial-branch=main'])
        await readme(o, next)
      }
      recs.push({ k: 'repo', n: next })
    }
    return addToMap(o, map, recs)
  }
  if (!o.keyDir) return map
  // One for each repository there is, and one for the next: when that one opens, every machine can write it at once.
  for (let n = 1; n <= Math.max(last, next) + 1; n++) {
    const pub = await myKey(o.keyDir, n)
    if (!pub) break
    if (!map.keys.get(n)?.get(o.machine)?.has(pub)) recs.push({ k: 'key', n, m: o.machine, pub })
  }
  // With `gh` signed in as the vault's owner: the repositories and the keys. Asked only when there is something to do.
  const view = emptyMap()
  fold(view, [...[...map.keys].flatMap(([n, by]) => [...by].flatMap(([m, pubs]) => [...pubs].map((pub): Rec => ({ k: 'key', n, m, pub })))), ...recs])
  const waiting = (n: number) => [...(view.keys.get(n) ?? [])].flatMap(([m, pubs]) => [...pubs].filter((pub) => !map.access.has(accessKey(n, pub))).map((pub) => ({ m, pub })))
  const repos = [...map.repos, ...(next ? [next] : [])]
  if (o.gh && (next || repos.some((n) => waiting(n).length)) && (await loginOf(o.gh, now)) === host.owner) {
    for (const n of repos) {
      const repo = `${host.owner}/${rawRepoName(n)}`
      let made = false
      if (n === next) {
        if ((await o.gh(['repo', 'view', repo, '--json', 'name'])).code !== 0) {
          const r = await o.gh(['repo', 'create', repo, '--private', '--description', 'Encrypted copy kept by weevils'])
          if (r.code) throw new VaultError(`gh repo create: ${(r.err || r.out).trim()}`) // i18n-ignore: gh's own error
          made = true
        }
        recs.push({ k: 'repo', n })
      }
      for (const w of waiting(n)) {
        await addDeployKey(o.gh, repo, w.m, w.pub)
        recs.push({ k: 'access', n, m: w.m, pub: w.pub })
      }
      if (made) await readme(o, n)
    }
  }
  return addToMap(o, map, recs)
}

/** Whether this machine can write the n-th raw repository: it exists, and this machine's key was registered on it. */
function writable(o: VaultOptions, map: RawMap): (n: number) => Promise<boolean> {
  const host = hostOf(o.remote)
  const known = new Map<number, boolean>()
  return async (n: number) => {
    if (!map.repos.has(n)) return false
    if (host?.kind !== 'github' || !o.keyDir) return true
    if (!known.has(n)) {
      const pub = await myKey(o.keyDir, n)
      known.set(n, !!pub && map.access.has(accessKey(n, pub)))
    }
    return known.get(n)!
  }
}

// ---------------------------------------------------------------- raw lines, pushed

interface RawManifest {
  v: 1
  thread: string
  /** By raw segment (`L1.claude.0001.jsonl`): how much of the source is in the vault, and its slim chunks in order. */
  files: Record<string, { src: { b: number; h: string }; chunks: { n: string; b: number }[] }>
}

export interface RawReport {
  /** Threads whose new lines were sealed, the chunks made, their sealed bytes. */
  sealed: number
  chunks: number
  bytes: number
  /** Pushes to raw repositories (one per batch of refs), and refs sent. */
  pushes: number
  pushed: number
  /** Threads that wait: a turn still being written, or no raw repository this machine can write yet. */
  waiting: number
  noRepo: number
  /** How long until the first waiting thread is due (ms). */
  later?: number
  differ: string[]
  failed: { thread: string; error: string }[]
  /** Raw repositories the map lists. */
  repos: number
  error?: string
}

/** How the source's bytes before `b` are recognised next time: the hash of the last 64 KB before it. */
const mark = (blob: Buffer, b: number) => sha256(blob.subarray(Math.max(0, b - (64 << 10)), b))

async function rawFiles(book: string, src: string): Promise<{ name: string; oid: string; size: number }[]> {
  const out: { name: string; oid: string; size: number }[] = []
  for (const l of (await text(book, ['ls-tree', '-r', '-l', src, '--', 'raw/'])).split('\n')) {
    if (!l) continue
    const [meta, file] = l.split('\t')
    const name = file.slice('raw/'.length)
    if (!RAW_FILE.test(name)) continue
    const [, , oid, size] = meta.split(/\s+/)
    out.push({ name, oid, size: Number(size) })
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** The machine each leg ran on, from the journal: the one that keeps the full lines. */
async function legMachines(book: string, src: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const r = await git(book, ['cat-file', 'blob', `${src}:events.jsonl`], { allowFail: true })
  if (r.code) return out
  for (const line of r.out.toString().split('\n')) {
    if (!line.includes('"type":"leg.start"')) continue
    try {
      const e = JSON.parse(line) as { type?: string; leg?: string; engine?: string }
      const m = e.type === 'leg.start' && e.leg && e.engine ? parseEngine(e.engine)?.machine : null
      if (m) out.set(e.leg!, m)
    } catch {
      /* a cut line */
    }
  }
  return out
}

async function treeEntries(gitDir: string, commit: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>()
  for (const l of (await text(gitDir, ['ls-tree', '-r', commit])).split('\n')) {
    if (!l) continue
    const [meta, name] = l.split('\t')
    entries.set(name, meta.split(' ')[2])
  }
  return entries
}

/** A commit whose tree is `m` and one folder of sealed files. */
async function commitOf(staging: string, entries: Map<string, string>, folder: 'c' | 'b', base: string | null): Promise<string> {
  const list = [...entries].filter(([k]) => k.startsWith(`${folder}/`)).map(([k, oid]) => `100644 blob ${oid}\t${k.slice(2)}`)
  const root = [`100644 blob ${entries.get('m')}\tm`, ...(list.length ? [`040000 tree ${await mktree(staging, list)}\t${folder}`] : [])]
  return text(staging, ['commit-tree', await mktree(staging, root), ...(base ? ['-p', base] : []), '-m', 'vault'], { env: NEUTRAL })
}

/** The commit to build on: this machine's, unless the remote's is not behind it (ahead, or another machine's). */
async function baseOf(staging: string, mine: string | null, theirs: string | null): Promise<string | null> {
  if (theirs && theirs !== mine && (!mine || !(await isAncestor(staging, theirs, mine)))) return theirs
  return mine
}

async function lsRemote(o: VaultOptions, remote: string, pattern: string, ssh?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const prefix = pattern.slice(0, -1)
  for (const l of (await text(o.staging, ['ls-remote', remote, pattern], { env: sshEnv(ssh), timeoutMs: o.netMs ?? 120_000 })).split('\n')) {
    const [oid, ref] = l.split('\t')
    if (ref?.startsWith(prefix)) out.set(ref.slice(prefix.length), oid)
  }
  return out
}

/** The refs of `ids` that the remote has and this machine does not have at that commit, fetched beside its own. */
async function fetchMoved(o: VaultOptions, remote: string, ssh: string | undefined, kind: 'raw' | 'checkpoints', ids: string[], theirs: Map<string, string>, tracked: Map<string, string>) {
  const need = ids.filter((id) => theirs.has(id) && tracked.get(id) !== theirs.get(id))
  for (let i = 0; i < need.length; i += GROUP_REFS) {
    const part = need.slice(i, i + GROUP_REFS)
    await git(o.staging, ['fetch', '-q', '--no-tags', remote, ...part.map((id) => `+refs/${kind}/${id}:refs/vault-remote/${kind}/${id}`)], { env: sshEnv(ssh), timeoutMs: o.netMs ?? 600_000 })
    for (const id of part) tracked.set(id, theirs.get(id)!)
  }
}

/** The sealed bytes a push of `commit` adds to what the remote holds at `have`. */
async function added(staging: string, commit: string, have: string | null): Promise<number> {
  return Number(await text(staging, ['rev-list', '--objects', '--disk-usage', commit, ...(have ? [`^${have}`] : [])], { allowFail: true })) || 0
}

export interface LinesReport { raw: RawReport; checkpoints: CheckpointsReport }
/** What weevilsd's pusher hands the process that pushes the raw lines and the checkpoints (vault-worker.ts). */
export interface LinesJob extends Omit<VaultOptions, 'key' | 'gh' | 'now' | 'progress'> {
  keyFile: string
  /** The path of `gh`. */
  gh?: string
  /** The pusher's clock when it started the job: what is due is decided at that time. */
  at?: number
}

const noRaw = (): RawReport => ({ sealed: 0, chunks: 0, bytes: 0, pushes: 0, pushed: 0, waiting: 0, noRepo: 0, differ: [], failed: [], repos: 0 })
const noCheckpoints = (): CheckpointsReport => ({ sent: 0, bytes: 0, pushes: 0, pushed: 0, skipped: [], failed: [] })

/**
 * The raw lines, then the checkpoints (step 3), one such push at a time on this machine. An error of one is in its
 * report and never keeps the other back.
 */
export async function pushLines(o: VaultOptions): Promise<LinesReport> {
  await openStaging(o.staging)
  let unlock: () => Promise<void>
  try {
    unlock = await lockStaging(o.staging, 'lines.lock')
  } catch (e) {
    if (!(e instanceof Locked)) throw e
    return { raw: { ...noRaw(), error: 'the raw lines are being pushed by another process of this machine: it goes on from there' }, checkpoints: noCheckpoints() } // i18n-ignore: log line
  }
  try {
    const state = await readLines(o.staging)
    const raw = await pushRaw(o, state)
    return { raw, checkpoints: await pushCheckpoints(o, state) }
  } finally {
    await unlock()
  }
}

/**
 * Seals what is new in every thread's raw lines and pushes it, a batch at a time: each batch is claimed in the map,
 * sealed, pushed, then recorded, so a push that is cut goes on from the last batch that arrived.
 */
async function pushRaw(o: VaultOptions, state: State): Promise<RawReport> {
  const report = noRaw()
  try {
    await raw(o, state, report)
  } catch (e) {
    if (e instanceof VaultError && /cannot decrypt/.test(e.message)) throw e
    report.error = (e as Error).message
  }
  await writeState(o.staging, state).catch(() => undefined)
  return report
}

/** The threads whose raw lines are due: their ref moved since they last went, and the turn is over (or they have
 *  waited long enough). `later`: how long until the first one that waits is due. */
async function dueRaw(book: string, state: State, o: { rawQuietMs?: number; rawEveryMs?: number }, now: number): Promise<{ due: { id: string; src: string }[]; waiting: number; later?: number }> {
  const due: { id: string; src: string }[] = []
  let waiting = 0
  let later: number | undefined
  const every = o.rawEveryMs ?? RAW_EVERY
  for (const l of (await text(book, ['for-each-ref', '--format=%(objectname) %(committerdate:unix) %(refname)', 'refs/threads/'])).split('\n')) {
    if (!l) continue
    const [src, at, ref] = l.split(' ')
    const id = ref.slice('refs/threads/'.length)
    if (state.raw[id] === src) continue
    const age = now - Number(at) * 1000
    // Still being written: after the turn, or now when its lines have waited long enough already (a thread whose
    // lines never went counts from when it was made).
    const since = now - (state.rawAt[id] ?? born(id))
    if (o.rawQuietMs && age < o.rawQuietMs && since < every) {
      waiting++
      later = Math.min(later ?? Infinity, o.rawQuietMs - age, every - since)
      continue
    }
    due.push({ id, src })
  }
  return { due, waiting, ...(later !== undefined ? { later } : {}) }
}

/**
 * Whether the raw lines or the checkpoints have something to send now (weevilsd's pusher asks before it starts the
 * process that sends them): two git commands and a small file, nothing sealed, nothing fetched.
 */
export async function linesDue(o: { dir: string; staging: string; remote: string; rawQuietMs?: number; rawEveryMs?: number; now?: number }): Promise<{ due: boolean; later?: number }> {
  const book = path.join(path.resolve(o.dir), '.git')
  if (!fs.existsSync(path.join(book, 'HEAD'))) return { due: false }
  const state = await readLines(o.staging)
  const code = [...(await refsUnder(book, 'refs/checkpoints/'))].some(([id, tip]) => state.checkpoints[id] !== tip)
  // A vault that is neither on GitHub nor in a folder takes no raw lines: only its checkpoints are ever due.
  if (!hostOf(o.remote)) return { due: code }
  const r = await dueRaw(book, state, o, o.now ?? Date.now())
  return { due: r.due.length > 0 || code, ...(r.later !== undefined ? { later: r.later } : {}) }
}

async function raw(o: VaultOptions, state: State, report: RawReport) {
  const book = path.join(path.resolve(o.dir), '.git')
  if (!fs.existsSync(path.join(book, 'HEAD'))) return
  const now = (o.now ?? Date.now)()
  const roll = o.rollBytes ?? ROLL_BYTES
  const done = state.raw
  const sentAt = state.rawAt
  const d = await dueRaw(book, state, o, now)
  const due = d.due
  report.waiting = d.waiting
  if (d.later !== undefined) report.later = d.later
  if (!hostOf(o.remote)) {
    report.noRepo = due.length
    return
  }
  let map = await upkeep(o, await fetchMap(o), state, now)
  report.repos = map.repos.size
  let can = writable(o, map)
  const tracked = await refsUnder(o.staging, 'refs/vault-remote/raw/')
  const remotes = new Map<number, Map<string, string>>()
  due.sort((a, b) => (a.id < b.id ? 1 : -1))

  /** What this machine pushed since it last said so in the map, once it is worth a line there. */
  const tally = (): Rec[] => Object.entries(state.rawBytes).filter(([n, b]) => b - (state.rawTold[n] ?? 0) >= roll / 32).map(([n, b]): Rec => ({ k: 'bytes', n: Number(n), m: o.machine, b }))
  const write = async (recs: Rec[]) => {
    map = await addToMap(o, map, recs)
    for (const r of recs) if (r.k === 'bytes') state.rawTold[r.n] = r.b
  }

  for (let i = 0; i < due.length; ) {
    // 1. A window of threads that have raw lines: a quarter of a repository's size at most, so that a repository
    //    never passes its size by more than that (VAULT-7).
    const win: { id: string; src: string; files: Awaited<ReturnType<typeof rawFiles>> }[] = []
    for (let source = 0; i < due.length && win.length < WINDOW_THREADS && source < roll / 4; i++) {
      const files = await rawFiles(book, due[i].src)
      if (!files.length) {
        done[due[i].id] = due[i].src
        sentAt[due[i].id] = now
      } else {
        win.push({ ...due[i], files })
        source += files.reduce((s, f) => s + f.size, 0)
      }
    }
    if (!win.length) break
    // 2. Where each one goes: the repository the map names, or the newest one this machine can write. A full one is
    //    followed by the next as soon as a machine that can make it sees it.
    let target = 0
    for (const n of [...map.repos].sort((a, b) => b - a)) {
      if (await can(n)) {
        target = n
        break
      }
    }
    if (target && held(map, state, o.machine, target) >= roll) {
      map = await upkeep(o, map, state, now)
      can = writable(o, map)
      const next = Math.max(0, ...map.repos)
      if (next !== target && (await can(next))) target = next
    }
    report.repos = map.repos.size
    const recs = tally()
    const go: (typeof win[number] & { n: number })[] = []
    for (const w of win) {
      let n = map.threads.get(w.id) ?? 0
      if (n ? !(await can(n)) : !target) {
        report.noRepo++
        continue
      }
      if (!n) recs.push({ k: 'thread', t: w.id, n: (n = target) })
      go.push({ ...w, n })
    }
    await write(recs)
    // 3. Sealed and pushed, one repository at a time, in groups of refs.
    for (const n of new Set(go.map((g) => g.n))) {
      const remote = rawRemote(o.remote, n)
      const ssh = rawSsh(o, n)
      const mineHere = go.filter((g) => g.n === n)
      if (!remotes.has(n)) remotes.set(n, await lsRemote(o, remote, 'refs/raw/*', ssh))
      const theirs = remotes.get(n)!
      await fetchMoved(o, remote, ssh, 'raw', mineHere.map((g) => g.id), theirs, tracked)
      let group: { id: string; src: string; oid: string }[] = []
      let bytes = 0
      const flush = async () => {
        if (!group.length) return
        await git(o.staging, ['push', '-q', '--atomic', '--no-verify', remote, ...group.map((g) => `${g.oid}:refs/raw/${g.id}`)], { env: sshEnv(ssh), timeoutMs: o.netMs ?? 600_000 })
        for (const g of group) {
          await git(o.staging, ['update-ref', `refs/vault-remote/raw/${g.id}`, g.oid])
          tracked.set(g.id, g.oid)
          theirs.set(g.id, g.oid)
          done[g.id] = g.src
          sentAt[g.id] = now
        }
        state.rawBytes[n] = (state.rawBytes[n] ?? 0) + bytes
        report.pushes++
        report.pushed += group.length
        await writeState(o.staging, state)
        o.progress?.(`raw: ${group.length} threads, ${(bytes / 1e6).toFixed(1)} MB → ${rawRepoName(n)}`) // i18n-ignore: progress of a command
        group = []
        bytes = 0
      }
      for (const g of mineHere) {
        try {
          const r = await sealRaw(o, book, g, tracked.get(g.id) ?? null)
          if (r.differ) report.differ.push(g.id)
          if (r.chunks) {
            report.sealed++
            report.chunks += r.chunks
          }
          if (!r.commit || r.commit === (tracked.get(g.id) ?? null)) {
            done[g.id] = g.src
            sentAt[g.id] = now
            continue
          }
          // What was sealed just now; for a commit sealed by a push that was cut, what git says it adds.
          const size = r.bytes || (await added(o.staging, r.commit, tracked.get(g.id) ?? null))
          report.bytes += size
          bytes += size
          group.push({ id: g.id, src: g.src, oid: r.commit })
        } catch (e) {
          if (e instanceof VaultError && /cannot decrypt/.test(e.message)) throw e
          report.failed.push({ thread: g.id, error: (e as Error).message })
        }
        if (bytes >= GROUP_BYTES || group.length >= GROUP_REFS) await flush()
      }
      await flush()
    }
    await writeState(o.staging, state)
  }
  await write(tally())
  report.repos = map.repos.size
}

/** One thread: the bytes appended to each raw segment since the vault's copy, slim, sealed as one chunk each. */
async function sealRaw(o: VaultOptions, book: string, g: { id: string; src: string; files: { name: string; oid: string; size: number }[] }, theirs: string | null): Promise<{ commit: string | null; chunks: number; bytes: number; differ: boolean }> {
  const mine = await revParse(o.staging, `refs/raw/${g.id}`)
  const base = await baseOf(o.staging, mine, theirs)
  const m: RawManifest = base ? (JSON.parse(open(o.key, g.id, 'rm', (await git(o.staging, ['cat-file', 'blob', `${base}:m`])).out).toString()) as RawManifest) : { v: 1, thread: g.id, files: {} }
  if (m.thread !== g.id) throw new VaultError(`raw manifest of ${g.id} names ${m.thread}`) // i18n-ignore: technical error
  const entries = base ? await treeEntries(o.staging, base) : new Map<string, string>()
  let legs: Map<string, string> | null = null
  let chunks = 0
  let bytes = 0
  let differ = false
  for (const f of g.files) {
    const had = m.files[f.name]
    // A segment only grows: the same size is the same bytes; a shorter one is a copy the vault is ahead of.
    if (had && f.size <= had.src.b) continue
    const blob = (await git(book, ['cat-file', 'blob', f.oid])).out
    if (had && mark(blob, had.src.b) !== had.src.h) {
      differ = true // written differently by another machine: left as the vault has it
      continue
    }
    const from = had?.src.b ?? 0
    const end = blob.lastIndexOf(10) + 1 // whole lines only
    if (end <= from) continue
    const [, leg, provider] = RAW_FILE.exec(f.name)!
    legs ??= await legMachines(book, g.src)
    const slim = await slimRaw(blob.subarray(from, end), provider as Provider, legs.get(leg) ?? o.machine, o.yieldMs ?? 8)
    const sealed = await sealLarge(o.key, g.id, 'rc', slim)
    const n = sha256(sealed)
    entries.set(`c/${n}`, await writeBlob(o.staging, sealed))
    m.files[f.name] = { src: { b: end, h: mark(blob, end) }, chunks: [...(had?.chunks ?? []), { n, b: slim.length }] }
    chunks++
    bytes += sealed.length
    await yieldNow()
  }
  if (!chunks) {
    if (base && base !== mine) await git(o.staging, ['update-ref', `refs/raw/${g.id}`, base])
    return { commit: base, chunks: 0, bytes: 0, differ }
  }
  const manifest = seal(o.key, g.id, 'rm', Buffer.from(JSON.stringify(m)))
  entries.set('m', await writeBlob(o.staging, manifest))
  const commit = await commitOf(o.staging, entries, 'c', base)
  await git(o.staging, ['update-ref', `refs/raw/${g.id}`, commit])
  return { commit, chunks, bytes: bytes + manifest.length, differ }
}

// ---------------------------------------------------------------- checkpoints, pushed

interface CheckpointManifest {
  v: 1
  thread: string
  /** The bundles in order: each one's name in b/, the checkpoint commit it brings, its bytes. */
  bundles: { n: string; tip: string; b: number }[]
  /** The newest checkpoint is not here: its bundle was over the limit, and it stays on that machine. */
  skipped?: { tip: string; bytes: number; machine: string }
}

export interface CheckpointsReport {
  /** Bundles sealed this time, and their sealed bytes. */
  sent: number
  bytes: number
  pushes: number
  pushed: number
  /** Threads whose newest checkpoint is over the limit: they can only continue on this machine. */
  skipped: { thread: string; bytes: number }[]
  failed: { thread: string; error: string }[]
  error?: string
}

/** git in the person's project, with nothing that could run their own programs. */
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'gc.auto=0']

/**
 * What a machine that clones the project from its origin already has of a checkpoint: the commits where the
 * checkpoint's history meets the origin's branches as this machine last saw them. Noted when the checkpoint was taken
 * (checkpoint.ts); for a checkpoint older than that note, looked for in the folders the thread ran in. Empty when the
 * project is not found here, has no origin, or is a folder without git: the bundle then carries the whole history.
 */
async function originBoundary(book: string, thread: string): Promise<string[]> {
  const noted = await originNote(book, thread)
  if (noted) return present(book, noted)
  const j = await git(book, ['cat-file', 'blob', `refs/threads/${thread}:events.jsonl`], { allowFail: true })
  if (j.code) return []
  const cwds: string[] = []
  for (const line of j.out.toString().split('\n')) {
    if (!line.includes('"type":"leg.start"')) continue
    try {
      const cwd = (JSON.parse(line) as { cwd?: string }).cwd
      if (cwd && !cwds.includes(cwd)) cwds.unshift(cwd)
    } catch {
      /* a cut line */
    }
  }
  for (const cwd of cwds.slice(0, 4)) {
    if (!fs.existsSync(cwd)) continue
    const ref = (await runGit([...SAFE, 'rev-parse', '-q', '--verify', `${projectRef(thread)}^{commit}`], { cwd, timeoutMs: 20_000 })).stdout.trim()
    if (!ref || !(await runGit([...SAFE, 'for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes/origin/'], { cwd, timeoutMs: 20_000 })).stdout.trim()) continue
    const r = await runGit([...SAFE, 'rev-list', '--boundary', ref, '--not', '--remotes=origin'], { cwd, timeoutMs: 60_000 })
    if (r.code) continue
    const found = r.stdout.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1))
    return present(book, found)
  }
  return []
}

/** The commits of `oids` this repository has. */
async function present(gitDir: string, oids: string[]): Promise<string[]> {
  if (!oids.length) return []
  const out = await text(gitDir, ['cat-file', '--batch-check'], { input: `${oids.join('\n')}\n` })
  return out.split('\n').filter((l) => l.split(' ')[1] === 'commit').map((l) => l.split(' ')[0])
}

/**
 * Sends each thread's new checkpoint as a sealed git bundle: the checkpoint commit and what it stands on, without
 * what the vault's earlier bundles and the project's origin already hold. A bundle over the limit is not sent; the
 * manifest says so, and the thread can only continue on this machine. Never anywhere but the vault (RESUME-2).
 */
async function pushCheckpoints(o: VaultOptions, state: State): Promise<CheckpointsReport> {
  const report = noCheckpoints()
  try {
    await checkpoints(o, state, report)
  } catch (e) {
    if (e instanceof VaultError && /cannot decrypt/.test(e.message)) throw e
    report.error = (e as Error).message
  }
  await writeState(o.staging, state).catch(() => undefined)
  return report
}

async function checkpoints(o: VaultOptions, state: State, report: CheckpointsReport) {
  const book = path.join(path.resolve(o.dir), '.git')
  if (!fs.existsSync(path.join(book, 'HEAD'))) return
  const done = state.checkpoints
  const due = [...(await refsUnder(book, 'refs/checkpoints/'))].filter(([id, tip]) => done[id] !== tip)
  if (!due.length) return
  const max = o.bundleMax ?? BUNDLE_MAX
  const theirs = await lsRemote(o, o.remote, 'refs/checkpoints/*', o.ssh)
  const tracked = await refsUnder(o.staging, 'refs/vault-remote/checkpoints/')
  await fetchMoved(o, o.remote, o.ssh, 'checkpoints', due.map(([id]) => id), theirs, tracked)
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'weevils-bundle-'))
  let group: { id: string; tip: string; oid: string }[] = []
  let bytes = 0
  const flush = async () => {
    if (!group.length) return
    await git(o.staging, ['push', '-q', '--atomic', '--no-verify', o.remote, ...group.map((g) => `${g.oid}:refs/checkpoints/${g.id}`)], { env: sshEnv(o.ssh), timeoutMs: o.netMs ?? 600_000 })
    for (const g of group) {
      await git(o.staging, ['update-ref', `refs/vault-remote/checkpoints/${g.id}`, g.oid])
      tracked.set(g.id, g.oid)
      done[g.id] = g.tip
    }
    report.pushes++
    report.pushed += group.length
    await writeState(o.staging, state)
    o.progress?.(`checkpoints: ${group.length} threads, ${(bytes / 1e6).toFixed(1)} MB`) // i18n-ignore: progress of a command
    group = []
    bytes = 0
  }
  try {
    for (const [id, listed] of due) {
      // The ref as it is now: a turn may have ended since the list was read.
      const tip = (await revParse(book, hubRef(id))) ?? listed
      try {
        const mine = await revParse(o.staging, `refs/checkpoints/${id}`)
        const base = await baseOf(o.staging, mine, tracked.get(id) ?? null)
        const m: CheckpointManifest = base ? (JSON.parse(open(o.key, id, 'km', (await git(o.staging, ['cat-file', 'blob', `${base}:m`])).out).toString()) as CheckpointManifest) : { v: 1, thread: id, bundles: [] }
        if (m.thread !== id) throw new VaultError(`checkpoint manifest of ${id} names ${m.thread}`) // i18n-ignore: technical error
        let commit = base
        if (!m.bundles.some((b) => b.tip === tip) && m.skipped?.tip !== tip) {
          const not = [...new Set([...(await present(book, m.bundles.map((b) => b.tip))), ...(await originBoundary(book, id))])].map((c) => `^${c}`)
          // Measured before it is made: a project's whole history is never packed only to be thrown away.
          let size = Number(await text(book, ['rev-list', '--objects', '--disk-usage', tip, ...not], { allowFail: true })) || 0
          let sealed: Buffer | null = null
          if (size <= max * 2) {
            const file = path.join(tmp, `${id}.bundle`)
            const made = await git(book, ['bundle', 'create', '-q', file, hubRef(id), ...not], { allowFail: true, timeoutMs: 600_000 })
            if (made.code) {
              // Nothing the vault and the origin do not have already (git refuses an empty bundle).
              if (/empty bundle/i.test(made.err)) {
                done[id] = tip
                continue
              }
              throw new VaultError(`git bundle: ${made.err.trim().split('\n').at(-1) ?? ''}`) // i18n-ignore: git's own error
            }
            size = (await fsp.stat(file)).size
            if (size <= max) sealed = await sealLarge(o.key, id, 'kb', await fsp.readFile(file))
            await fsp.rm(file, { force: true })
          }
          const entries = base ? await treeEntries(o.staging, base) : new Map<string, string>()
          if (sealed) {
            const n = sha256(sealed)
            entries.set(`b/${n}`, await writeBlob(o.staging, sealed))
            m.bundles.push({ n, tip, b: size })
            delete m.skipped
            report.sent++
          } else {
            m.skipped = { tip, bytes: size, machine: o.machine }
            report.skipped.push({ thread: id, bytes: size })
          }
          entries.set('m', await writeBlob(o.staging, seal(o.key, id, 'km', Buffer.from(JSON.stringify(m)))))
          commit = await commitOf(o.staging, entries, 'b', base)
          await git(o.staging, ['update-ref', `refs/checkpoints/${id}`, commit])
        } else if (base && base !== mine) await git(o.staging, ['update-ref', `refs/checkpoints/${id}`, base])
        if (!commit || commit === (tracked.get(id) ?? null)) {
          done[id] = tip
          continue
        }
        const size = await added(o.staging, commit, tracked.get(id) ?? null)
        report.bytes += size
        bytes += size
        group.push({ id, tip, oid: commit })
      } catch (e) {
        if (e instanceof VaultError && /cannot decrypt/.test(e.message)) throw e
        report.failed.push({ thread: id, error: (e as Error).message })
      }
      if (bytes >= GROUP_BYTES || group.length >= GROUP_REFS) await flush()
      await yieldNow()
    }
    await flush()
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- fetched back, for one thread

/** The raw map as the vault has it now. */
async function fetchMap(o: VaultOptions): Promise<RawMap> {
  await openStaging(o.staging)
  await git(o.staging, ['fetch', '-q', '--no-tags', o.remote, '+refs/map/*:refs/vault-remote/map/*'], { env: sshEnv(o.ssh), timeoutMs: o.netMs ?? 120_000 })
  return readMap(o)
}

/** One ref of a remote into refs/vault-remote/; null when the remote has no such ref. */
async function fetchOne(o: VaultOptions, remote: string, ssh: string | undefined, ref: string): Promise<string | null> {
  const to = `refs/vault-remote/${ref.slice('refs/'.length)}`
  const r = await git(o.staging, ['fetch', '-q', '--no-tags', remote, `+${ref}:${to}`], { env: sshEnv(ssh), timeoutMs: o.netMs ?? 600_000, allowFail: true })
  if (r.code) {
    if (/couldn't find remote ref|no such ref/i.test(r.err)) return null
    throw new VaultError(`git fetch: ${r.err.trim().split('\n').slice(-2).join(' ')}`) // i18n-ignore: git's own error
  }
  return revParse(o.staging, to)
}

/**
 * A thread's slim raw lines from the vault, by segment name (`L1.claude.0001.jsonl`): the map says which raw
 * repository, that one ref is fetched, its chunks opened. Empty when the vault holds none. Nothing else is fetched.
 */
export async function fetchRaw(o: VaultOptions, thread: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  const n = (await fetchMap(o)).threads.get(thread)
  if (!n) return out
  const tip = await fetchOne(o, rawRemote(o.remote, n), rawSsh(o, n), `refs/raw/${thread}`)
  if (!tip) return out
  const m = JSON.parse(open(o.key, thread, 'rm', (await git(o.staging, ['cat-file', 'blob', `${tip}:m`])).out).toString()) as RawManifest
  if (m.thread !== thread) throw new VaultError(`raw manifest of ${thread} names ${m.thread}`) // i18n-ignore: technical error
  const entries = await treeEntries(o.staging, tip)
  for (const [name, f] of Object.entries(m.files)) {
    const sealed = await blobs(o.staging, f.chunks.map((c) => entries.get(`c/${c.n}`) ?? c.n))
    const parts = sealed.map((s, i) => {
      const plain = open(o.key, thread, 'rc', s)
      if (plain.length !== f.chunks[i].b) throw new VaultError(`raw chunk ${f.chunks[i].n} of ${thread} has ${plain.length} bytes, not ${f.chunks[i].b}`) // i18n-ignore: technical error
      return plain
    })
    out.set(name, Buffer.concat(parts))
  }
  return out
}

export interface FetchedCheckpoint {
  /** The bundles, decrypted, in the order they apply. */
  bundles: string[]
  /** The checkpoint commits they bring. */
  tips: string[]
  /** The newest checkpoint stayed on its machine (over the size limit). */
  skipped?: { tip: string; bytes: number; machine: string }
}

/** A thread's checkpoint bundles from the vault, decrypted into `dir` (null: the vault has none for it). */
export async function fetchCheckpoint(o: VaultOptions, thread: string, dir: string): Promise<FetchedCheckpoint | null> {
  await openStaging(o.staging)
  const tip = await fetchOne(o, o.remote, o.ssh, `refs/checkpoints/${thread}`)
  if (!tip) return null
  const m = JSON.parse(open(o.key, thread, 'km', (await git(o.staging, ['cat-file', 'blob', `${tip}:m`])).out).toString()) as CheckpointManifest
  if (m.thread !== thread) throw new VaultError(`checkpoint manifest of ${thread} names ${m.thread}`) // i18n-ignore: technical error
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  const entries = await treeEntries(o.staging, tip)
  const bundles: string[] = []
  for (const [i, b] of m.bundles.entries()) {
    const [sealed] = await blobs(o.staging, [entries.get(`b/${b.n}`) ?? b.n])
    const file = path.join(dir, `${String(i).padStart(4, '0')}.bundle`)
    await fsp.writeFile(file, open(o.key, thread, 'kb', sealed), { mode: 0o600 })
    bundles.push(file)
  }
  return { bundles, tips: m.bundles.map((b) => b.tip), ...(m.skipped ? { skipped: m.skipped } : {}) }
}

/** What a resume asks of the vault (resume.ts, start.ts): one thread's journal, lines, code and lease, and nothing more. */
export interface VaultSource {
  /** The thread's journal as the vault has it, merged into this machine's weevbook. `differ`: this machine wrote the
   *  thread another way than the vault holds it (it went on after another machine took it): it cannot resume it. */
  refresh(thread: string): Promise<{ differ: boolean }>
  raw(thread: string): Promise<Map<string, Buffer>>
  checkpoint(thread: string, dir: string): Promise<FetchedCheckpoint | null>
  /** Step 4: the thread's lease on the vault, taken for this machine on the person's order or agreement
   *  (vault-lease.ts). `force`: even from a machine that still renews it. */
  claim(thread: string, force?: boolean): Promise<Claim>
  /** A claim given back (the resume did not happen): the lease goes idle. */
  release(thread: string): Promise<void>
  /** The journals pushed now with their leases, when nothing else is pushing (weevilsd's pusher sends them otherwise). */
  push(): Promise<void>
}

export function vaultSource(o: VaultOptions): VaultSource {
  return {
    async refresh(thread) {
      try {
        return { differ: (await restoreVault(o, { only: thread })).differ.includes(thread) }
      } catch (e) {
        if (!(e instanceof Locked)) throw e // weevilsd's pusher is at work: the copy this machine has
        return { differ: false }
      }
    },
    raw: (thread) => fetchRaw(o, thread),
    checkpoint: (thread, dir) => fetchCheckpoint(o, thread, dir),
    claim: (thread, force) => claimLease(o, thread, force),
    release: (thread) => releaseLease(o, thread),
    async push() {
      try {
        await pushVault({ ...o, raw: false })
      } catch (e) {
        if (!(e instanceof Locked)) throw e
      }
    },
  }
}
