// A thread resumed on this machine, with the same provider (docs/spec/04-resume.md, step 3): its lease taken (stolen
// first when its holder went silent), the code restored from its last checkpoint on the hub, the provider session
// rebuilt from the raw segments with the folder path rewritten, and the failed turn given again with the signed
// preface, never as a replay of the user's message. dispatch.ts chooses among this machine's engines of the thread's
// own provider; a change of provider is not done here.
//
// `weevils weevbook resume <thread>` calls it. Step 4's dispatcher starts turns with start.ts, which uses the same
// pieces (the session rebuilt from raw, the checkpoint restored) for every rung.
//
// With a vault (docs/spec/07-vault.md, step 3) a thread this machine never ran resumes too: its slim raw lines and
// its checkpoint are fetched from the vault, for that thread alone, when the hub does not have them; and on a machine
// with no hub at all, the thread's journal comes from the vault and the leg is written here (resumeLocal).

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { claudeSlug, findClone, place, realGit, rewritePaths, type PlaceDeps } from '../bring.ts'
import { restoreCheckpoint, type Restored } from './checkpoint.ts'
import { bringCode, uncheckedCode, type CodeReport, type CodeState } from './code-state.ts'
import { decide, threadFacts, type MachineFacts, type Quota, type ThreadFacts } from './dispatch.ts'
import { HubSync, REMOTE, draft, legCount, openLeg, safeTurns } from './hub.ts'
import { parseEngine, slugify, type CheckpointEvent, type EventDraft, type JournalEvent, type LegId, type MetaEvent, type Provider } from './journal.ts'
import { OBSERVE_EVERY, STEAL_BOUND, stealable, type GitRunner, type Intent } from './lease.ts'
import { Weevbook, writeAtomic } from './store.ts'
import { Sessions, accountOf as accountHash, machinePart, sessionKey } from './sync.ts'
import { assign, next, preface, stolen } from './turn.ts'
import { REDACTED } from './redact.ts'
import { hubRunner } from './gitrun.ts'
import type { VaultSource } from './vault-raw.ts'

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

/** The machine a thread leaves, asked directly (weevilsd: through the tunnel it has to it). */
export interface SourceMachine {
  /** The repository the thread's session works in over there, as it is now (null: the session is not in one). */
  code: CodeState | null
  /** Files of that repository, base64, by path (some may be missing: too large, or gone). */
  files: (paths: string[]) => Promise<Record<string, string>>
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
  /** The hub (absent: this machine has none, and the thread comes from the vault alone). */
  hub?: { url: string; here: boolean }
  /** The vault, when this machine has one: what the hub does not hold of the thread is fetched from it. */
  vault?: VaultSource
  /** Without a hub, for a thread that has no lease on the vault yet (pushed before step 4): a turn at work elsewhere
   *  is taken for stopped once its thread was silent this long (SILENT_FOR). */
  silentMs?: number
  /** The person said to take it even from a machine that still renews its lease (07-vault.md, step 4, without a hub),
   *  or whose code could not be checked: a thread whose code does not travel, its machine not answering, continues
   *  here as the synced copy has it, and the answer says that machine's changes stayed there unchecked. */
  force?: boolean
  /** The person named the engine ("send this to Claude on …"): refused when it is not the thread's own provider. */
  provider?: Provider
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
  /** The machine the thread leaves, asked now: null when it does not answer (it is then taken for silent). */
  source?: (machine: string, thread: string) => Promise<SourceMachine | null>
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
      /** A thread whose code does not travel (`kind: none`), continued on this machine's clone of its repository:
       *  what was pulled, carried and left of the other machine's code. */
      code?: CodeReport
      /** The lease was stolen first (its holder had gone silent). */
      stole: boolean
      launched: boolean
      ms: number
    }
  | {
      ok: false
      /** `other-provider`: the engine asked for is not the thread's (`detail`: the thread's provider). */
      why: 'unreachable' | 'unknown' | 'held' | 'here' | 'own-leg' | 'attempts' | 'busy' | 'hold' | 'no-session' | 'rejected' | 'launch' | 'other-provider'
      detail: string
      /** held: how long until a steal is allowed, by this clock. */
      wait?: number
      holder?: string
    }

const fail = (why: Extract<ResumeResult, { ok: false }>['why'], detail: string, more: { wait?: number; holder?: string } = {}): ResumeResult => ({ ok: false, why, detail, ...more })
const zero = (now: number): Quota => ({ readAt: now, fiveHour: { used: 0, resetsAt: null }, week: { used: 0, resetsAt: null } })

/**
 * The table a resume decides on (dispatch.ts): this machine, signed in, and the machine the thread leaves, never a
 * candidate (`away`), with the truth about it: asked now, it answered or not. A thread whose code does not travel can
 * continue on a clone of its repository here: its origin is the one the other machine says, else its checkpoints'.
 */
async function resumeTable(o: ResumeOptions, x: { me: string; at: number; mine: string; last: { engine: string }; project: string | null; events: readonly JournalEvent[] }) {
  const old = parseEngine(x.last.engine)!
  const src = old.machine !== x.me && o.source ? await o.source(old.machine, o.thread).catch(() => null) : null
  const repo = src?.code?.origin ?? x.events.filter((e): e is CheckpointEvent => e.type === 'checkpoint' && !!e.repo).at(-1)?.repo ?? null
  const clone = repo ? await findClone(repo, { home: o.home, projectsDir: o.projectsDir, roots: o.roots, claudeDir: o.claudeDir, codexDir: o.codexDir, git: o.git ?? realGit }).catch(() => null) : null
  const machines: MachineFacts[] = [{ machine: x.me, seen: x.at, answers: true, projects: x.project ? [x.project] : [], ...(clone && repo ? { repos: [repo] } : {}), engines: [{ engine: x.mine, signedIn: true }] }]
  if (old.machine !== x.me) machines.push({ machine: old.machine, seen: src ? x.at : 0, answers: !!src, projects: [], engines: [{ engine: x.last.engine, signedIn: true }] })
  return { machines, away: old.machine !== x.me ? old.machine : undefined, repo, clone, src, from: old.machine }
}

/** The facts the table reads: a forced move of a thread whose code does not travel, its machine silent, is placed as
 *  if its code had no checkpoint (the synced copy as it is); codeHere then says what could not be checked. */
function unchecked(o: ResumeOptions, t: Awaited<ReturnType<typeof resumeTable>>, facts: ThreadFacts): ThreadFacts {
  return o.force && facts.checkpoint === 'none' && !t.src && !t.clone && t.away ? { ...facts, checkpoint: null } : facts
}

/** The other machine's code brought into this clone, for a thread whose checkpoint does not travel. */
async function codeHere(t: Awaited<ReturnType<typeof resumeTable>>, facts: ThreadFacts, log?: (line: string) => void, cwd?: string): Promise<CodeReport | undefined> {
  if (facts.checkpoint !== 'none') return undefined
  if (!t.clone) return !t.src && t.away && cwd ? uncheckedCode(cwd, t.from) : undefined
  if (!t.src) return uncheckedCode(t.clone, t.from)
  if (!t.src.code) return { ...uncheckedCode(t.clone, t.from), checked: true, line: `${t.from}'s session is not in a repository: nothing to compare with ${t.clone}` }
  try {
    return await bringCode({ state: t.src.code, clone: t.clone, machine: t.from, files: t.src.files })
  } catch (e) {
    log?.(`[resume] code from ${t.from}: ${(e as Error).message}`)
    return { ...uncheckedCode(t.clone, t.from), line: `${t.clone}: the code of ${t.from} could not be compared (${(e as Error).message})` }
  }
}

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

/**
 * The raw lines of every leg of `session`, in order, each leg's folder rewritten to `cwd` (04-resume.md, rung 2).
 * `vault`: the thread's slim raw from the vault (07-vault.md), used for the legs this machine holds no line of.
 */
export async function rebuild(book: HubSync['book'], thread: string, events: readonly JournalEvent[], provider: Provider, session: string, cwd: string, vault?: Map<string, Buffer>): Promise<string> {
  const dir = book.abs(book.pathOf(thread)!)
  const names = await fsp.readdir(path.join(dir, 'raw')).catch(() => [] as string[])
  let text = ''
  for (const e of events) {
    if (e.type !== 'leg.start' || e.session !== session || parseEngine(e.engine)?.provider !== provider || !e.leg) continue
    const mine = (n: string) => n.startsWith(`${e.leg}.${provider}.`) && n.endsWith('.jsonl')
    const segs = names.filter(mine).sort()
    let leg = ''
    for (const n of segs) leg += await fsp.readFile(path.join(dir, 'raw', n), 'utf8')
    if (!segs.length && vault) for (const n of [...vault.keys()].filter(mine).sort()) leg += vault.get(n)!.toString()
    const moved = rewritePaths(leg, e.cwd, cwd)
    text += provider === 'claude' ? mendThinking(moved) : moved
  }
  return text
}

/**
 * The thread's slim raw from the vault, when a leg of `session` has no raw line on this machine (a thread restored
 * from the vault, or one whose machine never reached the hub). Undefined: nothing is missing, or there is no vault.
 */
export async function vaultRaw(book: HubSync['book'], vault: VaultSource | undefined, thread: string, events: readonly JournalEvent[], provider: Provider, session: string): Promise<Map<string, Buffer> | undefined> {
  if (!vault) return undefined
  const rel = book.pathOf(thread)
  const names = rel ? await fsp.readdir(path.join(book.abs(rel), 'raw')).catch(() => [] as string[]) : []
  const missing = events.some((e) => e.type === 'leg.start' && e.session === session && parseEngine(e.engine)?.provider === provider && !!e.leg && !names.some((n) => n.startsWith(`${e.leg}.${provider}.`)))
  return missing ? vault.raw(thread) : undefined
}

export interface Placed {
  /** The folder the engine works in. */
  cwd: string
  restored: Restored | null
  /** The thread's newest checkpoint stayed on its machine (too large for the vault): it can only continue there. */
  onlyThere?: string
}

/**
 * Steps 2 and 3 of rung 2: where the project lives here (found or cloned), and the thread's last checkpoint restored
 * there. The checkpoint is the newest one the journal names that the weevbook's repository holds (its own, or the
 * hub's, fetched by `git`); with none there, the newest one the vault's bundles bring. With none at all the folder is
 * used as found.
 */
export async function placeAndRestore(o: {
  thread: string
  events: readonly JournalEvent[]
  /** The last leg's folder, on the machine it ran on. */
  cwd: string
  /** The repository's origin when no checkpoint names one (a thread of `kind: none` going to a clone of it). */
  origin?: string
  /** The weevbook's repository, and its runner with the hub as remote (null: no hub). */
  gitDir: string
  git: GitRunner
  hub: boolean
  vault?: VaultSource
  dataDir: string
  home: string
  projectsDir: string
  roots: string[]
  claudeDir: string
  codexDir: string
  placeGit?: PlaceDeps['git']
  busy?: (cwd: string) => boolean
  log?: (line: string) => void
}): Promise<Placed> {
  const id = o.thread
  const checkpoints = o.events.filter((e): e is CheckpointEvent => e.type === 'checkpoint')
  const kept = checkpoints.filter((c) => c.kind !== 'none' && !!c.commit)
  if (o.hub) await o.git(['fetch', '--quiet', '--no-tags', REMOTE, `+refs/checkpoints/${id}:refs/hub/checkpoints/${id}`])
  let ck: CheckpointEvent | undefined
  for (const c of [...kept].reverse()) {
    if ((await o.git(['cat-file', '-e', `${c.commit}^{commit}`])).code === 0) {
      ck = c
      break
    }
  }
  // The hub's copy, or this machine's own ref (a thread whose checkpoints were taken here, with no hub).
  let sourceRef = `refs/hub/checkpoints/${id}`
  if (ck && (await o.git(['rev-parse', '-q', '--verify', `${sourceRef}^{commit}`])).code !== 0) sourceRef = `refs/checkpoints/${id}`
  let bundles: string[] | undefined
  let tmp: string | null = null
  try {
    if (!ck && o.vault && kept.length) {
      tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'weevils-checkpoint-'))
      const got = await o.vault.checkpoint(id, tmp).catch((e: Error) => {
        // With a hub the vault is the second source: the folder is then used as found, as when no checkpoint was pushed.
        if (!o.hub) throw e
        o.log?.(`[vault] checkpoint of ${id}: ${e.message}`)
        return null
      })
      if (got) {
        const tips = new Set(got.tips)
        ck = kept.findLast((c) => tips.has(c.commit!))
        if (got.skipped && ck !== kept.at(-1)) return { cwd: o.cwd, restored: null, onlyThere: `the code of this thread can only continue on ${got.skipped.machine}: its last checkpoint is ${Math.round(got.skipped.bytes / 1e6)} MB, more than the vault takes` } // i18n-ignore: the reason of a hold, as dispatch.ts writes it
        if (ck) bundles = got.bundles
      }
    }
    const existed = new Set(await fsp.readdir(o.projectsDir).catch(() => [] as string[]))
    const p = await place({ cwd: o.cwd, origin: ck?.repo ?? o.origin, branch: ck?.branch }, { home: o.home, projectsDir: o.projectsDir, roots: o.roots, claudeDir: o.claudeDir, codexDir: o.codexDir, git: o.placeGit ?? realGit })
    const fresh = path.dirname(p.to) === path.resolve(o.projectsDir) && !existed.has(path.basename(p.to))
    let cwd = p.cwd
    let restored: Restored | null = null
    if (ck && (ck.kind === 'git' || ck.kind === 'shadow')) {
      const title = o.events.findLast((e): e is MetaEvent => e.type === 'meta' && !!e.title)?.title ?? ''
      const slug = `${slugify(title).slice(0, 40) || 'thread'}-${id.slice(-6).toLowerCase()}`
      const busy = (o.busy ?? busyByFiles(o.claudeDir))(p.cwd)
      restored = await restoreCheckpoint({ kind: ck.kind, commit: ck.commit!, base: ck.base, branch: ck.branch, repo: ck.repo, thread: id, slug, dir: p.to, fresh, source: o.gitDir, sourceRef, ...(bundles ? { bundles } : {}), dataDir: o.dataDir, busy })
      if (restored.mode === 'worktree' || restored.mode === 'beside') cwd = path.join(restored.dir, path.relative(p.to, p.cwd))
    }
    return { cwd, restored }
  } finally {
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true })
  }
}

/**
 * A Claude session whose thinking redaction once changed (raw written before signed blocks were kept as they are):
 * the API refuses the whole conversation for one such block. The block goes, and a line left with nothing in it goes
 * too, its children taking its parent, so the conversation stays one chain. Only that reasoning is lost.
 */
export function mendThinking(text: string): string {
  if (!text.includes(REDACTED)) return text
  const parentOf = new Map<string, string | null>()
  const out: string[] = []
  for (const line of text.split('\n')) {
    let o: { uuid?: string; parentUuid?: string | null; message?: { content?: unknown } } | undefined
    try {
      o = line.trim() ? JSON.parse(line) : undefined
    } catch {
      o = undefined
    }
    if (!o || typeof o !== 'object') {
      out.push(line)
      continue
    }
    let changed = false
    const content = o.message?.content
    if (Array.isArray(content) && content.some(damaged)) {
      const kept = content.filter((b) => !damaged(b))
      if (!kept.length && o.uuid) {
        parentOf.set(o.uuid, o.parentUuid ?? null)
        continue
      }
      o = { ...o, message: { ...o.message, content: kept } }
      changed = true
    }
    let p = o.parentUuid
    while (p && parentOf.has(p)) p = parentOf.get(p)!
    if (p !== o.parentUuid) {
      o = { ...o, parentUuid: p ?? null }
      changed = true
    }
    out.push(changed ? JSON.stringify(o) : line)
  }
  return out.join('\n')
}

const damaged = (b: unknown) => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'thinking' && String((b as { thinking?: unknown }).thinking ?? '').includes(REDACTED)

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
  if (!o.sync && !o.hub) return o.vault ? resumeLocal(o, t0) : fail('unreachable', 'no hub and no vault on this machine')
  const sync = o.sync ?? new HubSync({ dir: o.dir, dataDir: o.dataDir, sessions: o.sessions, machine: o.machine, hub: o.hub!, steals: false, now, log: o.log, ssh: o.ssh })
  if (!(await sync.ensure())) return fail('unreachable', sync.status.error ?? 'the hub did not answer')
  const id = o.thread

  // 1. The lease: idle (whoever holds it) or stolen from a holder that went silent.
  let stole = false
  const until = now() + STEAL_BOUND + 30_000
  for (;;) {
    const f = await sync.serial(() => sync.client.fetch(id))
    if (!f) return fail('unreachable', 'fetch')
    const l = f.seen.lease
    // The hub never saw it: with a vault, the thread comes from there (the hub sync takes it up afterwards).
    if (!l || !f.seen.tip) return o.vault ? resumeLocal(o, t0) : fail('unknown', 'the hub has no such thread')
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
  // The thread's machine never held its lease on this hub (it joined with a vault, and this hub only has the thread
  // from the vault): the lease that machine respects is the vault's, so the resume takes that one.
  const lastLeg = events.filter((e) => e.type === 'leg.start').at(-1)
  const legMachine = lastLeg?.type === 'leg.start' ? parseEngine(lastLeg.engine)?.machine : undefined
  if (o.vault && !stole && legMachine && legMachine !== me && seen.lease && machinePart(seen.lease.holder) !== legMachine) return resumeLocal(o, t0)
  const open = openLeg(events)
  if (open && parseEngine(open.engine)?.machine === me) return fail('own-leg', `its leg ${open.leg} is this machine's own session ${open.session}: continue it in the app`)
  const legs = events.filter((e) => e.type === 'leg.start')
  const last = legs.at(-1)
  if (!last || last.type !== 'leg.start') return fail('no-session', 'the thread has no provider session yet')
  const provider = parseEngine(last.engine)!.provider
  if (o.provider && o.provider !== provider) return fail('other-provider', provider)
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
  const tb = await resumeTable(o, { me, at, mine, last, project, events })
  const retry = nx.kind === 'dispatch' && nx.retry
  const facts = { ...threadFacts(events, { project, cloneable: !!ckEvent?.repo, retry, turn: nx.kind === 'dispatch' ? nx.turn : turns.length }), repo: tb.repo }
  const d = decide({ now: at, thread: unchecked(o, tb, facts), table: { machines: tb.machines, quotas: { [`${provider}:${account(provider)}`]: zero(at) } }, ledger: [], preferred: provider, away: tb.away })
  if (d.rule === 'hold' || !d.engine) return fail('hold', `${d.hold ?? 'hold'}: ${d.reason}`)
  if (parseEngine(d.engine)?.provider !== provider) return fail('hold', `only ${provider} resumes in step 3`)
  const rung: 1 | 2 = d.rung === 1 ? 1 : 2

  // 4. The code: the last checkpoint the hub has, restored without overwriting anyone's work.
  const book = sync.book
  let restored: Restored | null = null
  let cwd = last.cwd
  const session = last.session
  const sessionFile = findSession(provider, session, o.claudeDir, o.codexDir)
  let code: CodeReport | undefined
  if (rung === 2 || !sessionFile) {
    const p = await placeAndRestore({ thread: id, events, cwd: last.cwd, origin: tb.clone ? (tb.repo ?? undefined) : undefined, gitDir: book.gitDir, git: sync.git, hub: true, vault: o.vault, dataDir: o.dataDir, home: o.home, projectsDir: o.projectsDir, roots: o.roots, claudeDir: o.claudeDir, codexDir: o.codexDir, placeGit: o.git, busy: o.busy, log: o.log })
    if (p.onlyThere) return fail('hold', `only-there: ${p.onlyThere}`)
    cwd = p.cwd
    restored = p.restored
    code = await codeHere(tb, facts, o.log, p.cwd)
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
    const slim = await vaultRaw(book, o.vault, id, events, provider, session).catch((e: Error) => {
      o.log?.(`[vault] raw lines of ${id}: ${e.message}`)
      return undefined
    })
    const text = await sync.withBook(async () => rebuild(book, id, (await book.thread(id))!.journal.events, provider, session, cwd, slim))
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
    ...(code ? { code } : {}),
    stole,
    launched,
    ms: Date.now() - t0,
  }
}

/** A thread with no lease on the vault (pushed before step 4): a turn at work on another machine is taken for stopped
 *  once the thread has been silent this long. */
export const SILENT_FOR = 10 * 60_000

/**
 * The same resume on a machine whose only source for the thread is the vault (no hub, or a hub that never saw it):
 * the journal is brought up to date from the vault, the thread's lease on the vault is taken (07-vault.md, step 4),
 * the slim raw lines and the checkpoint bundles are fetched for this thread alone, and the new leg is written in this
 * machine's weevbook, which its vault pusher sends with the lease. Every caller is the person's order or agreement
 * (VAULT-6): an idle lease is taken over, a working one whose machine went silent is stolen, and one still renewed is
 * refused unless `force`.
 */
async function resumeLocal(o: ResumeOptions, t0: number): Promise<ResumeResult> {
  const claimed = { yes: false }
  const out = await resumeFromVault(o, t0, claimed)
  // Refused after the lease was taken: it is given back, idle (a launch that failed wrote its own end, pushed idle).
  if (!out.ok && claimed.yes) await o.vault!.release(o.thread).catch((e: Error) => o.log?.(`[vault] ${o.thread}: lease not released (${e.message})`))
  return out
}

async function resumeFromVault(o: ResumeOptions, t0: number, claimed: { yes: boolean }): Promise<ResumeResult> {
  const vault = o.vault!
  const now = o.now ?? Date.now
  const me = machinePart(o.machine)
  const id = o.thread
  try {
    if ((await vault.refresh(id)).differ) return fail('rejected', 'this machine wrote the thread another way than the vault holds it: it continues on the machine that took it')
  } catch (e) {
    return fail('unreachable', `the vault did not answer: ${(e as Error).message}`)
  }
  const book = await Weevbook.open(o.dir, o.machine)
  /** Under the weevbook's lock, as the writer of this machine takes it. */
  const withBook = async <T>(fn: () => Promise<T>, writes = false): Promise<T> => {
    if (!(await book.lockWait(30_000))) throw new Error('the weevbook stayed locked') // i18n-ignore: for the log
    try {
      return await fn()
    } finally {
      await book.unlock(writes)
    }
  }
  const read = () => withBook(async () => (await book.thread(id))?.journal.events ?? null)
  let events = await read()
  if (!events) return fail('unknown', 'neither this machine nor the vault has such a thread')
  const open = openLeg(events)
  if (open && parseEngine(open.engine)?.machine === me) return fail('own-leg', `its leg ${open.leg} is this machine's own session ${open.session}: continue it in the app`)
  const last = events.filter((e) => e.type === 'leg.start').at(-1)
  if (!last || last.type !== 'leg.start') return fail('no-session', 'the thread has no provider session yet')
  const provider = parseEngine(last.engine)!.provider
  if (o.provider && o.provider !== provider) return fail('other-provider', provider)
  let turns = safeTurns(events)
  const live = next(turns)
  // The lease on the vault: taken over idle, stolen from a silent machine, or (`force`) from one that still renews it.
  let claim: Awaited<ReturnType<VaultSource['claim']>>
  try {
    claim = await vault.claim(id, o.force)
  } catch (e) {
    return fail('unreachable', `the vault did not answer: ${(e as Error).message}`)
  }
  if (!claim.ok) {
    if (claim.why === 'held') return fail('held', `${claim.holder} is at work on ${claim.turn !== undefined ? `turn ${claim.turn}` : 'it'} (its lease was renewed ${Math.round(claim.agoMs / 1000)} s ago)`, { wait: claim.wait, holder: claim.holder })
    return fail(claim.why, claim.why === 'unreachable' ? 'the vault did not answer' : 'the thread moved on the vault meanwhile: try again')
  }
  claimed.yes = true
  if (live.kind === 'busy' && !claim.stole && !o.force) {
    // No working lease said who holds it (a thread pushed before step 4): the journal's own silence decides.
    const quiet = now() - Date.parse(events.at(-1)!.at)
    const silent = o.silentMs ?? SILENT_FOR
    if (quiet < silent) return fail('held', `turn ${live.turn} was at work on ${parseEngine(last.engine)!.machine} ${Math.round(quiet / 1000)} s ago`, { wait: silent - quiet, holder: parseEngine(last.engine)!.machine })
  }
  // What the journal will say once the other machine's turn and leg are closed: decided on before anything is written.
  const closing: EventDraft[] = []
  const lost = live.kind === 'busy' ? stolen(turns) : null
  const t = now()
  if (lost) closing.push(draft(t, open?.leg ?? null, { type: 'turn', ...lost }))
  if (open) closing.push(draft(t, open.leg, { type: 'leg.end', reason: lost ? 'machine-lost' : 'moved', by: o.machine })) // i18n-ignore: journal data
  if (lost) turns = safeTurns([...events, { ...closing[0], v: 1, seq: events.length + 1 } as JournalEvent])
  const nx = next(turns)
  if (nx.kind === 'busy') return fail('busy', `turn ${nx.turn} is ${nx.state} in the journal`)
  if (nx.kind === 'hold') return fail('attempts', `turn ${nx.turn} failed ${3} times on api or auth: it waits for "try again"`)

  // The engine, as with a hub: this machine's, of the thread's own provider.
  const account = o.account ?? ((p: Provider) => accountHash(p, o.home, path.dirname(o.codexDir)))
  const mine = `${provider}:${account(provider)}@${me}`
  const project = events.find((e): e is MetaEvent => e.type === 'meta' && e.project !== undefined)?.project ?? null
  const ckEvent = events.filter((e): e is CheckpointEvent => e.type === 'checkpoint').at(-1)
  const tb = await resumeTable(o, { me, at: t, mine, last, project, events })
  const dispatching = nx.kind === 'dispatch'
  const facts = { ...threadFacts(events, { project, cloneable: !!ckEvent?.repo, retry: dispatching && nx.retry, turn: dispatching ? nx.turn : turns.length }), repo: tb.repo }
  const d = decide({ now: t, thread: unchecked(o, tb, facts), table: { machines: tb.machines, quotas: { [`${provider}:${account(provider)}`]: zero(t) } }, ledger: [], preferred: provider, away: tb.away })
  if (d.rule === 'hold' || !d.engine) return fail('hold', `${d.hold ?? 'hold'}: ${d.reason}`)
  if (parseEngine(d.engine)?.provider !== provider) return fail('hold', `only ${provider} resumes in step 3`)
  const rung: 1 | 2 = d.rung === 1 ? 1 : 2

  // The lines and the code, from the vault, for this thread alone.
  const session = last.session
  const sessionFile = findSession(provider, session, o.claudeDir, o.codexDir)
  let cwd = last.cwd
  let restored: Restored | null = null
  let slim: Map<string, Buffer> | undefined
  let code: CodeReport | undefined
  if (rung === 2 || !sessionFile) {
    try {
      slim = await vaultRaw(book, vault, id, events, provider, session)
    } catch (e) {
      return fail('unreachable', `the vault did not give the thread's lines: ${(e as Error).message}`)
    }
    const probe = await withBook(() => rebuild(book, id, events!, provider, session, last.cwd, slim))
    if (!probe) return fail('no-session', 'the vault does not hold the lines of this conversation yet: its machine has not pushed them')
    const p = await placeAndRestore({ thread: id, events, cwd: last.cwd, origin: tb.clone ? (tb.repo ?? undefined) : undefined, gitDir: book.gitDir, git: hubRunner(book.gitDir), hub: false, vault, dataDir: o.dataDir, home: o.home, projectsDir: o.projectsDir, roots: o.roots, claudeDir: o.claudeDir, codexDir: o.codexDir, placeGit: o.git, busy: o.busy, log: o.log })
    if (p.onlyThere) return fail('hold', `only-there: ${p.onlyThere}`)
    cwd = p.cwd
    restored = p.restored
    code = await codeHere(tb, facts, o.log, p.cwd)
  }

  // The journal, here: the other machine's leg closed, this one opened, the turn running.
  const leg = `L${legCount(events) + 1}` as LegId
  const epoch = Math.max(0, ...events.map((e) => (e.type === 'leg.start' ? e.epoch : 0))) + 1
  const seen = events.length
  const wrote = await withBook(async () => {
    const cur = (await book.thread(id))?.journal.events ?? []
    if (cur.length !== seen) return false // the writer of this machine, or a restore, wrote meanwhile
    const at = now()
    const drafts: EventDraft[] = [...closing]
    if (dispatching) drafts.push(draft(at, null, { type: 'turn', ...assign(turns, nx.turn, d.engine!, d.rule, d.reason) }))
    drafts.push(draft(at, leg, { type: 'leg.start', engine: d.engine!, session, cwd, rung, epoch }))
    if (dispatching) drafts.push(draft(at, leg, { type: 'turn', turn: nx.turn, state: 'running' }))
    const r = await book.append(id, { events: drafts })
    if (r.refused) throw new Error('the journal refused the resume') // i18n-ignore: for the log
    await book.commitThread(id, `${dispatching ? `turn ${nx.turn} (running) · ` : ''}resume · ${provider} · ${o.machine}`)
    return true
  }, true)
  if (!wrote) return fail('rejected', 'the thread moved meanwhile: try again')
  events = (await read()) ?? events
  // The new leg reaches the vault now, with its lease (weevilsd's pusher sends it within the minute otherwise).
  await vault.push().catch((e: Error) => o.log?.(`[vault] ${id}: not pushed yet (${e.message})`))

  // The provider session: recorded first (the writer must never take the file for a new thread), then written.
  const sessions = new Sessions(o.sessions)
  await sessions.load()
  let file = sessionFile ?? ''
  if (rung === 2 || !sessionFile) {
    const text = await withBook(() => rebuild(book, id, events!, provider, session, cwd, slim))
    file = await destination(provider, session, cwd, o.claudeDir, o.codexDir, now())
    await sessions.record({ key: sessionKey({ file, provider }), thread: id, leg, provider, file, lines: countLines(text), offset: Buffer.byteLength(text), rawBytes: 0, base: countLines(text), moved: false })
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await writeAtomic(file, text)
  } else {
    const text = await fsp.readFile(sessionFile, 'utf8')
    await sessions.record({ key: sessionKey({ file: sessionFile, provider }), thread: id, leg, provider, file: sessionFile, lines: countLines(text), offset: Buffer.byteLength(text), rawBytes: 0, base: countLines(text), moved: false })
  }

  let launched = false
  if (dispatching) {
    const accepted = events.find((e) => e.type === 'turn' && e.turn === nx.turn && e.state === 'accepted')
    const asked = accepted && accepted.type === 'turn' && accepted.message ? events.find((e) => e.id === accepted.message) : undefined
    const text = nx.resume || !asked || asked.type !== 'message' ? preface(id, events, nx.turn) : asked.text
    try {
      await o.launch({ provider, session, cwd, file, text, thread: id, turn: nx.turn })
      launched = true
    } catch (e) {
      // The engine did not start: the attempt failed with no effect, its leg ends.
      await withBook(async () => {
        const at = now()
        await book.append(id, { events: [draft(at, leg, { type: 'turn', turn: nx.turn, state: 'failed', reason: 'api', effect: 'none' }), draft(at, leg, { type: 'leg.end', reason: 'error', by: o.machine })] }) // i18n-ignore: journal data
        await book.commitThread(id, `turn ${nx.turn} (failed) · ${provider} · ${o.machine}`)
      }, true).catch(() => undefined)
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
    ...(code ? { code } : {}),
    stole: claim.stole || !!lost,
    launched,
    ms: Date.now() - t0,
  }
}
