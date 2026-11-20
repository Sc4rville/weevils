import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { accountHash, factsOf, machineEngines, parseEngines, publishEngines, quotaFrom, readEngines } from './engines.ts'
import { REMOTE } from './hub.ts'
import { runGit } from './gitrun.ts'

const NOW = Date.parse('2026-11-20T10:00:00Z')
const quota = (session: number, week: number) => async () => ({ ok: true, source: 't', at: NOW - 1000, windows: [{ kind: 'session' as const, percent: session, resetsAt: NOW + 3600_000 }, { kind: 'week' as const, percent: week, resetsAt: null }] })
const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("a machine's engines.json", () => {
  it('lists each signed-in account once, with its quota; an unknown account is left out', async () => {
    const j = await machineEngines('laptop (home)', ['shop', 'blog'], [
      { provider: 'claude', account: 'a3f9c1', signedIn: true, quota: quota(40, 12) },
      { provider: 'claude', account: 'a3f9c1', signedIn: true, quota: quota(40, 12) },
      { provider: 'codex', account: 'b7e2d0', signedIn: false, quota: quota(0, 0) },
      { provider: 'codex', account: 'unknown', signedIn: true, quota: quota(0, 0) },
    ], NOW)
    expect(j).toMatchObject({ v: 1, machine: 'laptop--home-', projects: ['blog', 'shop'], engines: [{ engine: 'claude:a3f9c1@laptop--home-', signedIn: true }, { engine: 'codex:b7e2d0@laptop--home-', signedIn: false }] })
    expect(Object.keys(j.quotas)).toEqual(['claude:a3f9c1'])
    const f = factsOf(parseEngines(JSON.stringify(j))!)
    expect(f.seen).toBe(NOW)
    expect(f.quotas['claude:a3f9c1']).toEqual({ readAt: NOW - 1000, fiveHour: { used: 40, resetsAt: NOW + 3600_000 }, week: { used: 12, resetsAt: null } })
    expect(parseEngines('{"v":2}')).toBeNull()
    expect(quotaFrom({ ok: false, source: 't', at: 0, windows: [] }, NOW)).toBeNull()
    expect(accountHash('x')).toMatch(/^[0-9a-f]{6}$/)
  })
  it('goes to refs/engines/<machine> on the hub, replaced each time, and the dispatcher reads them all', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weevbook-engines-'))
    tmp.push(root)
    const hub = path.join(root, 'hub.git')
    await runGit(['init', '-q', '--bare', hub])
    const clone = async (name: string) => {
      const dir = path.join(root, name)
      await runGit(['init', '-q', '--bare', dir])
      await runGit(['--git-dir', dir, 'remote', 'add', REMOTE, hub])
      return (args: readonly string[], o: { input?: string; env?: Record<string, string> } = {}) => runGit(['--git-dir', dir, ...args], o)
    }
    const laptop = await clone('laptop')
    const server = await clone('server')
    expect(await publishEngines(laptop, await machineEngines('laptop', ['shop'], [{ provider: 'claude', account: 'a3f9c1', signedIn: true, quota: quota(10, 1) }], NOW))).toBe(true)
    expect(await publishEngines(laptop, await machineEngines('laptop', ['shop'], [{ provider: 'claude', account: 'a3f9c1', signedIn: true, quota: quota(55, 1) }], NOW + 60_000))).toBe(true)
    expect(await publishEngines(server, await machineEngines('server', [], [], NOW))).toBe(true)
    const all = (await readEngines(server))!
    expect(all.map((j) => j.machine).sort()).toEqual(['laptop', 'server'])
    expect(all.find((j) => j.machine === 'laptop')!.quotas['claude:a3f9c1'].fiveHour.used).toBe(55)
    // One commit with no parent per machine.
    expect((await runGit(['--git-dir', hub, 'rev-list', '--count', 'refs/engines/laptop'])).stdout.trim()).toBe('1')
  })
})
