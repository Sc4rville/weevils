import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_UNTRACKED_BYTES, hubRef, keepInWeevbook, projectRef, restoreCheckpoint, shadowRepo, takeCheckpoint } from './checkpoint.ts'

const THREAD = '01M7M8E6XR7ZVPYA7TRMHKHR25'
const roots: string[] = []
let gitConfig = ''
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), `weevils-ck-${name}-`))
  roots.push(d)
  return d
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' } })
const write = (f: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}
const hash = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
/** What the user sees of their repository: status, index, branches, stash, HEAD. Must not change (RESUME-1). */
const userView = (repo: string) => ({
  status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
  cached: git(repo, 'diff', '--cached'),
  branches: git(repo, 'branch', '-a', '-v'),
  stash: git(repo, 'stash', 'list'),
  head: git(repo, 'rev-parse', 'HEAD'),
  index: hash(path.join(repo, '.git', 'index')),
})
const files = (repo: string, commit: string) => git(repo, 'ls-tree', '-r', '--name-only', commit).trim().split('\n')
const show = (repo: string, spec: string) => git(repo, 'show', spec)

/** A project with two commits, a staged change, an unstaged change, an untracked file and an ignored one. */
function project(home: string) {
  const repo = path.join(home, 'projects', 'shop')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  write(path.join(repo, 'src/money.ts'), 'export const fmt = (n: number) => `${n}`\n')
  write(path.join(repo, 'README.md'), '# shop\n')
  write(path.join(repo, 'old.txt'), 'to be removed\n')
  write(path.join(repo, '.gitignore'), '.env\nnode_modules/\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'first')
  git(repo, 'remote', 'add', 'origin', 'https://tok123@github.com/alex/shop.git')
  write(path.join(repo, 'src/money.ts'), 'export const fmt = (n: number) => `${n} €`\n')
  write(path.join(repo, 'README.md'), '# shop\n\nstaged\n')
  git(repo, 'add', 'README.md')
  fs.rmSync(path.join(repo, 'old.txt'))
  write(path.join(repo, 'src/new.ts'), 'export const x = 1\n')
  write(path.join(repo, '.env'), 'SECRET=1\n')
  git(repo, 'stash', 'list')
  return repo
}

beforeAll(() => {
  gitConfig = path.join(tmp('cfg'), 'gitconfig')
  fs.writeFileSync(gitConfig, '')
  process.env.GIT_CONFIG_GLOBAL = gitConfig
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

describe('taking a checkpoint', () => {
  it('a git project: the folder as it is on disk, the user index, branches and stash untouched (RESUME-1)', async () => {
    const home = tmp('home')
    const repo = project(home)
    const before = userView(repo)
    const t = await takeCheckpoint({ cwd: path.join(repo, 'src'), thread: THREAD, turn: 2, home, dataDir: path.join(home, 'data') })
    expect(userView(repo)).toEqual(before)
    const f = t.fields
    expect(f.kind).toBe('git')
    expect(f.base).toBe(before.head.trim())
    expect(f.branch).toBe('main')
    expect(f.repo).toBe('https://github.com/alex/shop.git')
    expect(f.changed).toBe(4)
    expect(git(repo, 'rev-parse', projectRef(THREAD)).trim()).toBe(f.commit)
    // Tracked changes staged or not, deletions, untracked files; never what .gitignore leaves out.
    expect(files(repo, f.commit!).sort()).toEqual(['.gitignore', 'README.md', 'src/money.ts', 'src/new.ts'])
    expect(show(repo, `${f.commit}:src/money.ts`)).toContain('€')
    expect(show(repo, `${f.commit}:README.md`)).toContain('staged')
    expect(git(repo, 'log', '-1', '--format=%P %s', f.commit!).trim()).toBe(`${f.base} turn 2 · ${THREAD}`)
    // No branch lists it.
    expect(git(repo, 'branch', '-a')).not.toContain('weevils')
  })

  it('the next checkpoint has the previous one as second parent; nothing moved: the same commit', async () => {
    const home = tmp('home')
    const repo = project(home)
    const a = (await takeCheckpoint({ cwd: repo, thread: THREAD, turn: 1, home, dataDir: home })).fields.commit!
    expect((await takeCheckpoint({ cwd: repo, thread: THREAD, turn: 2, home, dataDir: home })).fields.commit).toBe(a)
    write(path.join(repo, 'src/new.ts'), 'export const x = 2\n')
    const b = (await takeCheckpoint({ cwd: repo, thread: THREAD, turn: 3, home, dataDir: home })).fields.commit!
    expect(git(repo, 'log', '-1', '--format=%P', b).trim().split(' ')).toEqual([git(repo, 'rev-parse', 'HEAD').trim(), a])
  })

  it('an untracked file over 5 MiB is left out and named; a tracked one is always in', async () => {
    const home = tmp('home')
    const repo = project(home)
    write(path.join(repo, 'big.bin'), Buffer.alloc(MAX_UNTRACKED_BYTES + 1, 1))
    const f = (await takeCheckpoint({ cwd: repo, thread: THREAD, turn: 1, home, dataDir: home })).fields
    expect(f.skipped).toEqual(['big.bin'])
    expect(files(repo, f.commit!)).not.toContain('big.bin')
  })

  it('a folder without git: a private repository of weevils, with its ignore list', async () => {
    const home = tmp('home')
    const dir = path.join(home, 'notes')
    write(path.join(dir, 'plan.md'), 'plan\n')
    write(path.join(dir, 'node_modules/x/index.js'), 'x\n')
    write(path.join(dir, 'debug.log'), 'log\n')
    const t = await takeCheckpoint({ cwd: dir, thread: THREAD, turn: 1, home, dataDir: path.join(home, 'data') })
    expect(t.fields.kind).toBe('shadow')
    expect(t.gitDir).toBe(shadowRepo(path.join(home, 'data'), THREAD))
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false)
    expect(execFileSync('git', ['--git-dir', t.gitDir!, 'ls-tree', '-r', '--name-only', t.fields.commit!], { encoding: 'utf8' }).trim()).toBe('plan.md')
  })

  it('a home folder: kind none, and the thread continues on that machine only', async () => {
    const home = tmp('home')
    expect((await takeCheckpoint({ cwd: home, thread: THREAD, turn: 1, home, dataDir: home })).fields).toEqual({ kind: 'none', reason: 'home folder' })
  })
})

describe('restoring a checkpoint on another machine', () => {
  async function setup() {
    const a = tmp('a')
    const repo = project(a)
    const origin = path.join(tmp('origin'), 'shop.git')
    git(repo, 'init', '-q', '--bare', origin)
    git(repo, 'push', '-q', origin, 'HEAD:main')
    const t = await takeCheckpoint({ cwd: repo, thread: THREAD, turn: 2, home: a, dataDir: a })
    // The weevbook of the other machine, with the checkpoint as the hub gave it.
    const book = path.join(tmp('book'), '.git')
    git(path.dirname(book), 'init', '-q', '--bare', book)
    await keepInWeevbook(book, t.gitDir!, THREAD)
    const b = tmp('b')
    const clone = path.join(b, 'projects', 'shop')
    git(b, 'clone', '-q', origin, clone)
    return { repo, t, book, b, clone, origin }
  }

  it('a clean clone at the base: in place, every file of the checkpoint and no other (RESUME-3)', async () => {
    const { t, book, b, clone } = await setup()
    const branches = git(clone, 'branch', '-a', '-v')
    const r = await restoreCheckpoint({ kind: 'git', commit: t.fields.commit!, base: t.fields.base, branch: 'main', thread: THREAD, slug: 'fix-money', dir: clone, fresh: false, source: book, dataDir: b })
    expect(r).toEqual({ dir: clone, mode: 'in-place' })
    expect(git(clone, 'branch', '-a', '-v')).toBe(branches)
    expect(fs.readFileSync(path.join(clone, 'src/money.ts'), 'utf8')).toContain('€')
    expect(fs.existsSync(path.join(clone, 'old.txt'))).toBe(false)
    expect(fs.existsSync(path.join(clone, 'src/new.ts'))).toBe(true)
    // git status shows the engine's work as changes on top of the base.
    expect(git(clone, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' D old.txt', ' M README.md', ' M src/money.ts', '?? src/new.ts'])
  })

  it("someone's uncommitted work: a worktree on a new branch weevils/<slug>, nothing overwritten (RESUME-4)", async () => {
    const { t, book, b, clone } = await setup()
    write(path.join(clone, 'src/money.ts'), 'mine\n')
    const before = userView(clone)
    const r = await restoreCheckpoint({ kind: 'git', commit: t.fields.commit!, base: t.fields.base, branch: 'main', thread: THREAD, slug: 'fix-money', dir: clone, fresh: false, source: book, dataDir: b })
    expect(r.mode).toBe('worktree')
    expect(r.branch).toBe('weevils/fix-money')
    expect(r.dir).toBe(`${clone}-weevils-fix-money`)
    expect(fs.readFileSync(path.join(clone, 'src/money.ts'), 'utf8')).toBe('mine\n')
    const after = userView(clone)
    expect({ ...after, branches: '' }).toEqual({ ...before, branches: '' })
    expect(git(clone, 'rev-parse', 'main').trim()).toBe(before.head.trim())
    expect(fs.readFileSync(path.join(r.dir, 'src/money.ts'), 'utf8')).toContain('€')
    expect(fs.existsSync(path.join(r.dir, 'old.txt'))).toBe(false)
  })

  it('a clone on another commit: a worktree, the branch is never moved', async () => {
    const { t, book, b, clone } = await setup()
    write(path.join(clone, 'later.txt'), 'later\n')
    git(clone, 'add', '-A')
    git(clone, 'commit', '-qm', 'later')
    const head = git(clone, 'rev-parse', 'HEAD')
    const r = await restoreCheckpoint({ kind: 'git', commit: t.fields.commit!, base: t.fields.base, branch: 'main', thread: THREAD, slug: 'fix', dir: clone, fresh: false, source: book, dataDir: b })
    expect(r.mode).toBe('worktree')
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('an empty folder: a repository of its own, on the base, with the files', async () => {
    const { t, book, b } = await setup()
    const dir = path.join(b, 'projects', 'shop-2')
    const r = await restoreCheckpoint({ kind: 'git', commit: t.fields.commit!, base: t.fields.base, branch: 'main', repo: t.fields.repo, thread: THREAD, slug: 'fix', dir, fresh: true, source: book, dataDir: b })
    expect(r).toEqual({ dir, mode: 'new', branch: 'main' })
    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(t.fields.base)
    expect(fs.readFileSync(path.join(dir, 'src/money.ts'), 'utf8')).toContain('€')
    expect(git(dir, 'remote', 'get-url', 'origin').trim()).toBe('https://github.com/alex/shop.git')
  })

  it('a folder without git: in place when empty, beside when it holds something else', async () => {
    const a = tmp('a')
    const dir = path.join(a, 'notes')
    write(path.join(dir, 'plan.md'), 'plan v2\n')
    const t = await takeCheckpoint({ cwd: dir, thread: THREAD, turn: 1, home: a, dataDir: a })
    const book = path.join(tmp('book'), '.git')
    git(path.dirname(book), 'init', '-q', '--bare', book)
    await keepInWeevbook(book, t.gitDir!, THREAD)
    expect(git(path.dirname(book), '--git-dir', book, 'rev-parse', hubRef(THREAD)).trim()).toBe(t.fields.commit)
    const b = tmp('b')
    const empty = path.join(b, 'notes')
    const r1 = await restoreCheckpoint({ kind: 'shadow', commit: t.fields.commit!, thread: THREAD, slug: 'plan', dir: empty, fresh: true, source: book, dataDir: b })
    expect(r1).toEqual({ dir: empty, mode: 'in-place' })
    expect(fs.readFileSync(path.join(empty, 'plan.md'), 'utf8')).toBe('plan v2\n')
    const other = path.join(b, 'other')
    write(path.join(other, 'plan.md'), 'someone else\n')
    const r2 = await restoreCheckpoint({ kind: 'shadow', commit: t.fields.commit!, thread: THREAD, slug: 'plan', dir: other, fresh: false, source: book, dataDir: b })
    expect(r2.mode).toBe('beside')
    expect(fs.readFileSync(path.join(other, 'plan.md'), 'utf8')).toBe('someone else\n')
    expect(fs.readFileSync(path.join(r2.dir, 'plan.md'), 'utf8')).toBe('plan v2\n')
  })
})
