import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Snapshot } from '../shared/api.ts'
import { smart } from './fast.ts'
import { Memory } from './memory.ts'
import { BACKOFF_MS, FIRST_ROUND_MS, IDLE_MS, KEEP_MS, MAX_RUN_MS, MIN_FREE_BYTES, ROUND_EVERY_MS, ROUND_MEMORY_MS, VANISH_MS, Optimizers, freeReason, isRepeat, parseProposals, slug, type Sys } from './optimizers.ts'

// Hermetic: no claude CLI, no login check, the language fixed in memory.
vi.mock('./fast.ts', async (orig) => ({ ...(await orig<typeof import('./fast.ts')>()), smart: vi.fn() }))
vi.mock('./setup.ts', () => ({ claudeLogged: vi.fn(() => true) }))
vi.mock('./i18n.ts', async (orig) => {
  const real = await orig<typeof import('./i18n.ts')>()
  return { ...real, lang: () => 'en', tr: (m: Record<string, unknown>) => m.en, user: () => 'Sam' }
})

const model = vi.mocked(smart)
const T0 = new Date('2026-11-10T09:00:00Z').getTime()
const MIN = 60_000

const session = (over: Partial<Session>): Session =>
  ({ id: 'x', projectId: 'mygame', repo: 'mygame', machineId: 'test', tool: 'claude', title: 't', status: 'idle', lastActivityAt: T0, ...over }) as Session

let dir: string
let memory: Memory
let snap: Snapshot
let sys: Sys
let createIn: ReturnType<typeof vi.fn>
let bump: ReturnType<typeof vi.fn>
const make = () =>
  new Optimizers(
    { snapshot: () => snap, allRepos: () => ['mygame', 'mygame-site', 'notes'], repoDir: (r: string) => `/p/${r}`, createIn, bump } as never,
    memory,
    { file: path.join(dir, 'optimizers.json'), dir: path.join(dir, 'optimizers'), sys },
  )
const flush = () => new Promise((r) => setTimeout(r, 0))
const props = (n = 3) =>
  JSON.stringify(
    [
      { title: 'Harden mygame tests', why: 'they want to ship mygame', repo: 'mygame', kind: 'tests', heavy: true, priority: 1, est: 40, prompt: 'Add tests for the jump physics of mygame, stop at one hour.' },
      { title: 'Watch indie game fairs', why: 'they want to show the game', repo: null, kind: 'watch', heavy: false, priority: 2, est: 20, prompt: 'Find the indie game fairs of the next six months and list them.' },
      { title: 'Draft the landing page', why: 'mygame-site is empty', repo: 'mygame-site', kind: 'content', heavy: false, priority: 3, est: 30, prompt: 'Draft a landing page text for mygame in the repo mygame-site.' },
    ].slice(0, n),
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizers-'))
  memory = new Memory(path.join(dir, 'memory.json'))
  snap = { projects: [{ id: 'mygame', name: 'mygame', kind: 'repo', repos: ['mygame', 'mygame-site'], where: {}, lastActivityAt: T0 }], sessions: [], mainWorking: false } as unknown as Snapshot
  sys = { load: () => 0.2, cpus: () => 4, free: () => 8 * 1024 ** 3, logged: () => true }
  createIn = vi.fn(async () => ({ id: 'sess-1' }))
  bump = vi.fn()
  model.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('auto — proposals from the model', () => {
  it('keeps a real repo, drops an unknown one, clamps numbers, at most max', () => {
    const raw = [
      { title: 'A', prompt: 'too short title is dropped because it has one letter' },
      { title: 'Fix tests', repo: 'MyGame', kind: 'tests', priority: 9, est: 900, prompt: 'Fix the failing tests of mygame, one hour max.' },
      { title: 'Ghost repo task', repo: 'not-here', kind: 'weird', prompt: 'Something grounded in a repo that does not exist.' },
      { title: 'No brief', repo: 'mygame' },
      { title: 'Fourth one ok', prompt: 'A valid fourth one that should be cut by max.' },
    ]
    const out = parseProposals(raw, ['mygame', 'notes'], [], 2)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ title: 'Fix tests', repo: 'mygame', kind: 'tests', priority: 3, est: 120, heavy: false })
    expect(out[1]).toMatchObject({ title: 'Ghost repo task', repo: null, kind: 'other', priority: 2, est: 30 })
    expect(parseProposals({ tasks: raw }, ['mygame'], [], 3)).toHaveLength(3)
    expect(parseProposals('nope', [], [])).toEqual([])
  })

  it('never proposes again what was already proposed, refused or done (nor a near copy)', () => {
    const known = [{ title: 'Harden the mygame tests' }]
    expect(isRepeat('harden mygame tests!', known)).toBe(true)
    expect(isRepeat('Watch indie game fairs', known)).toBe(false)
    const out = parseProposals(JSON.parse(props()), ['mygame', 'mygame-site'], known)
    expect(out.map((p) => p.title)).toEqual(['Watch indie game fairs', 'Draft the landing page'])
  })

  it('slugs a title for a branch name', () => {
    expect(slug('Préparer la page « mygame » !')).toBe('preparer-la-page-mygame')
    expect(slug('!!!')).toBe('task')
  })
})

describe('auto — rounds', () => {
  it('first round a few minutes after start, not before; never when Claude is not logged in', () => {
    const o = make()
    expect(o.roundDue(T0 + MIN)).toBe(false)
    expect(o.roundDue(T0 + FIRST_ROUND_MS)).toBe(true)
    sys.logged = () => false
    expect(o.roundDue(T0 + FIRST_ROUND_MS)).toBe(false)
  })

  it('a round adds up to 3 proposals, then waits while 3 are unanswered; the prompt carries memory, projects and repos', async () => {
    memory.add('wants to ship mygame this year')
    const o = make()
    model.mockResolvedValue(props())
    await o.round(T0)
    const p = model.mock.calls[0][0]
    expect(p).toContain('wants to ship mygame this year')
    expect(p).toContain('mygame-site')
    expect(p).toContain('Propose at most 3 tasks')
    expect(o.list().map((x) => x.state)).toEqual(['proposed', 'proposed', 'proposed'])
    expect(o.list()[0]).toMatchObject({ title: 'Harden mygame tests', priority: 1, est: 40, heavy: true })
    expect(o.list()[0]).not.toHaveProperty('prompt')
    expect(o.roundDue(T0 + ROUND_EVERY_MS)).toBe(false)
    expect(bump).toHaveBeenCalled()
  })

  it('every 6 h, sooner (30 min apart at least) when the memory changed', async () => {
    const o = make()
    model.mockResolvedValue(props(1))
    await o.round(T0)
    expect(o.roundDue(T0 + ROUND_MEMORY_MS)).toBe(false)
    vi.setSystemTime(T0 + 10 * MIN)
    memory.add('loves board games')
    expect(o.roundDue(T0 + 20 * MIN)).toBe(false)
    expect(o.roundDue(T0 + ROUND_MEMORY_MS)).toBe(true)
    expect(o.roundDue(T0 + ROUND_EVERY_MS - MIN)).toBe(true)
  })

  it('a failed round backs off an hour at least, doubling', async () => {
    const o = make()
    model.mockRejectedValue(new Error('not logged'))
    await o.round(T0)
    expect(o.roundDue(T0 + BACKOFF_MS - MIN)).toBe(false)
    expect(o.roundDue(T0 + BACKOFF_MS)).toBe(true)
    model.mockResolvedValue('no json at all')
    await o.round(T0 + BACKOFF_MS)
    expect(o.roundDue(T0 + 2 * BACKOFF_MS)).toBe(false)
    expect(o.roundDue(T0 + 3 * BACKOFF_MS)).toBe(true)
  })

  it('refused ones disappear from the app but stay in the prompt; nothing is proposed twice', async () => {
    const o = make()
    model.mockResolvedValue(props())
    await o.round(T0)
    const watch = o.list().find((x) => x.kind === 'watch')!
    expect(o.refuse(watch.id)).toBe(true)
    expect(o.list().map((x) => x.id)).not.toContain(watch.id)
    expect(o.proposalPrompt()).toContain('[refused] Watch indie game fairs')
    model.mockResolvedValue(props())
    await o.round(T0 + ROUND_EVERY_MS)
    expect(o.list()).toHaveLength(2)
  })
})

describe('auto — the runner', () => {
  const accepted = async (n = 1) => {
    const o = make()
    model.mockResolvedValue(props(n))
    await o.round(T0)
    for (const x of o.list()) expect(o.accept(x.id)).toBe(true)
    return o
  }

  it('waits for a free machine: an agent working (or 5 min after), load, memory', async () => {
    const o = await accepted()
    snap.sessions = [session({ id: 'other', status: 'working' })]
    o.tick(T0 + 10 * MIN)
    expect(o.list()[0]).toMatchObject({ state: 'queued', waiting: 'busy' })
    snap.sessions = [session({ id: 'other', status: 'idle' })]
    o.tick(T0 + 10 * MIN + IDLE_MS - MIN)
    expect(o.list()[0].waiting).toBe('busy')
    sys.load = () => 6
    o.tick(T0 + 10 * MIN + IDLE_MS)
    expect(o.list()[0].waiting).toBe('load')
    sys.load = () => 0.3
    sys.free = () => MIN_FREE_BYTES - 1
    o.tick(T0 + 10 * MIN + IDLE_MS)
    expect(o.list()[0].waiting).toBe('ram')
    expect(createIn).not.toHaveBeenCalled()
    sys.free = () => 8 * 1024 ** 3
    sys.logged = () => false
    o.tick(T0 + 10 * MIN + IDLE_MS)
    await flush()
    expect(createIn).not.toHaveBeenCalled()
    expect(freeReason({ idleFor: IDLE_MS, load: 5.9, cpus: 4, free: MIN_FREE_BYTES })).toBeNull()
  })

  it('a remote session working does not hold the machine; weevboss working does', async () => {
    const o = await accepted()
    snap.sessions = [session({ id: 'far', status: 'working', machineId: 'pc' })]
    snap.mainWorking = true
    o.tick(T0 + 10 * MIN)
    expect(o.list()[0].waiting).toBe('busy')
    snap.mainWorking = false
    o.tick(T0 + 10 * MIN + IDLE_MS)
    await flush()
    expect(createIn).toHaveBeenCalled()
  })

  it('starts one task at a time in its repo with the safety brief, then follows its session to done', async () => {
    const o = await accepted(2)
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(createIn).toHaveBeenCalledTimes(1)
    const [cwd, title, text] = createIn.mock.calls[0]
    expect(cwd).toBe('/p/mygame')
    expect(title).toBe('Harden mygame tests')
    expect(text).toMatch(/git worktree add .*optimizers\/\w+\/wt -b auto\/harden-mygame-tests-/)
    expect(text).toContain('never push')
    expect(text).toContain('`heavy`')
    expect(text).toContain('Add tests for the jump physics')
    let [run, next] = o.list()
    expect(run).toMatchObject({ state: 'running', sessionId: 'sess-1' })
    expect(next).toMatchObject({ state: 'queued', waiting: 'queue' })

    // Its own session working does not count as « busy ».
    snap.sessions = [session({ id: 'sess-1', status: 'working' })]
    o.tick(T0 + IDLE_MS + MIN)
    expect(o.list()[0].state).toBe('running')
    snap.sessions = [session({ id: 'sess-1', status: 'idle', lastMessage: `Done: 12 new tests on branch auto/x. ${'x'.repeat(300)}` })]
    o.tick(T0 + IDLE_MS + 20 * MIN)
    ;[run] = o.list().filter((x) => x.title === 'Harden mygame tests')
    expect(run.state).toBe('done')
    expect(run.lastEvent!.startsWith('Done: 12 new tests')).toBe(true)
    expect(run.lastEvent!.length).toBeLessThanOrEqual(160)
    expect(run.endedAt).toBe(T0 + IDLE_MS + 20 * MIN)
  })

  it('a task without a repo runs in its own workspace and writes a report', async () => {
    const o = make()
    model.mockResolvedValue(JSON.stringify([JSON.parse(props(2))[1]]))
    await o.round(T0)
    o.accept(o.list()[0].id)
    o.tick(T0 + IDLE_MS)
    await flush()
    const [cwd, , text] = createIn.mock.calls[0]
    expect(cwd).toBe(path.join(dir, 'optimizers', o.list()[0].id))
    expect(fs.existsSync(cwd)).toBe(true)
    expect(text).toContain(path.join(cwd, 'report.md'))
    expect(text).not.toContain('git worktree')
  })

  it('vanished or too long → failed; a failed start → failed', async () => {
    let o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    o.tick(T0 + IDLE_MS + VANISH_MS + MIN)
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'the session vanished' })

    fs.rmSync(path.join(dir, 'optimizers.json'))
    o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    snap.sessions = [session({ id: 'sess-1', status: 'working' })]
    o.tick(T0 + IDLE_MS + MAX_RUN_MS + MIN)
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'stopped after 2 h' })

    fs.rmSync(path.join(dir, 'optimizers.json'))
    snap.sessions = []
    createIn.mockRejectedValueOnce(new Error('tmux missing'))
    o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'could not start: tmux missing' })
  })

  it('persists across restarts; finished ones leave the app after 3 days', async () => {
    const o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    const again = make()
    expect(again.list()[0]).toMatchObject({ state: 'running', sessionId: 'sess-1' })
    snap.sessions = [session({ id: 'sess-1', status: 'idle', lastMessage: 'ok' })]
    again.tick(T0 + IDLE_MS + VANISH_MS + MIN)
    expect(again.list()[0].state).toBe('done')
    expect(again.list(T0 + IDLE_MS + VANISH_MS + MIN + KEEP_MS + 1)).toEqual([])
  })

  it('accept and refuse only from the right state', async () => {
    const o = await accepted()
    const id = o.list()[0].id
    expect(o.accept(id)).toBe(false)
    expect(o.refuse(id)).toBe(true)
    expect(o.list()).toEqual([])
    expect(o.accept('nope')).toBe(false)
  })
})
