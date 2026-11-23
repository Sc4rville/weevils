// The code of a conversation that moves without a checkpoint that travels (`kind: none`: a home folder, a folder too
// large), to a machine that has its own clone of the same repository (docs/spec/07-vault.md, « A direct order »).
//
// The machine the conversation leaves says the state of the repository its session works in: origin, HEAD, branch,
// the commits GitHub does not have, and every uncommitted file with its git hash. The machine it goes to compares
// that with its clone: the base is pulled when it can go forward, a file that differs is carried when the clone's own
// copy is untouched, and everything else is named, never overwritten. Nothing is ever deleted on the machine left.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { safeUrl } from '../bring.ts'
import { runGit } from './gitrun.ts'

/** Files carried at most, one by one and in all: past that, they are named and left where they are. */
export const CARRY_FILE_BYTES = 5 << 20
export const CARRY_TOTAL_BYTES = 20 << 20
/** Uncommitted files read at most (a folder with more is said as such). */
export const DIRTY_FILES = 2_000

export interface DirtyFile {
  /** Relative to the repository's top folder, with '/'. */
  path: string
  state: 'modified' | 'added' | 'deleted' | 'untracked'
  /** git's hash of the file as it is on disk (null: deleted, or not a regular file). */
  hash: string | null
  bytes: number
}

export interface CodeState {
  /** The repository's top folder, on the machine that says it. */
  folder: string
  origin: string | null
  head: string | null
  branch: string | null
  /** Commits of HEAD that no `origin/*` ref has (as this clone last fetched them): their subjects, newest first. */
  unpushed: string[]
  dirty: DirtyFile[]
  /** More uncommitted files than DIRTY_FILES: the list is cut. */
  more?: boolean
}

export interface CodeReport {
  /** The clone the conversation continues with, here. */
  folder: string
  /** The machine left answered (false: nothing of its code could be checked). */
  checked: boolean
  /** The clone went forward to the other machine's HEAD (`git merge --ff-only`). */
  pulled?: string
  /** Why it did not, when the two stand on different commits. */
  notPulled?: string
  /** Uncommitted files already the same here, carried here, and left (with why). */
  same: string[]
  carried: string[]
  left: { path: string; why: string }[]
  /** Commits that only the machine left has. */
  unpushed: string[]
  /** One line for the person: what was done, and what was not. */
  line: string
}

const git = (cwd: string, args: string[], timeoutMs = 60_000) => runGit(['-c', 'core.fsmonitor=false', ...args], { cwd, timeoutMs })
const out = async (cwd: string, args: string[]) => {
  const r = await git(cwd, args)
  return r.code === 0 ? r.stdout.trim() : ''
}

/** The folder the session works in now: the `cwd` of its newest line (a session that `cd`s keeps writing it there). */
export function currentFolder(file: string, provider: 'claude' | 'codex'): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, 512 << 10)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      if (!l.includes('"cwd"')) continue
      try {
        const o = JSON.parse(l) as { cwd?: unknown; payload?: { cwd?: unknown } }
        const cwd = provider === 'claude' ? o.cwd : (o.payload?.cwd ?? o.cwd)
        if (typeof cwd === 'string' && cwd) return cwd
      } catch {
        // a line cut by the window: the one before
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/** The state of the repository `folder` is in (null: not in a repository with a first commit). */
export async function readCodeState(folder: string): Promise<CodeState | null> {
  if (!folder || !fs.existsSync(folder)) return null
  const top = await out(folder, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  const head = await out(top, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])
  if (!head) return null
  const origin = await out(top, ['config', '--get', 'remote.origin.url'])
  const branch = await out(top, ['symbolic-ref', '-q', '--short', 'HEAD'])
  const unpushed = (await out(top, ['log', '--format=%h %s', '-n', '20', 'HEAD', '--not', '--remotes=origin'])).split('\n').filter(Boolean)
  const status = (await git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])).stdout
  const dirty: DirtyFile[] = []
  let more = false
  for (const entry of status.split('\0')) {
    if (entry.length < 4) continue
    if (dirty.length >= DIRTY_FILES) {
      more = true
      break
    }
    const xy = entry.slice(0, 2)
    const rel = entry.slice(3)
    if (rel.endsWith('/')) continue // a repository inside: its own business
    const abs = path.join(top, rel)
    const st = await fsp.lstat(abs).catch(() => null)
    const state: DirtyFile['state'] = xy === '??' ? 'untracked' : xy.includes('D') && !st ? 'deleted' : xy.includes('A') ? 'added' : 'modified'
    const file = !!st && st.isFile()
    const hash = file ? (await out(top, ['hash-object', '--no-filters', '--', rel])) || null : null
    dirty.push({ path: rel, state, hash, bytes: file ? st!.size : 0 })
  }
  return { folder: top, origin: origin ? safeUrl(origin) : null, head, branch: branch || null, unpushed, dirty, ...(more ? { more } : {}) }
}

/** Files of the repository `top`, for the machine that takes the conversation: only regular files inside it, capped. */
export async function readFiles(top: string, paths: readonly string[]): Promise<Record<string, string>> {
  const root = path.resolve(top)
  const got: Record<string, string> = {}
  let total = 0
  for (const rel of paths) {
    const abs = path.resolve(root, rel)
    if (!abs.startsWith(`${root}${path.sep}`) || abs.split(path.sep).includes('.git')) continue
    const st = await fsp.lstat(abs).catch(() => null)
    if (!st || !st.isFile() || st.size > CARRY_FILE_BYTES || total + st.size > CARRY_TOTAL_BYTES) continue
    // A file inside a symlinked folder could lead out of the repository.
    if ((await fsp.realpath(abs).catch(() => '')) !== abs) continue
    got[rel] = (await fsp.readFile(abs)).toString('base64')
    total += st.size
  }
  return got
}

/**
 * The other machine's code state brought into `clone` (the same repository, here). Pulls the base forward when the
 * clone can (fast-forward only, git refuses whatever would touch a changed file), carries each file that differs when
 * this clone's own copy of it is untouched and both stand on the same commit, and names the rest.
 */
export async function bringCode(o: { state: CodeState; clone: string; machine: string; files: (paths: string[]) => Promise<Record<string, string>>; fetch?: boolean }): Promise<CodeReport> {
  const { state: s, clone } = o
  const report: CodeReport = { folder: clone, checked: true, same: [], carried: [], left: [], unpushed: s.unpushed, line: '' }
  let head = await out(clone, ['rev-parse', '-q', '--verify', 'HEAD^{commit}'])
  if (s.head && head !== s.head) {
    const known = async () => (await git(clone, ['cat-file', '-e', `${s.head}^{commit}`])).code === 0
    if (!(await known()) && o.fetch !== false) await git(clone, ['fetch', '--quiet', 'origin'], 120_000)
    if (!(await known())) report.notPulled = `${s.head.slice(0, 7)} is not on the origin`
    else if (!head || (await git(clone, ['merge-base', '--is-ancestor', head, s.head])).code !== 0) report.notPulled = `this clone has commits ${o.machine} does not`
    else {
      const m = await git(clone, ['merge', '--quiet', '--ff-only', s.head])
      if (m.code === 0) {
        report.pulled = s.head
        head = s.head
      } else report.notPulled = `git refused: ${(m.stderr || m.stdout).trim().split('\n')[0].slice(0, 160)}`
    }
  }
  const mine = new Map<string, string>()
  for (const entry of (await git(clone, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'])).stdout.split('\0')) if (entry.length >= 4) mine.set(entry.slice(3), entry.slice(0, 2))
  const sameBase = !!s.head && head === s.head
  const want: DirtyFile[] = []
  for (const f of s.dirty) {
    const abs = path.join(clone, f.path)
    const st = await fsp.lstat(abs).catch(() => null)
    const here = st?.isFile() ? (await out(clone, ['hash-object', '--no-filters', '--', f.path])) || null : null
    if (f.state === 'deleted' ? !st : here !== null && here === f.hash) {
      report.same.push(f.path)
      continue
    }
    if (!sameBase) {
      report.left.push({ path: f.path, why: `${o.machine} stands on ${s.head?.slice(0, 7) ?? '?'}, this clone on ${head.slice(0, 7) || '?'}` })
      continue
    }
    if (mine.has(f.path)) {
      report.left.push({ path: f.path, why: 'changed on both machines: this copy kept' })
      continue
    }
    if (f.state === 'deleted') {
      // Removed over there, untouched here: removed here too (it is in git, nothing is lost).
      await fsp.rm(abs, { force: true })
      report.carried.push(f.path)
      continue
    }
    if (!f.hash) {
      report.left.push({ path: f.path, why: 'not a regular file' })
      continue
    }
    if (f.bytes > CARRY_FILE_BYTES) {
      report.left.push({ path: f.path, why: `${Math.round(f.bytes / 1e6)} MB, too large to carry` })
      continue
    }
    want.push(f)
  }
  if (want.length) {
    let got: Record<string, string> = {}
    try {
      got = await o.files(want.map((f) => f.path))
    } catch (e) {
      for (const f of want) report.left.push({ path: f.path, why: `not received: ${(e as Error).message}` })
      want.length = 0
    }
    for (const f of want) {
      const b64 = got[f.path]
      if (b64 === undefined) {
        report.left.push({ path: f.path, why: 'not received (too large in all, or changed meanwhile)' })
        continue
      }
      const abs = path.join(clone, f.path)
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, Buffer.from(b64, 'base64'))
      const now = await out(clone, ['hash-object', '--no-filters', '--', f.path])
      if (now === f.hash) report.carried.push(f.path)
      else report.left.push({ path: f.path, why: 'changed on the way: carried as it was read' })
    }
  }
  if (s.more) report.left.push({ path: '…', why: `more than ${DIRTY_FILES} uncommitted files: the rest was not compared` })
  report.line = codeLine(report, o.machine)
  return report
}

/** The report when the machine left did not answer. */
export function uncheckedCode(clone: string, machine: string): CodeReport {
  return { folder: clone, checked: false, same: [], carried: [], left: [], unpushed: [], line: `${machine} did not answer: its uncommitted changes, if any, stay there and were not checked` }
}

function codeLine(r: CodeReport, machine: string): string {
  const parts: string[] = []
  if (r.pulled) parts.push(`pulled to ${r.pulled.slice(0, 7)}`)
  if (r.notPulled) parts.push(`not pulled (${r.notPulled})`)
  if (r.carried.length) parts.push(`carried from ${machine}: ${r.carried.join(', ')}`)
  if (r.same.length) parts.push(`already the same: ${r.same.length} file${r.same.length > 1 ? 's' : ''}`)
  if (r.left.length) parts.push(`left on ${machine}: ${r.left.map((l) => `${l.path} (${l.why})`).join(', ')}`)
  if (r.unpushed.length) parts.push(`commits only ${machine} has: ${r.unpushed.join('; ')}`)
  return `${r.folder}: ${parts.length ? parts.join(' · ') : `the same as on ${machine}`}`
}
