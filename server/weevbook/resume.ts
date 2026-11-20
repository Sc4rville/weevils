// A thread resumed on this machine, with the same provider (docs/spec/04-resume.md, step 3): its lease taken (stolen
// first when its holder went silent), the code restored from its last checkpoint on the hub, the provider session
// rebuilt from the raw segments with the folder path rewritten, and the failed turn given again with the signed
// preface, never as a replay of the user's message. dispatch.ts chooses among this machine's engines of the thread's
// own provider; a change of provider is not done here.
//
// `weevils weevbook resume <thread>` calls it. Step 4's dispatcher starts turns with start.ts, which uses the same
// pieces (the session rebuilt from raw, the checkpoint restored) for every rung.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { claudeSlug, place, realGit, rewritePaths, type PlaceDeps } from '../bring.ts'
import { restoreCheckpoint, type Restored } from './checkpoint.ts'
import { decide, threadFacts, type MachineFacts, type Quota } from './dispatch.ts'
import { HubSync, REMOTE, draft, legCount, openLeg, safeTurns } from './hub.ts'
import { parseEngine, slugify, type CheckpointEvent, type EventDraft, type JournalEvent, type LegId, type MetaEvent, type Provider } from './journal.ts'
import { OBSERVE_EVERY, STEAL_BOUND, stealable, type Intent } from './lease.ts'
import { writeAtomic } from './store.ts'
import { Sessions, accountOf as accountHash, machinePart, sessionKey } from './sync.ts'
import { assign, next, preface } from './turn.ts'

export interface Launch {
  provider: Provider
  /** The provider session to resume natively (`claude --resume <session>`, `codex resume <session>`). */
  session: string
  cwd: string
  /** The session file, as rebuilt here. */
  file: string
  /** The first request: the preface of 04 for a turn that resumes after an effect, the user's message otherwise. */
  text: string
  thread: string
  turn: number
}

export interface ResumeOptions {
  thread: string
  /** The weevbook (DATA_DIR/weevbook), DATA_DIR, and DATA_DIR/weevbook-sessions.jsonl. */
  dir: string
  dataDir: string
  sessions: string
  machine: string
  home: string
  /** ~/.claude/projects and ~/.codex/sessions. */
  claudeDir: string
  codexDir: string
  roots: string[]
  projectsDir: string
  hub: { url: string; here: boolean }
  /** Starts the provider on the session with its first request (weevilsd: w.send; the command line: the local API). */
  launch: (l: Launch) => Promise<void>
  /** The hub sync of this process, when there is one: one lease client and one order of writes. */
  sync?: HubSync
  ssh?: string
  /** A silent holder: wait until its lease may be stolen (at most STEAL_BOUND), then steal it. */
  wait?: boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** The account of each provider on this machine (default: the signed-in one, as the writer reads it). */
  account?: (p: Provider) => string
  /** Another session works in this folder now (default: a session file of it written in the last 2 minutes). */
  busy?: (cwd: string) => boolean
  git?: PlaceDeps['git']
  log?: (line: string) => void
}

export type ResumeResult =
  | {
      ok: true
      /** The turn given to the engine (null: no turn was waiting, the thread is only placed here). */
      turn: number | null
      attempt?: number
      resume?: boolean
      leg: LegId
      rung: 1 | 2
      engine: string
      rule: string
      cwd: string
      file: string
      session: string
      restored: Restored | null
      /** The lease was stolen first (its holder had gone silent). */
      stole: boolean
      launched: boolean
      ms: number
    }
  | {
      ok: false
      why: 'unreachable' | 'unknown' | 'held' | 'here' | 'own-leg' | 'attempts' | 'busy' | 'hold' | 'no-session' | 'rejected' | 'launch'
      detail: string
      /** held: how long until a steal is allowed, by this clock. */
      wait?: number
      holder?: string
    }

const fail = (why: Extract<ResumeResult, { ok: false }>['why'], detail: string, more: { wait?: number; holder?: string } = {}): ResumeResult => ({ ok: false, why, detail, ...more })
const zero = (now: number): Quota => ({ readAt: now, fiveHour: { used: 0, resetsAt: null }, week: { used: 0, resetsAt: null } })

/** A session of the folder was written in the last two minutes: someone works there. */
export function busyByFiles(claudeDir: string) {
  return (cwd: string) => {
    const dir = path.join(claudeDir, claudeSlug(cwd))
    try {
      const now = Date.now()
      return fs.readdirSync(dir).some((f) => f.endsWith('.jsonl') && now - fs.statSync(path.join(dir, f)).mtimeMs < 120_000)
    } catch {
      return false
    }
  }
}

/** The provider session file of `session` on this machine, if there is one. */
export function findSession(provider: Provider, session: string, claudeDir: string, codexDir: string): string | null {
  if (provider === 'claude') {
    let dirs: fs.Dirent[] = []
    try {
      dirs = fs.readdirSync(claudeDir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const d of dirs.filter((x) => x.isDirectory())) {
      const f = path.join(claudeDir, d.name, `${session}.jsonl`)
      if (fs.existsSync(f)) return f
    }
    return null
  }
  const walk = (dir: string): string | null => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name)
      if (d.isDirectory()) {
        const f = walk(p)
        if (f) return f
      } else if (d.name.endsWith(`-${session}.jsonl`)) return p
    }
    return null
  }
  try {
    return walk(codexDir)
  } catch {
    return null
  }
}
export const countLines = (text: string) => text.split('\n').length - 1

/** The raw lines of every leg of `session`, in order, each leg's folder rewritten to `cwd` (04-resume.md, rung 2). */
export async function rebuild(book: HubSync['book'], thread: string, events: readonly JournalEvent[], provider: Provider, session: string, cwd: string): Promise<string> {
  const dir = book.abs(book.pathOf(thread)!)
  const names = await fsp.readdir(path.join(dir, 'raw')).catch(() => [] as string[])
  let text = ''
  for (const e of events) {
    if (e.type !== 'leg.start' || e.session !== session || parseEngine(e.engine)?.provider !== provider || !e.leg) continue
    const segs = names.filter((n) => n.startsWith(`${e.leg}.${provider}.`) && n.endsWith('.jsonl')).sort()
    let leg = ''
    for (const n of segs) leg += await fsp.readFile(path.join(dir, 'raw', n), 'utf8')
    text += rewritePaths(leg, e.cwd, cwd)
  }
  return text
}

/** Where the provider looks for the session here; an existing file is kept beside (`.before-weevbook`). */
export async function destination(provider: Provider, session: string, cwd: string, claudeDir: string, codexDir: string, now: number): Promise<string> {
  let dest: string
  if (provider === 'claude') dest = path.join(claudeDir, claudeSlug(cwd), `${session}.jsonl`)
  else {
    const there = findSession('codex', session, claudeDir, codexDir)
    const d = new Date(now)
    dest = there ?? path.join(codexDir, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'), `rollout-${d.toISOString().slice(0, 19).replace(/:/g, '-')}-${session}.jsonl`)
  }
  if (fs.existsSync(dest)) {
    let keep = `${dest}.before-weevbook`
    for (let i = 2; fs.existsSync(keep); i++) keep = `${dest}.before-weevbook-${i}`
    await fsp.rename(dest, keep)
  }
  return dest
}

/**
 * Resumes a thread here. Fails without writing anything when the thread is busy elsewhere (its holder is alive), held
 * for attempts, or can only continue on its machine (a checkpoint of `kind: none`).
 */
export async function resumeThread(o: ResumeOptions): Promise<ResumeResult> {
  const t0 = Date.now()
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const me = machinePart(o.machine)
  const sync = o.sync ?? new HubSync({ dir: o.dir, dataDir: o.dataDir, sessions: o.sessions, machine: o.machine, hub: o.hub, steals: false, now, log: o.log, ssh: o.ssh })
  if (!(await sync.ensure())) return fail('unreachable', sync.status.error ?? 'the hub did not answer')
  const id = o.thread

  // 1. The lease: idle (whoever holds it) or stolen from a holder that went silent.
  let stole = false
  const until = now() + STEAL_BOUND + 30_000
  for (;;) {
    const f = await sync.serial(() => sync.client.fetch(id))
    if (!f) return fail('unreachable', 'fetch')
    const l = f.seen.lease
    if (!l || !f.seen.tip) return fail('unknown', 'the hub has no such thread')
    if (l.state !== 'working') break
    if (l.holder === o.machine) return fail('here', `a turn of this thread runs on this machine (${l.engine ?? '?'})`, { holder: l.holder })
    const s = stealable(f.seen, now())
    if (s.ok) {
      if (await sync.serial(() => sync.steal(id, f.seen))) {
        stole = true
        break
      }
      continue
    }
    if (!o.wait || now() + Math.min(s.wait, OBSERVE_EVERY) > until) return fail('held', `${l.holder} holds it, working on turn ${l.turn ?? '?'}`, { wait: s.wait, holder: l.holder })
    await sleep(Math.min(s.wait, OBSERVE_EVERY))
  }

  // 2. The thread as the hub has it, here.
  const got = await sync.serial(async () => {
    const f = await sync.client.fetch(id)
    if (!f?.seen.tip) return null
    await sync.yieldTo(id, f.seen)
    const th = await sync.book.thread(id)
    return th ? { seen: f.seen, events: th.journal.events } : null
  })
  if (!got) return fail('unreachable', 'fetch')
  const { seen, events } = got
  if (seen.lease?.state === 'working') return fail('held', `${seen.lease.holder} took it meanwhile`, { holder: seen.lease.holder })
  const open = openLeg(events)
  if (open && parseEngine(open.engine)?.machine === me) return fail('own-leg', `its leg ${open.leg} is this machine's own session ${open.session}: continue it in the app`)
  const legs = events.filter((e) => e.type === 'leg.start')
  const last = legs.at(-1)
  if (!last || last.type !== 'leg.start') return fail('no-session', 'the thread has no provider session yet')
  const provider = parseEngine(last.engine)!.provider
  const turns = safeTurns(events)
  const nx = next(turns)
  if (nx.kind === 'busy') return fail('busy', `turn ${nx.turn} is ${nx.state} in the journal`)
  if (nx.kind === 'hold') return fail('attempts', `turn ${nx.turn} failed ${3} times on api or auth: it waits for "try again"`)

  // 3. The engine: this machine's, of the same provider (dispatch.ts on a table of this machine and the old one).
  const account = o.account ?? ((p: Provider) => accountHash(p, o.home, path.dirname(o.codexDir)))
  const mine = `${provider}:${account(provider)}@${me}`
  const meta = events.find((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)
  const project = meta?.project ?? null
  const checkpoints = events.filter((e): e is CheckpointEvent => e.type === 'checkpoint')
  const ckEvent = checkpoints.at(-1)
  const at = now()
  const old = parseEngine(last.engine)!
  const table: MachineFacts[] = [{ machine: me, seen: at, answers: true, projects: project ? [project] : [], engines: [{ engine: mine, signedIn: true }] }]
  if (old.machine !== me) table.push({ machine: old.machine, seen: 0, answers: false, projects: [], engines: [{ engine: last.engine, signedIn: true }] })
  const retry = nx.kind === 'dispatch' && nx.retry
  const facts = threadFacts(events, { project, cloneable: !!ckEvent?.repo, retry, turn: nx.kind === 'dispatch' ? nx.turn : turns.length })
  const d = decide({ now: at, thread: facts, table: { machines: table, quotas: { [`${provider}:${account(provider)}`]: zero(at) } }, ledger: [], preferred: provider })
  if (d.rule === 'hold' || !d.engine) return fail('hold', `${d.hold ?? 'hold'}: ${d.reason}`)
  if (parseEngine(d.engine)?.provider !== provider) return fail('hold', `only ${provider} resumes in step 3`)
  const rung: 1 | 2 = d.rung === 1 ? 1 : 2

  // 4. The code: the last checkpoint the hub has, restored without overwriting anyone's work.
  const book = sync.book
  let restored: Restored | null = null
  let cwd = last.cwd
  const session = last.session
  const sessionFile = findSession(provider, session, o.claudeDir, o.codexDir)
  if (rung === 2 || !sessionFile) {
    await sync.git(['fetch', '--quiet', '--no-tags', REMOTE, `+refs/checkpoints/${id}:refs/hub/checkpoints/${id}`])
    let ck: CheckpointEvent | undefined
    for (const c of [...checkpoints].reverse()) {
      if (c.kind === 'none' || !c.commit) continue
      if ((await sync.git(['cat-file', '-e', `${c.commit}^{commit}`])).code === 0) {
        ck = c
        break
      }
    }
    const existed = new Set(await fsp.readdir(o.projectsDir).catch(() => [] as string[]))
    const p = await place({ cwd: last.cwd, origin: ck?.repo, branch: ck?.branch }, { home: o.home, projectsDir: o.projectsDir, roots: o.roots, claudeDir: o.claudeDir, codexDir: o.codexDir, git: o.git ?? realGit })
    const fresh = path.dirname(p.to) === path.resolve(o.projectsDir) && !existed.has(path.basename(p.to))
    cwd = p.cwd
    if (ck && (ck.kind === 'git' || ck.kind === 'shadow')) {
      const title = events.findLast((e): e is MetaEvent => e.type === 'meta' && !!e.title)?.title ?? ''
      const slug = `${slugify(title).slice(0, 40) || 'thread'}-${id.slice(-6).toLowerCase()}`
      const busy = (o.busy ?? busyByFiles(o.claudeDir))(p.cwd)
      restored = await restoreCheckpoint({ kind: ck.kind, commit: ck.commit!, base: ck.base, branch: ck.branch, repo: ck.repo, thread: id, slug, dir: p.to, fresh, source: book.gitDir, sourceRef: `refs/hub/checkpoints/${id}`, dataDir: o.dataDir, busy })
      if (restored.mode === 'worktree' || restored.mode === 'beside') cwd = path.join(restored.dir, path.relative(p.to, p.cwd))
    }
  }

  // 5. The journal and the lease, in one push: leg.end (moved), assigned, leg.start, running.
  const leg = `L${legCount(events) + 1}` as LegId
  const epoch = seen.lease && seen.lease.holder !== o.machine ? seen.lease.epoch + 1 : (seen.lease?.epoch ?? 1)
  const dispatching = nx.kind === 'dispatch'
  const pushed = await sync.serial(async () => {
    const wrote = await sync.withBook(async () => {
      const tip = await book.threadRef(id)
      if (tip !== seen.tip) return null
      const t = now()
      const drafts: EventDraft[] = []
      if (open) drafts.push(draft(t, open.leg, { type: 'leg.end', reason: 'moved', by: o.machine })) // i18n-ignore: journal data
      if (dispatching) drafts.push(draft(t, null, { type: 'turn', ...assign(turns, nx.turn, d.engine!, d.rule, d.reason) }))
      drafts.push(draft(t, leg, { type: 'leg.start', engine: d.engine!, session, cwd, rung, epoch }))
      if (dispatching) drafts.push(draft(t, leg, { type: 'turn', turn: nx.turn, state: 'running' }))
      await book.append(id, { events: drafts })
      return book.commitThread(id, `${dispatching ? `turn ${nx.turn} (running) · ` : ''}resume · ${provider} · ${o.machine}`)
    })
    if (!wrote) return { ok: false as const, tip: null }
    const intent: Intent = dispatching ? { engine: d.engine!, leg, state: 'working', turn: nx.turn, tip: wrote } : { engine: d.engine!, leg, state: 'idle', tip: wrote }
    const out = await sync.client.take(id, intent)
    if (!out.ok) {
      // Someone moved first: the hub's version, and these events never happened.
      const f = await sync.client.fetch(id)
      if (f?.seen.tip) await sync.withBook(() => book.adopt(id, f.seen.tip!))
      return { ok: false as const, tip: null }
    }
    await sync.git(['update-ref', `refs/hub/threads/${id}`, wrote])
    sync.status.held[id] = { epoch: out.lease.epoch, state: out.lease.state }
    return { ok: true as const, tip: wrote }
  })
  if (!pushed.ok) return fail('rejected', 'the thread moved on the hub meanwhile: try again')

  // 6. The provider session: recorded first (the writer must never take the file for a new thread), then written.
  const sessions = new Sessions(o.sessions)
  await sessions.load()
  let file = sessionFile ?? ''
  if (rung === 2 || !sessionFile) {
    const text = await sync.withBook(async () => rebuild(book, id, (await book.thread(id))!.journal.events, provider, session, cwd))
    file = await destination(provider, session, cwd, o.claudeDir, o.codexDir, now())
    const key = sessionKey({ file, provider })
    await sessions.record({ key, thread: id, leg, provider, file, lines: countLines(text ?? ''), offset: Buffer.byteLength(text ?? ''), rawBytes: 0, base: countLines(text ?? ''), moved: false })
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await writeAtomic(file, text ?? '')
  } else {
    const text = await fsp.readFile(sessionFile, 'utf8')
    const key = sessionKey({ file: sessionFile, provider })
    await sessions.record({ key, thread: id, leg, provider, file: sessionFile, lines: countLines(text), offset: Buffer.byteLength(text), rawBytes: 0, base: countLines(text), moved: false })
  }

  // 7. The engine: the preface when an earlier attempt had an effect (RESUME-8), the user's message otherwise.
  let launched = false
  if (dispatching) {
    const all = (await sync.withBook(async () => (await book.thread(id))!.journal.events)) ?? events
    const accepted = all.find((e) => e.type === 'turn' && e.turn === nx.turn && e.state === 'accepted')
    const asked = accepted && accepted.type === 'turn' && accepted.message ? all.find((e) => e.id === accepted.message) : undefined
    const text = nx.resume || !asked || asked.type !== 'message' ? preface(id, all, nx.turn) : asked.text
    try {
      await o.launch({ provider, session, cwd, file, text, thread: id, turn: nx.turn })
      launched = true
    } catch (e) {
      // The engine did not start: the attempt failed with no effect, its leg ends, the thread goes idle.
      await sync.serial(async () => {
        const tip = await sync.withBook(async () => {
          const t = now()
          await book.append(id, { events: [draft(t, leg, { type: 'turn', turn: nx.turn, state: 'failed', reason: 'api', effect: 'none' }), draft(t, leg, { type: 'leg.end', reason: 'error', by: o.machine })] }) // i18n-ignore: journal data
          return book.commitThread(id, `turn ${nx.turn} (failed) · ${provider} · ${o.machine}`)
        })
        const out = (await sync.client.renew([{ thread: id, intent: { engine: null, leg: null, state: 'idle', tip: tip ?? null } }])).get(id)
        if (out?.ok) {
          await sync.git(['update-ref', `refs/hub/threads/${id}`, out.lease.tip!])
          sync.status.held[id] = { epoch: out.lease.epoch, state: 'idle' }
        }
      })
      return fail('launch', (e as Error).message)
    }
  }
  return {
    ok: true,
    turn: dispatching ? nx.turn : null,
    ...(dispatching ? { attempt: (turns[nx.turn - 1]?.attempts.length ?? 0) + 1, resume: nx.resume } : {}),
    leg,
    rung,
    engine: d.engine,
    rule: d.rule,
    cwd,
    file,
    session,
    restored,
    stole,
    launched,
    ms: Date.now() - t0,
  }
}
