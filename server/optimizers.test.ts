import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, Snapshot } from '../shared/api.ts'
import { smart } from './fast.ts'
import O from './i18n/optimizers.ts'
import { Memory } from './memory.ts'
import { execFileSync, spawnSync } from 'node:child_process'
import { BACKOFF_MS, DENY, FIRST_ROUND_MS, IDLE_MS, KEEP_MS, MAX_RUN_MS, MAX_TRIES, MIN_FREE_BYTES, RETRY_MS, ROUND_EVERY_MS, ROUND_MEMORY_MS, SAFETY_ARGS, VANISH_MS, Optimizers, freeReason, guardEnv, isRepeat, jailArgs, isStall, parseProposals, slug, stallKind, tidy, type Sys } from './optimizers.ts'

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
  ({ id: 'x', projectId: 'mygame', repo: 'mygame', machineId: 'test', tool: 'claude', title: 't', status: 'idle', lastActivityAt: T0, messageCount: 6, live: true, ...over }) as Session

let dir: string
let memory: Memory
let snap: Snapshot
let sys: Sys
let createIn: ReturnType<typeof vi.fn>
let bump: ReturnType<typeof vi.fn>
/** What the session's transcript and hooks say (turn still open, Stop received). */
let store: Map<string, { phase: 'working' | 'idle'; lastActivityAt: number }>
let hooks: Map<string, { event: string; at: number }>
const make = () =>
  new Optimizers(
    { snapshot: () => snap, allRepos: () => ['mygame', 'mygame-site', 'notes'], repoDir: (r: string) => path.join(dir, 'p', r), createIn, bump, store, hooks } as never,
    memory,
    { file: path.join(dir, 'optimizers.json'), dir: path.join(dir, 'optimizers'), sys },
  )
const flush = () => new Promise((r) => setTimeout(r, 0))
const props = (n = 3) =>
  JSON.stringify(
    [
      { title: 'Harden mygame tests', why: 'you want to ship mygame', repo: 'mygame', kind: 'tests', heavy: true, priority: 1, est: 40, prompt: 'Add tests for the jump physics of mygame, stop at one hour.' },
      { title: 'Watch indie game fairs', why: 'you want to show the game', repo: null, kind: 'watch', heavy: false, priority: 2, est: 20, prompt: 'Find the indie game fairs of the next six months and list them.' },
      { title: 'Draft the landing page', why: 'mygame-site is empty', repo: 'mygame-site', kind: 'content', heavy: false, priority: 3, est: 30, prompt: 'Draft a landing page text for mygame in the repo mygame-site.' },
    ].slice(0, n),
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimizers-'))
  memory = new Memory(path.join(dir, 'memory.json'))
  snap = { projects: [{ id: 'mygame', name: 'mygame', kind: 'repo', repos: ['mygame', 'mygame-site'], where: {}, lastActivityAt: T0 }], sessions: [], mainWorking: false } as unknown as Snapshot
  sys = { load: () => 0.2, cpus: () => 4, free: () => 8 * 1024 ** 3, logged: () => true, worktree: vi.fn(async (_repo: string, d: string) => void fs.mkdirSync(d, { recursive: true })), jail: vi.fn(async () => true) }
  store = new Map()
  hooks = new Map()
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

  it('a round that proposed nothing does not hold the next memory 30 min: a round once it settles, never a loop', async () => {
    const o = make()
    model.mockResolvedValue('[]')
    await o.round(T0)
    expect(o.list()).toEqual([])
    // Nothing new: nothing before the 6 h.
    expect(o.roundDue(T0 + 2 * 3600_000)).toBe(false)
    vi.setSystemTime(T0 + 5 * MIN)
    memory.add('wants to ship mygame this year')
    expect(o.roundDue(T0 + 6 * MIN)).toBe(false)
    expect(o.roundDue(T0 + 7 * MIN)).toBe(true)
    // Kept across a restart.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'optimizers.json'), 'utf8')).lastEmpty).toBe(true)
    // Empty again: the same memory does not bring another round.
    await o.round(T0 + 7 * MIN)
    expect(o.roundDue(T0 + 20 * MIN)).toBe(false)
    // A round that proposed something: the 30 min hold is back.
    model.mockResolvedValue(props(1))
    vi.setSystemTime(T0 + 20 * MIN)
    memory.add('loves board games')
    await o.round(T0 + 25 * MIN)
    vi.setSystemTime(T0 + 30 * MIN)
    memory.add('plays chess')
    expect(o.roundDue(T0 + 35 * MIN)).toBe(false)
    expect(o.roundDue(T0 + 25 * MIN + ROUND_MEMORY_MS)).toBe(true)
  })

  it('titles and why lines are tidy and talk to the user', async () => {
    expect(tidy('Préparer la page « mygame »', 80)).toBe('Préparer la page mygame')
    expect(tidy('"Watch" the “indie” fairs , now', 80)).toBe('Watch the indie fairs, now')
    expect(tidy("Tu veux l'écrire « bientôt » ?", 80)).toBe("Tu veux l'écrire bientôt ?")
    const out = parseProposals([{ title: '« Muscler » les tests', why: 'Tu veux sortir « mygame » cette année.', prompt: 'Add tests for the jump physics of mygame.' }], [], [])
    expect(out[0]).toMatchObject({ title: 'Muscler les tests', why: 'Tu veux sortir mygame cette année.' })
    const o = make()
    expect(o.proposalPrompt()).toMatch(/why speaks to them directly as you/)
    expect(o.proposalPrompt()).toMatch(/speaking to them directly as you .*never they, he, she or the user/)
    const fr = O.fr.propose('Sam', 3, '', '', '', '', '')
    expect(fr).toContain('au tutoiement')
    expect(fr).toContain('sans guillemets')
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
    const [cwd, title, text, args, env] = createIn.mock.calls[0]
    const id = o.list()[0].id
    // Its own worktree beside the repo, on a fresh branch, made by weevils before the session starts.
    expect(cwd).toBe(path.join(dir, 'p', '.auto', 'mygame', id))
    expect(sys.worktree).toHaveBeenCalledWith(path.join(dir, 'p', 'mygame'), cwd, expect.stringMatching(/^auto\/harden-mygame-tests-\w{4}$/))
    expect(title).toBe('Harden mygame tests')
    expect(text).toMatch(/on the local branch auto\/harden-mygame-tests-\w{4} made for you/)
    expect(text).toContain(`never touch the folder ${path.join(dir, 'p', 'mygame')}`)
    expect(text).not.toContain('git worktree add')
    expect(text).toContain('never push')
    expect(text).toContain('`heavy`')
    expect(text).toContain('Add tests for the jump physics')
    // The rules are enforced by Claude Code too, not only written in the brief.
    expect(args).toEqual(SAFETY_ARGS)
    expect(JSON.parse(args[1]).permissions.deny).toEqual(expect.arrayContaining(['Bash(git push*)', 'Bash(git -C * push*)', 'Bash(gh *)', 'Bash(* publish)', 'Bash(curl * --json*)', 'Read(~/.ssh/**)']))
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--mcp-config={"mcpServers":{}}']))
    // …and by its environment: gh logged out in an empty config of weevils', git unable to push.
    expect(env.set.GH_CONFIG_DIR).toBe(path.join(dir, 'optimizers', '.guard', 'gh'))
    expect(fs.readdirSync(env.set.GH_CONFIG_DIR)).toEqual([])
    expect(env.set.GIT_SSH_COMMAND).toBe('/bin/false')
    // …and in a jail (bwrap), tried first: its folder writable, the rest of the projects read-only.
    expect(env.wrap[0]).toBe('bwrap')
    expect(env.wrap.at(-1)).toBe('--')
    expect(sys.jail).toHaveBeenCalledWith(env.wrap.slice(1))
    expect(env.wrap.join(' ')).toContain(`--bind ${path.dirname(cwd)} ${path.dirname(cwd)}`)
    expect(env.unset).toEqual(expect.arrayContaining(['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK']))
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
    expect(cwd).toBe(path.join(dir, 'optimizers', `.${o.list()[0].id}`))
    expect(fs.existsSync(cwd)).toBe(true)
    expect(sys.worktree).not.toHaveBeenCalled()
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
    // A short note in the app, the raw error in the log only.
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'could not start' })
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('tmux missing')

    fs.rmSync(path.join(dir, 'optimizers.json'))
    vi.mocked(sys.worktree).mockRejectedValueOnce(new Error("fatal: a branch named 'auto/x' already exists"))
    o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'could not make its branch' })

    // A jail that does not hold stops the task; no bwrap at all (macOS) runs it with the other barriers only.
    fs.rmSync(path.join(dir, 'optimizers.json'))
    fs.rmSync(path.join(dir, 'p'), { recursive: true, force: true })
    vi.mocked(sys.jail).mockRejectedValueOnce(new Error('bwrap: Creating new namespace failed'))
    createIn.mockClear()
    o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(o.list()[0]).toMatchObject({ state: 'failed', lastEvent: 'could not start' })
    expect(createIn).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('(jail)')

    fs.rmSync(path.join(dir, 'optimizers.json'))
    fs.rmSync(path.join(dir, 'p'), { recursive: true, force: true })
    vi.mocked(sys.jail).mockResolvedValueOnce(false)
    o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(o.list()[0].state).toBe('running')
    expect(createIn.mock.calls[0][4].wrap).toEqual([])
  })

  it('blocked on a question (needs_user) it keeps running and holds the slot; ended without any answer → failed', async () => {
    const o = await accepted(2)
    o.tick(T0 + IDLE_MS)
    await flush()
    snap.sessions = [session({ id: 'sess-1', status: 'working' })]
    o.tick(T0 + IDLE_MS + MIN)
    snap.sessions = [session({ id: 'sess-1', status: 'needs_user', attention: 'Do you want to proceed?' })]
    o.tick(T0 + IDLE_MS + 20 * MIN)
    await flush()
    expect(o.list()[0]).toMatchObject({ state: 'running' })
    expect(createIn).toHaveBeenCalledTimes(1)
    // The process went away with only the brief in its transcript: nothing was done.
    snap.sessions = [session({ id: 'sess-1', status: 'done', live: false, messageCount: 1, lastMessage: 'Background task…' })]
    o.tick(T0 + IDLE_MS + 30 * MIN)
    expect(o.list().find((x) => x.title === 'Harden mygame tests')).toMatchObject({ state: 'failed', lastEvent: 'ended without any answer' })
  })

  it('a long silent command reads idle, but the turn is still open: not done until it ends', async () => {
    const o = await accepted()
    o.tick(T0 + IDLE_MS)
    await flush()
    snap.sessions = [session({ id: 'sess-1', status: 'working' })]
    o.tick(T0 + IDLE_MS + MIN)
    // `heavy npm test` for 12 min: the transcript waits for the tool's result, the last hook is a PostToolUse.
    store.set('sess-1', { phase: 'working', lastActivityAt: T0 + IDLE_MS + 2 * MIN })
    hooks.set('sess-1', { event: 'PostToolUse', at: T0 + IDLE_MS + 2 * MIN })
    snap.sessions = [session({ id: 'sess-1', status: 'idle', lastMessage: 'Running the tests.' })]
    o.tick(T0 + IDLE_MS + 15 * MIN)
    expect(o.list()[0].state).toBe('running')
    // Same, the pane went past 30 min of silence (« done » for the app) while the command runs.
    snap.sessions = [session({ id: 'sess-1', status: 'done', lastMessage: 'Running the tests.' })]
    o.tick(T0 + IDLE_MS + 40 * MIN)
    expect(o.list()[0].state).toBe('running')
    // The agent answers: a Stop hook after its last entry closes the turn, even if the transcript did not say so yet.
    store.set('sess-1', { phase: 'working', lastActivityAt: T0 + IDLE_MS + 41 * MIN })
    hooks.set('sess-1', { event: 'Stop', at: T0 + IDLE_MS + 41 * MIN })
    snap.sessions = [session({ id: 'sess-1', status: 'idle', lastMessage: '40 tests added on auto/x, all green.' })]
    o.tick(T0 + IDLE_MS + 42 * MIN)
    expect(o.list()[0]).toMatchObject({ state: 'done', lastEvent: '40 tests added on auto/x, all green.' })
  })

  it('a usage limit or an API error is not « done »: back to the queue for later, the next task may go first, a few tries', async () => {
    const o = await accepted(2)
    o.tick(T0 + IDLE_MS)
    await flush()
    const first = o.list()[0]
    snap.sessions = [session({ id: 'sess-1', status: 'working' })]
    o.tick(T0 + IDLE_MS + MIN)
    snap.sessions = [session({ id: 'sess-1', status: 'idle', messageCount: 2, lastMessage: "You've hit your limit · resets 3am (Europe/Paris)" })]
    let now = T0 + IDLE_MS + 2 * MIN
    createIn.mockResolvedValueOnce({ id: 'sess-2' })
    o.tick(now)
    await flush()
    let held = o.list().find((x) => x.id === first.id)!
    expect(held).toMatchObject({ state: 'queued', waiting: 'later', retryAt: now + RETRY_MS })
    expect(held.lastEvent).toBe('usage limit reached')
    // The other accepted task does not wait behind it.
    expect(createIn).toHaveBeenCalledTimes(2)
    expect(o.list()[0]).toMatchObject({ state: 'running', sessionId: 'sess-2', title: 'Watch indie game fairs' })
    snap.sessions = [session({ id: 'sess-2', status: 'idle', lastMessage: 'Report written.' })]
    now += 10 * MIN
    o.tick(now)
    expect(o.list().find((x) => x.sessionId === 'sess-2')!.state).toBe('done')
    // Not before its time; then again, in its worktree already there.
    o.tick(now + MIN)
    await flush()
    expect(createIn).toHaveBeenCalledTimes(2)
    createIn.mockResolvedValue({ id: 'sess-3' })
    now = held.retryAt! + MIN
    o.tick(now)
    await flush()
    expect(createIn).toHaveBeenCalledTimes(3)
    expect(sys.worktree).toHaveBeenCalledTimes(1)
    held = o.list().find((x) => x.id === first.id)!
    expect(held).toMatchObject({ state: 'running', sessionId: 'sess-3' })
    expect(held.retryAt).toBeUndefined()
    // After MAX_TRIES stops in a row: failed, with the reason.
    for (let i = 1; i < MAX_TRIES; i++) {
      snap.sessions = [session({ id: o.get(first.id)!.sessionId!, status: 'idle', messageCount: 2, lastMessage: 'API Error: 529 Overloaded' })]
      now += VANISH_MS + MIN
      o.tick(now)
      await flush()
      if (o.get(first.id)!.state === 'queued') {
        now = o.get(first.id)!.retryAt! + MIN
        o.tick(now)
        await flush()
      }
    }
    expect(o.get(first.id)).toMatchObject({ state: 'failed', lastEvent: 'Claude API error' })
  })

  it('tells a stall from a summary', () => {
    for (const m of ["You've hit your limit · resets 3am", 'Claude AI usage limit reached|1762000000', '5-hour limit reached ∙ resets 2pm', 'API Error: 500 {"type":"error"}', 'Failed to authenticate: OAuth session expired', 'Login expired · Please run /login'])
      expect(isStall(m), m).toBe(true)
    for (const m of ['Added a rate limit test to mygame; the branch awaits review.', 'Done. Usage limits are documented in report.md.', ''])
      expect(isStall(m), m).toBe(false)
    expect(DENY.every((r) => /^(Bash|Read|Edit)\(.+\)$/.test(r) || ['SendMessage', 'ListAgents', 'RemoteTrigger'].includes(r))).toBe(true)
    // A trailing « :* » is Claude Code's old prefix syntax: every rule uses wildcards.
    expect(DENY.filter((r) => r.endsWith(':*)'))).toEqual([])
    expect(["You've hit your limit · resets 3am", 'Credit balance is too low'].map(stallKind)).toEqual(['limit', 'limit'])
    expect(['Failed to authenticate: OAuth session expired', 'Login expired · Please run /login'].map(stallKind)).toEqual(['login', 'login'])
    expect(stallKind('API Error: 529 Overloaded')).toBe('api')
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

describe('auto — the environment barriers', () => {
  const git = (env: NodeJS.ProcessEnv, cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 15_000 })

  it('drops tokens and paid keys from the environment, keeps Claude and weevils own', () => {
    const { set, unset } = guardEnv('/g', { PATH: '/bin', FOO_API_KEY: 'x', HF_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', WEEVILS_SECRET: 's' })
    expect(unset).toEqual(expect.arrayContaining(['GH_TOKEN', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'NPM_TOKEN', 'FOO_API_KEY', 'HF_TOKEN', 'AWS_SECRET_ACCESS_KEY']))
    expect(unset).not.toEqual(expect.arrayContaining(['ANTHROPIC_API_KEY']))
    expect(unset).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(unset).not.toContain('WEEVILS_SECRET')
    expect(unset).not.toContain('PATH')
    expect(set).toMatchObject({ GH_CONFIG_DIR: '/g/gh', DOCKER_CONFIG: '/g/docker', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' })
    expect(Number(set.GIT_CONFIG_COUNT)).toBeGreaterThan(5)
  })

  it('git cannot push anywhere (a remote, git -C, an explicit URL, ssh), fails at once, and still reads', () => {
    const repo = path.join(dir, 'r')
    fs.mkdirSync(repo)
    const plain = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir }
    git(plain, repo, 'init', '-q')
    git(plain, repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x')
    git(plain, repo, 'remote', 'add', 'origin', 'https://github.com/example/never-pushed.git')
    git(plain, repo, 'remote', 'add', 'gh', 'git@github.com:example/never-pushed.git')
    git(plain, repo, 'remote', 'add', 'sshpush', 'https://github.com/example/a.git')
    git(plain, repo, 'config', 'remote.sshpush.pushurl', 'ssh://git@github.com/example/never-pushed.git')
    git(plain, repo, 'branch', '-u', 'origin/main')
    const local = path.join(dir, 'bare.git')
    git(plain, dir, 'init', '-q', '--bare', local)
    const { set, unset } = guardEnv(path.join(dir, 'guard'), plain)
    const env: NodeJS.ProcessEnv = { ...plain, ...set }
    for (const k of unset) delete env[k]
    const tries = [
      ['push'],
      ['-C', repo, 'push'],
      ['push', 'origin', 'HEAD'],
      ['push', 'gh', 'HEAD:main'],
      ['push', 'https://github.com/example/never-pushed.git', 'HEAD'],
      ['push', 'git@github.com:example/never-pushed.git', 'HEAD'],
      ['push', local, 'HEAD:main'],
      ['push', `file://${local}`, 'HEAD:main'],
      ['push', 'sshpush', 'HEAD'],
    ]
    for (const args of tries) {
      const at = Date.now()
      const r = git(env, repo, ...args)
      expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).not.toBe(0)
      expect(Date.now() - at, args.join(' ')).toBeLessThan(5000)
      // Rewritten to the unknown transport, or ssh refused: never on the network.
      expect(r.stderr, args.join(' ')).toMatch(/weevils-no-push|Could not read from remote/)
    }
    expect(git(plain, local, 'rev-parse', '--verify', '-q', 'main').status).not.toBe(0)
    // Reading still works: the fetch URL is untouched, no helper is left.
    expect(git(env, repo, 'remote', 'get-url', 'origin').stdout.trim()).toBe('https://github.com/example/never-pushed.git')
    expect(git(env, repo, 'config', '--get-all', 'credential.https://github.com.helper').stdout.trim()).toBe('')
    expect(git(env, repo, 'log', '--oneline').status).toBe(0)
  })

  it('the jail: hidden first, then read-only, then the task folder writable, its repo config and hooks read-only last', () => {
    const exists = (p: string) => !p.includes('missing')
    const args = jailArgs({ home: '/h', hide: ['/run/user/1', '/h/missing-data'], roots: ['/p'], rw: ['/p/.auto/r', '/p/.auto/.guard'], git: '/p/r/.git' }, exists)
    const at = (a: string[]) => args.findIndex((_, i) => a.every((x, j) => args[i + j] === x))
    expect(args.slice(0, 3)).toEqual(['--dev-bind', '/', '/'])
    expect(args.slice(-2)).toEqual(['--die-with-parent', '--'])
    for (const p of ['/h/.ssh', '/h/.config/gh', '/h/.codex', '/h/.config/weevils', '/run/user/1']) expect(at(['--tmpfs', p]), p).toBeGreaterThan(0)
    expect(args).not.toContain('/h/missing-data')
    expect(at(['--ro-bind', '/dev/null', '/h/.netrc'])).toBeGreaterThan(0)
    expect(at(['--ro-bind', '/h/.bashrc', '/h/.bashrc'])).toBeGreaterThan(0)
    expect(at(['--ro-bind', '/h/.claude/settings.json', '/h/.claude/settings.json'])).toBeGreaterThan(0)
    const roRoot = at(['--ro-bind', '/p', '/p'])
    const rwTask = at(['--bind', '/p/.auto/r', '/p/.auto/r'])
    const rwGit = at(['--bind', '/p/r/.git', '/p/r/.git'])
    const roConfig = at(['--ro-bind', '/p/r/.git/config', '/p/r/.git/config'])
    expect(at(['--tmpfs', '/h/.ssh'])).toBeLessThan(roRoot)
    expect(roRoot).toBeLessThan(rwTask)
    expect(rwTask).toBeLessThan(rwGit)
    expect(rwGit).toBeLessThan(roConfig)
    expect(at(['--ro-bind', '/p/r/.git/hooks', '/p/r/.git/hooks'])).toBeGreaterThan(rwGit)
  })

  it.skipIf(process.platform !== 'linux' || spawnSync('bwrap', ['--dev-bind', '/', '/', 'true']).status !== 0)('the jail holds: keys gone, the user’s files and the repo config read-only, the task folder writable, no sudo', () => {
    const home = path.join(dir, 'home')
    const p = path.join(dir, 'p')
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true })
    fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'secret')
    fs.writeFileSync(path.join(home, '.bashrc'), '# rc\n')
    fs.writeFileSync(path.join(home, '.netrc'), 'machine x password y\n')
    fs.mkdirSync(path.join(p, '.auto', 'r'), { recursive: true })
    const plain = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir }
    git(plain, p, 'init', '-q', 'r')
    const args = jailArgs({ home, hide: [], roots: [p], rw: [path.join(p, '.auto', 'r')], git: path.join(p, 'r', '.git') })
    const run = (sh: string) => spawnSync('bwrap', [...args, 'sh', '-c', sh], { encoding: 'utf8', timeout: 15_000, env: plain })
    expect(run(`ls -A ${home}/.ssh; cat ${home}/.netrc`).stdout).toBe('')
    expect(run(`echo x >> ${home}/.bashrc`).status).not.toBe(0)
    expect(run(`echo x > ${p}/r/README`).status).not.toBe(0)
    expect(run(`git -C ${p}/r config core.fsmonitor 'touch ${dir}/pwn'`).status).not.toBe(0)
    expect(run(`echo x > ${p}/r/.git/hooks/post-commit`).status).not.toBe(0)
    expect(run(`echo ok > ${p}/.auto/r/report.md && git -C ${p}/r -c user.name=t -c user.email=t@t commit -q --allow-empty -m t`).status).toBe(0)
    expect(run('grep NoNewPrivs /proc/self/status').stdout).toMatch(/NoNewPrivs:\s+1/)
    expect(fs.readFileSync(path.join(home, '.bashrc'), 'utf8')).toBe('# rc\n')
    expect(fs.existsSync(path.join(dir, 'pwn'))).toBe(false)
  })

  it.skipIf(spawnSync('gh', ['--version']).status !== 0)('gh runs logged out', () => {
    const o = make()
    const { set, unset } = guardEnv(o.guard(), process.env)
    const env: NodeJS.ProcessEnv = { ...process.env, ...set }
    for (const k of unset) delete env[k]
    const r = spawnSync('gh', ['auth', 'status'], { env, encoding: 'utf8', timeout: 15_000 })
    expect(r.status).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).toMatch(/not logged in/i)
    expect(execFileSync('ls', ['-A', set.GH_CONFIG_DIR], { encoding: 'utf8' }).trim()).toBe('')
  })
})
