// Threads in the app (docs/spec, step 4), wired into weevilsd: on only with WEEVILS_THREADS=1. What this file adds to
// a weevilsd that already writes the weevbook and syncs with its hub:
//
// - the Threads service (server/weevbook/threads.ts): engines.json, the dispatcher on the machine that serves the app,
//   the start of the turns it gives this machine;
// - how a turn starts here: the provider session resumed or opened by weevilsd itself, under the account the
//   dispatcher chose (Weevils.send / createIn / resumeIn, ClaudeAccounts.use);
// - the app's view: a session row carries its thread, the rows of one thread are one row, and /api/threads.
//
// index.ts calls startThreads once; nothing here runs with the switch off.

import type http from 'node:http'
import path from 'node:path'
import type { Message, Session } from '../shared/api.ts'
import type { ThreadState } from '../shared/threads.ts'
import { MAIN, accounts } from './claude-accounts.ts'
import { reposUnder } from './connector/tools.ts'
import type { Weevils } from './core.ts'
import { claudeHaiku, relay as codexSmall } from './fast.ts'
import { providerStatus } from './provider.ts'
import { codexQuota, claudeQuota } from './usage.ts'
import type { Instruction } from './weevbook/dispatcher.ts'
import { claudeAccountOf, type EngineSource } from './weevbook/engines.ts'
import type { HubSync } from './weevbook/hub.ts'
import { slugify, type Provider } from './weevbook/journal.ts'
import { startTurn, type Launcher, type StartResult } from './weevbook/start.ts'
import { Sessions, accountOf, machinePart } from './weevbook/sync.ts'
import { Threads, type Peer, type ThreadsOptions } from './weevbook/threads.ts'
import type { VaultSource } from './weevbook/vault-raw.ts'
import { realTitle } from './transcripts.ts'

type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void

export interface ThreadsAppOptions {
  w: Weevils
  sync: HubSync
  machine: string
  dispatcher: boolean
  dataDir: string
  home: string
  claudeDir: string
  codexDir: string
  roots: string[]
  projectsDir: string
  preferred: Provider
  /** This machine's vault, when it has one now (docs/spec/07-vault.md, step 3). */
  vault?: () => VaultSource | undefined
  /** Step 4: the dispatcher's moves to another account, machine or provider wait for the person's yes. */
  moves?: ThreadsOptions['moves']
  log?: (line: string) => void
}

export interface ThreadsApp {
  threads: Threads
  /** The session rows of the snapshot, each with its thread; the rows of one thread are one row. */
  rows(sessions: Session[]): Session[]
  /** This machine starts a turn the dispatcher gave it. */
  start(ins: Instruction): Promise<StartResult>
  /** Long signed briefs carry their spoken line (server/brief-says.ts). */
  says?(messages: Message[]): Message[]
  /** The topic title of a thread, when one of its sessions was named (server/titles.ts). */
  topic?(thread: string): string | undefined
}

/** The Claude account of an engine id (its six hex characters) among the user's accounts here; null: the main one. */
function claudeAccountId(account: string, home: string): string | null {
  const a = accounts()
  if (!a) return null
  for (const f of a.folders()) if (claudeAccountOf(f.dir, home) === account) return f.id
  return null
}

export function startThreads(o: ThreadsAppOptions): ThreadsApp {
  const { w, sync } = o
  const sessionsFile = path.join(o.dataDir, 'weevbook-sessions.jsonl')
  const repos = reposUnder(o.roots)
  const folderOf = (project: string | null) => {
    if (!project) return o.projectsDir
    for (const root of o.roots) for (const name of repos()) if (slugify(name) === project) return path.join(root, name)
    return null
  }
  const use = (provider: Provider, account: string) => {
    if (provider !== 'claude') return
    const id = claudeAccountId(account, o.home)
    if (id) accounts()?.use(id)
  }
  const launch: Launcher = {
    async resume(l) {
      use(l.provider, l.account)
      try {
        await w.send(l.session, l.text)
      } catch (e) {
        // A session file this machine has not listed yet (rebuilt from raw a moment ago): started by its id.
        if ((e as { status?: number }).status !== 404) throw e
        await w.resumeIn(l.provider, l.cwd, l.session, l.text)
      }
    },
    async open(l) {
      use(l.provider, l.account)
      await w.createIn(l.cwd, l.title, l.text, [], {}, l.provider, l.session ?? undefined)
    },
  }
  const start = (ins: Instruction) =>
    startTurn({ sync, sessionsFile, dataDir: o.dataDir, machine: o.machine, home: o.home, claudeDir: o.claudeDir, codexDir: o.codexDir, roots: o.roots, projectsDir: o.projectsDir, launch, folderOf, vault: o.vault?.(), log: o.log }, ins)
  const sources = (): EngineSource[] => {
    const out: EngineSource[] = []
    const claude = providerStatus('claude')
    const a = accounts()
    for (const f of a ? a.folders() : [{ id: MAIN, dir: null, logged: claude.logged }]) {
      out.push({ provider: 'claude', account: claudeAccountOf(f.dir, o.home), signedIn: claude.installed && f.logged, quota: () => (a ? a.quotaOf(f.id) : claudeQuota()) })
    }
    const codex = providerStatus('codex')
    out.push({ provider: 'codex', account: accountOf('codex', o.home, path.dirname(o.codexDir)), signedIn: codex.installed && codex.logged, quota: codexQuota })
    return out
  }
  const peers = (): Peer[] =>
    w.remotes
      .filter((r) => r.snap?.machines[0]?.id)
      .map((r) => ({
        machine: machinePart(r.snap!.machines[0].id),
        online: r.online,
        start: (ins) => r.call<StartResult>('POST', '/api/weevbook/start', ins),
        deliver: async (thread, text) => void (await r.call('POST', '/api/weevbook/deliver', { thread, text })),
      }))
  const threads = new Threads({
    sync,
    machine: o.machine,
    dispatcher: o.dispatcher,
    preferred: o.preferred,
    inboxFile: path.join(o.dataDir, 'threads-inbox.jsonl'),
    projects: () => repos().map((r) => slugify(r)).filter(Boolean),
    sources,
    start,
    deliver: async (session, text) => void (await w.send(session, text)),
    peers,
    write: (provider, prompt) => (provider === 'claude' ? claudeHaiku(prompt, 180_000) : codexSmall(prompt, 180_000)),
    changed: () => w.bump(),
    ...(o.moves ? { moves: o.moves } : {}),
    log: o.log,
  })
  void threads.start()

  // Which thread each session file belongs to, and each thread's title, read again every few seconds.
  const sessions = new Sessions(sessionsFile)
  let titles = new Map<string, string>()
  let states = new Map<string, ThreadState>()
  const refresh = async () => {
    const before = sessions.all().length
    const was = [...states].join()
    await sessions.load().catch(() => undefined)
    const lines = await threads.lines().catch(() => null)
    if (lines) {
      titles = new Map(lines.filter((l) => l.title).map((l) => [l.thread, l.title]))
      states = new Map(lines.map((l) => [l.thread, l.state]))
    }
    if (sessions.all().length !== before || [...states].join() !== was) w.bump()
  }
  void refresh()
  setInterval(() => void refresh(), 5_000).unref?.()

  const rows = (list: Session[]): Session[] => {
    const best = new Map<string, Session>()
    const out: Session[] = []
    for (const s of list) {
      const thread = s.thread ?? (s.machineId === o.machine ? sessions.get(`${s.tool}:${s.id}`)?.thread : undefined)
      if (!thread) {
        out.push(s)
        continue
      }
      const row = { ...s, ...rowState(s, states.get(thread)), thread, title: rowTitle(s.title, titles.get(thread), realTitle(o.w.titles?.get(s.id)?.title)) }
      const cur = best.get(thread)
      if (!cur || row.lastActivityAt > cur.lastActivityAt) best.set(thread, row)
    }
    return [...out, ...best.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }
  // A thread's topic: the renamer's title of a session it ran in (the thread's own is often the brief's first words).
  const topic = (thread: string): string | undefined => {
    let found: string | undefined
    for (const r of sessions.all()) if (r.thread === thread) found = realTitle(o.w.titles?.get(r.key.slice(r.key.indexOf(':') + 1))?.title) ?? found
    return found
  }
  return { threads, rows, start, says: (m) => o.w.says?.attach(m) ?? m, topic }
}

/** The session's topic title (the renamer's) wins over the thread's, which is often only the first words of the brief
 *  that opened it (« Asks from Alex (medium effort… »); the thread's title stands in until the topic is named. */
export const rowTitle = (session: string, thread: string | undefined, topic: string | undefined): string => (topic ? session : thread || session)

/**
 * A session row says what its thread says (one of three states), not what its engine did: a usage limit or an error
 * the dispatcher works around is not a cut. A question the engine asks (a permission) stays: the person must answer.
 */
export function rowState(s: Session, state: ThreadState | undefined): Partial<Session> {
  if (!state) return {}
  const { interrupted: _i, ...rest } = s
  if (s.status === 'needs_user' && (s.attention || s.choices?.length || s.ask)) return {}
  if (state === 'working') return { ...rest, interrupted: undefined, status: 'working', workStartedAt: s.workStartedAt ?? s.lastActivityAt }
  if (state === 'paused') return { ...rest, interrupted: undefined, status: 'needs_user', workStartedAt: null }
  return s.status === 'interrupted' || s.status === 'working' && !s.live ? { ...rest, interrupted: undefined, status: 'idle', workStartedAt: null } : {}
}

/** The routes of threads: the app's (list, read, write, continue) and the dispatcher's calls to this machine. */
export function threadsRoutes(app: ThreadsApp, json: Json, readBody: ReadBody, isLocal: (req: http.IncomingMessage) => boolean): [string, RegExp, Handler][] {
  const t = app.threads
  return [
    ['GET', /^\/api\/threads$/, async (_req, res, url) => {
      const project = url.searchParams.get('project') ?? undefined
      const list = await t.list({ project, q: url.searchParams.get('q') ?? undefined })
      json(res, 200, { ...list, threads: list.threads.map((l) => ({ ...l, title: app.topic?.(l.thread) ?? l.title })) })
    }],
    ['GET', /^\/api\/threads\/([0-9A-HJKMNP-TV-Z]{26})$/, async (_req, res, _u, [id]) => {
      const v = await t.view(id)
      if (!v) return json(res, 404, { error: 'not found' }) // i18n-ignore: an API answer the app does not show
      json(res, 200, { ...v, title: app.topic?.(id) ?? v.title, messages: app.says ? app.says(v.messages) : v.messages })
    }],
    ['POST', /^\/api\/threads\/([0-9A-HJKMNP-TV-Z]{26})\/send$/, async (req, res, _u, [id]) => {
      const body = await readBody(req)
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text) return json(res, 400, { error: 'empty' }) // i18n-ignore: the composer never sends an empty message
      const key = typeof body?.key === 'string' && /^[\w:.-]{1,120}$/.test(body.key) ? `weevils:${body.key}` : undefined
      json(res, 200, await t.accept(id, { text, key, source: 'weevils' }))
    }],
    ['POST', /^\/api\/threads\/([0-9A-HJKMNP-TV-Z]{26})\/continue$/, async (_req, res, _u, [id]) => {
      t.poke(id)
      json(res, 200, (await t.view(id)) ?? { thread: id })
    }],
    // The dispatcher of another machine: start this turn here, give this message to the turn running here.
    ['POST', /^\/api\/weevbook\/start$/, async (req, res) => {
      if (!isLocal(req)) return json(res, 403, { error: 'forbidden' }) // i18n-ignore: machine to machine
      json(res, 200, await app.start((await readBody(req)) as Instruction))
    }],
    ['POST', /^\/api\/weevbook\/deliver$/, async (req, res) => {
      if (!isLocal(req)) return json(res, 403, { error: 'forbidden' }) // i18n-ignore: machine to machine
      const body = await readBody(req)
      await t.deliverHere(String(body?.thread ?? ''), String(body?.text ?? ''))
      json(res, 200, { ok: true })
    }],
  ]
}
