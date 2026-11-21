// Evidence for the request ledger (server/boss-ledger.ts): the commits that landed where a session's work ships.
//
// A session often ships several requests in a few commits, and its last words are about something else. So a request
// is checked against what landed since it was sent, not only against what the session said last. « Landed » means on
// a branch that ships, never on a side branch that still waits for a merge:
//   1. the repository's default branch (the local one and origin's: a merge made on the forge counts once fetched);
//   2. the branch checked out in the repository's own folder (the main checkout, not a linked worktree);
//   3. the branches named in WEEVILS_SHIPPED_BRANCHES (comma-separated), for a project that serves another one
//      (a preview, a staging site).
// Everything here is local and read-only: no fetch, no network.

import { execFile } from 'node:child_process'

export interface LandedCommit {
  /** The first 8 characters of its hash. */
  id: string
  /** Commit time, in ms. */
  at: number
  subject: string
  body: string
  files: string[]
  /** The shipping branch it was found on. */
  branch: string
}

type Git = (dir: string, args: string[]) => Promise<string | null>

const gitOut: Git = (dir, args) =>
  new Promise((resolve) => execFile('git', ['-C', dir, ...args], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve(e ? null : String(out))))

/** The extra branches that ship, from WEEVILS_SHIPPED_BRANCHES (read at each call: `weevils config set` applies at once). */
export const shippedBranches = (env: NodeJS.ProcessEnv = process.env) =>
  (env.WEEVILS_SHIPPED_BRANCHES ?? '').split(/[,\s]+/).map((b) => b.trim()).filter((b) => /^[\w./-]{1,100}$/.test(b) && !b.startsWith('-'))

/** The refs that ship for the repository holding `cwd`, as [ref, branch name], the default branch first. */
export async function shippedRefs(cwd: string, extra = shippedBranches(), git: Git = gitOut): Promise<[string, string][]> {
  const dirs = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']))?.trim().split('\n')
  if (!dirs || dirs.length < 2) return []
  const names: string[] = []
  const origin = (await git(cwd, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']))?.trim().replace(/^origin\//, '')
  if (origin) names.push(origin)
  else names.push('main', 'master')
  // The main checkout's own branch (a linked worktree is side work until it is merged).
  if (dirs[0] === dirs[1]) {
    const head = (await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']))?.trim()
    if (head) names.push(head)
  }
  names.push(...extra)
  const out: [string, string][] = []
  for (const name of [...new Set(names)]) {
    for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
      if ((await git(cwd, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])) !== null) out.push([ref, name])
    }
  }
  return out
}

/** The commits that landed on a shipping branch since `since` (ms), the newest first, merges left out. */
export async function landedCommits(cwd: string, since: number, o: { max?: number; extra?: string[]; git?: Git } = {}): Promise<LandedCommit[]> {
  const git = o.git ?? gitOut
  const max = o.max ?? 400
  const seen = new Map<string, LandedCommit>()
  for (const [ref, branch] of await shippedRefs(cwd, o.extra, git)) {
    const raw = await git(cwd, ['log', '--no-merges', `--since=${Math.floor(since / 1000)}`, '-n', String(max), '--format=%x1e%H%x1f%ct%x1f%s%x1f%b%x1f', '--name-only', ref])
    for (const rec of (raw ?? '').split('\x1e')) {
      const [hash, ct, subject, body, files] = rec.split('\x1f')
      if (!hash || !/^[0-9a-f]{40,64}$/.test(hash.trim()) || seen.has(hash.trim())) continue
      const at = Number(ct) * 1000
      if (!Number.isFinite(at) || at < since) continue
      seen.set(hash.trim(), { id: hash.trim().slice(0, 8), at, subject: (subject ?? '').trim(), body: (body ?? '').trim(), files: (files ?? '').split('\n').map((f) => f.trim()).filter(Boolean), branch })
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, max)
}

/** The lines one commit added and removed, as a bounded excerpt (no context, no file headers beyond their names). */
export async function commitChanges(cwd: string, id: string, max = 900, git: Git = gitOut): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/.test(id)) return ''
  const raw = await git(cwd, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', id])
  const lines: string[] = []
  let used = 0
  for (const l of (raw ?? '').split('\n')) {
    const keep = /^(\+\+\+ b\/|[+-](?![+-]))/.test(l) && l.trim().length > 1
    if (!keep) continue
    const line = l.startsWith('+++ b/') ? `@ ${l.slice(6)}` : l.length > 160 ? l.slice(0, 159) + '…' : l
    if (used + line.length + 1 > max) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/**
 * The landed commits of a folder, read at most once every two minutes (the ledger asks on every tick): a commit is
 * seen within two minutes of landing. A longer reach than the one kept reads again.
 */
export class LandedCache {
  private kept = new Map<string, { since: number; readAt: number; list: Promise<LandedCommit[]> }>()
  private readonly ttl: number
  private readonly read: (cwd: string, since: number) => Promise<LandedCommit[]>
  private readonly now: () => number
  constructor(ttl = 120_000, read: (cwd: string, since: number) => Promise<LandedCommit[]> = landedCommits, now: () => number = Date.now) {
    this.ttl = ttl
    this.read = read
    this.now = now
  }
  get(cwd: string, since: number): Promise<LandedCommit[]> {
    const k = this.kept.get(cwd)
    const fresh = k && k.since <= since && this.now() - k.readAt < this.ttl ? k : undefined
    const entry = fresh ?? { since, readAt: this.now(), list: this.read(cwd, since).catch(() => []) }
    if (!fresh) {
      if (this.kept.size > 200) this.kept.clear()
      this.kept.set(cwd, entry)
    }
    return entry.list.then((list) => list.filter((c) => c.at >= since))
  }
}
