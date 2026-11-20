import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { appendEvent, parseJournal, serializeEvent, validateJournal, type EventDraft, type JournalEvent } from './journal.ts'
import {
  GRACE, LIFETIME, LeaseClient, STEAL_BOUND, gitIn, iso, lateEvents, lateNote, observe, orphanRef, parseLease, plan,
  serializeLease, stealable, standing, type GitRunner, type Intent, type Lease, type Seen,
} from './lease.ts'

const T0 = Date.parse('2026-11-20T10:00:00Z')
const S = 1000
const THREAD = '01M7M8E6XR7ZVPYA7TRMHKHR25'
const lease = (o: Partial<Lease> = {}): Lease => ({
  v: 1, thread: THREAD, holder: 'laptop', engine: 'claude:a3f9c1@laptop', leg: 'L1', epoch: 1, state: 'working', turn: 2,
  taken: iso(T0), renewed: iso(T0), expires: iso(T0 + LIFETIME), tip: 'a'.repeat(40), ...o,
})
const working: Intent = { engine: 'claude:a3f9c1@server', leg: 'L2', state: 'working', turn: 2 }

describe('lease.json', () => {
  it('is written in the field order of the spec, on one line', () => {
    const text = serializeLease(lease())
    expect(text.endsWith('}\n')).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual(['v', 'thread', 'holder', 'engine', 'leg', 'epoch', 'state', 'turn', 'taken', 'renewed', 'expires', 'tip'])
    expect(parseLease(text)).toEqual(lease())
  })
  it('reads the example of the spec', () => {
    const spec = '{"v":1,"thread":"01M7M8E6XR7ZVPYA7TRMHKHR25","holder":"laptop","engine":"claude:a3f9c1@laptop","leg":"L1","epoch":1,"state":"working","turn":2,"taken":"2026-11-17T08:02:13Z","renewed":"2026-11-17T08:12:41Z","expires":"2026-11-17T08:13:41Z","tip":"9adfb7a34e4a513eb760d627d9bba045a8271eb5"}'
    const l = parseLease(spec)!
    expect(Date.parse(l.expires) - Date.parse(l.renewed)).toBe(LIFETIME)
    expect(serializeLease(l)).toBe(`${spec}\n`)
  })
  it('an idle lease has no turn; a broken one is not trusted', () => {
    const { turn: _t, ...idle } = lease({ state: 'idle' })
    expect(parseLease(serializeLease(idle as Lease))).toEqual(idle)
    expect(parseLease('{"v":1}')).toBeNull()
    expect(parseLease('not json')).toBeNull()
    expect(parseLease(serializeLease({ ...lease(), epoch: 0 }))).toBeNull()
    expect(parseLease(serializeLease({ ...lease(), turn: undefined }))).toBeNull()
  })
})

describe('the rules', () => {
  const seen = (l: Lease | null, since = T0): Seen => ({ commit: l ? 'c1' : null, lease: l, tip: l?.tip ?? null, since })

  it('observe: the time a lease was first seen moves only when its commit changes', () => {
    const a = observe(undefined, 'c1', lease(), null, T0)
    const b = observe(a, 'c1', lease(), null, T0 + 50 * S)
    const c = observe(b, 'c2', lease(), null, T0 + 70 * S)
    expect([a.since, b.since, c.since]).toEqual([T0, T0, T0 + 70 * S])
  })
  it('take: no lease yet, epoch 1, the ref must not exist', () => {
    const p = plan('server', THREAD, seen(null), working, T0)
    expect(p.op).toBe('take')
    if (!p.op) return
    expect([p.lease.epoch, p.expect, p.lease.holder, p.lease.state, p.lease.turn]).toEqual([1, null, 'server', 'working', 2])
    expect(Date.parse(p.lease.expires) - Date.parse(p.lease.renewed)).toBe(LIFETIME)
  })
  it('renew: the holder keeps its epoch and the time it took the lease', () => {
    const p = plan('laptop', THREAD, seen(lease({ epoch: 4, taken: iso(T0 - 600 * S) })), { ...working, state: 'idle' }, T0 + 20 * S)
    if (!p.op) throw new Error('refused')
    expect([p.op, p.lease.epoch, p.lease.taken, p.lease.state, p.lease.turn, p.expect]).toEqual(['renew', 4, iso(T0 - 600 * S), 'idle', undefined, 'c1'])
  })
  it('take over idle: any machine, at once, epoch + 1', () => {
    const p = plan('server', THREAD, seen(lease({ state: 'idle', epoch: 3 })), working, T0)
    if (!p.op) throw new Error('refused')
    expect([p.op, p.lease.epoch, p.expect]).toEqual(['take-idle', 4, 'c1'])
  })
  it('a working lease of another machine is never taken without asking for a steal', () => {
    expect(plan('server', THREAD, seen(lease()), working, T0 + 3600 * S, {})).toMatchObject({ op: null, why: 'held' })
  })
  it('steal: needs expires + 30 s by the local clock and the same commit for 60 s', () => {
    const l = lease()
    const expiresAt = Date.parse(l.expires)
    // Seen since T0: unchanged long enough at T0 + 60 s, but expires + 30 s is T0 + 90 s.
    expect(stealable(seen(l, T0), T0 + 60 * S)).toEqual({ ok: false, wait: 30 * S })
    expect(stealable(seen(l, T0), expiresAt + GRACE)).toEqual({ ok: true, wait: 0 })
    // First seen late: expired already, but not yet unchanged for 60 s.
    expect(stealable(seen(l, T0 + 200 * S), T0 + 230 * S)).toEqual({ ok: false, wait: 30 * S })
    expect(stealable(seen(lease({ state: 'idle' })), T0 + 3600 * S).ok).toBe(false)
    const p = plan('server', THREAD, seen(l, T0), working, expiresAt + GRACE, { steal: true })
    if (!p.op) throw new Error('refused')
    expect([p.op, p.lease.epoch, p.lease.holder]).toEqual(['steal', 2, 'server'])
    expect(plan('server', THREAD, seen(l, T0), working, expiresAt, { steal: true })).toMatchObject({ op: null, why: 'not-yet' })
  })
  it('the steal bound: 130 s after the last renewal at most, with clocks within 30 s', () => {
    expect(STEAL_BOUND).toBe(130 * S)
  })
  it('standing after a rejection: a lease naming this machine is its own write', () => {
    expect(standing('laptop', seen(lease()))).toBe('holder')
    expect(standing('server', seen(lease()))).toBe('lost')
    expect(standing('server', seen(null))).toBe('free')
  })
  it('the orphan ref is named for the machine and the epoch it lost', () => {
    expect(orphanRef(THREAD, 'laptop', 1)).toBe(`refs/orphans/${THREAD}/laptop-1`)
  })
})

// ---------------------------------------------------------------- journals for the tests

let ids = 0
const ulid = () => `01M7M8E6XR${String(++ids).padStart(16, '0')}`
const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
function journal(events: JournalEvent[], ...drafts: EventDraft[]): JournalEvent[] {
  const out = [...events]
  for (const d of drafts) {
    const line = appendEvent(out, d)
    if (line) out.push(JSON.parse(line))
  }
  return out
}
const textOf = (events: readonly JournalEvent[]) => events.map(serializeEvent).join('\n') + '\n'
const ENGINE_A = 'claude:a3f9c1@laptop'
const ENGINE_B = 'claude:a3f9c1@server'
/** The start of a thread: line 1, a message, turn 1 accepted, assigned and running on the laptop. */
function started(thread: string): JournalEvent[] {
  const msg = ulid()
  return journal([],
    { id: ulid(), at: at(T0), leg: null, type: 'meta', thread, title: 'Fix the login redirect' },
    { id: msg, at: at(T0), leg: null, type: 'message', role: 'user', text: 'Fix it', source: 'weevils', key: `k-${thread}` },
    { id: ulid(), at: at(T0), leg: null, type: 'turn', turn: 1, state: 'accepted', message: msg },
    { id: ulid(), at: at(T0), leg: null, type: 'turn', turn: 1, state: 'assigned', engine: ENGINE_A, attempt: 1, rule: 'new', reason: 'test' },
    { id: ulid(), at: at(T0), leg: 'L1', type: 'leg.start', engine: ENGINE_A, session: 's1', cwd: '/p', rung: 0, epoch: 1 },
    { id: ulid(), at: at(T0), leg: 'L1', type: 'turn', turn: 1, state: 'running' })
}
const tool = (leg: 'L1' | 'L2', name: string): EventDraft => ({ id: ulid(), at: at(T0), leg, type: 'tool', call: ulid(), name, summary: `${name} · x` })

// ---------------------------------------------------------------- two machines and a bare hub

const ROOT = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'lease-'))
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }))
let worlds = 0

interface Machine {
  name: string
  git: GitRunner
  client: LeaseClient
  clock: { t: number }
  /** Cuts the network: every fetch and push fails as if the hub could not be reached. */
  offline: boolean
  /** Drops the answer of the next push after it reached the hub. */
  loseNextAnswer: boolean
}

async function world() {
  const dir = path.join(ROOT, `w${++worlds}`)
  fs.mkdirSync(dir)
  const hub = path.join(dir, 'hub.git')
  await gitIn(dir)(['init', '--quiet', '--bare', hub])
  const machine = async (name: string, offset = 0): Promise<Machine> => {
    const repo = path.join(dir, name)
    fs.mkdirSync(repo)
    await gitIn(repo)(['init', '--quiet'])
    await gitIn(repo)(['remote', 'add', 'hub', hub])
    const real = gitIn(repo)
    const m = { name, clock: { t: T0 + offset }, offline: false, loseNextAnswer: false } as Machine
    m.git = async (args, opts) => {
      const net = args[0] === 'push' || args[0] === 'fetch'
      if (net && m.offline) return { code: 128, stdout: '', stderr: 'fatal: Could not read from remote repository.' }
      const r = await real(args, opts)
      if (args[0] === 'push' && m.loseNextAnswer) {
        m.loseNextAnswer = false
        return { code: 128, stdout: '', stderr: 'fatal: the remote end hung up unexpectedly' }
      }
      return r
    }
    m.client = new LeaseClient({ machine: name, git: m.git, now: () => m.clock.t })
    return m
  }
  /** Moves every clock by `ms`. */
  const pass = (ms: number, ...ms_: Machine[]) => ms_.forEach((m) => (m.clock.t += ms))
  /** What the hub has: its refs, read without any machine. */
  const refs = async () => {
    const r = await gitIn(dir)(['--git-dir', hub, 'for-each-ref', '--format=%(objectname) %(refname)'])
    return Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split(' ').reverse()))
  }
  const leaseAt = async (thread: string) => {
    const sha = (await refs())[`refs/leases/${thread}`]
    return sha ? parseLease((await gitIn(dir)(['--git-dir', hub, 'cat-file', 'blob', `${sha}:lease.json`])).stdout) : null
  }
  const journalAt = async (thread: string) => {
    const sha = (await refs())[`refs/threads/${thread}`]
    return parseJournal((await gitIn(dir)(['--git-dir', hub, 'cat-file', 'blob', `${sha}:events.jsonl`])).stdout).events
  }
  return { machine, pass, refs, leaseAt, journalAt }
}

/** A thread commit on top of `parent`: one file, events.jsonl. */
async function commit(m: Machine, events: readonly JournalEvent[], parent: string | null): Promise<string> {
  const blob = (await m.git(['hash-object', '-w', '--stdin'], { input: textOf(events) })).stdout.trim()
  const tree = (await m.git(['mktree'], { input: `100644 blob ${blob}\tevents.jsonl\n` })).stdout.trim()
  const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' }
  return (await m.git(['commit-tree', tree, '-m', 'turn', ...(parent ? ['-p', parent] : [])], { env })).stdout.trim()
}
/** The journal at a commit, read from the machine's own repository. */
const read = async (m: Machine, sha: string) => parseJournal((await m.git(['cat-file', 'blob', `${sha}:events.jsonl`])).stdout).events
let threads = 0
const newThread = () => `01M7M8E6XR${String(++threads).padStart(4, '0')}ZVPYA7TRMHKH`

/** Machine `a` takes a new thread and starts turn 1 on it. */
async function laptopWorking(a: Machine) {
  const thread = newThread()
  const events = started(thread)
  const tip = await commit(a, events, null)
  const r = await a.client.take(thread, { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip })
  expect(r).toMatchObject({ ok: true, op: 'take' })
  return { thread, events, tip }
}

describe('against a real hub: two machines, a bare repository', { timeout: 30_000 }, () => {
  it('take: the first wins with epoch 1; a second take is rejected and does not start', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const { thread, tip } = await laptopWorking(a)
    expect(await w.leaseAt(thread)).toMatchObject({ holder: 'laptop', epoch: 1, state: 'working', turn: 1, tip })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(tip)
    // The server has not fetched: it plans a take (the ref must not exist), and the hub refuses.
    const r = await b.client.take(thread, working)
    expect(r).toMatchObject({ ok: false })
    await b.client.fetch(thread)
    expect(await b.client.take(thread, working)).toMatchObject({ ok: false, why: 'refused' })
  })

  it('two takers at once: exactly one wins, every time', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    for (let i = 0; i < 6; i++) {
      const thread = newThread()
      const [ra, rb] = await Promise.all([
        a.client.take(thread, { engine: ENGINE_A, leg: null, state: 'working', turn: 1 }),
        b.client.take(thread, { engine: ENGINE_B, leg: null, state: 'working', turn: 1 }),
      ])
      expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1)
      const winner = ra.ok ? 'laptop' : 'server'
      const loser = ra.ok ? rb : ra
      expect(loser).toMatchObject({ ok: false, why: 'rejected', holder: winner })
      expect((await w.leaseAt(thread))?.holder).toBe(winner)
    }
  })

  it('renew: the thread and the lease move together, and the lease names the pushed tip (SYNC-3)', async () => {
    const w = await world()
    const a = await w.machine('laptop')
    const { thread, events, tip } = await laptopWorking(a)
    w.pass(20 * S, a)
    const more = journal(events, tool('L1', 'Read'), tool('L1', 'Edit'))
    const tip2 = await commit(a, more, tip)
    const r = await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])
    expect(r.get(thread)).toMatchObject({ ok: true, op: 'renew' })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(tip2)
    expect(await w.leaseAt(thread)).toMatchObject({ holder: 'laptop', epoch: 1, tip: tip2, renewed: iso(T0 + 20 * S), taken: iso(T0) })
    expect(validateJournal(await w.journalAt(thread))).toEqual([])
  })

  it('a renewal against a lease that moved changes nothing in the hub (atomic)', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const { thread, events, tip } = await laptopWorking(a)
    // The laptop goes idle; the server takes over the idle lease.
    w.pass(5 * S, a, b)
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'idle' } }])).get(thread)).toMatchObject({ ok: true })
    await b.client.fetch(thread)
    expect(await b.client.take(thread, working)).toMatchObject({ ok: true, op: 'take-idle', lease: { epoch: 2, holder: 'server' } })
    const before = await w.refs()
    // The laptop still believes it holds it, with events to push: rejected, and neither ref moves.
    const tip2 = await commit(a, journal(events, tool('L1', 'Bash')), tip)
    const r = await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])
    expect(r.get(thread)).toMatchObject({ ok: false, why: 'lost', holder: 'server' })
    expect(await w.refs()).toEqual(before)
  })

  it('go idle, then another machine takes over the idle lease at once, epoch 2', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const { thread } = await laptopWorking(a)
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'idle' } }])).get(thread)).toMatchObject({ ok: true })
    expect(await w.leaseAt(thread)).toMatchObject({ state: 'idle', epoch: 1 })
    expect((await w.leaseAt(thread))?.turn).toBeUndefined()
    await b.client.fetch(thread)
    expect(await b.client.take(thread, working)).toMatchObject({ ok: true, op: 'take-idle' })
    expect(await w.leaseAt(thread)).toMatchObject({ holder: 'server', epoch: 2, state: 'working' })
  })

  it('steal: refused before expires + 30 s, refused before 60 s unchanged, then done with turn failed and leg.end', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const { thread, events, tip } = await laptopWorking(a)
    // The laptop goes silent right after its renewal at T0. The server reads the lease 50 s later.
    w.pass(50 * S, b)
    await b.client.fetch(thread)
    const failed = journal(events,
      { id: ulid(), at: at(T0), leg: 'L1', type: 'turn', turn: 1, state: 'failed', reason: 'machine-lost', effect: 'some' },
      { id: ulid(), at: at(T0), leg: 'L1', type: 'leg.end', reason: 'machine-lost', by: 'server' })
    const tip2 = await commit(b, failed, tip)
    const intent: Intent = { engine: null, leg: null, state: 'idle', tip: tip2 }
    // T0 + 90 s: expired + 30 s, but seen unchanged for 40 s only.
    w.pass(40 * S, b)
    await b.client.fetch(thread)
    expect(await b.client.steal(thread, intent)).toEqual({ ok: false, why: 'refused', wait: 20 * S })
    // T0 + 110 s: both.
    w.pass(20 * S, b)
    await b.client.fetch(thread)
    expect(await b.client.steal(thread, intent)).toMatchObject({ ok: true, op: 'steal', lease: { holder: 'server', epoch: 2 } })
    expect(validateJournal(await w.journalAt(thread))).toEqual([])
    expect((await w.journalAt(thread)).slice(-2).map((e) => e.type)).toEqual(['turn', 'leg.end'])
  })

  it('the old holder after a steal: rejected, its commits go to an orphan ref, the holder folds them into a late note', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const { thread, events, tip } = await laptopWorking(a)
    // The laptop is cut off and keeps working locally.
    a.offline = true
    w.pass(30 * S, a)
    const local = journal(events, tool('L1', 'Bash'))
    const localTip = await commit(a, local, tip)
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: localTip } }])).get(thread)).toEqual({ ok: false, why: 'unreachable' })
    // The server steals.
    w.pass(30 * S, b)
    await b.client.fetch(thread)
    w.pass(70 * S, b)
    await b.client.fetch(thread)
    const stolen = journal(events,
      { id: ulid(), at: at(T0), leg: 'L1', type: 'turn', turn: 1, state: 'failed', reason: 'machine-lost', effect: 'some' },
      { id: ulid(), at: at(T0), leg: 'L1', type: 'leg.end', reason: 'machine-lost', by: 'server' })
    const stolenTip = await commit(b, stolen, tip)
    expect(await b.client.steal(thread, { engine: null, leg: null, state: 'idle', tip: stolenTip })).toMatchObject({ ok: true })
    // The laptop comes back: its renewal is rejected, it has lost.
    a.offline = false
    w.pass(100 * S, a)
    const r = (await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: localTip } }])).get(thread)
    expect(r).toEqual({ ok: false, why: 'lost', holder: 'server' })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(stolenTip)
    // SYNC-6: it writes nothing more to the thread; its commits go to an orphan ref, created once.
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'idle', tip: localTip } }])).get(thread)).toMatchObject({ ok: false, why: 'lost' })
    expect(await a.client.orphan(thread, localTip, 1)).toEqual({ ok: true, ref: orphanRef(thread, 'laptop', 1) })
    expect(await a.client.orphan(thread, localTip, 1)).toEqual({ ok: true, ref: orphanRef(thread, 'laptop', 1) })
    // The holder reads the orphan and appends one late note, deleting the ref in the same atomic push.
    const f = (await b.client.fetch(thread))!
    expect(f.orphans).toEqual([{ ref: orphanRef(thread, 'laptop', 1), commit: localTip }])
    const note = lateNote(stolen, await read(b, localTip), f.orphans[0].ref)!
    expect(note).toMatchObject({ kind: 'late', leg: 'L1', text: 'laptop came back with 1 event of L1 it had not pushed; kept here, not part of the thread' })
    expect((note.data as { events: { name: string }[] }).events.map((e) => e.name)).toEqual(['Bash'])
    const noted = journal(stolen, { ...note, id: ulid(), at: at(T0) } as EventDraft)
    const notedTip = await commit(b, noted, stolenTip)
    const done = await b.client.renew([{ thread, intent: { engine: null, leg: null, state: 'idle', tip: notedTip }, drop: f.orphans }])
    expect(done.get(thread)).toMatchObject({ ok: true })
    const after = await w.refs()
    expect(after[orphanRef(thread, 'laptop', 1)]).toBeUndefined()
    expect(after[`refs/threads/${thread}`]).toBe(notedTip)
    expect(validateJournal(await w.journalAt(thread))).toEqual([])
  })

  it('clocks within 30 s: the steal comes 60 to 120 s after the last renewal', async () => {
    for (const [offset, earliest] of [[30 * S, 120 * S], [-30 * S, 61 * S], [0, 90 * S]] as const) {
      const w = await world()
      const [a, b] = [await w.machine('laptop', offset), await w.machine('server')]
      const { thread } = await laptopWorking(a)
      // The server first reads the lease at T0 + 1 s, then again as soon as its rules allow; the laptop is silent.
      w.pass(1 * S, b)
      let stolen = 0
      while (!stolen && b.clock.t < T0 + STEAL_BOUND) {
        await b.client.fetch(thread)
        const r = await b.client.steal(thread, { engine: null, leg: null, state: 'idle' })
        if (r.ok) stolen = b.clock.t - T0
        else w.pass(r.why === 'refused' ? Math.max(r.wait, 1 * S) : 1 * S, b)
      }
      expect(stolen).toBe(earliest)
    }
  })

  it('a wrong clock never takes a thread from a live, connected holder', async () => {
    for (const [ahead, behind] of [[600 * S, 0], [0, -600 * S]] as const) {
      const w = await world()
      // Server's clock 10 minutes ahead, or laptop's 10 minutes behind: every lease looks expired at once.
      const [a, b] = [await w.machine('laptop', behind), await w.machine('server', ahead)]
      const { thread } = await laptopWorking(a)
      for (let s = 0; s < 300; s += 10) {
        w.pass(10 * S, a, b)
        if (s % 20 === 10) expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1 } }])).get(thread)).toMatchObject({ ok: true })
        await b.client.fetch(thread)
        expect(await b.client.steal(thread, { engine: null, leg: null, state: 'idle' })).toMatchObject({ ok: false, why: 'refused' })
      }
      // The laptop stops: 60 s of the same commit later, the steal passes.
      w.pass(60 * S, b)
      await b.client.fetch(thread)
      expect(await b.client.steal(thread, { engine: null, leg: null, state: 'idle' })).toMatchObject({ ok: true })
    }
  })

  it('beyond 30 s, a holder whose clock is ahead delays the steal; it never speeds it up', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop', 600 * S), await w.machine('server')]
    const { thread } = await laptopWorking(a)
    w.pass(300 * S, b)
    await b.client.fetch(thread)
    w.pass(60 * S, b)
    await b.client.fetch(thread)
    expect(await b.client.steal(thread, { engine: null, leg: null, state: 'idle' })).toMatchObject({ ok: false, why: 'refused' })
    // expires (laptop clock T0 + 660 s) + 30 s, on the server's clock.
    w.pass(330 * S, b)
    await b.client.fetch(thread)
    expect(await b.client.steal(thread, { engine: null, leg: null, state: 'idle' })).toMatchObject({ ok: true })
  })

  it('an answer lost on the way: the push had landed, the machine adopts its own lease and goes on', async () => {
    const w = await world()
    const a = await w.machine('laptop')
    const { thread, events, tip } = await laptopWorking(a)
    w.pass(20 * S, a)
    const tip2 = await commit(a, journal(events, tool('L1', 'Read')), tip)
    a.loseNextAnswer = true
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])).get(thread)).toEqual({ ok: false, why: 'unreachable' })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(tip2)
    // Its next renewal expects the old lease: rejected; the lease it reads names itself; it pushes again from there.
    w.pass(20 * S, a)
    const r = (await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])).get(thread)
    expect(r).toMatchObject({ ok: true, lease: { epoch: 1, renewed: iso(T0 + 40 * S) } })
  })

  it('offline: nothing changes in the hub; back online, everything is pushed when nobody took the lease', async () => {
    const w = await world()
    const a = await w.machine('laptop')
    const { thread, events, tip } = await laptopWorking(a)
    a.offline = true
    w.pass(40 * S, a)
    const tip2 = await commit(a, journal(events, tool('L1', 'Read'), tool('L1', 'Edit')), tip)
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])).get(thread)).toEqual({ ok: false, why: 'unreachable' })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(tip)
    a.offline = false
    w.pass(20 * S, a)
    expect((await a.client.renew([{ thread, intent: { engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip: tip2 } }])).get(thread)).toMatchObject({ ok: true })
    expect((await w.refs())[`refs/threads/${thread}`]).toBe(tip2)
  })

  it('a batch of renewals: the stolen lease is dropped, the others pass in the same push (SYNC-10)', async () => {
    const w = await world()
    const [a, b] = [await w.machine('laptop'), await w.machine('server')]
    const one = await laptopWorking(a)
    const two = await laptopWorking(a)
    // The server steals the second one (the laptop was silent for long enough).
    w.pass(5 * S, b)
    await b.client.fetch(two.thread)
    w.pass(100 * S, b)
    await b.client.fetch(two.thread)
    expect(await b.client.steal(two.thread, { engine: null, leg: null, state: 'idle' })).toMatchObject({ ok: true })
    w.pass(110 * S, a)
    const intent = (tip: string): Intent => ({ engine: ENGINE_A, leg: 'L1', state: 'working', turn: 1, tip })
    const tip1 = await commit(a, journal(one.events, tool('L1', 'Read')), one.tip)
    const tip2 = await commit(a, journal(two.events, tool('L1', 'Read')), two.tip)
    const r = await a.client.renew([{ thread: one.thread, intent: intent(tip1) }, { thread: two.thread, intent: intent(tip2) }])
    expect(r.get(one.thread)).toMatchObject({ ok: true })
    expect(r.get(two.thread)).toMatchObject({ ok: false, why: 'lost', holder: 'server' })
    const refs = await w.refs()
    expect([refs[`refs/threads/${one.thread}`], refs[`refs/threads/${two.thread}`]]).toEqual([tip1, two.tip])
  })
})

describe('late events', () => {
  it('are what the orphan has after the two journals part', () => {
    const base = started(THREAD)
    const thread = journal(base, { id: ulid(), at: at(T0), leg: 'L1', type: 'leg.end', reason: 'machine-lost', by: 'server' })
    const orphan = journal(base, tool('L1', 'Bash'), tool('L1', 'Edit'))
    expect(lateEvents(thread, orphan).map((e) => (e.type === 'tool' ? e.name : e.type))).toEqual(['Bash', 'Edit'])
    expect(lateEvents(thread, base)).toEqual([])
    expect(lateNote(thread, base, orphanRef(THREAD, 'laptop', 1))).toBeNull()
    expect(lateNote(thread, orphan, orphanRef(THREAD, 'laptop', 1))?.text).toBe('laptop came back with 2 events of L1 it had not pushed; kept here, not part of the thread')
  })
})
