// From automation to factory (docs/automations/PROTOCOL.md): the move of existing automations to manifest schema 2
// (their schedules and standing authorizations untouched), the measured signals, weevboss's one line, the person's
// unlock and what it leaves alone. Hermetic: no agent, no model, no GitHub (a stand-in publishes).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Optimizer, Snapshot } from '../shared/api.ts'
import { FACTORY } from '../shared/factory.ts'
import { Memory } from './memory.ts'
import { Optimizers, optimizerRoutes, type Sys } from './optimizers.ts'

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
let foryou: { add: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> }
let publish: ReturnType<typeof vi.fn>
let asks: { text: string; at: number; dispatches: { session: string }[] }[]
const snap = { projects: [], sessions: [], mainWorking: false } as unknown as Snapshot

const make = () => new Optimizers(
  { snapshot: () => snap, allRepos: () => ['my-app'], repoDir: (r: string) => path.join(dir, 'p', r), createIn: vi.fn(), bump: vi.fn(), store: new Map(), hooks: new Map(), detail: vi.fn(), send: vi.fn(), foryou, ledger: { asks: () => asks } } as never,
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
const scheduler = (o: any) => { const { software: _s, name: _n, factory: _f, promo: _p, usage: _u, ...rest } = o; return rest }
const ready = async () => { const o = make(); await o.adoptAll(); return o }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizers-factory-'))
  publish = vi.fn(async (o: { owner: string; name: string }) => ({ repository: `${o.owner}/${o.name}`, url: `https://github.com/${o.owner}/${o.name}` }))
  sys = { load: () => 0.2, cpus: () => 4, free: () => 8 * 1024 ** 3, logged: () => true, worktree: vi.fn(), jail: vi.fn(async () => true), head: vi.fn(async () => undefined), base: vi.fn(async () => undefined), refresh: vi.fn(async () => 'kept' as const), push: vi.fn(async () => false), ghOwner: async () => 'someone', publish, pushSource: vi.fn(async () => true) } as unknown as Sys
  foryou = { add: vi.fn(), dismiss: vi.fn() }
  asks = []
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

describe('eligible: measured, shown in two places, paced', () => {
  it('says why on the automation itself, only when it is mature and has one more reason', async () => {
    seed([auto('proven0001'), auto('young00001', { title: 'Young one', runs: runs(6), runCount: 6 }), auto('shaky00001', { title: 'Shaky one', runs: runs(30, 3) }), auto('builtin001', { title: 'Cost saver', builtin: 'cost' })])
    const o = await ready()
    const list = o.list(T0)
    expect(list.find((x) => x.id === 'proven0001')?.promotion).toEqual({ reasons: [{ kind: 'proven', runs: 37, ok: 10, of: 10 }] })
    for (const id of ['young00001', 'shaky00001', 'builtin001']) expect(list.find((x) => x.id === id)?.promotion).toBeUndefined()
    expect(o.signalsOf('young00001', T0)).toMatchObject({ mature: false, eligible: false, signals: { runs: 6, lastOk: 6, lastOf: 6, ageDays: 9 } })
    // Nothing of the bookkeeping reaches the app.
    expect(list[0]).not.toHaveProperty('usage')
    expect(list[0]).not.toHaveProperty('promo')
  })

  it('its source grew when someone committed to it: weevils’ own manifest commits never count', async () => {
    seed([auto('aaaa000001', { runs: runs(12).map((r, i) => (i === 11 ? { ...r, page: 'report/leads' } : r)), runCount: 12 })])
    const o = await ready()
    o.label('aaaa000001', { title: 'Lead finder' })
    await o.syncManifests(T0 + HOUR, true)
    expect(git('aaaa000001', 'rev-list', '--count', 'HEAD')).toBe('3')
    expect(o.signalsOf('aaaa000001', T0)?.signals).toMatchObject({ commits: 0, resultsPage: true })
    for (const n of [1, 2, 3]) {
      fs.writeFileSync(path.join(repo('aaaa000001'), 'src', `step${n}.mjs`), `export const n = ${n}\n`)
      git('aaaa000001', 'add', '-A'); git('aaaa000001', 'commit', '-q', '-m', `feat: step ${n}`)
    }
    await o.syncManifests(T0 + 2 * HOUR, true)
    expect(o.signalsOf('aaaa000001', T0)).toMatchObject({ eligible: true, reasons: [{ kind: 'grown', commits: 3 }] })
    expect(manifest('aaaa000001').results).toEqual({ page: 'report/leads' })
  })

  it('counts what the person did: opens (once a minute per kind), run now, their words, their requests', async () => {
    seed([auto('aaaa000001', { runs: runs(12), runCount: 12, talk: [{ who: 'user', text: 'tighter please', at: T0 - DAY }, { who: 'auto', text: 'done', at: T0 - DAY }] })])
    const o = await ready()
    expect(o.list(T0)[0].promotion).toBeUndefined()
    for (let d = 0; d < 4; d++) for (const kind of ['page', 'run', 'results'] as const) { o.seen('aaaa000001', kind, T0 + d * DAY); o.seen('aaaa000001', kind, T0 + d * DAY + 1000) }
    expect(o.signalsOf('aaaa000001', T0 + 4 * DAY)?.signals).toMatchObject({ consumed: 12, consumedDays: 4, pushes: 1 })
    expect(o.list(T0 + 4 * DAY)[0].promotion?.reasons).toEqual([{ kind: 'used', count: 12, days: 4 }])
    asks = [{ text: 'make opportunity hunter stricter', at: T0, dispatches: [] }, { text: 'something else', at: T0, dispatches: [{ session: 's3' }] }, { text: 'opportunity hunter last month', at: T0 - 40 * DAY, dispatches: [] }]
    expect(o.signalsOf('aaaa000001', T0 + 4 * DAY + 6 * 60_000)?.signals.requests).toBe(2)
  })

  it('weevboss says it once, for one automation at a time, one a week at most', async () => {
    seed([auto('aaaa000001'), auto('bbbb000002', { title: 'Ad maker', runCount: 50 })])
    const o = await ready()
    ;(o as any).auto = true
    o.tick(T0)
    expect(foryou.add).toHaveBeenCalledTimes(1)
    expect(foryou.add.mock.calls[0][0]).toMatchObject({ id: 'factory:bbbb000002', who: 'weevboss', kind: 'boss', open: { page: 'auto', id: 'bbbb000002' } })
    expect(foryou.add.mock.calls[0][0].text).toBe('Ad maker can become a factory: 50 runs, 10 of the last 10 good.')
    expect(foryou.add.mock.calls[0][0]).not.toHaveProperty('actions')
    // A week later the first one is still open: no second line.
    o.tick(T0 + 8 * DAY)
    expect(foryou.add).toHaveBeenCalledTimes(1)
    // Put off: the next one may be said, a week after the last line; the first stays silent.
    o.notNow('bbbb000002', T0 + 8 * DAY)
    expect(foryou.dismiss).toHaveBeenCalledWith('factory:bbbb000002')
    expect(o.list(T0 + 8 * DAY).find((x) => x.id === 'bbbb000002')?.promotion).toBeUndefined()
    o.tick(T0 + 8 * DAY + 60_000)
    expect(foryou.add.mock.calls.map((c) => c[0].id)).toEqual(['factory:bbbb000002', 'factory:aaaa000001'])
  })

  it('« not now » holds for a month and ten more runs; after three, weevboss never says it again', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    o.notNow('aaaa000001', T0)
    const item = () => (o as any).s.items[0]
    expect(o.list(T0 + 31 * DAY)[0].promotion).toBeUndefined()
    item().runCount = 47
    expect(o.list(T0 + 29 * DAY)[0].promotion).toBeUndefined()
    expect(o.list(T0 + 31 * DAY)[0].promotion).toBeDefined()
    item().promo.laterCount = FACTORY.MAX_LATER
    ;(o as any).auto = true
    o.tick(T0 + 40 * DAY)
    expect(foryou.add).not.toHaveBeenCalled()
    expect(o.list(T0 + 40 * DAY)[0].promotion).toBeDefined()
  })
})

describe('the unlock', () => {
  it('marks the source, makes it a factory at once and publishes its repository; the scheduler is not rewritten', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    const before = scheduler(stored()[0])
    const item = o.unlock('aaaa000001', T0) as Optimizer
    expect(item.factory).toMatchObject({ name: 'opportunity-hunter', unlockedAt: T0, remote: 'pending' })
    expect(item.promotion).toBeUndefined()
    await vi.waitFor(() => expect(stored()[0].factory.remote).toBe('pushed'))
    expect(publish).toHaveBeenCalledWith({ dir: repo('aaaa000001'), owner: 'someone', name: 'opportunity-hunter', description: 'Reads public pages and lists leads; publishes nothing.', topics: ['weevils', 'factory', 'automation'] })
    expect(stored()[0].factory.repository).toBe('someone/opportunity-hunter')
    expect(scheduler(stored()[0])).toEqual(before)
    expect(manifest('aaaa000001')).toMatchObject({ kind: 'factory', name: 'opportunity-hunter', factory: { name: 'opportunity-hunter', unlockedAt: new Date(T0).toISOString() }, entrypoint: 'src/run.mjs', schedule: { trigger: 'every', every: '3h', window: '01:00-05:00' } })
    expect(git('aaaa000001', 'log', '--format=%s', '-1')).toBe('feat(factory): opportunity-hunter becomes a factory')
    expect(git('aaaa000001', 'diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('automation.json')
    expect(stored()[0].software.revision).toBe(git('aaaa000001', 'rev-parse', 'HEAD'))
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'automation-workspaces', 'registry', 'automations', 'aaaa000001.json'), 'utf8'))).toMatchObject({ kind: 'factory', remote: 'https://github.com/someone/opportunity-hunter' })
    expect(foryou.dismiss).toHaveBeenCalledWith('factory:aaaa000001')
    // A second tap changes nothing and creates nothing.
    expect((o.unlock('aaaa000001', T0 + 1000) as Optimizer).factory?.unlockedAt).toBe(T0)
    expect(publish).toHaveBeenCalledTimes(1)
    // A later manifest pass keeps it a factory.
    await o.syncManifests(T0 + HOUR, true)
    expect(manifest('aaaa000001').kind).toBe('factory')
  })

  it('refuses what has not earned it, and a source with unsaved work, changing nothing', async () => {
    seed([auto('young00001', { runs: runs(6), runCount: 6 }), auto('dirty00001', { title: 'Dirty one' })])
    const o = await ready()
    expect(o.unlock('young00001', T0)).toBe('no')
    expect(o.unlock('nope', T0)).toBeNull()
    fs.writeFileSync(path.join(repo('dirty00001'), 'src', 'run.mjs'), '// in progress\n')
    expect(() => o.unlock('dirty00001', T0)).toThrow(/uncommitted/)
    expect(stored().map((x) => x.factory)).toEqual([undefined, undefined])
    expect(publish).not.toHaveBeenCalled()
  })

  it('without GitHub the factory is unlocked here and its repository waits; with a refusal it says which', async () => {
    seed([auto('aaaa000001'), auto('bbbb000002', { title: 'Ad maker' })])
    sys.ghOwner = async () => null
    const o = await ready()
    o.unlock('aaaa000001', T0)
    await vi.waitFor(() => expect(stored()[0].factory.note).toBe('github'))
    expect(stored()[0].factory.remote).toBe('pending')
    expect(publish).not.toHaveBeenCalled()
    sys.ghOwner = async () => 'someone'
    const { FactoryError } = await import('./factory.ts')
    publish.mockRejectedValueOnce(new FactoryError('secret', 'private key'))
    // A restart with GitHub connected: the first factory's repository is published at last, the second one refused.
    const again = await ready()
    await vi.waitFor(() => expect(stored()[0].factory).toMatchObject({ remote: 'pending', note: 'secret', detail: 'private key' }))
    again.unlock('bbbb000002', T0)
    await vi.waitFor(() => expect(stored()[1].factory).toMatchObject({ remote: 'pushed', repository: 'someone/ad-maker' }))
    // A refusal that a retry cannot fix is not tried again by itself.
    await again.syncManifests(T0 + HOUR, true)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('reads the page and the numbers a factory declares from its selected source only', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    o.unlock('aaaa000001', T0)
    await vi.waitFor(() => expect(stored()[0].factory.remote).toBe('pushed'))
    const m = manifest('aaaa000001')
    fs.writeFileSync(path.join(repo('aaaa000001'), 'automation.json'), JSON.stringify({ ...m, metrics: [{ key: 'leads', label: 'Leads' }], page: { panels: [{ type: 'hero' }, { type: 'iframe' }, { type: 'metrics', items: [{ key: 'leads' }] }] } }, null, 2) + '\n')
    git('aaaa000001', 'commit', '-q', '-am', 'feat(page): its own panels')
    expect(o.list(T0)[0].factory?.panels).toBeUndefined()
    o.promoteSoftware('aaaa000001', git('aaaa000001', 'rev-parse', 'HEAD'))
    expect(o.list(T0)[0].factory).toMatchObject({ panels: [{ type: 'hero' }, { type: 'metrics', items: [{ key: 'leads' }] }], metrics: [{ key: 'leads', label: 'Leads' }] })
    expect(sys.pushSource).toHaveBeenCalledWith(repo('aaaa000001'))
  })
})

describe('the routes', () => {
  const call = async (o: Optimizers, method: string, url: string, req: Record<string, unknown>, body: unknown = {}) => {
    const chunks: Buffer[] = []
    const res = Object.assign(new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb() } }), { status: 0, writeHead(s: number) { this.status = s; return this } })
    const json = (r: typeof res, status: number, b: unknown) => { r.writeHead(status); r.end(JSON.stringify(b)) }
    const u = new URL(url, 'http://x')
    for (const [m, re, h] of optimizerRoutes(o, json as never, async () => body)) {
      const p = m === method ? re.exec(u.pathname) : null
      if (!p) continue
      const done = new Promise((r) => res.on('finish', r))
      await h(req as never, res as never, u, p.slice(1))
      await done
      return { status: res.status, body: JSON.parse(Buffer.concat(chunks).toString()) }
    }
    throw new Error(`no route ${method} ${url}`)
  }
  const browser = { headers: {}, socket: { remoteAddress: '203.0.113.7' }, url: '/' }
  const script = { headers: { 'x-weevils-automated': '1' }, socket: { remoteAddress: '203.0.113.7' }, url: '/' }

  it('only the person unlocks, puts off, or is counted; anyone may read the signals', async () => {
    seed([auto('aaaa000001')])
    const o = await ready()
    expect((await call(o, 'GET', '/api/auto/aaaa000001/signals', script)).body).toMatchObject({ eligible: true, mature: true, signals: { runs: 37 }, thresholds: { MATURE_RUNS: 10 } })
    expect(await call(o, 'POST', '/api/auto/aaaa000001/factory/unlock', script)).toMatchObject({ status: 403 })
    expect(await call(o, 'POST', '/api/auto/aaaa000001/factory/later', script)).toMatchObject({ status: 403 })
    expect(await call(o, 'POST', '/api/auto/aaaa000001/factory/unlock', {})).toMatchObject({ status: 403 })
    expect((await call(o, 'POST', '/api/auto/aaaa000001/seen', script, { what: 'page' })).body).toEqual({ ok: true, counted: false })
    expect(stored()[0].factory).toBeUndefined()
    expect(stored()[0].usage).toBeUndefined()
    expect((await call(o, 'POST', '/api/auto/aaaa000001/seen', browser, { what: 'page' })).body).toEqual({ ok: true, counted: true })
    expect(await call(o, 'POST', '/api/auto/aaaa000001/seen', browser, { what: 'now' })).toMatchObject({ status: 400 })
    const unlocked = await call(o, 'POST', '/api/auto/aaaa000001/factory/unlock', browser)
    expect(unlocked).toMatchObject({ status: 200, body: { item: { factory: { name: 'opportunity-hunter' } } } })
    expect(await call(o, 'POST', '/api/auto/nope/factory/unlock', browser)).toMatchObject({ status: 404 })
  })

  it('an automation that has not earned it answers 409 in plain words', async () => {
    seed([auto('young00001', { runs: runs(6), runCount: 6 })])
    const o = await ready()
    expect(await call(o, 'POST', '/api/auto/young00001/factory/unlock', browser)).toEqual({ status: 409, body: { error: 'This automation cannot become a factory yet.' } })
  })
})
