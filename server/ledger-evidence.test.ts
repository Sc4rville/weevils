import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { commitChanges, landedCommits, LandedCache, shippedBranches, shippedRefs, type LandedCommit } from './ledger-evidence.ts'

const T0 = Date.UTC(2026, 10, 14, 8, 0, 0)

/** A small repository: main with two commits, a side branch in a linked worktree, a « staging » branch. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-evidence-'))
  const main = path.join(dir, 'shop-app')
  fs.mkdirSync(main)
  const git = (cwd: string, at: number, ...args: string[]) => {
    const date = new Date(at).toISOString()
    return execFileSync('git', ['-C', cwd, '-c', 'user.name=alex', '-c', 'user.email=alex@example.com', '-c', 'commit.gpgsign=false', ...args], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
  }
  const commit = (cwd: string, at: number, file: string, text: string, message: string) => {
    fs.writeFileSync(path.join(cwd, file), text)
    git(cwd, at, 'add', '-A')
    git(cwd, at, 'commit', '-q', '-m', message)
  }
  git(main, T0, 'init', '-q', '-b', 'main')
  commit(main, T0 - 3600_000, 'cart.ts', 'export const cart = []\n', 'feat(cart): an empty cart')
  commit(main, T0 + 60_000, 'sidebar.ts', 'export const misc = false\n', 'feat(sidebar): hide the Misc section\n\nThe section shows only when it holds something.')
  const side = path.join(dir, 'wt-side')
  git(main, T0, 'worktree', 'add', '-q', '-b', 'feat/side', side)
  commit(side, T0 + 120_000, 'side.ts', 'export const side = 1\n', 'feat(side): work that still waits for a merge')
  git(main, T0, 'branch', 'staging')
  const staging = path.join(dir, 'wt-staging')
  git(main, T0, 'worktree', 'add', '-q', staging, 'staging')
  commit(staging, T0 + 180_000, 'preview.ts', 'export const preview = 1\n', 'feat(preview): the preview serves the new thread')
  return { main, side, staging }
}

describe('landed commits', () => {
  it('reads what landed on the default branch since a time, never a side branch, from any folder of the repository', async () => {
    const r = repo()
    const subjects = (list: LandedCommit[]) => list.map((c) => c.subject)
    const got = await landedCommits(r.main, T0, { extra: [] })
    expect(subjects(got)).toEqual(['feat(sidebar): hide the Misc section'])
    expect(got[0]).toMatchObject({ at: T0 + 60_000, branch: 'main', files: ['sidebar.ts'], body: 'The section shows only when it holds something.' })
    expect(got[0].id).toMatch(/^[0-9a-f]{8}$/)
    // Asked from the linked worktree: the same answer; its own branch is side work until it is merged.
    expect(subjects(await landedCommits(r.side, T0, { extra: [] }))).toEqual(['feat(sidebar): hide the Misc section'])
    expect(subjects(await landedCommits(r.main, T0 - 2 * 3600_000, { extra: [] }))).toEqual(['feat(sidebar): hide the Misc section', 'feat(cart): an empty cart'])
    // A branch the project serves, named in the setting, ships too.
    expect(subjects(await landedCommits(r.main, T0, { extra: ['staging'] }))).toEqual(['feat(preview): the preview serves the new thread', 'feat(sidebar): hide the Misc section'])
    expect((await landedCommits(r.main, T0, { extra: ['staging'] }))[0].branch).toBe('staging')
    // Not a repository: nothing, no error.
    expect(await landedCommits(os.tmpdir(), T0, { extra: [] })).toEqual([])
  })

  it('counts the branch checked out in the repository own folder, and reads the setting', async () => {
    const r = repo()
    expect((await shippedRefs(r.main, [])).map(([, name]) => name)).toEqual(['main'])
    expect((await shippedRefs(r.side, [])).map(([, name]) => name)).toEqual(['main'])
    execFileSync('git', ['-C', r.main, 'checkout', '-q', '-b', 'dev'])
    expect((await shippedRefs(r.main, [])).map(([, name]) => name)).toEqual(['main', 'dev'])
    expect(shippedBranches({ WEEVILS_SHIPPED_BRANCHES: ' staging, preview/next ,--all,' })).toEqual(['staging', 'preview/next'])
    expect(shippedBranches({})).toEqual([])
  })

  it('gives some of the lines a commit changed', async () => {
    const r = repo()
    const [c] = await landedCommits(r.main, T0, { extra: [] })
    expect(await commitChanges(r.main, c.id)).toBe('@ sidebar.ts\n+export const misc = false')
    expect(await commitChanges(r.main, 'not-a-commit; rm -rf')).toBe('')
  })

  it('reads a folder at most once per period, and again for a longer reach', async () => {
    let now = T0
    const reads: number[] = []
    const cache = new LandedCache(120_000, async (_cwd, since) => { reads.push(since); return [{ id: 'a', at: T0 + 10, subject: 's', body: '', files: [], branch: 'main' }, { id: 'b', at: T0 - 10, subject: 's', body: '', files: [], branch: 'main' }].filter((c) => c.at >= since) }, () => now)
    expect((await cache.get('/x', T0 - 100)).map((c) => c.id)).toEqual(['a', 'b'])
    expect((await cache.get('/x', T0)).map((c) => c.id)).toEqual(['a'])
    expect(reads).toEqual([T0 - 100])
    await cache.get('/x', T0 - 1000)
    expect(reads).toEqual([T0 - 100, T0 - 1000])
    now += 130_000
    await cache.get('/x', T0)
    expect(reads).toHaveLength(3)
  })
})
