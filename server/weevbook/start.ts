// The chosen engine's machine starts a turn (docs/spec/03-sync-and-lease.md, « Who writes what »; 04-resume.md, the
// rungs). The dispatcher sent an instruction: this attempt of this turn, on this engine, at this rung. Here: the lease
// is taken with `assigned`, `leg.start` and `running` in one push, the provider session is made ready (the same one,
// rebuilt from raw on another machine, or a new one that reads the handoff), and the provider gets the request.
//
// What the engine does next is written by the shadow writer (writer.ts, sync.ts) like any session of this machine, and
// the hub sync renews the lease while the turn runs and lets it go when the turn ends.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { claudeSlug, place, realGit, type PlaceDeps } from '../bring.ts'
import { restoreCheckpoint } from './checkpoint.ts'
import type { Instruction } from './dispatcher.ts'
import { firstRequest, journalHandoff } from './handoff.ts'
import { HubSync, REMOTE, draft, legCount, openLeg, safeTurns } from './hub.ts'
import { parseEngine, slugify, type CheckpointEvent, type EventDraft, type JournalEvent, type LegId, type MetaEvent, type Provider } from './journal.ts'
import type { Intent, Seen } from './lease.ts'
import { busyByFiles, countLines, destination, findSession, rebuild } from './resume.ts'
import { Sessions, machinePart, sessionKey } from './sync.ts'
import { assign, next, preface, prefaceSign } from './turn.ts'

/** How weevilsd starts a provider: on an existing session, or a new one. `account`: the six hex characters of the
 *  engine's account, to sign in under. */
export interface Launcher {
  resume(o: { provider: Provider; session: string; cwd: string; text: string; account: string; thread: string }): Promise<void>
  /** A new session in `cwd` whose first request is `text`. Claude takes the id given; Codex chooses its own (null). */
  open(o: { provider: Provider; cwd: string; title: string; text: string; account: string; session: string | null; thread: string }): Promise<void>
}

export interface StartHost {
  sync: HubSync
  /** DATA_DIR/weevbook-sessions.jsonl, DATA_DIR. */
  sessionsFile: string
  dataDir: string
  machine: string
  home: string
  claudeDir: string
  codexDir: string
  roots: string[]
  projectsDir: string
  launch: Launcher
  /** The folder of a project on this machine, for a thread that has no leg yet. */
  folderOf: (project: string | null) => string | null
  git?: PlaceDeps['git']
  now?: () => number
  log?: (line: string) => void
  /** How long a new Codex session may take to write its file (ms). */
  findFor?: number
  sleep?: (ms: number) => Promise<void>
}

export type StartResult =
  | { ok: true; leg: LegId; session: string; rung: number; cwd: string; text: string }
  | { ok: false; why: 'not-here' | 'unreachable' | 'busy' | 'stale' | 'rejected' | 'no-folder' | 'launch'; detail: string }

const no = (why: Extract<StartResult, { ok: false }>['why'], detail: string): StartResult => ({ ok: false, why, detail })

/**
 * The thread as the hub has it, here (call inside sync.serial): the hub's version adopted, unless this machine has
 * more (it holds the thread and the round has not pushed yet). A local copy that went another way is handed over as
 * an orphan first (HubSync.yieldTo), as when a lease is lost.
 */
export async function readThread(sync: HubSync, id: string): Promise<{ seen: Seen; events: JournalEvent[]; ahead: boolean; orphans: { ref: string; commit: string }[] } | null> {
  const f = await sync.client.fetch(id)
  if (!f) return null
  const H = f.seen.tip
  const ancestor = async (a: string, b: string) => (await sync.git(['merge-base', '--is-ancestor', a, b])).code === 0
  const r = await sync.withBook(async () => {
    const book = sync.book
    let L = await book.threadRef(id)
    // A folder ahead of its ref (the writer appended since the last round): committed first, so nothing is lost.
    if (await book.thread(id)) L = (await book.commitThread(id, `sync · ${sync.status.machine}`)) ?? L
    let ahead = false
    if (H && L !== H) {
      if (L && (await ancestor(H, L))) ahead = true
      else if (!L || (await ancestor(L, H))) await book.adopt(id, H)
      else return 'diverged' as const
    }
    return { events: (await book.thread(id))?.journal.events ?? [], ahead }
  })
  if (r === undefined) return null
  if (r === 'diverged') {
    await sync.yieldTo(id, f.seen)
    const events = await sync.withBook(async () => (await sync.book.thread(id))?.journal.events ?? [])
    return { seen: f.seen, events: events ?? [], ahead: false, orphans: f.orphans }
  }
  return { seen: f.seen, events: r.events, ahead: r.ahead, orphans: f.orphans }
}

/**
 * Appends events to a thread here and pushes them with the lease (call inside sync.serial): taken idle by the
 * dispatcher's machine to file messages and holds, or working by the engine's machine to start a turn. On a refusal,
 * the hub's version comes back and these events never happened.
 */
export async function pushEvents(sync: HubSync, id: string, seenTip: string | null, drafts: EventDraft[], intent: (events: readonly JournalEvent[]) => Omit<Intent, 'tip'>, subject: string): Promise<{ ok: true; tip: string; epoch: number } | { ok: false }> {
  const book = sync.book
  const wrote = await sync.withBook(async () => {
    const tip = await book.threadRef(id)
    if (seenTip && tip !== seenTip) {
      // Only this machine's own commits may sit on top of the hub's tip.
      if (!tip || (await sync.git(['merge-base', '--is-ancestor', seenTip, tip])).code !== 0) return null
    }
    if (drafts.length) {
      const r = await book.append(id, { events: drafts })
      if (r.refused) {
        // Refused by the journal: the hub's version, and nothing of it.
        if (seenTip) await book.adopt(id, seenTip)
        return null
      }
    }
    const commit = await book.commitThread(id, subject)
    const events = (await book.thread(id))?.journal.events ?? []
    return commit ? { commit, events } : null
  })
  if (!wrote) return { ok: false }
  const out = await sync.client.take(id, { ...intent(wrote.events), tip: wrote.commit })
  if (!out.ok) {
    const f = await sync.client.fetch(id)
    if (f?.seen.tip) await sync.withBook(() => book.adopt(id, f.seen.tip!))
    return { ok: false }
  }
  await sync.git(['update-ref', `refs/hub/threads/${id}`, wrote.commit])
  sync.status.held[id] = { epoch: out.lease.epoch, state: out.lease.state }
  return { ok: true, tip: wrote.commit, epoch: out.lease.epoch }
}

/** The session file a new Codex session wrote for a thread: the one whose first request names the thread. */
export async function findNewSession(codexDir: string, thread: string, since: number): Promise<{ session: string; file: string } | null> {
  const sign = prefaceSign(thread)
  const days = [new Date(since), new Date()].map((d) => path.join(codexDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  for (const dir of [...new Set(days)]) {
    let names: string[] = []
    try {
      names = await fsp.readdir(dir)
    } catch {
      continue
    }
    for (const n of names) {
      const m = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(n)
      if (!m) continue
      const file = path.join(dir, n)
      const st = await fsp.stat(file).catch(() => null)
      if (!st || st.mtimeMs < since - 5_000) continue
      const head = await fsp.readFile(file, 'utf8').then((t) => t.slice(0, 256 << 10), () => '')
      if (head.includes(sign) || head.includes(JSON.stringify(sign).slice(1, -1))) return { session: m[1], file }
    }
  }
  return null
}

/** The request the engine reads first: the preface after an effect (RESUME-8), else the user's message. */
function requestOf(id: string, events: readonly JournalEvent[], turn: number, resume: boolean): string {
  const accepted = events.find((e) => e.type === 'turn' && e.turn === turn && e.state === 'accepted')
  const asked = accepted && accepted.type === 'turn' && accepted.message ? events.find((e) => e.id === accepted.message) : undefined
  return resume || !asked || asked.type !== 'message' ? preface(id, events, turn) : asked.text
}

/** Starts the instruction's attempt here. Every refusal writes nothing; the dispatcher places the turn again. */
export async function startTurn(h: StartHost, ins: Instruction): Promise<StartResult> {
  const now = h.now ?? Date.now
  const sync = h.sync
  const id = ins.thread
  const E = parseEngine(ins.engine)
  if (!E || E.machine !== machinePart(h.machine)) return no('not-here', `${ins.engine} is not an engine of this machine`)
  const provider = E.provider
  const account = ins.engine.slice(ins.engine.indexOf(':') + 1, ins.engine.indexOf('@'))
  if (!(await sync.ensure())) return no('unreachable', sync.status.error ?? 'the hub did not answer')

  // 1. The thread, and whether this attempt is still the one to start.
  const got = await sync.serial(() => readThread(sync, id))
  if (!got) return no('unreachable', 'fetch')
  if (got.seen.lease?.state === 'working') return no('busy', `${got.seen.lease.holder} holds it working`)
  const events = got.events
  const turns = safeTurns(events)
  const nx = next(turns)
  if (nx.kind !== 'dispatch' || nx.turn !== ins.turn || nx.attempt !== ins.attempt) return no('stale', `the thread moved on (${nx.kind})`)

  // 2. The session: the same provider's last one when the rung allows it, else a new one (rung 0 or 3).
  const open = openLeg(events)
  const same = open !== null && open.engine === ins.engine
  const legs = events.filter((e) => e.type === 'leg.start')
  const last = legs.at(-1)
  const ownLast = legs.findLast((e) => e.type === 'leg.start' && parseEngine(e.engine)?.provider === provider)
  const native = ins.rung === 1 || ins.rung === 2
  let session = native && ownLast && ownLast.type === 'leg.start' ? ownLast.session : null
  let cwd = open?.cwd ?? (last && last.type === 'leg.start' ? last.cwd : '') ?? ''
  const meta = events.findLast((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)
  const project = meta?.project ?? null
  const title = events.findLast((e): e is MetaEvent => e.type === 'meta' && !!e.title)?.title ?? ''
  const sessionFile = session ? findSession(provider, session, h.claudeDir, h.codexDir) : null
  if (native && session && !sessionFile && ins.rung === 1) return no('stale', `session ${session} is not on this machine`)

  // 3. The folder: here already, or found or cloned, then the thread's last checkpoint restored (rungs 2 and 3, and a
  //    leg that comes from another machine).
  const fromElsewhere = !!last && last.type === 'leg.start' && parseEngine(last.engine)?.machine !== E.machine
  if (!last) {
    const folder = h.folderOf(project)
    if (!folder) return no('no-folder', `${project ?? 'the thread'} has no folder here`)
    cwd = folder
  } else if (fromElsewhere || !fs.existsSync(cwd)) {
    const checkpoints = events.filter((e): e is CheckpointEvent => e.type === 'checkpoint')
    await sync.git(['fetch', '--quiet', '--no-tags', REMOTE, `+refs/checkpoints/${id}:refs/hub/checkpoints/${id}`])
    let ck: CheckpointEvent | undefined
    for (const c of [...checkpoints].reverse()) {
      if (c.kind === 'none' || !c.commit) continue
      if ((await sync.git(['cat-file', '-e', `${c.commit}^{commit}`])).code === 0) {
        ck = c
        break
      }
    }
    const existed = new Set(await fsp.readdir(h.projectsDir).catch(() => [] as string[]))
    const p = await place({ cwd, origin: ck?.repo, branch: ck?.branch }, { home: h.home, projectsDir: h.projectsDir, roots: h.roots, claudeDir: h.claudeDir, codexDir: h.codexDir, git: h.git ?? realGit })
    const fresh = path.dirname(p.to) === path.resolve(h.projectsDir) && !existed.has(path.basename(p.to))
    cwd = p.cwd
    if (ck && (ck.kind === 'git' || ck.kind === 'shadow')) {
      const slug = `${slugify(title).slice(0, 40) || 'thread'}-${id.slice(-6).toLowerCase()}`
      const restored = await restoreCheckpoint({ kind: ck.kind, commit: ck.commit!, base: ck.base, branch: ck.branch, repo: ck.repo, thread: id, slug, dir: p.to, fresh, source: sync.book.gitDir, sourceRef: `refs/hub/checkpoints/${id}`, dataDir: h.dataDir, busy: busyByFiles(h.claudeDir)(p.cwd) })
      if (restored.mode === 'worktree' || restored.mode === 'beside') cwd = path.join(restored.dir, path.relative(p.to, p.cwd))
    }
  }

  // A new Claude session takes the id given; a Codex one is known once its file is written.
  if (!session && provider === 'claude') session = crypto.randomUUID()
  const leg: LegId = same ? open!.leg : (`L${legCount(events) + 1}` as LegId)

  // 4. The journal and the lease, in one push: leg.end (moved), assigned, leg.start, running.
  const at = now()
  const known = session !== null
  const pushed = await sync.serial(() =>
    pushEvents(
      sync,
      id,
      got.seen.tip,
      [
        ...(open && !same ? [draft(at, open.leg, { type: 'leg.end', reason: 'moved', by: h.machine })] : []), // i18n-ignore: journal data
        draft(at, same ? open!.leg : null, { type: 'turn', ...assign(turns, ins.turn, ins.engine, ins.rule, ins.reason) }),
        ...(same || !known ? [] : [draft(at, leg, { type: 'leg.start', engine: ins.engine, session, cwd, rung: ins.rung, epoch: nextEpoch(got.seen, h.machine) })]),
        ...(known ? [draft(at, leg, { type: 'turn', turn: ins.turn, state: 'running' })] : []),
      ],
      () => ({ engine: ins.engine, leg, state: 'working', turn: ins.turn }),
      `turn ${ins.turn} (running) · ${provider} · ${h.machine}`,
    ),
  )
  if (!pushed.ok) return no('rejected', 'the thread moved on the hub meanwhile')
  const all = await sync.withBook(async () => (await sync.book.thread(id))?.journal.events ?? events) ?? events

  // 5. The provider session: recorded before anything is written to it (the writer must never take it for a new
  //    thread), then made ready.
  const sessions = new Sessions(h.sessionsFile)
  await sessions.load()
  let file = sessionFile ?? ''
  if (native && session && (ins.rung === 2 || !sessionFile)) {
    const text = await sync.withBook(async () => rebuild(sync.book, id, all, provider, session!, cwd))
    file = await destination(provider, session, cwd, h.claudeDir, h.codexDir, now())
    await sessions.record({ key: sessionKey({ file, provider }), thread: id, leg, provider, file, lines: countLines(text ?? ''), offset: Buffer.byteLength(text ?? ''), rawBytes: 0, base: countLines(text ?? ''), moved: false })
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, text ?? '')
  } else if (native && sessionFile && !same) {
    const text = await fsp.readFile(sessionFile, 'utf8')
    await sessions.record({ key: sessionKey({ file: sessionFile, provider }), thread: id, leg, provider, file: sessionFile, lines: countLines(text), offset: Buffer.byteLength(text), rawBytes: 0, base: countLines(text), moved: false })
  } else if (!native && provider === 'claude') {
    file = path.join(h.claudeDir, claudeSlug(cwd), `${session}.jsonl`)
    await sessions.record({ key: sessionKey({ file, provider }), thread: id, leg, provider, file, lines: 0, offset: 0, rawBytes: 0, base: 0, moved: false })
  }

  // 6. The engine gets the request. A new session reads the handoff first (rung 3; rung 0 for a chat's first engine).
  const request = requestOf(id, all, ins.turn, nx.resume)
  const history = all.some((e) => e.type === 'message' && e.role === 'assistant') || legs.length > 0
  // A new Codex session is found by the thread its first request names: a plain request is signed too.
  const text = !native && history ? firstRequest(id, all, (await handoffOf(sync, id)) ?? journalHandoff(id, all, now()), request) : !known ? `${prefaceSign(id)} ${request}` : request
  try {
    if (native) await h.launch.resume({ provider, session: session!, cwd, text, account, thread: id })
    else {
      await h.launch.open({ provider, cwd, title: title || request.slice(0, 60), text, account, session, thread: id })
      if (!known) {
        // Codex: its session id is in the name of the file it writes first; the leg starts once it is known.
        const t0 = now()
        let found: { session: string; file: string } | null = null
        while (!found && now() - t0 < (h.findFor ?? 30_000)) {
          found = await findNewSession(h.codexDir, id, at)
          if (!found) await (h.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(500)
        }
        if (!found) throw new Error('the new Codex session wrote no file')
        session = found.session
        file = found.file
        await sessions.record({ key: sessionKey({ file, provider }), thread: id, leg, provider, file, lines: 0, offset: 0, rawBytes: 0, base: 0, moved: false })
        const more = await sync.serial(() =>
          pushEvents(sync, id, pushed.tip, [draft(now(), leg, { type: 'leg.start', engine: ins.engine, session, cwd, rung: ins.rung, epoch: pushed.epoch }), draft(now(), leg, { type: 'turn', turn: ins.turn, state: 'running' })], () => ({ engine: ins.engine, leg, state: 'working', turn: ins.turn }), `turn ${ins.turn} (running) · ${provider} · ${h.machine}`),
        )
        if (!more.ok) throw new Error('the lease moved while Codex started')
      }
    }
  } catch (e) {
    // The engine did not start: the attempt failed with no effect, its leg (if it started) ends, the thread is idle.
    await sync.serial(async () => {
      const cur = await sync.withBook(async () => (await sync.book.thread(id))?.journal.events ?? [])
      const tip = await sync.withBook(() => sync.book.threadRef(id))
      const t = now()
      const legOpen = openLeg(cur ?? [])
      const live = safeTurns(cur ?? []).find((x) => x.turn === ins.turn && (x.state === 'assigned' || x.state === 'running'))
      await pushEvents(
        sync,
        id,
        tip ?? null,
        [
          ...(live ? [draft(t, legOpen?.leg ?? null, { type: 'turn', turn: ins.turn, state: 'failed', reason: 'api', effect: 'none' })] : []), // i18n-ignore: journal data
          ...(legOpen && legOpen.engine === ins.engine ? [draft(t, legOpen.leg, { type: 'leg.end', reason: 'error', by: h.machine })] : []), // i18n-ignore: journal data
        ],
        () => ({ engine: null, leg: null, state: 'idle' }),
        `turn ${ins.turn} (failed) · ${provider} · ${h.machine}`,
      )
    })
    h.log?.(`[threads] ${id.slice(-6)} turn ${ins.turn}: ${provider} did not start: ${(e as Error).message}`)
    return no('launch', (e as Error).message)
  }
  h.log?.(`[threads] ${id.slice(-6)} turn ${ins.turn}.${ins.attempt} → ${ins.engine} (${ins.rule}, rung ${ins.rung})`)
  return { ok: true, leg, session: session!, rung: ins.rung, cwd, text }
}

/** The epoch a lease taken now gets: one more when it comes from another holder (lease.ts plan). */
function nextEpoch(seen: Seen, machine: string): number {
  return seen.lease && seen.lease.holder !== machine ? seen.lease.epoch + 1 : (seen.lease?.epoch ?? 1)
}

/** The thread's handoff.md here, when it has one. */
async function handoffOf(sync: HubSync, id: string): Promise<string | null> {
  return (
    (await sync.withBook(async () => {
      const p = sync.book.pathOf(id)
      return p ? fsp.readFile(path.join(sync.book.abs(p), 'handoff.md'), 'utf8').catch(() => null) : null
    })) ?? null
  )
}
