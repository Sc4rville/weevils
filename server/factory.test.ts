import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { FactoryError, publishFactory, pushFactory, realGit, scanSource, secretKinds, type Exec } from './factory.ts'

/** A key block's first line, put together here so that no file of the repository holds one. */
const keyBlock = (kind: string) => `-----BEGIN ${kind} ${'PRIVATE'} KEY-----`
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
/** A source repository with two commits, and a bare repository standing in for GitHub. */
function fixture(files: Record<string, string> = { 'automation.json': '{"id":"a"}', 'src/run.mjs': 'export {}\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-'))
  dirs.push(root)
  const dir = path.join(root, 'source')
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  sh(dir, 'init', '-q', '--initial-branch=main')
  fs.writeFileSync(path.join(dir, 'README.md'), '# a\n')
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'adopt')
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text)
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'grow')
  const hub = path.join(root, 'hub')
  fs.mkdirSync(hub)
  return { root, dir, hub }
}
/** gh, played: `existing` are the repositories the account already has; created ones become bare repositories. */
function fakeGh(hub: string, existing: string[] = []) {
  const calls: string[][] = []
  const have = new Set(existing)
  const gh: Exec = async (args) => {
    calls.push(args)
    if (args[0] === 'repo' && args[1] === 'view') { if (!have.has(args[2])) throw new Error('not found'); return '{}' }
    if (args[0] === 'repo' && args[1] === 'create') {
      have.add(args[2])
      execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', path.join(hub, args[2] + '.git')])
      return ''
    }
    return ''
  }
  return { gh, calls, have }
}
/** git, with github.com reached in the fixture's bare repositories (the recorded origin stays the real address). */
const gitTo = (hub: string): Exec => (args, cwd) => realGit(['-c', `url.${hub}/.insteadOf=https://github.com/`, ...args], cwd)

describe('what must never leave the machine', () => {
  it('names the kinds of secret, never a value', () => {
    expect(secretKinds(`${keyBlock('OPENSSH')}\nabc`)).toEqual(['private key'])
    expect(secretKinds(`token = ghp_${'a'.repeat(36)}`)).toEqual(['GitHub token'])
    expect(secretKinds('clone https://user:hunter2pw@example.com/x.git')).toEqual(['credentials in a URL'])
    expect(secretKinds('const key = process.env.API_KEY // sk- prefix, https://example.com/a:b')).toEqual([])
  })
  it('reads the whole history: a secret removed in a later commit still counts', async () => {
    const { dir } = fixture({ 'notes.txt': `ghp_${'b'.repeat(36)}\n` })
    fs.rmSync(path.join(dir, 'notes.txt'))
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'remove it')
    expect(await scanSource(dir)).toEqual(['GitHub token'])
    const env = fixture({ '.env': 'A=1\n' })
    expect(await scanSource(env.dir)).toEqual(['.env file'])
    expect(await scanSource(fixture().dir)).toEqual([])
  })
})

describe('a factory gets its own private repository', () => {
  it('creates it private, with its description and topics, and pushes the whole history', async () => {
    const { dir, hub } = fixture()
    const { gh, calls } = fakeGh(hub)
    const pub = await publishFactory({ dir, owner: 'someone', name: 'night-lens', description: 'Looks at the app every night.', topics: ['weevils', 'factory', 'My App!', 'weevils'], gh, git: gitTo(hub) })
    expect(pub).toEqual({ repository: 'someone/night-lens', url: 'https://github.com/someone/night-lens' })
    expect(calls).toContainEqual(['repo', 'create', 'someone/night-lens', '--private', '--description', 'Looks at the app every night.'])
    expect(calls).toContainEqual(['repo', 'edit', 'someone/night-lens', '--add-topic', 'weevils', '--add-topic', 'factory', '--add-topic', 'my-app'])
    expect(sh(path.join(hub, 'someone/night-lens.git'), 'log', '--format=%s', 'main')).toBe('grow\nadopt')
    expect(sh(dir, 'config', '--get', 'remote.origin.url')).toBe('https://github.com/someone/night-lens.git')
  })
  it('never takes over an existing repository: a taken name becomes <name>-factory, two taken names stop', async () => {
    const a = fixture()
    const first = fakeGh(a.hub, ['someone/night-lens'])
    expect((await publishFactory({ dir: a.dir, owner: 'someone', name: 'night-lens', description: 'd', topics: [], gh: first.gh, git: gitTo(a.hub) })).repository).toBe('someone/night-lens-factory')
    expect(first.calls.some((c) => c[1] === 'create' && c[2] === 'someone/night-lens')).toBe(false)
    const b = fixture()
    const both = fakeGh(b.hub, ['someone/night-lens', 'someone/night-lens-factory'])
    await expect(publishFactory({ dir: b.dir, owner: 'someone', name: 'night-lens', description: 'd', topics: [], gh: both.gh, git: gitTo(b.hub) })).rejects.toMatchObject({ code: 'taken', detail: 'someone/night-lens' })
    expect(both.calls.some((c) => c[1] === 'create')).toBe(false)
    expect(sh(b.dir, 'remote')).toBe('')
  })
  it('is resumable: a second call pushes again and creates nothing', async () => {
    const { dir, hub } = fixture()
    const { gh, calls } = fakeGh(hub)
    await publishFactory({ dir, owner: 'someone', name: 'x', description: 'd', topics: [], gh, git: gitTo(hub) })
    fs.writeFileSync(path.join(dir, 'README.md'), '# more\n')
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'later')
    await publishFactory({ dir, owner: 'someone', name: 'x', description: 'd', topics: [], gh, git: gitTo(hub) })
    expect(calls.filter((c) => c[1] === 'create')).toHaveLength(1)
    expect(sh(path.join(hub, 'someone/x.git'), 'log', '--format=%s', '-1', 'main')).toBe('later')
  })
  it('refuses a secret, a foreign origin and an impossible name before anything is created', async () => {
    const leak = fixture({ 'k.txt': `${keyBlock('RSA')}\n` })
    const g1 = fakeGh(leak.hub)
    await expect(publishFactory({ dir: leak.dir, owner: 'someone', name: 'x', description: 'd', topics: [], gh: g1.gh, git: gitTo(leak.hub) })).rejects.toMatchObject({ code: 'secret', detail: 'private key' })
    expect(g1.calls).toEqual([])
    const other = fixture()
    sh(other.dir, 'remote', 'add', 'origin', 'https://example.com/else.git')
    const g2 = fakeGh(other.hub)
    await expect(publishFactory({ dir: other.dir, owner: 'someone', name: 'x', description: 'd', topics: [], gh: g2.gh, git: gitTo(other.hub) })).rejects.toBeInstanceOf(FactoryError)
    expect(g2.calls).toEqual([])
    await expect(publishFactory({ dir: other.dir, owner: 'someone', name: '../x', description: 'd', topics: [], gh: g2.gh, git: gitTo(other.hub) })).rejects.toMatchObject({ code: 'name' })
  })
  it('a later revision is pushed as it is, and a source without origin is left alone', async () => {
    const { dir, hub } = fixture()
    expect(await pushFactory(dir, gitTo(hub))).toBe(false)
    const { gh } = fakeGh(hub)
    await publishFactory({ dir, owner: 'someone', name: 'x', description: 'd', topics: [], gh, git: gitTo(hub) })
    fs.writeFileSync(path.join(dir, 'README.md'), '# v2\n')
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'v2')
    expect(await pushFactory(dir, gitTo(hub))).toBe(true)
    expect(sh(path.join(hub, 'someone/x.git'), 'log', '--format=%s', '-1', 'main')).toBe('v2')
  })
})
