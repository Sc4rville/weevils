// A job sent to another machine runs on exactly what the session has: its working tree as a commit of its own
// (tracked changes and new files, never what .gitignore leaves out), made with a separate index so the session's own
// index, branch and stash are untouched. It travels as a git bundle holding only what the other machine lacks.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Git = (args: string[], o?: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string }) => Promise<string>

export const git: Git = (args, o = {}) =>
  new Promise((resolve, reject) => {
    const p = execFile('git', args, { cwd: o.cwd, env: { ...process.env, ...o.env }, maxBuffer: 64 << 20 }, (e, out, err) =>
      e ? reject(Object.assign(new Error(String(err || e.message).trim()), { code: (e as NodeJS.ErrnoException).code })) : resolve(String(out).trim()),
    )
    if (o.input !== undefined) p.stdin?.end(o.input)
  })

const IDENTITY = { GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: 'weevils@localhost', GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: 'weevils@localhost' }

export interface Snapshot {
  root: string
  /** The folder the command runs in, relative to the repository (« » for its top). */
  dir: string
  commit: string
  /** The repository's name on the other machine: its folder's name and its first commit (two clones share it). */
  key: string
}

export const repoKey = (root: string, first: string) => `${path.basename(root).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 40)}-${first.slice(0, 12)}`

/** The working tree of the repository around `cwd`, as a commit (null: not in a git repository with a commit). */
export async function snapshot(cwd: string, g: Git = git): Promise<Snapshot | null> {
  let root: string
  let head: string
  try {
    root = await g(['rev-parse', '--show-toplevel'], { cwd })
    head = await g(['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root })
  } catch {
    return null
  }
  const first = (await g(['rev-list', '--max-parents=0', 'HEAD'], { cwd: root })).split('\n').pop()!
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'weevils-snap-')), 'index')
  try {
    const real = await g(['rev-parse', '--path-format=absolute', '--git-path', 'index'], { cwd: root })
    try {
      fs.copyFileSync(real, index) // a head start: unchanged files are not hashed again
    } catch {
      /* a fresh repository */
    }
    const env = { GIT_INDEX_FILE: index, ...IDENTITY }
    await g(['add', '-A', '.'], { cwd: root, env })
    const tree = await g(['write-tree'], { cwd: root, env })
    const commit = await g(['commit-tree', tree, '-p', head, '-m', 'weevils job'], { cwd: root, env })
    const rel = path.relative(root, fs.realpathSync(cwd))
    return { root, dir: rel.startsWith('..') ? '' : rel, commit, key: repoKey(root, first) }
  } finally {
    fs.rmSync(path.dirname(index), { recursive: true, force: true })
  }
}

/**
 * The bundle that brings `commit` to a machine that already has `have` (the commits it said it holds; those unknown
 * here are left out). Null when it already has the commit.
 */
export async function bundle(root: string, commit: string, have: string[], out: string, g: Git = git): Promise<{ file: string; ref: string } | null> {
  const known: string[] = []
  for (const h of have.slice(0, 50)) {
    if (!/^[0-9a-f]{40,64}$/.test(h)) continue
    if (h === commit) return null
    try {
      await g(['cat-file', '-e', `${h}^{commit}`], { cwd: root })
      known.push(h)
    } catch {
      /* not here */
    }
  }
  const ref = `refs/weevils-heavy/${commit.slice(0, 16)}-${process.pid}`
  await g(['update-ref', ref, commit], { cwd: root })
  try {
    await g(['bundle', 'create', '-q', out, ref, ...known.map((k) => `^${k}`)], { cwd: root })
    return { file: out, ref }
  } catch (e) {
    if (/empty bundle/i.test((e as Error).message)) return null
    throw e
  } finally {
    await g(['update-ref', '-d', ref], { cwd: root }).catch(() => undefined)
  }
}
