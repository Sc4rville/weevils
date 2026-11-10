// The « auto » band that never sleeps: from the memory and the real projects, weevils proposes background tasks
// (« optimizers »: harden a repo's tests, watch a topic the user cares about, prepare content, explore an idea they
// mentioned). Each one is accepted or refused with one tap. Accepted ones run in a normal Claude session (visible in
// its project) when the machine is free — no agent working for 5 min, load and memory under the `heavy` thresholds —
// one at a time, on a local branch in its own git worktree, never destructive, paid or published without the user's go.
//
// Where a task works: never under DATA_DIR (weevils hides every session there, it is weevboss's). A repo task gets a git
// worktree that weevils makes itself, <root>/.auto/<repo>/<id> on branch auto/<slug>-<id>: place() skips the hidden
// folder and files the session under the repo's project, and the user's own checkout is never touched. A task without a
// repo works in <projects>/.auto/.<id> (all hidden: the session goes to the misc project, or where its talk points).
//
// Stored in DATA_DIR/optimizers.json (outside every repo). Proposal rounds only on the main machine with Claude
// logged in: a few minutes after start, then every 6 h at most, sooner when the memory changed (30 min apart at
// least, or as soon as it settles after a round that proposed nothing), only while fewer than 3 proposals wait for an
// answer; a failed round backs off 1 h (doubling), never a loop.
//
// Never pushed, published or paid without the user: the brief says so, Claude Code's deny list (DENY) blocks the plain
// commands, and the session's environment (guardEnv) leaves gh logged out, git unable to push and no MCP connector.

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AutoMachine, Optimizer, Session } from '../shared/api.ts'
import { DATA_DIR, MACHINE, PROJECTS_DIR } from './config.ts'
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
/** A task stopped by a usage limit, an expired login or an API error goes back to the queue this long, this many tries. */
export const RETRY_MS = 3600_000
export const MAX_TRIES = 3
/** Finished tasks stay in the band this long. */
export const KEEP_MS = 3 * 24 * 3600_000
const TICK_MS = 60_000
const MAX_STORED = 200
const KINDS = ['tests', 'watch', 'content', 'explore', 'other'] as const

/**
 * What an unattended task may never do, enforced by Claude Code itself (deny rules hold even without permission
 * prompts): push, anything through gh, publish a package or an image, expose a port, send data with curl or wget,
 * reach another machine, sudo, kill weevils' tmux, delete outside its folder, read keys and secrets, edit the user's
 * configuration. Rules are wildcards checked on each part of a compound command (`cd x && git push`), wrappers
 * (`timeout`, `VAR=…`) removed; `bash -c "…"` or a script's own HTTP call still pass them: the environment barriers
 * below (guardEnv) are the layer that holds. The brief says it too.
 */
const curlSends = ['-X', '--request', '-d', '--data', '--json', '-F', '--form', '-T', '--upload-file'].flatMap((f) => [`Bash(curl ${f}*)`, `Bash(curl * ${f}*)`])
export const DENY = [
  'Bash(git push*)',
  'Bash(git -C * push*)',
  'Bash(git -c * push*)',
  'Bash(git --git-dir* push*)',
  'Bash(git --work-tree* push*)',
  'Bash(git send-email*)',
  'Bash(git config --global*)',
  'Bash(gh)',
  'Bash(gh *)',
  'Bash(*/gh *)',
  'Bash(* publish)',
  'Bash(* publish *)',
  'Bash(twine upload*)',
  'Bash(docker push*)',
  'Bash(docker * push*)',
  'Bash(docker login*)',
  'Bash(podman push*)',
  'Bash(expose*)',
  'Bash(*/expose *)',
  'Bash(runpodctl *)',
  ...curlSends,
  'Bash(wget *--post*)',
  'Bash(wget *--method*)',
  'Bash(wget *--body*)',
  'Bash(ssh *)',
  'Bash(scp *)',
  'Bash(sftp *)',
  'Bash(rsync *)',
  'Bash(sudo *)',
  'Bash(su *)',
  'Bash(pkexec *)',
  'Bash(crontab *)',
  'Bash(systemctl *)',
  'Bash(tmux *kill-server*)',
  'Bash(pkill *)',
  'Bash(killall *)',
  'Bash(rm * ~*)',
  'Bash(rm * $HOME*)',
  'Bash(rm * /)',
  'Bash(rm * ..*)',
  'Bash(*.config/gh*)',
  'Bash(*.ssh/*)',
  'Bash(*.credentials.json*)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.config/gh/**)',
  'Read(~/.config/weevils/**)',
  'Read(~/.claude.json)',
  'Read(~/.claude/.credentials.json)',
  'Read(~/.netrc)',
  'Read(~/.git-credentials)',
  'Read(~/.npmrc)',
  'Read(~/.docker/config.json)',
  'Read(**/.env)',
  'Read(**/.env.*)',
  'Edit(~/.ssh/**)',
  'Edit(~/.claude/**)',
  'Edit(~/.claude.json)',
  'Edit(~/.config/**)',
  'Edit(~/.local/share/weevils/**)',
  'Edit(~/.bashrc)',
  'Edit(~/.profile)',
  'Edit(~/.gitconfig)',
]
/**
 * The extra arguments of an optimizer's claude session: the deny list as flag settings, and no MCP server at all (the
 * user's claude.ai connectors and plugins can send mail, publish or spend credits; an empty --mcp-config with
 * --strict-mcp-config leaves none).
 */
export const SAFETY_ARGS = ['--settings', JSON.stringify({ permissions: { deny: DENY } }), '--strict-mcp-config', `--mcp-config=${JSON.stringify({ mcpServers: {} })}`]

/** A push URL weevils rewrites every remote to: no such git transport, so a push fails at once, before any network. */
export const NO_PUSH_URL = 'weevils-no-push://'
/** The URL starts a push may take (pushInsteadOf rewrites them all to NO_PUSH_URL; fetch is untouched). */
const PUSH_PREFIXES = ['https://', 'http://', 'ssh://', 'git://', 'git@', 'file://', '/']
/** Variables that hand out a login or a paid key (plus any …TOKEN, …SECRET, …API_KEY in weevils' own environment). */
const SECRET_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'SSH_AUTH_SOCK', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'CARGO_REGISTRY_TOKEN', 'TWINE_PASSWORD', 'DOCKER_AUTH_CONFIG']
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|CREDENTIALS?)$/i
/** Claude's own login (an OAuth token or an API key may be how it runs) and weevils' hooks keep theirs. */
const KEEP_NAME = /^(ANTHROPIC_|CLAUDE_|WEEVILS_)/

/**
 * The environment of an optimizer's session (only theirs: the user's own sessions keep everything). These hold even when
 * a command slips past the deny list (`bash -c`, a script, an alias):
 * - gh has no account: an empty config dir of its own, no token variable → every gh call (and gh's git credential
 *   helper) runs logged out;
 * - git never pushes: every push URL is rewritten to an unknown transport (a remote, an explicit URL, git -C …), ssh
 *   refuses to run for git, no credential helper, no prompt, no askpass; fetch and clone over https still work;
 * - no ssh agent, no docker login, no publishing token, no paid-API key from weevils' environment, no claude.ai connector.
 * `guard` is a folder of weevils' (emptied before each task): gh/ and docker/ inside are the empty configs.
 */
export function guardEnv(guard: string, env: NodeJS.ProcessEnv = process.env): { set: Record<string, string>; unset: string[] } {
  const git: [string, string][] = [
    ['remote.pushDefault', NO_PUSH_URL],
    ...PUSH_PREFIXES.map((p): [string, string] => [`url.${NO_PUSH_URL}.pushInsteadOf`, p]),
    // An empty helper empties the list, global and per-URL ones (gh sets credential.https://github.com.helper).
    ['credential.helper', ''],
    ['credential.https://github.com.helper', ''],
    ['credential.https://gist.github.com.helper', ''],
  ]
  const set: Record<string, string> = {
    GH_CONFIG_DIR: path.join(guard, 'gh'),
    GH_PROMPT_DISABLED: '1',
    DOCKER_CONFIG: path.join(guard, 'docker'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    SSH_ASKPASS: '/bin/false',
    SSH_ASKPASS_REQUIRE: 'never',
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: '/bin/false',
    GIT_CONFIG_COUNT: String(git.length),
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
  }
  git.forEach(([k, v], i) => {
    set[`GIT_CONFIG_KEY_${i}`] = k
    set[`GIT_CONFIG_VALUE_${i}`] = v
  })
  const found = Object.keys(env).filter((k) => SECRET_NAME.test(k) && !KEEP_NAME.test(k) && !(k in set))
  return { set, unset: [...new Set([...SECRET_VARS, ...found])] }
}

type Stored = Optimizer & {
  /** The agent's brief, as the model wrote it (the safety rules are added at launch). */
  prompt: string
  acceptedAt?: number
  /** The session was seen working (its return to idle then means done). */
  seenWorking?: boolean
  /** Last time the session was seen in the snapshot. */
  seenAt?: number
  /** Starts stopped by a usage limit, a login or an API error. */
  tries?: number
}
interface State {
  items: Stored[]
  lastRoundAt: number
  /** The last round proposed nothing (a blank install): the next memory change is not held 30 min. */
  lastEmpty?: boolean
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
  /** git -C <repo> worktree add <dir> -b <branch> (from the checkout's HEAD). */
  worktree: (repo: string, dir: string, branch: string) => Promise<void>
}
const gitWorktree = (repo: string, dir: string, branch: string) =>
  new Promise<void>((resolve, reject) =>
    execFile('git', ['-C', repo, 'worktree', 'add', dir, '-b', branch], { timeout: 60_000 }, (e, _out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').pop())) : resolve())),
  )
const realSys: Sys = { load: () => os.loadavg()[0], cpus: () => os.cpus().length || 1, free: () => os.freemem(), logged: claudeLogged, worktree: gitWorktree }

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

/**
 * A reply that is not work: a usage limit, an expired login, an API error. Claude Code writes them as the agent's
 * answer, short; a real summary that mentions a limit is longer than this and does not start like one.
 */
export function isStall(msg: string): boolean {
  const m = msg.trim()
  if (!m || m.length > 200) return false
  return /^(api error\b|you['’]ve (hit|reached) your|claude (ai )?usage limit|usage limit|\d+-hour limit|weekly limit|limit reached|failed to authenticate|login expired|oauth|invalid api key|credit balance|request timed out|overloaded|please run \/login)/i.test(m)
}

/** Which stop it was, for a short note in the app (the raw message stays in the log). */
export function stallKind(msg: string): 'limit' | 'login' | 'api' {
  if (/limit|credit/i.test(msg)) return 'limit'
  if (/auth|login|oauth|api key|\/login/i.test(msg)) return 'login'
  return 'api'
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
  /** <projects>/.auto: the workspaces of the tasks without a repo (<projects>/.auto/.<id>). */
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

  constructor(w: Weevils, memory: Memory, opts: { file?: string; /** default <projects>/.auto */ dir?: string; sys?: Partial<Sys> } = {}) {
    this.w = w
    this.memory = memory
    this.file = opts.file ?? path.join(DATA_DIR, 'optimizers.json')
    this.dir = opts.dir ?? path.join(PROJECTS_DIR, '.auto')
    const sys = opts.sys ?? {}
    this.sys = {
      load: () => (sys.load ?? realSys.load)(),
      cpus: () => (sys.cpus ?? realSys.cpus)(),
      free: () => (sys.free ?? realSys.free)(),
      logged: () => (sys.logged ?? realSys.logged)(),
      worktree: (repo, dir, branch) => (sys.worktree ?? realSys.worktree)(repo, dir, branch),
    }
    this.s = (() => {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<State>
        const items = (Array.isArray(raw.items) ? raw.items : []).filter((o) => o && typeof o.id === 'string' && typeof o.title === 'string' && typeof o.state === 'string')
        return { items, lastRoundAt: Number(raw.lastRoundAt) || 0, lastEmpty: raw.lastEmpty === true, fails: Number(raw.fails) || 0, failUntil: Number(raw.failUntil) || 0 }
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
      .map(({ prompt: _p, acceptedAt: _a, seenWorking: _w, seenAt: _s, tries: _t, ...o }) => o)
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
    delete o.retryAt
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
    // Stopped by a limit or an error: it waits for its retry time, the others go first.
    const ready = queue.filter((o) => !(o.retryAt && o.retryAt > now))
    queue.forEach((o) => {
      const i = ready.indexOf(o)
      const wait = i < 0 ? 'later' : running || this.launching || i > 0 ? 'queue' : (reason ?? undefined)
      if (o.waiting !== wait) {
        if (wait) o.waiting = wait
        else delete o.waiting
        dirty = true
      }
    })
    if (dirty) this.changed()
    // Never without Claude logged in: the session would open on a login screen and sit there.
    if (!running && !this.launching && !reason && ready[0] && this.sys.logged()) void this.launch(ready[0], now)
    if (this.roundDue(now)) void this.round(now)
  }

  /**
   * The running task's session. Working, or blocked on a question (needs_user: it keeps the one-at-a-time slot) → still
   * running. At rest: a limit or API error → back to the queue for later; a turn still open (a long silent command reads
   * as idle after 10 min) → still running; ended with a real reply → done; ended without one → failed. Gone or too long
   * → failed.
   */
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
    if (s.status === 'working' || s.status === 'needs_user') {
      if (o.seenWorking || s.status !== 'working') return false
      o.seenWorking = true
      return true
    }
    const last = s.lastMessage ?? ''
    if (isStall(last)) return this.later(o, now, last)
    if (this.turnOpen(s)) return false
    // A short task can start and finish between two looks: past the start-up delay, at rest means it ended.
    if (!o.seenWorking && now - (o.startedAt ?? now) <= VANISH_MS) return false
    if (s.messageCount < 2) return end('failed', t.noWork)
    return end('done', oneLine(last, 160))
  }

  /** The agent's turn has not ended: its transcript waits for a tool's result and no Stop hook came since. */
  private turnOpen(s: Session): boolean {
    if (!s.live) return false
    const tr = this.w.store?.get(s.id)
    if (tr?.phase !== 'working') return false
    const h = this.w.hooks?.get(s.id)
    return !(h && (h.event === 'Stop' || h.event === 'SessionEnd') && h.at >= tr.lastActivityAt - 2000)
  }

  /** Stopped by a limit, a login or an API error: no work was done, it goes back to the queue for later (a few tries). */
  private later(o: Stored, now: number, why: string): boolean {
    o.tries = (o.tries ?? 0) + 1
    o.lastEvent = tr(O)[`stall_${stallKind(why)}`]
    if (o.tries >= MAX_TRIES) {
      o.state = 'failed'
      o.endedAt = now
      console.log(`[auto] « ${o.title} » abandonnée après ${o.tries} essais (${oneLine(why, 160)})`)
      return true
    }
    o.state = 'queued'
    o.retryAt = now + RETRY_MS
    o.waiting = 'later'
    console.log(`[auto] « ${o.title} » arrêtée (${oneLine(why, 160)}) · nouvel essai dans ${Math.round(RETRY_MS / 60_000)} min`)
    return true
  }

  /** Where a task works: its own git worktree beside its repo, or a hidden folder of its own (see the top of the file). */
  workspace(o: { id: string; repo: string | null }): string {
    return o.repo ? path.join(path.dirname(this.w.repoDir(o.repo)), '.auto', o.repo, o.id) : path.join(this.dir, `.${o.id}`)
  }

  /** The guard folder of guardEnv, emptied before each task (a task may have written in gh's or docker's config). */
  guard(): string {
    const dir = path.join(this.dir, '.guard')
    for (const sub of ['gh', 'docker']) {
      fs.rmSync(path.join(dir, sub), { recursive: true, force: true })
      fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 })
    }
    return dir
  }

  /** Starts a task in a Claude session: in its own worktree of its repo (on a fresh local branch), or in its workspace. */
  private async launch(o: Stored, now: number) {
    this.launching = true
    o.state = 'running'
    o.startedAt = now
    delete o.waiting
    delete o.lastEvent
    delete o.retryAt
    delete o.seenWorking
    delete o.seenAt
    delete o.sessionId
    this.changed()
    let step: 'branch' | 'start' = 'start'
    try {
      const cwd = this.workspace(o)
      const branch = `auto/${slug(o.title)}-${o.id.slice(0, 4)}`
      // A retry finds its worktree already there (same branch).
      if (o.repo && !fs.existsSync(cwd)) {
        step = 'branch'
        fs.mkdirSync(path.dirname(cwd), { recursive: true })
        await this.sys.worktree(this.w.repoDir(o.repo), cwd, branch)
        step = 'start'
      } else fs.mkdirSync(cwd, { recursive: true })
      const writesReport = !o.repo || o.kind === 'watch' || o.kind === 'content' || o.kind === 'explore'
      const text = tr(O).brief({
        title: o.title,
        branch,
        checkout: o.repo ? this.w.repoDir(o.repo) : '',
        // Beside the worktree, never in it (the branch stays the work itself).
        report: o.repo ? path.join(path.dirname(cwd), `${o.id}.md`) : path.join(cwd, 'report.md'),
        inRepo: !!o.repo,
        writesReport,
        heavy: o.heavy,
        prompt: o.prompt,
      })
      const { id } = await this.w.createIn(cwd, o.title, text, SAFETY_ARGS, guardEnv(this.guard()))
      o.sessionId = id
      o.seenAt = Date.now()
      console.log(`[auto] lancée : ${o.title} (${cwd})`)
    } catch (e) {
      // The app shows a short note; the raw error (tmux, git) stays in the log.
      o.state = 'failed'
      o.endedAt = Date.now()
      o.lastEvent = step === 'branch' ? tr(O).branchFailed : tr(O).startFailed
      console.error(`[auto] lancement de « ${o.title} » (${step}) : ${(e as Error).message}`)
    } finally {
      this.launching = false
      this.changed()
    }
  }

  // ---------------------------------------------------------------- proposal rounds

  private waiting() {
    return this.s.items.filter((o) => o.state === 'proposed').length
  }

  /** A round is due: first one a few minutes after start, then every 6 h, sooner after a memory change (2 min after
   *  it settles when the last round proposed nothing, else 30 min after the last round at least). */
  roundDue(now = Date.now()): boolean {
    if (this.rounding || now < this.s.failUntil || this.waiting() >= MAX_WAITING || !this.sys.logged()) return false
    if (!this.s.lastRoundAt) return now - this.bootAt >= FIRST_ROUND_MS
    const since = now - this.s.lastRoundAt
    if (since >= ROUND_EVERY_MS) return true
    // After an empty round there is nothing to crowd: the first new memory is worth a round as soon as it settles. It
    // takes a memory change after that round to come back, so never a loop.
    const gap = this.s.lastEmpty ? MEMORY_SETTLE_MS : ROUND_MEMORY_MS
    return this.memChangedAt > this.s.lastRoundAt && since >= gap && now - this.memChangedAt >= MEMORY_SETTLE_MS
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
        this.s.lastEmpty = props.length === 0
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
