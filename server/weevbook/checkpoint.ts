// Checkpoints of the code (docs/spec/04-resume.md#checkpoints): the project folder as it is on disk at the end of a
// turn, committed without touching the user's index, branches or stash, and restored on another machine without
// overwriting anyone's work.
//
//   git        the project's repository: a throwaway index (a copy of the user's, read only), every tracked change and
//              every untracked file up to 5 MiB that .gitignore lets through, `git commit-tree` with HEAD and the
//              previous checkpoint as parents, refs/weevils/checkpoints/<thread> (not a branch: no tool lists it)
//   shadow     a folder without git, or a repository without a first commit: the same, in a private repository of
//              weevils (DATA_DIR/checkpoints/<thread>.git) with the folder as work tree and a built-in ignore list
//   none       a home folder, or more than 20,000 files or 200 MiB to add: the code does not travel
//
// Nothing here pushes. The commit is fetched into the weevbook's repository (refs/checkpoints/<thread>), and the hub
// sync (hub.ts) pushes it to the hub only, never to the project's own remote (RESUME-2).

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeUrl } from '../bring.ts'
import type { CheckpointEvent } from './journal.ts'
import { gitOk, runGit } from './gitrun.ts'

/** An untracked file over this is left out of a checkpoint and named in `skipped` (tracked files are always in). */
export const MAX_UNTRACKED_BYTES = 5 << 20
/** More than this to add (files without git, or untracked files of a repository): `kind: none`. */
export const MAX_FOLDER_FILES = 20_000
export const MAX_FOLDER_BYTES = 200 << 20
/** Left out of a folder without git, on top of its own .gitignore files. */
export const SHADOW_IGNORES = ['node_modules/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', '*.log', 'logs/', '.cache/']
/** Names in `skipped`, at most. */
const SKIPPED_NAMES = 20
const ZERO = '0'.repeat(40)

export type CheckpointFields = Pick<CheckpointEvent, 'kind' | 'repo' | 'commit' | 'base' | 'branch' | 'changed' | 'skipped' | 'reason'>
export interface Taken {
  fields: CheckpointFields
  /** The repository that holds the commit (the project's own, or the private one of a folder without git). */
  gitDir?: string
}

/** The project's ref of a thread's checkpoints, and the weevbook's (the name it has on the hub). */
export const projectRef = (thread: string) => `refs/weevils/checkpoints/${thread}`
export const hubRef = (thread: string) => `refs/checkpoints/${thread}`
export const shadowRepo = (dataDir: string, thread: string) => path.join(dataDir, 'checkpoints', `${thread}.git`)

/** git, with nothing that could run the user's own programs (fsmonitor) or write a shared index file. */
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.splitIndex=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0']
const AUTHOR = { GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: 'weevils@weevbook.invalid', GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: 'weevils@weevbook.invalid' }

interface Ctx {
  cwd: string
  env: Record<string, string>
  timeoutMs: number
}
const g = (c: Ctx, args: string[], input?: string) => runGit([...SAFE, ...args], { cwd: c.cwd, env: c.env, input, timeoutMs: c.timeoutMs })
const ok = (c: Ctx, args: string[], input?: string) => gitOk([...SAFE, ...args], { cwd: c.cwd, env: c.env, input, timeoutMs: c.timeoutMs })
const lines = (s: string) => s.split('\n').filter(Boolean)
const isHome = (dir: string, home: string) => {
  const d = path.resolve(dir)
  return d === path.resolve(home) || d === '/' || /^\/(home|Users)\/[^/]+$|^\/root$/.test(d)
}

async function tmpIndex(): Promise<{ file: string; done: () => Promise<void> }> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'weevils-index-'))
  return { file: path.join(dir, 'index'), done: () => fsp.rm(dir, { recursive: true, force: true }) }
}

/**
 * Untracked files the throwaway index does not have, minus ignored ones: those up to 5 MiB to add, the rest named.
 * Null when there are more than the caps allow.
 */
async function untracked(c: Ctx, root: string): Promise<{ add: string[]; skipped: string[]; files: number; bytes: number } | null> {
  const out = await ok(c, ['ls-files', '--others', '--exclude-standard', '-z'])
  const add: string[] = []
  const skipped: string[] = []
  let bytes = 0
  for (const f of out.split('\0')) {
    // A repository inside the folder (« sub/ »): its own business, not part of this checkpoint.
    if (!f || f.endsWith('/')) continue
    const st = await fsp.lstat(path.join(root, f)).catch(() => null)
    if (!st) continue
    if (st.isFile() && st.size > MAX_UNTRACKED_BYTES) {
      skipped.push(f)
      continue
    }
    add.push(f)
    bytes += st.size
    if (add.length > MAX_FOLDER_FILES || bytes > MAX_FOLDER_BYTES) return null
  }
  return { add, skipped, files: add.length, bytes }
}

async function addList(c: Ctx, files: string[]) {
  if (!files.length) return
  await ok({ ...c, env: { ...c.env, GIT_LITERAL_PATHSPECS: '1' } }, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], files.join('\0'))
}

/** The tree of a folder as it is on disk, in a repository's object store (a throwaway index). With `from`, that index
 *  starts as a copy of the user's (read, never written) on HEAD, so that unchanged files are not hashed again. */
async function snapshot(c: Ctx, root: string, from: { userIndex: string; head: string } | null): Promise<{ tree: string; skipped: string[] } | null> {
  const idx = await tmpIndex()
  try {
    const cx = { ...c, env: { ...c.env, GIT_INDEX_FILE: idx.file } }
    if (from) {
      if (await fsp.copyFile(from.userIndex, idx.file).then(() => true, () => false)) {
        if ((await g(cx, ['read-tree', '-m', from.head])).code !== 0) {
          await fsp.rm(idx.file, { force: true })
          await ok(cx, ['read-tree', from.head])
        }
      } else await ok(cx, ['read-tree', from.head])
      // Tracked files: every change, whatever its size (deletions included).
      await ok(cx, ['add', '-u', '--', '.'])
    }
    const u = await untracked(cx, root)
    if (!u) return null
    await addList(cx, u.add)
    return { tree: (await ok(cx, ['write-tree'])).trim(), skipped: u.skipped }
  } finally {
    await idx.done()
  }
}

async function commitOn(c: Ctx, tree: string, parents: string[], message: string, at: number): Promise<string> {
  const date = `${Math.floor(at / 1000)} +0000`
  const env = { ...c.env, ...AUTHOR, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  return (await ok({ ...c, env }, ['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message])).trim()
}

const none = (reason: string): Taken => ({ fields: { kind: 'none', reason } })

export interface TakeOptions {
  /** The leg's folder. */
  cwd: string
  thread: string
  turn: number
  home: string
  dataDir: string
  now?: number
  timeoutMs?: number
}

/**
 * The checkpoint of a turn (docs/spec/04-resume.md): `git`, `shadow` or `none`. Never throws: a failure is `kind:
 * none` with its reason, and the thread resumes on this machine only.
 */
export async function takeCheckpoint(o: TakeOptions): Promise<Taken> {
  try {
    return await take(o)
  } catch (e) {
    return none(`checkpoint failed: ${(e as Error).message}`.slice(0, 300)) // i18n-ignore: journal data
  }
}

async function take(o: TakeOptions): Promise<Taken> {
  const at = o.now ?? Date.now()
  const timeoutMs = o.timeoutMs ?? 120_000
  const cwd = path.resolve(o.cwd || '/')
  if (!o.cwd || isHome(cwd, o.home)) return none('home folder')
  if (!(await fsp.stat(cwd).then((s) => s.isDirectory(), () => false))) return none('folder not found')
  const probe: Ctx = { cwd, env: {}, timeoutMs }
  const top = (await g(probe, ['rev-parse', '--show-toplevel'])).stdout.trim()
  const head = top ? (await g({ ...probe, cwd: top }, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])).stdout.trim() : ''
  if (top && head) {
    if (isHome(top, o.home)) return none('home folder')
    return takeGit(o, { cwd: top, env: {}, timeoutMs }, top, head, at)
  }
  return takeShadow(o, cwd, timeoutMs, at)
}

async function takeGit(o: TakeOptions, c: Ctx, top: string, head: string, at: number): Promise<Taken> {
  const commonDir = path.resolve(top, (await ok(c, ['rev-parse', '--git-common-dir'])).trim())
  const userIndex = path.resolve(top, (await ok(c, ['rev-parse', '--git-path', 'index'])).trim())
  const snap = await snapshot(c, top, { userIndex, head })
  if (!snap) return none(`too large: over ${MAX_FOLDER_FILES} untracked files or ${MAX_FOLDER_BYTES >> 20} MiB`) // i18n-ignore: journal data
  const ref = projectRef(o.thread)
  const prev = (await g(c, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])).stdout.trim()
  let commit = ''
  if (prev) {
    // Nothing moved since the previous checkpoint, on the same base: the same commit.
    const [pt, pp] = lines(await ok(c, ['log', '-1', '--format=%T%n%P', prev]))
    if (pt === snap.tree && pp?.split(' ')[0] === head) commit = prev
  }
  if (!commit) commit = await commitOn(c, snap.tree, prev ? [head, prev] : [head], `turn ${o.turn} · ${o.thread}`, at) // i18n-ignore: commit message
  if (commit !== prev) await ok(c, ['update-ref', ref, commit, prev || ZERO])
  const changed = lines(await ok(c, ['diff-tree', '-r', '--name-only', '--no-commit-id', head, snap.tree])).length
  const branch = (await g(c, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim()
  const origin = (await g(c, ['config', '--get', 'remote.origin.url'])).stdout.trim()
  return {
    fields: {
      kind: 'git',
      ...(origin ? { repo: safeUrl(origin) } : {}),
      commit,
      base: head,
      ...(branch ? { branch } : {}),
      changed,
      ...(snap.skipped.length ? { skipped: snap.skipped.slice(0, SKIPPED_NAMES) } : {}),
    },
    gitDir: commonDir,
  }
}

/** The private repository of a folder without git, made the first time with its ignore list. */
async function ensureShadow(dataDir: string, thread: string, timeoutMs: number): Promise<string> {
  const dir = shadowRepo(dataDir, thread)
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    await fsp.mkdir(path.dirname(dir), { recursive: true })
    await gitOk(['init', '-q', '--bare', dir], { timeoutMs })
  }
  await fsp.mkdir(path.join(dir, 'info'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'info', 'exclude'), `${SHADOW_IGNORES.join('\n')}\n`)
  return dir
}

async function takeShadow(o: TakeOptions, folder: string, timeoutMs: number, at: number): Promise<Taken> {
  const repo = await ensureShadow(o.dataDir, o.thread, timeoutMs)
  const c: Ctx = { cwd: folder, env: { GIT_DIR: repo, GIT_WORK_TREE: folder }, timeoutMs }
  const snap = await snapshot(c, folder, null)
  if (!snap) return none(`too large: over ${MAX_FOLDER_FILES} files or ${MAX_FOLDER_BYTES >> 20} MiB`) // i18n-ignore: journal data
  const ref = projectRef(o.thread)
  const prev = (await g(c, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])).stdout.trim()
  const prevTree = prev ? (await ok(c, ['rev-parse', `${prev}^{tree}`])).trim() : ''
  const commit = prevTree === snap.tree ? prev : await commitOn(c, snap.tree, prev ? [prev] : [], `turn ${o.turn} · ${o.thread}`, at) // i18n-ignore: commit message
  if (commit !== prev) await ok(c, ['update-ref', ref, commit, prev || ZERO])
  const changed = prev ? lines(await ok(c, ['diff-tree', '-r', '--name-only', '--no-commit-id', prev, snap.tree])).length : lines(await ok(c, ['ls-tree', '-r', '--name-only', snap.tree])).length
  return { fields: { kind: 'shadow', commit, changed, ...(snap.skipped.length ? { skipped: snap.skipped.slice(0, SKIPPED_NAMES) } : {}) }, gitDir: repo }
}

/** The checkpoint ref of `from` (a project's or a private repository) copied into the weevbook's repository, where the
 *  hub sync pushes it from. */
export async function keepInWeevbook(weevbookGitDir: string, from: string, thread: string, timeoutMs = 600_000) {
  await gitOk(['--git-dir', weevbookGitDir, 'fetch', '-q', '--no-tags', '--no-write-fetch-head', from, `+${projectRef(thread)}:${hubRef(thread)}`], { timeoutMs })
  await noteOrigin(weevbookGitDir, from, thread, timeoutMs).catch(() => undefined)
}

/** Where the weevbook keeps, by thread, the commits at which a checkpoint's history meets the project's origin. */
const originFile = (weevbookGitDir: string, thread: string) => path.join(weevbookGitDir, 'weevbook', 'origin', thread)

/**
 * What a machine that clones the project from its origin already has of this checkpoint (docs/spec/07-vault.md): the
 * commits where its history meets the origin's branches as this repository last fetched them. Written down while the
 * project is at hand (a worktree may be gone by the time the vault's bundle is made). No origin: an empty list.
 */
async function noteOrigin(weevbookGitDir: string, from: string, thread: string, timeoutMs: number) {
  const run = (args: string[]) => runGit(['--git-dir', from, ...SAFE, ...args], { timeoutMs: Math.min(timeoutMs, 60_000) })
  let found: string[] = []
  if ((await run(['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes/origin/'])).stdout.trim()) {
    const r = await run(['rev-list', '--boundary', projectRef(thread), '--not', '--remotes=origin'])
    if (r.code !== 0) return
    found = lines(r.stdout).filter((l) => l.startsWith('-')).map((l) => l.slice(1))
  }
  await fsp.mkdir(path.dirname(originFile(weevbookGitDir, thread)), { recursive: true })
  await fsp.writeFile(originFile(weevbookGitDir, thread), found.join('\n'))
}

/** The commits noted by noteOrigin for a thread (null: never noted). */
export async function originNote(weevbookGitDir: string, thread: string): Promise<string[] | null> {
  const text = await fsp.readFile(originFile(weevbookGitDir, thread), 'utf8').catch(() => null)
  return text === null ? null : lines(text)
}

// ---------------------------------------------------------------- restoring on another machine

export interface RestoreOptions {
  kind: 'git' | 'shadow'
  commit: string
  /** git: HEAD when the checkpoint was taken. */
  base?: string
  branch?: string
  /** git: the origin, without credentials. */
  repo?: string
  thread: string
  /** The thread's slug: names a worktree, a branch or a folder made beside. */
  slug: string
  /** Where the project lives here (bring.ts place()). */
  dir: string
  /** `dir` was made by weevils just now (an empty folder, or a clone of its own): its HEAD may move. */
  fresh: boolean
  /** The weevbook's repository, and its ref that holds the commit (default refs/checkpoints/<thread>). */
  source: string
  sourceRef?: string
  /** In place of `source`: the thread's checkpoint bundles from the vault (07-vault.md), in the order they apply. */
  bundles?: string[]
  dataDir: string
  /** Another session is at work in the folder now: the restore goes beside it. */
  busy?: boolean
  timeoutMs?: number
}
export interface Restored {
  /** The folder that now holds the checkpoint's files. */
  dir: string
  /** in-place: the project's own folder. worktree: a new git worktree on a new branch. beside: a new folder next to
   *  it (no git). new: a repository weevils made. */
  mode: 'in-place' | 'worktree' | 'beside' | 'new'
  branch?: string
}

const isEmptyDir = async (d: string) => (await fsp.readdir(d).catch(() => null))?.length === 0
const exists = (p: string) => fs.existsSync(p)
function uniq(base: string, taken: (p: string) => boolean): string {
  if (!taken(base)) return base
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`
}

/** The trees a thread's checkpoints have had (the chain of `commit`, newest first): « the thread's own state ». */
async function chainTrees(c: Ctx, commit: string): Promise<Set<string>> {
  return new Set(lines(await ok(c, ['log', '--format=%T', '-n', '500', commit])))
}

/** Writes `commit`'s files over `target` (a throwaway index: the user's index is never written), and removes the files
 *  `base` had that `commit` has not. */
async function apply(c: Ctx, target: string, commit: string, base: string | null) {
  const idx = await tmpIndex()
  try {
    const cx = { ...c, cwd: target, env: { ...c.env, GIT_INDEX_FILE: idx.file } }
    await ok(cx, ['read-tree', commit])
    await ok(cx, ['checkout-index', '-a', '-f', '-q'])
    if (base) {
      for (const f of lines(await ok(cx, ['diff-tree', '-r', '--name-only', '--no-commit-id', '--diff-filter=D', base, commit]))) {
        const p = path.resolve(target, f)
        if (p.startsWith(target + path.sep)) await fsp.rm(p, { force: true })
      }
    }
  } finally {
    await idx.done()
  }
}

/**
 * The checkpoint's commits into the repository at `c`: from the weevbook's own repository (the hub's copy), or from
 * the vault's bundles. A bundle leaves out what the project's origin has: when this clone is behind its origin, the
 * origin is fetched once and the bundle taken again.
 */
async function bring(c: Ctx, o: RestoreOptions) {
  const to = projectRef(o.thread)
  if (!o.bundles) {
    await ok(c, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', o.source, `+${o.sourceRef ?? hubRef(o.thread)}:${to}`])
    return
  }
  let fetched = false
  for (const b of o.bundles) {
    const args = ['fetch', '-q', '--no-tags', '--no-write-fetch-head', b, `+${hubRef(o.thread)}:${to}`]
    if ((await g(c, args)).code === 0) continue
    if (!fetched) await g(c, ['fetch', '-q', '--no-tags', '--no-write-fetch-head', 'origin', '+refs/heads/*:refs/remotes/origin/*'])
    fetched = true
    await ok(c, args)
  }
}

/**
 * The checkpoint's files on this machine (docs/spec/04-resume.md, « Restoring »). In the project's own folder only
 * when nothing there would be overwritten: HEAD is the checkpoint's base, and the folder has no change, or only this
 * thread's own earlier state, and no other session works in it. Otherwise in a new git worktree on a new branch
 * `weevils/<slug>` (a folder without git: a new folder beside it). No existing branch ever moves; the user's index is
 * never written.
 */
export async function restoreCheckpoint(o: RestoreOptions): Promise<Restored> {
  const timeoutMs = o.timeoutMs ?? 600_000
  return o.kind === 'git' ? restoreGit(o, timeoutMs) : restoreShadow(o, timeoutMs)
}

async function restoreGit(o: RestoreOptions, timeoutMs: number): Promise<Restored> {
  if (!o.base) throw new Error('a git checkpoint without its base') // i18n-ignore: internal error, for the log
  let dir = path.resolve(o.dir)
  let fresh = o.fresh
  await fsp.mkdir(dir, { recursive: true })
  let top = (await runGit(['rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs })).stdout.trim()
  if (!top) {
    // Not a repository: an empty folder becomes one; a folder with files of someone's gets a new one beside it.
    if (!(await isEmptyDir(dir))) {
      dir = uniq(`${dir}-weevils-${o.slug}`, exists)
      await fsp.mkdir(dir, { recursive: true })
    }
    await gitOk(['init', '-q', dir], { timeoutMs })
    if (o.repo && /^(https:\/\/|ssh:\/\/|git@)/.test(o.repo)) await gitOk(['-C', dir, 'remote', 'add', 'origin', o.repo], { timeoutMs })
    top = dir
    fresh = true
  }
  const c: Ctx = { cwd: top, env: {}, timeoutMs }
  await bring(c, o)
  if ((await g(c, ['cat-file', '-e', `${o.commit}^{commit}`])).code !== 0) throw new Error(`checkpoint ${o.commit.slice(0, 12)} is not on the hub`) // i18n-ignore: for the log
  const head = (await g(c, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])).stdout.trim()
  const branchExists = async (b: string) => (await g(c, ['rev-parse', '-q', '--verify', `refs/heads/${b}`])).code === 0

  if (fresh) {
    // A repository weevils made: its branch goes to the base (forward only), or a branch is made there.
    const current = (await g(c, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim()
    const forward = head && current && current === o.branch && (head === o.base || (await g(c, ['merge-base', '--is-ancestor', head, o.base])).code === 0)
    let branch = current
    if (forward) {
      if (head !== o.base) await ok(c, ['merge', '-q', '--ff-only', o.base])
    } else {
      const want = o.branch && !(await branchExists(o.branch)) ? o.branch : `weevils/${o.slug}`
      branch = want
      for (let i = 2; await branchExists(branch); i++) branch = `${want}-${i}`
      await ok(c, ['checkout', '-q', '-b', branch, o.base])
    }
    await apply(c, top, o.commit, o.base)
    return { dir: top, mode: 'new', ...(branch ? { branch } : {}) }
  }

  const status = await ok(c, ['status', '--porcelain=v1', '--untracked-files=normal'])
  let ownState = !status.trim()
  if (!ownState) {
    const userIndex = path.resolve(top, (await ok(c, ['rev-parse', '--git-path', 'index'])).trim())
    const snap = head ? await snapshot(c, top, { userIndex, head }) : null
    ownState = !!snap && (await chainTrees(c, o.commit)).has(snap.tree)
  }
  if (!o.busy && ownState && head === o.base) {
    await apply(c, top, o.commit, o.base)
    return { dir: top, mode: 'in-place' }
  }
  // Someone's work, another session, or another commit: a worktree of its own, on a new branch at the base.
  const at = uniq(`${top}-weevils-${o.slug}`, exists)
  let branch = `weevils/${o.slug}`
  for (let i = 2; await branchExists(branch); i++) branch = `weevils/${o.slug}-${i}`
  await ok(c, ['worktree', 'add', '-q', '-b', branch, at, o.base])
  await apply({ ...c, cwd: at }, at, o.commit, o.base)
  return { dir: at, mode: 'worktree', branch }
}

async function restoreShadow(o: RestoreOptions, timeoutMs: number): Promise<Restored> {
  const repo = await ensureShadow(o.dataDir, o.thread, timeoutMs)
  await bring({ cwd: path.dirname(repo), env: { GIT_DIR: repo }, timeoutMs }, o)
  if ((await runGit(['--git-dir', repo, 'cat-file', '-e', `${o.commit}^{commit}`], { timeoutMs })).code !== 0) throw new Error(`checkpoint ${o.commit.slice(0, 12)} is not on the hub`) // i18n-ignore: for the log
  let dir = path.resolve(o.dir)
  let mode: Restored['mode'] = 'in-place'
  await fsp.mkdir(dir, { recursive: true })
  if (!(await isEmptyDir(dir))) {
    const c: Ctx = { cwd: dir, env: { GIT_DIR: repo, GIT_WORK_TREE: dir }, timeoutMs }
    const snap = o.busy ? null : await snapshot(c, dir, null)
    if (!snap || !(await chainTrees(c, o.commit)).has(snap.tree)) {
      dir = uniq(`${dir}-weevils-${o.slug}`, exists)
      await fsp.mkdir(dir, { recursive: true })
      mode = 'beside'
    }
  }
  await apply({ cwd: dir, env: { GIT_DIR: repo, GIT_WORK_TREE: dir }, timeoutMs }, dir, o.commit, null)
  return { dir, mode }
}
