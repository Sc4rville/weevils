import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ulid } from './adapters/adapter.ts'
import { HubSync, TAKES_PER_ROUND, ensureHubRepo, intentOf, subjectOf } from './hub.ts'
import { parseJournal, validateJournal, type EventDraft } from './journal.ts'
import { parseLease, type Lease } from './lease.ts'
import { Weevbook } from './store.ts'

const T0 = Date.parse('2026-11-20T10:00:00Z')
const roots: string[] = []
const tmp = (name: string) => {
  const d = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), `weevils-hub-${name}-`))
  roots.push(d)
  return d
}
const git = (gitDir: string, ...args: string[]) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const tryGit = (gitDir: string, ...args: string[]) => {
  try {
    return { ok: true, out: git(gitDir, ...args) }
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: unknown }).stderr ?? e) }
  }
}
const ref = (gitDir: string, name: string) => tryGit(gitDir, 'rev-parse', '-q', '--verify', name).out.trim() || null
const leaseOf = (hub: string, id: string): Lease | null => {
  const r = tryGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`)
  return r.ok ? parseLease(r.out) : null
}

beforeAll(() => {
  const cfg = path.join(tmp('cfg'), 'gitconfig')
  fs.writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

/** One machine: its weevbook, its sessions file, its hub sync on a clock the test moves. */
function machine(root: string, name: string, hub: string, o: { here?: boolean; steals?: boolean; clock: { t: number } }) {
  const data = path.join(root, name, '.local', 'share', 'weevils')
  const logs: string[] = []
  const sync = new HubSync({ dir: path.join(data, 'weevbook'), dataDir: data, sessions: path.join(data, 'weevbook-sessions.jsonl'), machine: name, hub: { url: hub, here: !!o.here }, steals: !!o.steals, now: () => o.clock.t, log: (l) => logs.push(l) })
  return { name, data, dir: path.join(data, 'weevbook'), sync, logs }
}

/** A thread as the shadow writer writes one: a turn running, or done. */
async function thread(dir: string, who: string, o: { done?: boolean; at: number }): Promise<string> {
  const book = await Weevbook.open(dir, who)
  expect(await book.lock()).toBe(true)
  const id = ulid(o.at)
  const engine = `claude:abc123@${who}`
  const e = (x: Record<string, unknown>) => ({ id: ulid(o.at), at: new Date(o.at).toISOString(), ...x }) as EventDraft
  const msg = e({ leg: 'L1', type: 'message', role: 'user', text: 'Show prices with the currency', source: 'claude' })
  const events: EventDraft[] = [
    e({ leg: null, type: 'meta', thread: id, title: 'Prices with currency', project: 'shop' }),
    e({ leg: 'L1', type: 'leg.start', engine, session: `s-${id}`, cwd: '/home/u/projects/shop', rung: 0, epoch: 1 }),
    msg,
    e({ leg: 'L1', type: 'turn', turn: 1, state: 'accepted', message: msg.id }),
    e({ leg: 'L1', type: 'turn', turn: 1, state: 'assigned', engine, attempt: 1, rule: 'shadow', reason: 'test' }),
    e({ leg: 'L1', type: 'turn', turn: 1, state: 'running' }),
  ]
  if (o.done) events.push(e({ leg: 'L1', type: 'checkpoint', turn: 1, kind: 'none', reason: 'test' }), e({ leg: 'L1', type: 'turn', turn: 1, state: 'done' }))
  await book.append(id, { events })
  await book.commitThread(id, subjectOf([], who))
  await book.unlock(true)
  return id
}
async function extend(dir: string, who: string, id: string, x: Record<string, unknown>[], at: number) {
  const book = await Weevbook.open(dir, who)
  expect(await book.lock()).toBe(true)
  await book.append(id, { events: x.map((e) => ({ id: ulid(at), at: new Date(at).toISOString(), leg: 'L1', ...e }) as unknown as EventDraft) })
  await book.unlock(true)
}

describe('the lease a journal asks for', () => {
  it('working while a turn is assigned or running, with the open leg; idle otherwise', async () => {
    const root = tmp('intent')
    const id = await thread(path.join(root, 'book'), 'laptop', { at: T0 })
    const book = await Weevbook.open(path.join(root, 'book'), 'laptop')
    const events = (await book.thread(id))!.journal.events
    expect(intentOf(events, 'c1')).toEqual({ engine: 'claude:abc123@laptop', leg: 'L1', state: 'working', turn: 1, tip: 'c1' })
    expect(subjectOf(events, 'laptop')).toBe('turn 1 (running) · claude · laptop')
    await extend(path.join(root, 'book'), 'laptop', id, [{ type: 'checkpoint', turn: 1, kind: 'none', reason: 'test' }, { type: 'turn', turn: 1, state: 'done' }], T0)
    const done = (await (await Weevbook.open(path.join(root, 'book'), 'laptop')).thread(id))!.journal.events
    expect(intentOf(done, 'c2')).toEqual({ engine: 'claude:abc123@laptop', leg: 'L1', state: 'idle', tip: 'c2' })
  })
})

describe('sync with the hub', () => {
  it('offline, threads wait; back online, all of them go up, then only renewals and changes (SYNC-3, SYNC-10)', async () => {
    const root = tmp('offline')
    const hub = path.join(root, 'hub.git')
    const clock = { t: T0 }
    const a = machine(root, 'laptop', hub, { clock })
    const running = await thread(a.dir, 'laptop', { at: T0 })
    const done = await thread(a.dir, 'laptop', { done: true, at: T0 + 1 })
    // No hub yet: nothing is lost, the status says why.
    await a.sync.round()
    expect(a.sync.status.state).toBe('offline')
    expect(fs.existsSync(path.join(a.data, 'weevbook-hub.json'))).toBe(true)
    // The hub comes up: one round takes both threads, the running one working, the other idle.
    await ensureHubRepo(hub)
    clock.t += 20_000
    await a.sync.round()
    expect(a.sync.status.state).toBe('ok')
    expect(a.sync.status.pending).toBe(0)
    const gitDir = path.join(a.dir, '.git')
    for (const id of [running, done]) expect(ref(hub, `refs/threads/${id}`)).toBe(ref(gitDir, `refs/threads/${id}`))
    expect(leaseOf(hub, running)).toMatchObject({ holder: 'laptop', epoch: 1, state: 'working', turn: 1, leg: 'L1', tip: ref(gitDir, `refs/threads/${running}`) })
    expect(leaseOf(hub, done)).toMatchObject({ holder: 'laptop', state: 'idle' })
    // A step written to the folder, not committed by the writer yet: the next round commits and pushes it.
    await extend(a.dir, 'laptop', running, [{ type: 'tool', call: 'toolu_1', name: 'Edit', summary: 'src/money.ts' }], clock.t)
    const idleLease = ref(hub, `refs/leases/${done}`)
    clock.t += 20_000
    await a.sync.round()
    const tip = ref(gitDir, `refs/threads/${running}`)
    expect(ref(hub, `refs/threads/${running}`)).toBe(tip)
    expect(parseJournal(git(hub, 'cat-file', 'blob', `${tip}:events.jsonl`)).events.at(-1)).toMatchObject({ type: 'tool', call: 'toolu_1' })
    expect(leaseOf(hub, running)!.renewed).toBe(new Date(clock.t).toISOString().replace('.000Z', 'Z'))
    // An idle thread that did not move is not pushed again.
    expect(ref(hub, `refs/leases/${done}`)).toBe(idleLease)
    // The turn ends: the push that carries its end leaves the lease idle.
    await extend(a.dir, 'laptop', running, [{ type: 'checkpoint', turn: 1, kind: 'none', reason: 'test' }, { type: 'turn', turn: 1, state: 'done' }], clock.t)
    clock.t += 20_000
    await a.sync.round()
    expect(leaseOf(hub, running)).toMatchObject({ holder: 'laptop', state: 'idle' })
    expect(validateJournal(parseJournal(git(hub, 'cat-file', 'blob', `refs/threads/${running}:events.jsonl`)).events)).toEqual([])
  })

  it(`a machine with many threads catches up over rounds, ${TAKES_PER_ROUND} at a time`, async () => {
    const root = tmp('many')
    const hub = path.join(root, 'hub.git')
    await ensureHubRepo(hub)
    const clock = { t: T0 }
    const a = machine(root, 'laptop', hub, { clock })
    const n = TAKES_PER_ROUND + 4
    for (let i = 0; i < n; i++) await thread(a.dir, 'laptop', { done: true, at: T0 + i })
    const count = () => (tryGit(hub, 'for-each-ref', 'refs/threads/').out.match(/\n/g) ?? []).length
    await a.sync.round()
    expect(count()).toBe(TAKES_PER_ROUND)
    expect(a.sync.status.pending).toBe(n - TAKES_PER_ROUND)
    clock.t += 20_000
    await a.sync.round()
    expect(count()).toBe(n)
    expect(a.sync.status.pending).toBe(0)
  }, 60_000)

  it("the hub's machine composes the hub's main from what every machine pushed (SYNC-8)", async () => {
    const root = tmp('compose')
    const hub = path.join(root, 'hub.git')
    const clock = { t: T0 }
    const server = machine(root, 'server', hub, { here: true, clock })
    const laptop = machine(root, 'laptop', hub, { clock })
    await server.sync.round()
    const id = await thread(laptop.dir, 'laptop', { done: true, at: T0 })
    await laptop.sync.round()
    clock.t += 60_000
    await server.sync.round()
    const index = JSON.parse(git(hub, 'cat-file', 'blob', 'refs/heads/main:index.json')) as { threads: { thread: string; commit: string; path: string }[] }
    expect(index.threads).toEqual([expect.objectContaining({ thread: id, commit: ref(hub, `refs/threads/${id}`) })])
    expect(git(hub, 'rev-parse', `refs/heads/main:${index.threads[0].path}`).trim()).toBe(git(hub, 'rev-parse', `refs/threads/${id}^{tree}`).trim())
  })
})

describe('the checkpoint lane', () => {
  it('pushes fast-forward; when the hub has another chain, a commit that keeps both (every checkpoint stays reachable)', async () => {
    const root = tmp('ck')
    const hub = path.join(root, 'hub.git')
    await ensureHubRepo(hub)
    const clock = { t: T0 }
    const a = machine(root, 'laptop', hub, { clock })
    const b = machine(root, 'server', hub, { clock })
    await a.sync.round()
    await b.sync.round()
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    const commit = (m: ReturnType<typeof machine>, msg: string) => {
      const gitDir = path.join(m.dir, '.git')
      const c = execFileSync('git', ['--git-dir', gitDir, 'commit-tree', git(gitDir, 'mktree').trim(), '-m', msg], { encoding: 'utf8', env }).trim()
      git(gitDir, 'update-ref', 'refs/checkpoints/T1', c)
      return c
    }
    const x = commit(a, 'turn 1 on the laptop')
    expect(await a.sync.checkpoints()).toBe(1)
    expect(ref(hub, 'refs/checkpoints/T1')).toBe(x)
    expect(await a.sync.checkpoints()).toBe(0)
    const y = commit(b, 'turn 1 on the server')
    expect(await b.sync.checkpoints()).toBe(1)
    const kept = ref(hub, 'refs/checkpoints/T1')!
    expect(git(hub, 'log', '-1', '--format=%P', kept).trim().split(' ')).toEqual([x, y])
    expect(b.sync.status.checkpoints).toBe(0)
  })
})

describe("the hub's own rules", () => {
  it('thread refs only move forward and are never deleted; orphans are not moved; nothing else is taken', async () => {
    const root = tmp('hook')
    const hub = path.join(root, 'hub.git')
    await ensureHubRepo(hub)
    const work = path.join(root, 'work.git')
    git(work, 'init', '-q', '--bare')
    const tree = git(work, 'mktree').trim()
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    const commit = (msg: string, parent?: string) => execFileSync('git', ['--git-dir', work, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', msg], { encoding: 'utf8', env }).trim()
    const a = commit('a')
    const b = commit('b', a)
    const other = commit('other')
    const push = (...specs: string[]) => tryGit(work, 'push', '--porcelain', hub, ...specs)
    expect(push(`${b}:refs/threads/T1`).ok).toBe(true)
    expect(push(`+${other}:refs/threads/T1`).ok).toBe(false)
    expect(push(':refs/threads/T1').ok).toBe(false)
    expect(push(`${a}:refs/orphans/T1/laptop-1`).ok).toBe(true)
    expect(push(`+${b}:refs/orphans/T1/laptop-1`).ok).toBe(false)
    expect(push(':refs/orphans/T1/laptop-1').ok).toBe(true)
    expect(push(`+${other}:refs/leases/T1`).ok).toBe(true)
    expect(push(`+${a}:refs/leases/T1`).ok).toBe(true)
    expect(push(`${a}:refs/heads/feature`).ok).toBe(false)
    expect(ref(hub, 'refs/threads/T1')).toBe(b)
  })
})

describe('weevils weevbook sync status | resume', () => {
  it('prints what weevilsd last wrote; without a hub it says how to set one', async () => {
    const { main } = await import('./cli.ts')
    const data = tmp('cli')
    const lines: string[] = []
    expect(await main(['sync', 'status', '--data-dir', data], (l) => lines.push(l))).toBe(1)
    expect(lines[0]).toContain('WEEVILS_WEEVBOOK_HUB')
    fs.writeFileSync(path.join(data, 'weevbook-hub.json'), JSON.stringify({ v: 1, machine: 'laptop', hub: 'vps:.local/share/weevils/hub.git', here: false, steals: false, state: 'ok', at: '2026-11-20T10:00:20.000Z', reached: '2026-11-20T10:00:20.000Z', error: null, pending: 0, checkpoints: 1, working: ['01M7'], held: { '01M7': { epoch: 1, state: 'working' } }, lost: [], stolen: [], notes: 0, composed: null }))
    lines.length = 0
    expect(await main(['sync', 'status', '--data-dir', data], (l) => lines.push(l))).toBe(0)
    expect(lines).toEqual(['hub: vps:.local/share/weevils/hub.git', 'state: ok · last round 2026-11-20T10:00:20.000Z · hub reached 2026-11-20T10:00:20.000Z', 'waiting: 0 threads, 1 checkpoints', 'leases held: 1 · working: 01M7'])
    lines.length = 0
    expect(await main(['resume', '01M7', '--data-dir', data], (l) => lines.push(l))).toBe(1)
    expect(lines[0]).toContain('WEEVILS_WEEVBOOK_HUB')
  })
})
