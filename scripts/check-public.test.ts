// The public guard (scripts/check-public.mjs): what is personal never reaches the public repository. Each case runs
// the real script on a throwaway repository, with a throwaway HOME and no network.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.join(import.meta.dirname, 'check-public.mjs')
const BASE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'public-guard.json'), 'utf8'))
const NOREPLY = '1+dev@users.noreply.github.com'
const PUBLIC = 'https://github.com/Sc4rville/weevils.git'
const ZERO = '0'.repeat(40)
let dir: string, repo: string, home: string

const env = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  WEEVILS_PUBLIC_GUARD_HOST: 'localhost', WEEVILS_PUBLIC_GUARD_CONFIG: path.join(dir, 'guard.json'), ...extra,
})
const git = (args: string[], mail = NOREPLY) => {
  const r = spawnSync('git', ['-c', 'user.name=dev', '-c', `user.email=${mail}`, '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env: env(), encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text) }
const commit = (file: string, text: string, message = `add ${file}`, mail = NOREPLY) => { write(file, text); git(['add', '-A']); git(['commit', '-q', '-m', message], mail); return git(['rev-parse', 'HEAD']) }
const guard = (args: string[], opts: { env?: Record<string, string>; input?: string } = {}) => {
  const r = spawnSync('node', [SCRIPT, ...args], { cwd: repo, env: env(opts.env), input: opts.input ?? '', encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
/** The repository's own rules, with what a case changes: by default every commit is checked, whatever its date. */
const config = (change: Record<string, unknown> = {}) => { const file = path.join(dir, `guard-${Object.keys(change).join('-') || 'base'}.json`); fs.writeFileSync(file, JSON.stringify({ ...BASE, enforcedSince: undefined, ...change })); return { WEEVILS_PUBLIC_GUARD_CONFIG: file } }
const markers = (...lines: string[]) => { const file = path.join(dir, 'markers.txt'); fs.writeFileSync(file, lines.join('\n')); return { WEEVILS_PUBLIC_MARKERS: file } }

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-guard-'))
  repo = path.join(dir, 'repo'); home = path.join(dir, 'home')
  fs.mkdirSync(repo); fs.mkdirSync(home)
  fs.copyFileSync(config().WEEVILS_PUBLIC_GUARD_CONFIG, path.join(dir, 'guard.json'))
  git(['init', '-q', '-b', 'main'])
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('the tracked files', () => {
  it('passes neutral examples and says so', () => {
    commit('a.ts', 'const p = "/home/user/projects/app"\nconst q = "/Users/alex/x"\nconst m = "alex+weevils@gmail.com, you@gmail.com, bots@example.com"\n')
    expect(guard([])).toMatchObject({ code: 0, out: expect.stringContaining('no personal trace') })
  })
  it('refuses a real home folder, a real-looking mailbox, a private key and a machine-only file, naming each', () => {
    commit('a.ts', 'const p = "/home/jane/projects/app"\nconst m = "jane.doe@gmail.com"\n')
    commit('notes/key.txt', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n')
    commit('.env', 'TOKEN=1\n')
    const r = guard([])
    expect(r.code).toBe(1)
    expect(r.out).toContain('a.ts:1: a real home folder (/home/jane)')
    expect(r.out).toContain('a.ts:2: a real-looking mailbox (jane.doe@gmail.com)')
    expect(r.out).toContain('notes/key.txt:1: a private key block')
    expect(r.out).toContain('.env: a file that only belongs on a machine')
    expect(r.out).toContain('CONTRIBUTING.md')
  })
  it('reads the working tree, so a trace is caught before it is committed', () => {
    commit('a.ts', 'ok\n')
    write('a.ts', 'see /Users/jane/Desktop\n')
    expect(guard([]).code).toBe(1)
  })
  it('skips a line marked as a deliberate fake, a path inside another path, and binary files', () => {
    commit('a.ts', 'const fake = "/home/jane/x" // public-guard:allow a fake for the redaction test\nconst other = "/srv/other/home/jane"\n')
    commit('pic.bin', '\u0000/home/jane/\u0000')
    expect(guard([]).code).toBe(0)
  })
  it('refuses this machine’s own host name, read from the machine and written nowhere', () => {
    commit('a.md', 'deployed on srv-test-4242 yesterday\n')
    expect(guard([]).code).toBe(0)
    const r = guard([], { env: { WEEVILS_PUBLIC_GUARD_HOST: 'srv-test-4242.example.net' } })
    expect(r).toMatchObject({ code: 1, out: expect.stringContaining('this machine’s host name') })
  })
  it('leaves the owner’s own markers to the push: what is already there is listed by --audit, never failed', () => {
    commit('a.md', 'the Zorglub project\n')
    expect(guard([], { env: markers('\\bzorglub\\b') }).code).toBe(0)
    expect(guard(['--audit'], { env: markers('# mine', '\\bzorglub\\b') })).toMatchObject({ code: 0, out: expect.stringContaining('\\bzorglub\\b: 1 line(s) in 1 file(s)') })
  })
})

describe('what a range of commits adds', () => {
  it('refuses a commit signed with a personal e-mail and accepts a GitHub noreply one', () => {
    const first = commit('a.ts', 'one\n')
    commit('b.ts', 'two\n', 'add b', 'jane.doe@gmail.com')
    const r = guard(['--range', `${first}..HEAD`])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/commit [0-9a-f]{8}: the author’s e-mail is not a GitHub noreply address/)
    commit('c.ts', 'three\n')
    expect(guard(['--range', 'HEAD~1..HEAD']).code).toBe(0)
  })
  it('refuses the owner’s markers in an added line and in a commit message, not in what was already there', () => {
    const first = commit('a.md', 'the Zorglub project, long published\n')
    commit('a.md', 'the Zorglub project, long published\nand a neutral line\n')
    const own = markers('\\bzorglub\\b', 'secret-domain\\.example')
    expect(guard(['--range', `${first}..HEAD`], { env: own }).code).toBe(0)
    commit('b.md', 'see https://secret-domain.example/page\n', 'docs: what Zorglub asked for')
    const r = guard(['--range', `${first}..HEAD`], { env: own })
    expect(r.code).toBe(1)
    expect(r.out).toContain('b.md: one of your own markers (secret-domain\\.example)')
    expect(r.out).toMatch(/commit [0-9a-f]{8}, message: one of your own markers \(\\bzorglub\\b\)/)
  })
  it('refuses a trace added then removed inside the range: the history would still publish it', () => {
    const first = commit('a.ts', 'one\n')
    commit('a.ts', 'one\n/home/jane/secret\n')
    commit('a.ts', 'one\n')
    expect(guard(['--range', `${first}..HEAD`])).toMatchObject({ code: 1, out: expect.stringContaining('a real home folder (/home/jane)') })
  })
})

describe('work written before the guard existed', () => {
  it('is spared the two rules it could not know, the identity and the owner’s markers, and nothing else', () => {
    const first = commit('a.ts', 'one\n')
    const old = { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' }
    write('b.md', 'the Zorglub project\n')
    git(['add', '-A'])
    const r0 = spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=jane.doe@gmail.com', 'commit', '-q', '-m', 'old work'], { cwd: repo, env: { ...env(), ...old }, encoding: 'utf8' })
    expect(r0.status).toBe(0)
    const own = { ...markers('\\bzorglub\\b'), ...config({ enforcedSince: '2021-01-01T00:00:00Z' }) }
    expect(guard(['--range', `${first}..HEAD`], { env: own }).code).toBe(0)
    expect(guard(['--range', `${first}..HEAD`], { env: markers('\\bzorglub\\b') }).code).toBe(1)
    write('c.ts', '/home/jane/x\n')
    git(['add', '-A'])
    spawnSync('git', ['-c', 'user.name=dev', '-c', 'user.email=jane.doe@gmail.com', 'commit', '-q', '-m', 'old trace'], { cwd: repo, env: { ...env(), ...old }, encoding: 'utf8' })
    expect(guard(['--range', `${first}..HEAD`], { env: own })).toMatchObject({ code: 1, out: expect.stringContaining('a real home folder (/home/jane)') })
  })
})

describe('the pre-push hook', () => {
  it('leaves any other remote alone', () => {
    const sha = commit('a.ts', '/home/jane/x\n', 'add', 'jane.doe@gmail.com')
    expect(guard(['--pre-push', 'private', 'https://github.com/someone/weevils-private.git'], { input: `refs/heads/x ${sha} refs/heads/x ${ZERO}\n` })).toMatchObject({ code: 0, out: '' })
    expect(guard(['--pre-push', 'fork', 'https://github.com/someone/weevils.git'], { input: `refs/heads/x ${sha} refs/heads/x ${ZERO}\n` }).code).toBe(0)
  })
  it('refuses a branch that is not built on the public history', () => {
    const sha = commit('a.ts', 'one\n')
    const r = guard(['--pre-push', PUBLIC, PUBLIC], { input: `refs/heads/x ${sha} refs/heads/x ${ZERO}\n` })
    expect(r).toMatchObject({ code: 1, out: expect.stringContaining('not built on the public history') })
  })
  it('checks only what the push adds to the public repository, for a new branch and for an update', () => {
    const root = commit('a.ts', 'one\n')
    const cfg = config({ historyRoot: root })
    const old = commit('old.ts', '/home/jane/already-public\n', 'old', 'jane.doe@gmail.com')
    git(['remote', 'add', 'origin', PUBLIC])
    git(['update-ref', 'refs/remotes/origin/main', old])
    const good = commit('b.ts', 'two\n')
    // A new branch: only the commits the public repository does not have yet.
    expect(guard(['--pre-push', 'origin', PUBLIC], { env: cfg, input: `refs/heads/x ${good} refs/heads/x ${ZERO}\n` }).code).toBe(0)
    const bad = commit('c.ts', 'mail jane.doe@gmail.com\n')
    // An update of a branch already there: from what the remote has.
    const r = guard(['--pre-push', PUBLIC, PUBLIC], { env: cfg, input: `refs/heads/x ${bad} refs/heads/x ${good}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toContain('this push to github.com/Sc4rville/weevils is refused')
    expect(r.out).toContain('c.ts: a real-looking mailbox (jane.doe@gmail.com)')
    expect(r.out).not.toContain('already-public')
    // Deleting a branch publishes nothing.
    expect(guard(['--pre-push', 'origin', PUBLIC], { env: cfg, input: `(delete) ${ZERO} refs/heads/x ${good}\n` }).code).toBe(0)
  })
})
