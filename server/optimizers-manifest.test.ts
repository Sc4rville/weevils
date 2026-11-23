// Existing automations move to manifest schema 2 (docs/automations/PROTOCOL.md): their schedules and standing
// authorizations untouched. Hermetic: no agent, no model, no GitHub.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../shared/api.ts'
import { Memory } from './memory.ts'
import { Optimizers, type Sys } from './optimizers.ts'

vi.mock('./fast.ts', async (orig) => { const smart = vi.fn(); return { ...(await orig<typeof import('./fast.ts')>()), smart, claudeHaiku: (...a: any[]) => smart(...a), claudeAvailable: () => true, relay: vi.fn() } })
vi.mock('./setup.ts', () => ({ claudeLogged: vi.fn(() => true) }))
vi.mock('./i18n.ts', async (orig) => {
  const real = await orig<typeof import('./i18n.ts')>()
  return { ...real, lang: () => 'en', tr: (m: Record<string, unknown>) => m.en, user: () => 'Sam' }
})

const DAY = 86_400_000
const HOUR = 3_600_000
const T0 = new Date('2026-11-21T09:00:00Z').getTime()
let dir: string
let sys: Sys
const snap = { projects: [], sessions: [], mainWorking: false } as unknown as Snapshot

const make = () => new Optimizers(
  { snapshot: () => snap, allRepos: () => ['my-app'], repoDir: (r: string) => path.join(dir, 'p', r), createIn: vi.fn(), bump: vi.fn(), store: new Map(), hooks: new Map(), detail: vi.fn(), send: vi.fn() } as never,
  new Memory(path.join(dir, 'memory.json')),
  { file: path.join(dir, 'optimizers.json'), dir: path.join(dir, 'optimizers'), sys },
)
const runs = (n: number, bad = 0) => Array.from({ length: n }, (_, i) => ({ at: T0 - (n - i) * HOUR, startedAt: T0 - (n - i) * HOUR - 60_000, ok: i < n - bad, sessionId: `s${i}` }))
/** An accepted recurring automation, as an older weevils stored it. */
const auto = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: 'Opportunity hunter', why: 'Finds leads worth a reply.', scope: 'Reads public pages and lists leads; publishes nothing.', repo: null, kind: 'watch', heavy: false, state: 'queued',
  prompt: 'TOKEN=never-commit-this', createdAt: T0 - 9 * DAY, acceptedAt: T0 - 9 * DAY, every: 3 * HOUR, notBefore: T0 + HOUR, tz: 'Europe/Paris', window: { from: 60, to: 300 },
  talk: [{ who: 'user', text: 'private exchange', at: T0 - 10 * DAY }], runs: runs(30), runCount: 37, ...over,
})
const seed = (items: Record<string, unknown>[]) => fs.writeFileSync(path.join(dir, 'optimizers.json'), JSON.stringify({ items, lastRoundAt: T0, fails: 0, failUntil: 0 }))
const stored = () => JSON.parse(fs.readFileSync(path.join(dir, 'optimizers.json'), 'utf8')).items as any[]
const repo = (id: string) => path.join(dir, 'automation-workspaces', 'projects', `auto-${id}`)
const git = (id: string, ...args: string[]) => execFileSync('git', ['-C', repo(id), '-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgSign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const manifest = (id: string, rev = 'HEAD') => JSON.parse(git(id, 'show', `${rev}:automation.json`))
/** Everything the scheduler runs by: must come out of any manifest work byte-identical. */
const scheduler = (o: any) => { const { software: _s, name: _n, ...rest } = o; return rest }
const ready = async () => { const o = make(); await o.adoptAll(); return o }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizers-manifest-'))
  sys = { load: () => 0.2, cpus: () => 4, free: () => 8 * 1024 ** 3, logged: () => true, worktree: vi.fn(), jail: vi.fn(async () => true), head: vi.fn(async () => undefined), base: vi.fn(async () => undefined), refresh: vi.fn(async () => 'kept' as const), push: vi.fn(async () => false) } as unknown as Sys
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('existing automations move to manifest schema 2', () => {
  it('adds the manifest fields and a name; the schedule, scope, pause, target, runs and talk are not rewritten', async () => {
    const before = [auto('aaaa000001'), auto('bbbb000002', { title: 'Night lens', repo: 'my-app', onSleep: true, every: DAY, paused: true, waiting: 'paused' }), auto('cccc000003', { title: 'One-off check', every: undefined, window: undefined, state: 'done', endedAt: T0 - HOUR })]
    seed(before)
    await ready()
    const after = stored()
    expect(after.map(scheduler)).toEqual(JSON.parse(JSON.stringify(before)))
    expect(after.map((o) => o.name)).toEqual(['opportunity-hunter', 'night-lens', 'one-off-check'])
    expect(manifest('aaaa000001')).toMatchObject({ schemaVersion: 2, id: 'aaaa000001', kind: 'automation', name: 'opportunity-hunter', title: 'Opportunity hunter', purpose: 'Finds leads worth a reply.', owner: null, schedule: { trigger: 'every', every: '3h', window: '01:00-05:00' }, scope: 'Reads public pages and lists leads; publishes nothing.', entrypoint: 'src/run.mjs' })
    expect(manifest('bbbb000002')).toMatchObject({ owner: { repo: 'my-app' }, schedule: { trigger: 'sleep', every: '24h', window: '01:00-05:00' } })
    expect(manifest('cccc000003').schedule).toEqual({ trigger: 'time', at: new Date(T0 + HOUR).toISOString() })
    // Nothing private went into Git: not the brief, not the conversation, not the time zone.
    for (const id of ['aaaa000001', 'bbbb000002', 'cccc000003']) expect(git(id, 'log', '-p', '--all')).not.toMatch(/never-commit-this|private exchange|Europe\/Paris/)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'automation-workspaces', 'registry', 'automations', 'aaaa000001.json'), 'utf8'))).toMatchObject({ id: 'aaaa000001', name: 'opportunity-hunter', kind: 'automation', repository: '../projects/auto-aaaa000001' })
    // The mother folder says what it is, once; a README someone edited is kept.
    const readme = path.join(dir, 'automation-workspaces', 'README.md')
    expect(fs.readFileSync(readme, 'utf8')).toContain('one small Git repository per automation')
    fs.writeFileSync(readme, 'mine\n')
    await (await ready()).syncManifests(T0 + HOUR, true)
    expect(fs.readFileSync(readme, 'utf8')).toBe('mine\n')
  })

  it('the pinned source follows the manifest commit because the code that runs is identical', async () => {
    seed([auto('aaaa000001')])
    await ready()
    const [o] = stored()
    expect(git('aaaa000001', 'log', '--format=%s')).toBe('chore(manifest): schema 2\nchore(auto): adopt automation software source')
    expect(o.software.revision).toBe(git('aaaa000001', 'rev-parse', 'HEAD'))
    expect(git('aaaa000001', 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('automation.json')
    const pinned = path.join(dir, 'automation-workspaces', '.versions', 'aaaa000001', o.software.revision, 'src', 'run.mjs')
    expect(fs.readFileSync(pinned, 'utf8')).toBe(git('aaaa000001', 'show', 'HEAD~1:src/run.mjs') + '\n')
  })

  it('is stable: a second pass and a restart commit nothing', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    const head = git('aaaa000001', 'rev-parse', 'HEAD')
    await o.syncManifests(T0 + HOUR, true)
    await ready()
    expect(git('aaaa000001', 'rev-parse', 'HEAD')).toBe(head)
    expect(stored()[0].software.revision).toBe(head)
  })

  it('leaves alone what is not an automation yet, what runs, and a source with unsaved or unselected work', async () => {
    seed([
      auto('draft00001', { state: 'proposed', draft: true, acceptedAt: undefined, title: 'new automation' }),
      auto('refused001', { state: 'refused', acceptedAt: undefined }),
      auto('running001', { state: 'running', sessionId: 'live', startedAt: T0, seenWorking: true, title: 'Running one' }),
    ])
    await ready()
    expect(stored().map((o) => o.name)).toEqual([undefined, undefined, undefined])
    expect(manifest('draft00001').schemaVersion).toBe(1)
    expect(manifest('refused001').schemaVersion).toBe(1)
    // Unsaved work in a source: not touched. A commit that changes code, not yet selected: the manifest moves, the pin stays.
    seed([auto('dirty00001'), auto('grown00001', { title: 'Grown one' })])
    const o = await ready()
    const pinnedDirty = stored()[0].software.revision
    fs.writeFileSync(path.join(repo('dirty00001'), 'src', 'run.mjs'), '// in progress\n')
    fs.writeFileSync(path.join(repo('grown00001'), 'src', 'extra.mjs'), 'export const x = 1\n')
    git('grown00001', 'add', '-A'); git('grown00001', 'commit', '-q', '-m', 'feat: a step of its own')
    const pinnedGrown = stored()[1].software.revision
    o.label('dirty00001', { title: 'Renamed dirty' })
    o.label('grown00001', { title: 'Renamed grown' })
    await o.syncManifests(T0 + HOUR, true)
    expect(manifest('dirty00001').title).toBe('Opportunity hunter')
    expect(stored()[0].software.revision).toBe(pinnedDirty)
    expect(manifest('grown00001').title).toBe('Renamed grown')
    expect(stored()[1].software.revision).toBe(pinnedGrown)
  })

  it('the mirror follows the app and never drives: a renamed automation keeps its name, an edit in Git changes nothing live', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    o.label('aaaa000001', { title: 'Lead finder' })
    await o.syncManifests(T0 + HOUR, true)
    expect(manifest('aaaa000001')).toMatchObject({ name: 'opportunity-hunter', title: 'Lead finder' })
    expect(git('aaaa000001', 'log', '--format=%s', '-1')).toBe("chore(manifest): mirror the scheduler's record")
    // Someone commits a wider scope and a faster schedule into the manifest.
    const m = manifest('aaaa000001')
    fs.writeFileSync(path.join(repo('aaaa000001'), 'automation.json'), JSON.stringify({ ...m, scope: 'May do anything.', schedule: { trigger: 'every', every: '1m' } }, null, 2) + '\n')
    git('aaaa000001', 'commit', '-q', '-am', 'chore: widen it')
    const live = scheduler(stored()[0])
    await o.syncManifests(T0 + 2 * HOUR, true)
    expect(scheduler(stored()[0])).toEqual(live)
    expect(manifest('aaaa000001')).toMatchObject({ scope: 'Reads public pages and lists leads; publishes nothing.', schedule: { trigger: 'every', every: '3h', window: '01:00-05:00' } })
  })
})

