// Threads in weevilsd, end to end over a real hub (docs/spec, step 4): a message goes through the inbox, the turn
// state machine, the dispatcher's table, the lease and the engine's machine, and the shadow writer records what the
// engine did. The engines are fakes that write provider session files the way Claude Code and Codex do; everything
// else is the code weevilsd runs (threads.ts, dispatcher.ts, start.ts, hub.ts, the writer).
//
// Three stories: a message on two machines; an account out of quota mid-turn (the turn moves to another account, then
// to another provider, without a word); a machine lost mid-turn (the turn is stolen and continues on the other one).

import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claudeSlug } from '../bring.ts'
import { ulid } from './adapters/adapter.ts'
import type { Instruction } from './dispatcher.ts'
import { accountHash, type EngineSource } from './engines.ts'
import { HubSync, checkpointHook, draft } from './hub.ts'
import { parseJournal, validateJournal, type EventDraft, type JournalEvent, type LegId, type Provider, type TurnEvent } from './journal.ts'
import { STEAL_BOUND, parseLease } from './lease.ts'
import { startTurn, type Launcher, type StartResult } from './start.ts'
import { REQUEST_EXPIRES, Threads, type Peer } from './threads.ts'
import { prefaceSign } from './turn.ts'
import { startWeevbookWriter } from './writer.ts'

const T0 = Date.parse('2026-11-20T10:00:00Z')
const roots: string[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const run = (cwd: string, cmd: string, ...args: string[]) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const git = (cwd: string, ...args: string[]) => run(cwd, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args)
const hubGit = (hub: string, ...args: string[]) => run(hub, 'git', '--git-dir', hub, ...args)
const journal = (hub: string, id: string): JournalEvent[] => parseJournal(hubGit(hub, 'cat-file', 'blob', `refs/threads/${id}:events.jsonl`)).events
const lease = (hub: string, id: string) => parseLease(hubGit(hub, 'cat-file', 'blob', `refs/leases/${id}:lease.json`))
const turnsOf = (events: JournalEvent[], turn = 1) => events.filter((e): e is TurnEvent => e.type === 'turn' && e.turn === turn).map((e) => [e.state, e.state === 'failed' ? e.reason : e.state === 'assigned' ? e.rule : null])

beforeAll(() => {
  const cfg = path.join(fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevils-threads-cfg-')), 'gitconfig')
  roots.push(path.dirname(cfg))
  fs.writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true })
})

/** What a fake engine does with the request it gets. */
type Act = 'answer' | 'quota' | 'silent'

/** The project's origin, with a first commit; and the hub's path, on the machine that keeps it. */
function world() {
  const root = fs.mkdtempSync(path.join(process.env.WEEVILS_TEST_ROOT || os.tmpdir(), 'weevils-threads-'))
  roots.push(root)
  const seed = path.join(root, 'seed')
  fs.mkdirSync(path.join(seed, 'src'), { recursive: true })
  fs.writeFileSync(path.join(seed, 'src', 'money.ts'), 'export const fmt = (n: number) => `${n}`\n')
  git(seed, 'init', '-q')
  git(seed, 'add', '-A')
  git(seed, 'commit', '-qm', 'first')
  const origin = path.join(root, 'origin', 'shop.git')
  git(seed, 'clone', '-q', '--bare', seed, origin)
  return { root, origin, hub: path.join(root, 'server', '.local', 'share', 'weevils', 'hub.git'), clock: { t: T0 } }
}

/**
 * A machine running weevilsd with threads on: a clone of the project, a writer, a hub sync, the Threads service, and
 * fake engines (accounts with a quota each) that write session files like the real CLIs.
 */
function machine(w: ReturnType<typeof world>, name: string, o: { dispatcher?: boolean; accounts: { provider: Provider; account: string; used: number }[] }) {
  const home = path.join(w.root, name)
  const data = path.join(home, '.local', 'share', 'weevils')
  const projects = path.join(home, 'projects')
  const repo = path.join(projects, 'shop')
  const claudeDir = path.join(home, '.claude', 'projects')
  const codexDir = path.join(home, '.codex', 'sessions')
  fs.mkdirSync(projects, { recursive: true })
  fs.mkdirSync(data, { recursive: true })
  git(projects, 'clone', '-q', w.origin, repo)
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: `account-of-${name}` } }))
  const logs: string[] = []
  const log = (l: string) => logs.push(l)
  const dir = path.join(data, 'weevbook')
  const sessions = path.join(data, 'weevbook-sessions.jsonl')
  const clock = w.clock
  const sources = () => {
    const out: { file: string; provider: Provider }[] = []
    const walk = (d: string, provider: Provider) => {
      if (!fs.existsSync(d)) return
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name)
        if (f.isDirectory()) walk(p, provider)
        else if (f.name.endsWith('.jsonl')) out.push({ file: p, provider })
      }
    }
    walk(claudeDir, 'claude')
    walk(codexDir, 'codex')
    return out
  }
  const writer = startWeevbookWriter({ dir, sessions, machine: name, home, codexDir, roots: [projects], sources, intervalMs: 3_600_000, quietMs: 300, composeMs: 3_600_000, log, checkpoint: checkpointHook({ dataDir: data, home, weevbookGitDir: path.join(dir, '.git'), log }) })
  const sync = new HubSync({ dir, dataDir: data, sessions, machine: name, hub: { url: w.hub, here: !!o.dispatcher }, steals: !!o.dispatcher, now: () => clock.t, log })

  // The engines: what each does next, and every request they got.
  const acts: Act[] = []
  const calls: { how: 'resume' | 'open'; provider: Provider; account: string; session: string; text: string }[] = []
  const act = (provider: Provider, session: string, cwd: string, text: string) => {
    const what = acts.shift() ?? 'answer'
    if (provider === 'claude') claudeTurn(home, cwd, session, text, what)
    else codexTurn(codexDir, cwd, session, text, what)
  }
  const launch: Launcher = {
    async resume(l) {
      calls.push({ how: 'resume', provider: l.provider, account: l.account, session: l.session, text: l.text })
      act(l.provider, l.session, l.cwd, l.text)
    },
    async open(l) {
      const session = l.session ?? crypto.randomUUID()
      calls.push({ how: 'open', provider: l.provider, account: l.account, session, text: l.text })
      act(l.provider, session, l.cwd, l.text)
    },
  }
  const starts: Promise<StartResult>[] = []
  const peers: Peer[] = []
  const start = (ins: Instruction) => {
    const p = startTurn({ sync, sessionsFile: sessions, dataDir: data, machine: name, home, claudeDir, codexDir, roots: [projects], projectsDir: projects, launch, folderOf: (p) => (p === 'shop' ? repo : null), now: () => clock.t, log, findFor: 2_000, sleep: (ms) => sleep(Math.min(ms, 50)).then(() => undefined) }, ins)
    starts.push(p)
    return p
  }
  const quotas = new Map(o.accounts.map((a) => [`${a.provider}:${a.account}`, a.used]))
  const engines = (): EngineSource[] =>
    o.accounts.map((a) => ({
      provider: a.provider,
      account: a.account,
      signedIn: true,
      quota: async () => ({ ok: true, source: 'test', at: clock.t, windows: [{ kind: 'session', percent: quotas.get(`${a.provider}:${a.account}`)!, resetsAt: clock.t + 3 * 3600_000 }, { kind: 'week', percent: 5, resetsAt: clock.t + 5 * 86400_000 }] }),
    }))
  const threads = new Threads({ sync, machine: name, dispatcher: !!o.dispatcher, preferred: 'claude', inboxFile: path.join(data, 'threads-inbox.jsonl'), projects: () => ['shop'], sources: engines, start, deliver: async () => {}, peers: () => peers, now: () => clock.t, log })
  /** Every start sent here, finished. */
  const started = async () => {
    const out: StartResult[] = []
    while (starts.length) out.push(await starts.shift()!)
    return out
  }
  /** The writer reads what is new, then what the silence settles; the sync pushes it. */
  const settle = async () => {
    await writer.flush()
    await sleep(450)
    await writer.flush()
    await sync.round()
  }
  const peer = (online = () => true): Peer => ({ machine: name, get online() { return online() }, start: (ins) => start(ins), deliver: (thread, text) => threads.deliverHere(thread, text) })
  return { name, home, repo, claudeDir, codexDir, sync, threads, writer, acts, calls, quotas, started, settle, peer, peers, logs }
}

/** One turn of Claude Code in a session file: the request, a Write, then the end (an answer, a usage limit, nothing). */
function claudeTurn(home: string, cwd: string, session: string, request: string, what: Act) {
  const file = path.join(home, '.claude', 'projects', claudeSlug(cwd), `${session}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  let parent: string | null = before.length ? (JSON.parse(before.at(-1)!).uuid ?? null) : null
  const line = (type: 'user' | 'assistant', message: unknown, extra: object = {}) => {
    const uuid = crypto.randomUUID()
    fs.appendFileSync(file, `${JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.4', gitBranch: 'main', type, message, uuid, timestamp: new Date().toISOString(), ...extra })}\n`)
    parent = uuid
  }
  const n = crypto.randomBytes(4).toString('hex')
  line('user', { role: 'user', content: request })
  line('assistant', { id: `msg_${n}a`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'Write', input: { file_path: path.join(cwd, 'src/money.ts'), content: 'x' } }], stop_reason: 'tool_use' })
  line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'written' }] })
  if (what === 'answer') line('assistant', { id: `msg_${n}b`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Prices now show the currency.' }], stop_reason: 'end_turn' })
  if (what === 'quota') line('assistant', { id: `msg_${n}c`, type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Claude usage limit reached. Your limit will reset at 4pm' }] }, { isApiErrorMessage: true, error: 'rate_limit' })
}

/** One turn of Codex in a new rollout file (a new session: its first request names the thread). */
function codexTurn(codexDir: string, cwd: string, session: string, request: string, what: Act) {
  const d = new Date()
  const dir = path.join(codexDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `rollout-${d.toISOString().slice(0, 19).replace(/:/g, '-')}-${session}.jsonl`)
  const at = d.toISOString()
  const lines = [
    ...(fs.existsSync(file) ? [] : [{ timestamp: at, type: 'session_meta', payload: { id: session, timestamp: at, cwd, originator: 'codex_cli_rs', cli_version: '0.58.0' } }, { timestamp: at, type: 'turn_context', payload: { cwd, model: 'gpt-5.1-codex' } }]),
    { timestamp: at, type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: request }] } },
    { timestamp: at, type: 'event_msg', payload: { type: 'user_message', message: request, images: [] } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"npm test"}', call_id: 'call_1' } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: 'Tests: 3 passed' } },
    ...(what === 'answer'
      ? [
          { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The cart shows the currency too; the tests pass.' }] } },
          { timestamp: at, type: 'event_msg', payload: { type: 'agent_message', message: 'The cart shows the currency too; the tests pass.' } },
          { timestamp: at, type: 'event_msg', payload: { type: 'task_complete' } },
        ]
      : []),
  ]
  fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

/** Publishes every machine's engines.json and lets the dispatcher read them. */
async function tables(dispatcher: ReturnType<typeof machine>, ...all: ReturnType<typeof machine>[]) {
  for (const m of all) await m.threads.publish()
  await dispatcher.threads.readTable()
}

/** What the person sees of a thread: no engine, account, machine, quota or relay anywhere. */
function noTrace(view: NonNullable<Awaited<ReturnType<Threads['view']>>>) {
  const text = JSON.stringify(view)
  for (const word of ['relay', 'Relay', 'codex', 'Codex', 'quota', 'usage limit', '[from:weevbook', 'handoff', 'machine-lost', 'another agent']) expect(text).not.toContain(word)
}

describe('threads in weevilsd: message → turn → dispatch → lease → engine', () => {
  it('a message on the app becomes a turn on the engine with the most room, on another machine; one conversation', async () => {
    const w = world()
    const server = machine(w, 'server', { dispatcher: true, accounts: [{ provider: 'claude', account: accountHash('account-of-server'), used: 60 }] })
    const laptop = machine(w, 'laptop', { accounts: [{ provider: 'claude', account: accountHash('account-of-laptop'), used: 10 }] })
    server.peers.push(laptop.peer())
    await server.sync.round()
    await laptop.sync.ensure()
    await tables(server, server, laptop)

    const { thread: id } = await server.threads.accept(null, { text: 'Show prices with the currency', project: 'shop' })
    await server.threads.step(id)
    const [r] = await laptop.started()
    expect(r).toMatchObject({ ok: true, leg: 'L1', rung: 0, cwd: laptop.repo })
    // The engine got the person's words, nothing else; the lease is the laptop's, working.
    expect(laptop.calls).toEqual([expect.objectContaining({ how: 'open', provider: 'claude', text: 'Show prices with the currency' })])
    expect(lease(w.hub, id)).toMatchObject({ holder: 'laptop', state: 'working', turn: 1, leg: 'L1' })
    expect((await server.threads.view(id))!.state).toBe('working')

    // The laptop's writer records the turn the engine ran; its sync pushes it and lets the lease go.
    await laptop.settle()
    const events = journal(w.hub, id)
    expect(validateJournal(events)).toEqual([])
    expect(turnsOf(events)).toEqual([['accepted', null], ['assigned', 'new'], ['running', null], ['done', null]])
    expect(events.filter((e) => e.type === 'message' && e.role === 'user')).toEqual([expect.objectContaining({ text: 'Show prices with the currency', source: 'weevils' })])
    expect(events.find((e) => e.type === 'leg.start')).toMatchObject({ leg: 'L1', engine: `claude:${accountHash('account-of-laptop')}@laptop`, rung: 0 })
    expect(lease(w.hub, id)).toMatchObject({ holder: 'laptop', state: 'idle' })

    const view = (await server.threads.view(id))!
    expect(view).toMatchObject({ thread: id, project: 'shop', state: 'waiting' })
    expect(view.messages.map((m) => [m.role, m.text])).toEqual([['user', 'Show prices with the currency'], ['event', expect.stringContaining('Write')], ['assistant', 'Prices now show the currency.']])
    noTrace(view)
    expect((await server.threads.list({ project: 'shop' })).threads.map((t) => t.thread)).toEqual([id])

    // A second message: the same engine stays (it has room), the same session goes on.
    await server.threads.accept(id, { text: 'Thanks, and on the cart too?' })
    await server.threads.step(id)
    await laptop.started()
    await laptop.settle()
    const after = journal(w.hub, id)
    expect(validateJournal(after)).toEqual([])
    expect(turnsOf(after, 2)).toEqual([['accepted', null], ['assigned', 'stay'], ['running', null], ['done', null]])
    expect(laptop.calls[1]).toMatchObject({ how: 'resume', session: laptop.calls[0].session, text: 'Thanks, and on the cart too?' })
    expect(after.filter((e) => e.type === 'leg.start')).toHaveLength(1)
  }, 120_000)

  it('an account out of quota mid-turn: the turn goes on with another account, then another provider, silently', async () => {
    const w = world()
    const a = accountHash('account-of-server')
    const server = machine(w, 'server', { dispatcher: true, accounts: [{ provider: 'claude', account: a, used: 10 }, { provider: 'claude', account: 'b0b0b0', used: 40 }, { provider: 'codex', account: 'c0c0c0', used: 20 }] })
    await server.sync.round()
    await tables(server, server)

    // Account a stops on its usage limit after one step.
    server.acts.push('quota')
    const { thread: id } = await server.threads.accept(null, { text: 'Show prices with the currency', project: 'shop' })
    await server.threads.step(id)
    await server.started()
    await server.settle()
    let events = journal(w.hub, id)
    expect(turnsOf(events)).toEqual([['accepted', null], ['assigned', 'new'], ['running', null], ['failed', 'quota']])
    // The person sees the turn still working: a retry is under way.
    expect((await server.threads.view(id))!.state).toBe('working')

    // The dispatcher looks again: a is at its limit (the stop is a reading), b takes the same session, with the preface.
    server.quotas.set(`claude:${a}`, 100)
    server.acts.push('quota')
    await server.threads.step(id)
    await server.started()
    expect(server.calls[1]).toMatchObject({ how: 'resume', provider: 'claude', account: 'b0b0b0', session: server.calls[0].session })
    expect(server.calls[1].text.startsWith(prefaceSign(id))).toBe(true)
    await server.settle()
    events = journal(w.hub, id)
    expect(turnsOf(events)).toEqual([['accepted', null], ['assigned', 'new'], ['running', null], ['failed', 'quota'], ['assigned', 'account'], ['running', null], ['failed', 'quota']])

    // b stops too: no Claude account has room; Codex takes the thread in a new session that reads the handoff.
    server.quotas.set('claude:b0b0b0', 100)
    await server.threads.step(id)
    const [r] = await server.started()
    expect(r).toMatchObject({ ok: true, rung: 3, leg: 'L3' })
    const codex = server.calls[2]
    expect(codex).toMatchObject({ how: 'open', provider: 'codex', account: 'c0c0c0' })
    expect(codex.text.startsWith(prefaceSign(id))).toBe(true)
    expect(codex.text).toContain('Show prices with the currency')
    expect(codex.text).toMatch(/<handoff>[\s\S]*## Goal[\s\S]*<\/handoff>/)
    await server.settle()
    events = journal(w.hub, id)
    expect(validateJournal(events)).toEqual([])
    expect(turnsOf(events).slice(-3)).toEqual([['assigned', 'provider'], ['running', null], ['done', null]])
    expect(events.filter((e) => e.type === 'leg.start').map((e) => (e.type === 'leg.start' ? [e.engine, e.rung] : null))).toEqual([
      [`claude:${a}@server`, 0],
      ['claude:b0b0b0@server', 1],
      ['codex:c0c0c0@server', 3],
    ])

    // One conversation: the person's message once, the steps, the answer; no stop, no engine, no preface.
    const view = (await server.threads.view(id))!
    expect(view.state).toBe('waiting')
    expect(view.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['Show prices with the currency'])
    expect(view.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'The cart shows the currency too; the tests pass.' })
    noTrace(view)
  }, 120_000)

  it('a machine lost mid-turn: the dispatcher takes the lease and the turn continues on the other machine', async () => {
    const w = world()
    const server = machine(w, 'server', { dispatcher: true, accounts: [{ provider: 'claude', account: accountHash('account-of-server'), used: 50 }] })
    const laptop = machine(w, 'laptop', { accounts: [{ provider: 'claude', account: accountHash('account-of-laptop'), used: 10 }] })
    let laptopOn = true
    server.peers.push(laptop.peer(() => laptopOn))
    await server.sync.round()
    await laptop.sync.ensure()
    await tables(server, server, laptop)

    // The laptop starts the turn, takes one step, and dies before the answer.
    laptop.acts.push('silent')
    const { thread: id } = await server.threads.accept(null, { text: 'Show prices with the currency', project: 'shop' })
    await server.threads.step(id)
    await laptop.started()
    await laptop.writer.flush()
    await laptop.sync.round()
    laptop.writer.stop()
    laptopOn = false
    expect(lease(w.hub, id)).toMatchObject({ holder: 'laptop', state: 'working' })

    // The dispatcher looks while the lease is still fresh: nothing to do.
    w.clock.t += 20_000
    await server.threads.step(id)
    expect(server.calls).toHaveLength(0)

    // Past the bound, it steals, and places the turn again: the laptop does not answer, the server takes it (rung 2).
    w.clock.t += STEAL_BOUND
    await server.threads.publish()
    await server.threads.readTable()
    await server.threads.step(id)
    const [r] = await server.started()
    expect(r).toMatchObject({ ok: true, rung: 2, leg: 'L2', cwd: server.repo })
    expect(server.calls[0]).toMatchObject({ how: 'resume', provider: 'claude', session: laptop.calls[0].session })
    expect(server.calls[0].text.startsWith(prefaceSign(id))).toBe(true)
    await server.settle()
    const events = journal(w.hub, id)
    expect(validateJournal(events)).toEqual([])
    expect(turnsOf(events)).toEqual([['accepted', null], ['assigned', 'new'], ['running', null], ['failed', 'machine-lost'], ['assigned', 'machine'], ['running', null], ['done', null]])
    expect(lease(w.hub, id)).toMatchObject({ holder: 'server', state: 'idle' })
    const view = (await server.threads.view(id))!
    expect(view.state).toBe('waiting')
    expect(view.messages.filter((m) => m.role === 'user').map((m) => m.text)).toEqual(['Show prices with the currency'])
    noTrace(view)
  }, 120_000)

  it('a request from a chat app held more than an hour ends as « expired », and waits for the person', async () => {
    const w = world()
    const server = machine(w, 'server', { dispatcher: true, accounts: [] })
    await server.sync.round()
    await tables(server, server)
    const { thread: id } = await server.threads.accept(null, { text: 'Summarise the open pull requests', key: 'conn:chatgpt:c1:req:r1', source: 'connector', app: 'chatgpt', project: 'shop' })
    await server.threads.step(id)
    let events = journal(w.hub, id)
    expect(turnsOf(events)).toEqual([['accepted', null], ['held', null]])
    expect((await server.threads.view(id))!).toMatchObject({ state: 'paused', hold: { reason: 'no-machine' } })

    // An hour later, still no engine: the request expires rather than start out of the blue.
    w.clock.t += 3600_000 + 1000
    await server.threads.step(id)
    events = journal(w.hub, id)
    expect(validateJournal(events)).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'turn', turn: 1, state: 'held', reason: 'expired' })
    expect((await server.threads.view(id))!).toMatchObject({ state: 'paused', hold: { reason: 'expired', request: 'Summarise the open pull requests' } })
    // The dispatcher looks again: the expired request does not start by itself.
    await server.threads.step(id)
    expect(server.calls).toHaveLength(0)
  }, 60_000)
})

// ---------------------------------------------------------------- switching threads on over a weevbook with history

/** A thread as step 1 left it (the shadow writer, a backfill, the connector before threads): written straight into a
 *  machine's weevbook, at `at`, then committed; the next round pushes it. */
async function history(m: ReturnType<typeof machine>, at: number, build: (id: string, e: (leg: LegId | null, x: Record<string, unknown>) => EventDraft) => EventDraft[]): Promise<string> {
  let t = at
  const id = ulid(at)
  const events = build(id, (leg, x) => draft(t++, leg, x))
  const r = await m.sync.withBook(async () => {
    const r = await m.sync.book.append(id, { events })
    await m.sync.book.commitThread(id, `history · ${m.name}`)
    return r
  })
  expect(r).toEqual({ written: events.length, refused: 0 })
  return id
}

/** A provider session's thread, as the shadow writer records it: a first turn done, a second that failed on a
 *  provider error (`failed`), failed three times (`out`), or was cut while running (`cut`). */
function shadow(m: ReturnType<typeof machine>, account: string, project: string, end: 'failed' | 'out' | 'cut') {
  return (id: string, e: (leg: LegId | null, x: Record<string, unknown>) => EventDraft) => {
    const engine = `claude:${account}@${m.name}`
    const session = crypto.randomUUID()
    claudeTurn(m.home, m.repo, session, 'Fix the export', 'answer')
    const out: EventDraft[] = [e(null, { type: 'meta', thread: id, title: `Old work (${end})`, project }), e('L1', { type: 'leg.start', engine, session, cwd: m.repo, rung: 0, epoch: 1 })]
    const ask = (turn: number, text: string) => {
      const msg = e('L1', { type: 'message', role: 'user', text, source: 'claude' })
      out.push(msg, e('L1', { type: 'turn', turn, state: 'accepted', message: msg.id }))
    }
    ask(1, 'Fix the export')
    out.push(e('L1', { type: 'turn', turn: 1, state: 'assigned', engine, attempt: 1, rule: 'shadow', reason: 'recorded' }), e('L1', { type: 'turn', turn: 1, state: 'running' }), e('L1', { type: 'message', role: 'assistant', text: 'Fixed.' }), e('L1', { type: 'checkpoint', turn: 1, kind: 'none', reason: 'recorded' }), e('L1', { type: 'turn', turn: 1, state: 'done' }))
    ask(2, 'Now the import')
    for (let a = 1; a <= (end === 'out' ? 3 : 1); a++) {
      out.push(e('L1', { type: 'turn', turn: 2, state: 'assigned', engine, attempt: a, ...(a > 1 ? { resume: true } : {}), rule: 'shadow', reason: 'recorded' }), e('L1', { type: 'turn', turn: 2, state: 'running' }))
      out.push(e('L1', { type: 'tool', call: `c${a}`, name: 'Bash', summary: 'Bash · npm test' }))
      if (end !== 'cut') out.push(e('L1', { type: 'turn', turn: 2, state: 'failed', reason: 'api', effect: 'some' }))
    }
    return out
  }
}

/** A request from a chat app that the connector of step 5 filed, before any dispatcher: held, or only accepted. */
function request(key: string, held: boolean) {
  return (id: string, e: (leg: LegId | null, x: Record<string, unknown>) => EventDraft) => {
    const msg = e(null, { type: 'message', role: 'user', text: 'Summarise the open pull requests', source: 'connector', app: 'chatgpt', key })
    return [e(null, { type: 'meta', thread: id, title: 'Open pull requests', project: 'shop' }), msg, e(null, { type: 'turn', turn: 1, state: 'accepted', message: msg.id }), ...(held ? [e(null, { type: 'turn', turn: 1, state: 'held', rule: 'hold', reason: 'no-machine' })] : [])]
  }
}

const assigned = (events: JournalEvent[]) => events.filter((e) => e.type === 'turn' && e.state === 'assigned').length
/** The dispatcher's decision lines (« <thread> turn 2.1: stay → … »): a placement or a hold. */
const decisions = (logs: string[]) => logs.filter((l) => /\[threads\] \w{6} turn \d+\.\d+: /.test(l))

describe('switching threads on in an install with history', () => {
  it('places nothing, holds nothing and calls no engine; what will never go on says so; writing again continues', async () => {
    const w = world()
    const acc = accountHash('account-of-server')
    const server = machine(w, 'server', { dispatcher: true, accounts: [{ provider: 'claude', account: acc, used: 10 }] })
    const laptop = machine(w, 'laptop', { accounts: [{ provider: 'claude', account: accountHash('account-of-laptop'), used: 10 }] })
    let laptopOn = true
    server.peers.push(laptop.peer(() => laptopOn))
    await server.sync.round()
    await laptop.sync.ensure()
    const day = 86400_000

    // Step 1's weevbook: turns cut by a provider error, out of attempts, on a project only another machine has, a
    // session cut on the laptop (which then goes off), requests the connector held before there was a dispatcher.
    const failed = await history(server, T0 - 10 * day, shadow(server, acc, 'shop', 'failed'))
    const out = await history(server, T0 - 9 * day, shadow(server, acc, 'shop', 'out'))
    const elsewhere = await history(server, T0 - 8 * day, shadow(server, acc, 'lws-final-rookie', 'failed'))
    const cut = await history(laptop, T0 - 5 * 60_000, shadow(laptop, accountHash('account-of-laptop'), 'shop', 'cut'))
    const recent = await history(server, T0 - 30 * 60_000, request('conn:chatgpt:c1:req:r1', true))
    const old = await history(server, T0 - 3 * day, request('conn:chatgpt:c2:req:r1', false))
    await server.sync.round()
    await laptop.sync.round()
    laptopOn = false
    expect(lease(w.hub, cut)).toMatchObject({ holder: 'laptop', state: 'working' })
    const theirs = [failed, out, elsewhere]
    const before = new Map([...theirs, cut].map((id) => [id, journal(w.hub, id)]))

    // Threads on: the dispatcher's first run, several rounds, past the steal bound and past an hour.
    await server.threads.start()
    for (const step of [10_000, 10_000, STEAL_BOUND, 10_000, 2 * 3600_000, 10_000]) {
      w.clock.t += step
      await server.threads.tick()
      await server.sync.round()
    }
    server.threads.stop()

    // Not one engine call, not one placement or hold decided, not one `assigned` written.
    expect(await server.started()).toEqual([])
    expect(await laptop.started()).toEqual([])
    expect([...server.calls, ...laptop.calls]).toEqual([])
    expect(decisions(server.logs)).toEqual([])
    for (const id of [...theirs, cut, recent, old]) {
      const events = journal(w.hub, id)
      expect(validateJournal(events)).toEqual([])
      expect(assigned(events)).toBe(assigned(before.get(id) ?? events))
    }
    // The provider sessions' turns are left as they were (the laptop's cut one: only the steal of step 2).
    for (const id of theirs) expect(journal(w.hub, id)).toEqual(before.get(id))
    expect(journal(w.hub, cut).slice(before.get(cut)!.length)).toEqual([expect.objectContaining({ type: 'turn', turn: 2, state: 'failed', reason: 'machine-lost' }), expect.objectContaining({ type: 'leg.end', reason: 'machine-lost' })])
    // The connector's requests from before threads were on are closed: expired, never started.
    for (const id of [recent, old]) expect(journal(w.hub, id).at(-1)).toMatchObject({ type: 'turn', turn: 1, state: 'held', reason: 'expired' })

    // What the person sees: the provider's turns stopped, their move; the requests, « ask again ».
    for (const id of [...theirs, cut]) expect(await server.threads.view(id)).toMatchObject({ state: 'waiting', hold: { reason: 'stopped' } })
    expect(await server.threads.view(recent)).toMatchObject({ state: 'paused', hold: { reason: 'expired', request: 'Summarise the open pull requests' } })
    expect((await server.threads.lines()).filter((l) => l.state === 'working')).toEqual([])

    // The person writes again in one of them: the old turn is closed, the new one runs, in the same session.
    await server.threads.tick()
    await server.threads.accept(failed, { text: 'Try the import again' })
    await server.threads.step(failed)
    const [r] = await server.started()
    expect(r).toMatchObject({ ok: true, leg: 'L1', rung: 1 })
    expect(server.calls).toEqual([expect.objectContaining({ how: 'resume', text: 'Try the import again' })])
    const events = journal(w.hub, failed)
    expect(validateJournal(events)).toEqual([])
    expect(turnsOf(events, 2).slice(-1)).toEqual([['held', null]])
    expect(events.find((e) => e.type === 'turn' && e.turn === 2 && e.state === 'held')).toMatchObject({ reason: 'stopped' })
    expect(turnsOf(events, 3)).toEqual([['accepted', null], ['assigned', 'stay'], ['running', null]])
  }, 120_000)
})

describe('the dispatcher keeps its own clock of what is live', () => {
  it('a message kept in the inbox longer than a request waits is filed, and expires at once', async () => {
    const w = world()
    const server = machine(w, 'server', { dispatcher: true, accounts: [{ provider: 'claude', account: accountHash('account-of-server'), used: 10 }] })
    await server.sync.round()
    await tables(server, server)
    // Accepted, kept on disk, then weevilsd was down past the hour before the dispatcher could file it.
    const id = ulid(T0 - REQUEST_EXPIRES - 60_000)
    const inbox = path.join(server.home, '.local', 'share', 'weevils', 'threads-inbox.jsonl')
    fs.writeFileSync(inbox, `${JSON.stringify({ key: 'weevils:k1', thread: id, text: 'Show prices with the currency', source: 'weevils', project: 'shop', at: T0 - REQUEST_EXPIRES - 60_000 })}\n`)
    await server.threads.start()
    await server.threads.tick()
    server.threads.stop()
    expect(turnsOf(journal(w.hub, id))).toEqual([['accepted', null], ['held', null]])
    expect(journal(w.hub, id).at(-1)).toMatchObject({ reason: 'expired' })
    expect(server.calls).toEqual([])
  }, 60_000)
})
