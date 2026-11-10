// The « auto » band that never sleeps: from the memory and the real projects, weevils proposes background tasks
// (« optimizers »: harden a repo's tests, watch a topic the user cares about, prepare content, explore an idea they
// mentioned). Each one is accepted or refused with one tap. Accepted ones run in a normal Claude session (visible in
// its project) when the machine is free — no agent working for 5 min, load and memory under the `heavy` thresholds —
// one at a time, on a local branch in its own git worktree, never destructive, paid or published without the user's go.
//
// Stored in DATA_DIR/optimizers.json (outside every repo). Proposal rounds only on the main machine with Claude
// logged in: a few minutes after start, then every 6 h at most, sooner when the memory changed (30 min apart at
// least), only while fewer than 3 proposals wait for an answer; a failed round backs off 1 h (doubling), never a loop.

import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AutoMachine, Optimizer } from '../shared/api.ts'
import { DATA_DIR, MACHINE } from './config.ts'
import type { Weevils } from './core.ts'
import { parseJson, smart } from './fast.ts'
import { lang, tr, user } from './i18n.ts'
import O from './i18n/optimizers.ts'
import type { Memory } from './memory.ts'
import { claudeLogged } from './setup.ts'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

/** Proposals waiting for an answer: no new round past this. */
export const MAX_WAITING = 3
export const FIRST_ROUND_MS = 4 * 60_000
export const ROUND_EVERY_MS = 6 * 3600_000
/** A memory change brings the next round forward, but never closer than this to the previous one. */
export const ROUND_MEMORY_MS = 30 * 60_000
/** …and once the memory has been still for this long (an exchange with a weevil writes several memories). */
const MEMORY_SETTLE_MS = 2 * 60_000
export const BACKOFF_MS = 3600_000
export const BACKOFF_MAX_MS = 12 * 3600_000
/** The machine is free when no local agent has been working for this long… */
export const IDLE_MS = 5 * 60_000
/** …the 1-minute load is under this × cores and this much memory is available (the thresholds of `heavy`). */
export const LOAD_FACTOR = 1.5
export const MIN_FREE_BYTES = 2 * 1024 ** 3
/** A running task whose session is gone this long, or that runs longer than MAX_RUN_MS, has failed. */
export const VANISH_MS = 3 * 60_000
export const MAX_RUN_MS = 2 * 3600_000
/** Finished tasks stay in the band this long. */
export const KEEP_MS = 3 * 24 * 3600_000
const TICK_MS = 60_000
const MAX_STORED = 200
const KINDS = ['tests', 'watch', 'content', 'explore', 'other'] as const

type Stored = Optimizer & {
  /** The agent's brief, as the model wrote it (the safety rules are added at launch). */
  prompt: string
  acceptedAt?: number
  /** The session was seen working (its return to idle then means done). */
  seenWorking?: boolean
  /** Last time the session was seen in the snapshot. */
  seenAt?: number
}
interface State {
  items: Stored[]
  lastRoundAt: number
  fails: number
  failUntil: number
}

export interface Proposal {
  title: string
  why: string
  repo: string | null
  kind: Optimizer['kind']
  heavy: boolean
  priority: 1 | 2 | 3
  est: number
  prompt: string
}

/** What the runner reads about the machine (injected in tests). */
export interface Sys {
  load: () => number
  cpus: () => number
  free: () => number
  logged: () => boolean
}
const realSys: Sys = { load: () => os.loadavg()[0], cpus: () => os.cpus().length || 1, free: () => os.freemem(), logged: claudeLogged }

// ---------------------------------------------------------------- pure helpers (tested)

const oneLine = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["«“'\s]+|["»”'\s]+$/g, '')
    .slice(0, max)
    .trim()

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2))

/** Same task title, or nearly (most of its words shared with one already proposed). */
export function isRepeat(title: string, known: { title: string }[]): boolean {
  const n = norm(title)
  const a = words(title)
  return known.some((k) => {
    if (norm(k.title) === n) return true
    const b = words(k.title)
    if (!a.size || !b.size) return false
    let both = 0
    for (const w of a) if (b.has(w)) both++
    return both / (a.size + b.size - both) >= 0.6
  })
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The model's proposals, checked: a title and a brief, a repo that really is on the machine (else null), a known kind,
 * priority 1–3, a rough estimate, nothing already proposed (in any state: refused and done are never proposed again),
 * at most `max`.
 */
export function parseProposals(raw: unknown, repos: string[], known: { title: string }[], max = MAX_WAITING): Proposal[] {
  const r = raw as { tasks?: unknown; proposals?: unknown } | null
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(r?.tasks) ? r.tasks : Array.isArray(r?.proposals) ? r.proposals : []
  const out: Proposal[] = []
  for (const x of list as Record<string, unknown>[]) {
    if (out.length >= max) break
    if (!x || typeof x !== 'object') continue
    const title = oneLine(x.title, 80)
    const prompt = String(x.prompt ?? '').trim().slice(0, 6000)
    if (title.length < 3 || prompt.length < 20) continue
    if (isRepeat(title, [...known, ...out])) continue
    const want = typeof x.repo === 'string' ? x.repo.trim() : ''
    const repo = want ? (repos.find((n) => n === want) ?? repos.find((n) => n.toLowerCase() === want.toLowerCase()) ?? null) : null
    out.push({
      title,
      why: oneLine(x.why, 220),
      repo,
      kind: (KINDS as readonly string[]).includes(String(x.kind)) ? (x.kind as Optimizer['kind']) : 'other',
      heavy: x.heavy === true,
      priority: clamp(Math.round(Number(x.priority)) || 2, 1, 3) as 1 | 2 | 3,
      est: clamp(Math.round(Number(x.est)) || 30, 5, 120),
      prompt,
    })
  }
  return out
}

/** Branch-safe short name: « Harden the tests of mygame » → « harden-the-tests-of-mygame ». */
export function slug(title: string): string {
  return norm(title).replace(/ /g, '-').slice(0, 32).replace(/-+$/, '') || 'task'
}

/** What keeps the oldest accepted task from starting, or null when the machine is free. */
export function freeReason(m: { idleFor: number; load: number; cpus: number; free: number }): AutoMachine['wait'] {
  if (m.idleFor < IDLE_MS) return 'busy'
  if (m.load >= LOAD_FACTOR * m.cpus) return 'load'
  if (m.free < MIN_FREE_BYTES) return 'ram'
  return null
}

// ---------------------------------------------------------------- the optimizers

export class Optimizers {
  readonly w: Weevils
  readonly memory: Memory
  readonly file: string
  /** DATA_DIR/optimizers/<id>/: each task's workspace (its report, its git worktree). */
  readonly dir: string
  private s: State
  private sys: Sys
  private bootAt = Date.now()
  /** Last time a local agent (or weevboss) was seen working. */
  private lastBusyAt = Date.now()
  private memChangedAt = 0
  private rounding: Promise<void> | null = null
  private launching = false
  private auto = false

  constructor(w: Weevils, memory: Memory, opts: { file?: string; dir?: string; sys?: Partial<Sys> } = {}) {
    this.w = w
    this.memory = memory
    this.file = opts.file ?? path.join(DATA_DIR, 'optimizers.json')
    this.dir = opts.dir ?? path.join(DATA_DIR, 'optimizers')
    const sys = opts.sys ?? {}
    this.sys = { load: () => (sys.load ?? realSys.load)(), cpus: () => (sys.cpus ?? realSys.cpus)(), free: () => (sys.free ?? realSys.free)(), logged: () => (sys.logged ?? realSys.logged)() }
    this.s = (() => {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<State>
        const items = (Array.isArray(raw.items) ? raw.items : []).filter((o) => o && typeof o.id === 'string' && typeof o.title === 'string' && typeof o.state === 'string')
        return { items, lastRoundAt: Number(raw.lastRoundAt) || 0, fails: Number(raw.fails) || 0, failUntil: Number(raw.failUntil) || 0 }
      } catch {
        return { items: [], lastRoundAt: 0, fails: 0, failUntil: 0 }
      }
    })()
    memory.onChange(() => (this.memChangedAt = Date.now()))
  }

  /** Proposal rounds and the runner loop (main machine only). */
  start() {
    this.auto = true
    setInterval(() => this.tick(), TICK_MS).unref?.()
  }

  private save() {
    if (this.s.items.length > MAX_STORED) this.s.items = [...this.s.items].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_STORED)
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.s, null, 1))
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error(`[auto] écriture : ${(e as Error).message}`)
    }
  }

  private changed() {
    this.save()
    this.w.bump()
  }

  // ---------------------------------------------------------------- what the app sees

  /** For the snapshot: proposed, queued, running and finished in the last 3 days (never the refused ones). */
  list(now = Date.now()): Optimizer[] {
    const rank = { running: 0, queued: 1, proposed: 2, done: 3, failed: 3, refused: 4 } as const
    return this.s.items
      .filter((o) => o.state !== 'refused' && (o.state === 'proposed' || o.state === 'queued' || o.state === 'running' || now - (o.endedAt ?? o.createdAt) < KEEP_MS))
      .sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'proposed' ? (a.priority ?? 2) - (b.priority ?? 2) || a.createdAt - b.createdAt : 0) || (b.endedAt ?? 0) - (a.endedAt ?? 0) || (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0))
      .map(({ prompt: _p, acceptedAt: _a, seenWorking: _w, seenAt: _s, ...o }) => o)
  }

  /** The machine as the runner sees it (snapshot). */
  machine(now = Date.now()): AutoMachine {
    const load = this.sys.load()
    const cpus = this.sys.cpus()
    const free = this.sys.free()
    return { load: Math.round(load * 100) / 100, cpus, freeGb: Math.round((free / 1024 ** 3) * 10) / 10, wait: freeReason({ idleFor: now - this.lastBusyAt, load, cpus, free }) }
  }

  get(id: string) {
    return this.s.items.find((o) => o.id === id)
  }

  /** One tap: the proposal waits for a free machine. */
  accept(id: string): boolean {
    const o = this.get(id)
    if (!o || o.state !== 'proposed') return false
    o.state = 'queued'
    o.acceptedAt = Date.now()
    this.changed()
    if (this.auto) setTimeout(() => this.tick(), 1000).unref?.()
    return true
  }

  /** Refused (or taken back before it starts): kept for the prompt (never proposed again), hidden from the app. */
  refuse(id: string): boolean {
    const o = this.get(id)
    if (!o || (o.state !== 'proposed' && o.state !== 'queued')) return false
    o.state = 'refused'
    o.endedAt = Date.now()
    delete o.waiting
    this.changed()
    return true
  }

  // ---------------------------------------------------------------- the runner

  /** Every minute: follow the running task, say what the queue waits for, start the next one, maybe propose. */
  tick(now = Date.now()) {
    let dirty = this.follow(now)
    const snap = this.w.snapshot()
    const running = this.s.items.find((o) => o.state === 'running')
    const busy =
      !!snap.mainWorking || snap.sessions.some((s) => s.machineId === MACHINE.id && s.status === 'working' && s.id !== running?.sessionId)
    if (busy) this.lastBusyAt = now
    const reason = this.machine(now).wait
    const queue = this.s.items.filter((o) => o.state === 'queued').sort((a, b) => (a.acceptedAt ?? a.createdAt) - (b.acceptedAt ?? b.createdAt))
    queue.forEach((o, i) => {
      const wait = running || this.launching || i > 0 ? 'queue' : (reason ?? undefined)
      if (o.waiting !== wait) {
        if (wait) o.waiting = wait
        else delete o.waiting
        dirty = true
      }
    })
    if (dirty) this.changed()
    if (!running && !this.launching && !reason && queue[0]) void this.launch(queue[0], now)
    if (this.roundDue(now)) void this.round(now)
  }

  /** The running task's session: working → still running; back to rest after working → done; gone or too long → failed. */
  private follow(now: number): boolean {
    const o = this.s.items.find((x) => x.state === 'running')
    if (!o || this.launching) return false
    const t = tr(O)
    const end = (state: 'done' | 'failed', note: string) => {
      o.state = state
      o.endedAt = now
      o.lastEvent = note
      return true
    }
    if (now - (o.startedAt ?? now) > MAX_RUN_MS) return end('failed', t.timedOut)
    const s = o.sessionId ? this.w.snapshot().sessions.find((x) => x.id === o.sessionId) : undefined
    if (!s) return now - Math.max(o.seenAt ?? o.startedAt ?? now, this.bootAt) > VANISH_MS ? end('failed', t.vanished) : false
    o.seenAt = now
    if (s.status === 'working') {
      if (o.seenWorking) return false
      o.seenWorking = true
      return true
    }
    // A short task can start and finish between two looks: past the start-up delay, at rest means done.
    if (o.seenWorking || now - (o.startedAt ?? now) > VANISH_MS) return end('done', oneLine(s.lastMessage ?? '', 160))
    return false
  }

  /** Starts a task in a Claude session: in its repo (on a branch, in its own worktree) or in its workspace. */
  private async launch(o: Stored, now: number) {
    this.launching = true
    o.state = 'running'
    o.startedAt = now
    delete o.waiting
    delete o.lastEvent
    this.changed()
    try {
      const work = path.join(this.dir, o.id)
      fs.mkdirSync(work, { recursive: true })
      const cwd = o.repo ? this.w.repoDir(o.repo) : work
      const text = tr(O).brief({
        title: o.title,
        branch: `auto/${slug(o.title)}-${o.id.slice(0, 4)}`,
        worktree: path.join(work, 'wt'),
        report: path.join(work, 'report.md'),
        inRepo: !!o.repo,
        writesReport: !o.repo || o.kind === 'watch' || o.kind === 'content' || o.kind === 'explore',
        heavy: o.heavy,
        prompt: o.prompt,
      })
      const { id } = await this.w.createIn(cwd, o.title, text)
      o.sessionId = id
      o.seenAt = Date.now()
      console.log(`[auto] lancée : ${o.title} (${o.repo ?? work})`)
    } catch (e) {
      o.state = 'failed'
      o.endedAt = Date.now()
      o.lastEvent = tr(O).startFailed(oneLine((e as Error).message, 120))
      console.error(`[auto] lancement de « ${o.title} » : ${(e as Error).message}`)
    } finally {
      this.launching = false
      this.changed()
    }
  }

  // ---------------------------------------------------------------- proposal rounds

  private waiting() {
    return this.s.items.filter((o) => o.state === 'proposed').length
  }

  /** A round is due: first one a few minutes after start, then every 6 h, sooner after a memory change. */
  roundDue(now = Date.now()): boolean {
    if (this.rounding || now < this.s.failUntil || this.waiting() >= MAX_WAITING || !this.sys.logged()) return false
    if (!this.s.lastRoundAt) return now - this.bootAt >= FIRST_ROUND_MS
    const since = now - this.s.lastRoundAt
    if (since >= ROUND_EVERY_MS) return true
    return this.memChangedAt > this.s.lastRoundAt && since >= ROUND_MEMORY_MS && now - this.memChangedAt >= MEMORY_SETTLE_MS
  }

  /** The real projects as prompt lines: name, repos, the latest sessions' titles. */
  private projectsText(): string {
    const snap = this.w.snapshot()
    const since = Date.now() - 14 * 24 * 3600_000
    return [...snap.projects]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 12)
      .map((p) => {
        const titles = snap.sessions
          .filter((s) => s.projectId === p.id && s.lastActivityAt > since && s.title)
          .slice(0, 4)
          .map((s) => s.title)
        const repos = p.repos.filter((r) => r !== p.name)
        return `- ${p.name}${repos.length ? ` [${repos.join(', ')}]` : ''}${titles.length ? ` : ${titles.join(' · ')}` : ''}`
      })
      .join('\n')
  }

  /** The prompt of a round (also read by the tests). */
  proposalPrompt(max = MAX_WAITING): string {
    const t = tr(O)
    const history = [...this.s.items]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
      .map((o) => t.historyLine(o.title, t[`state_${o.state}`], o.state === 'refused' ? '' : o.why))
      .join('\n')
    const repos = this.w.allRepos().slice(0, 80).join(', ')
    const machine = t.machine(this.sys.cpus(), Math.round(os.totalmem() / 1024 ** 3), `${os.platform()} ${os.arch()}`)
    return t.propose(user(), max, this.memory.asText(), this.projectsText(), repos, machine, history)
  }

  /** One round with the model: up to 3 − (proposals waiting) new ones. Never two at once, backoff on failure. */
  round(now = Date.now()): Promise<void> {
    if (this.rounding) return this.rounding
    this.rounding = (async () => {
      const max = MAX_WAITING - this.waiting()
      try {
        const raw = parseJson<unknown>(await smart(this.proposalPrompt(max), 180_000))
        // i18n-ignore : raison de l'échec, seulement dans le journal
        if (raw === null) throw new Error('no JSON')
        const props = parseProposals(raw, this.w.allRepos(), this.s.items, max)
        for (const p of props) this.s.items.push({ ...p, id: crypto.randomBytes(5).toString('hex'), state: 'proposed', createdAt: Date.now() })
        this.s.lastRoundAt = now
        this.s.fails = 0
        this.s.failUntil = 0
        console.log(`[auto] ${props.length} proposition(s) (${lang()})`)
      } catch (e) {
        this.s.fails++
        const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** (this.s.fails - 1))
        this.s.failUntil = now + wait
        console.error(`[auto] propositions : ${(e as Error).message} · nouvel essai dans ${Math.round(wait / 60_000)} min`)
      } finally {
        this.changed()
      }
    })().finally(() => (this.rounding = null))
    return this.rounding
  }
}

/** POST /api/optimizers/:id/accept · POST /api/optimizers/:id/refuse */
export function optimizerRoutes(o: Optimizers, json: Json, _readBody: ReadBody): [string, RegExp, Handler][] {
  return [
    ['POST', /^\/api\/optimizers\/([\w-]+)\/accept$/, (_req, res, _u, [id]) => {
      const ok = o.accept(id)
      json(res, ok ? 200 : 404, { ok })
    }],
    ['POST', /^\/api\/optimizers\/([\w-]+)\/refuse$/, (_req, res, _u, [id]) => {
      const ok = o.refuse(id)
      json(res, ok ? 200 : 404, { ok })
    }],
  ]
}
