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
// Each task can be talked over before (and after) it is accepted (talk(), POST /api/optimizers/:id/talk): a short
// exchange with the model that answers about it and rewrites it when asked (what, when, how often, how intense, on which
// repo). Every field of the rewrite is checked here, never trusted; the exchange stays on the task (where it came from)
// and its gist goes into the brief at launch. Conditions: not before a moment, inside a daily window, every N (a
// recurring task goes back to the queue for its next run when one ends).
//
// Never pushed, published or paid without the user: the brief says so, Claude Code's deny list (DENY) blocks the plain
// commands, the session's environment (guardEnv) leaves gh logged out, git unable to push and no MCP connector, and the
// session runs in a jail (jailArgs, bwrap) where the keys and logins are gone and the user's files read-only.

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AutoMachine, Optimizer, OptimizerField, OptimizerLine, OptimizerTalkReply, Session } from '../shared/api.ts'
import { detectLang } from '../shared/detect-lang.ts'
import { fmtLocal, nextRun, nextStart, parseEvery, parseLocal, parseWindow, serverTz, validTz, windowText, MAX_AHEAD_MS, type Window } from './auto-time.ts'
import { DATA_DIR, MACHINE, PROJECT_ROOTS, PROJECTS_DIR } from './config.ts'
import type { Weevils } from './core.ts'
import { parseJson, smart } from './fast.ts'
import { lang, tr, user, withLang, type Lang } from './i18n.ts'
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
/** …or 1.5 × its estimate when that is longer, never past this. */
export const MAX_RUN_CAP_MS = 6 * 3600_000
/** A task stopped by a usage limit, an expired login or an API error goes back to the queue this long, this many tries. */
export const RETRY_MS = 3600_000
export const MAX_TRIES = 3
/** Finished tasks stay in the band this long. */
export const KEEP_MS = 3 * 24 * 3600_000
const TICK_MS = 60_000
const MAX_STORED = 200
const KINDS = ['tests', 'watch', 'content', 'explore', 'other'] as const
/** The exchange kept on a task: its last lines, each one cut to this. */
export const MAX_TALK = 12
export const TALK_CHARS = 500
/** One exchange turn: the model may take its time (it may rewrite the whole brief). */
const TALK_TIMEOUT_MS = 120_000
/** After a failed turn, the same task waits this long before the model is asked again (never a loop). */
export const TALK_BACKOFF_MS = 20_000
/** A recurring task keeps this many runs; this many failures in a row and it stops coming back. */
const MAX_RUNS = 10
export const MAX_FAILED_RUNS = 3
/** What a rewrite may change, in the order the app shows them. */
const SCOPE = ['title', 'why', 'kind', 'repo', 'prompt'] as const
const TERMS = ['est', 'priority', 'heavy', 'notBefore', 'window', 'every'] as const

/**
 * What an unattended task may never do, enforced by Claude Code itself (deny rules hold even without permission
 * prompts): push, anything through gh, publish a package or an image, expose a port, send data with curl or wget,
 * reach another machine, sudo, kill weevils' tmux, delete outside its folder, read keys and secrets, edit the user's
 * configuration. Rules are wildcards checked on each part of a compound command (`cd x && git push`), wrappers
 * (`timeout`, `VAR=…`, `env`) removed; `bash -c "…"`, `eval` or a script still pass them: the environment barriers
 * (guardEnv) stop the plain commands those run, the jail (jailArgs) what a task does on purpose. The brief says it too.
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
  // Every way out of the session: tmux and systemd start commands outside it (no barriers, no jail), weevils' own CLI
  // starts or messages a full session, claude and codex start an agent without this list.
  'Bash(tmux)',
  'Bash(tmux *)',
  'Bash(*/tmux *)',
  'Bash(systemd-run *)',
  'Bash(weevils*)',
  'Bash(*/weevils *)',
  'Bash(wv *)',
  'Bash(claude *)',
  'Bash(*/claude *)',
  'Bash(codex *)',
  'Bash(*/codex *)',
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
  // Claude Code's own ways to reach another session or a cloud agent (which has GitHub write access of its own).
  'SendMessage',
  'ListAgents',
  'RemoteTrigger',
]
/**
 * The extra arguments of an optimizer's claude session: the deny list as flag settings, and no MCP server at all (the
 * user's claude.ai connectors and plugins can send mail, publish or spend credits; an empty --mcp-config with
 * --strict-mcp-config leaves none).
 */
export const SAFETY_ARGS = ['--settings', JSON.stringify({ permissions: { deny: DENY }, disableClaudeAiConnectors: true }), '--strict-mcp-config', `--mcp-config=${JSON.stringify({ mcpServers: {} })}`]

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
    // weevils' CLI (weevils new, send…) talks to weevilsd on WEEVILS_PORT: a port where nothing listens.
    WEEVILS_PORT: '1',
  }
  git.forEach(([k, v], i) => {
    set[`GIT_CONFIG_KEY_${i}`] = k
    set[`GIT_CONFIG_VALUE_${i}`] = v
  })
  const found = Object.keys(env).filter((k) => SECRET_NAME.test(k) && !KEEP_NAME.test(k) && !(k in set))
  return { set, unset: [...new Set([...SECRET_VARS, ...found])] }
}

/** Hidden in the jail (an empty folder there): keys, logins, weevils' own config, the user's sockets. */
const JAIL_HIDE = ['.ssh', '.config/gh', '.config/hub', '.codex', '.config/weevils', '.aws', '.azure', '.config/gcloud', '.kube', '.docker', '.gnupg', '.password-store', '.runpod']
/** Hidden files (/dev/null there): logins kept in one file. */
const JAIL_HIDE_FILES = ['.netrc', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml']
/** Read-only in the jail: what runs later in the user's own sessions, unjailed (shell start files, ~/.local/bin, git and
 *  Claude Code's settings, hooks, skills and plugins, systemd user units). */
const JAIL_RO = ['.bashrc', '.bash_profile', '.bash_login', '.profile', '.zshrc', '.zshenv', '.zprofile', '.config/fish', '.config/environment.d', '.gitconfig', '.config/git', '.local/bin', '.config/systemd', '.config/autostart', '.claude/settings.json', '.claude/settings.local.json', '.claude/CLAUDE.md', '.claude/hooks', '.claude/commands', '.claude/agents', '.claude/skills', '.claude/plugins']

/**
 * The jail of an optimizer's session (bwrap's arguments, the command follows): the same files and network, minus what
 * lets a task act as the user beyond its folder. The environment barriers (guardEnv) stop a plain `git push` or `gh`,
 * but the task can undo them (`bash -c 'GH_CONFIG_DIR=~/.config/gh gh …'`); these it can't:
 * - hidden: ssh keys, gh / cloud / registry logins, weevils' data and config, the user's runtime sockets (ssh agent, dbus
 *   and systemd → no systemd-run, other Claude sessions), the tmux and zellij servers (no command started outside the
 *   jail), docker's socket (root in all but name);
 * - read-only: every project root except the task's own folder (worktree and report) and its repo's .git (commits),
 *   whose config and hooks stay read-only (a core.fsmonitor or a hook would run in the user's next git command), and
 *   the files listed in JAIL_RO;
 * - no new privileges: sudo, su, pkexec, crontab and at raise nothing.
 * Not covered: the network (a script can still send what it reads), Claude Code's own login and ~/.claude.json, the
 * loopback ports (weevils' API: its CLI is denied and pointed at a dead port, not walled off).
 */
export function jailArgs(o: { home: string; hide: string[]; roots: string[]; rw: string[]; git?: string; /** kept visible among JAIL_HIDE: the login of the agent that runs the task (Codex: .codex) */ show?: string[] }, exists: (p: string) => boolean = fs.existsSync): string[] {
  const real = (p: string) => {
    try {
      return fs.realpathSync(p)
    } catch {
      return p
    }
  }
  const pick = (list: string[]) => [...new Set(list.filter((p) => exists(p)).map(real))]
  const home = (list: string[]) => list.map((p) => path.join(o.home, p))
  const hide = pick([...home(JAIL_HIDE.filter((p) => !o.show?.includes(p))), ...o.hide])
  const files = pick([...home(JAIL_HIDE_FILES), '/run/docker.sock', '/var/run/docker.sock', '/run/podman/podman.sock'])
  const ro = pick([...home(JAIL_RO), ...o.roots])
  const rw = pick([...o.rw, ...(o.git ? [o.git] : [])])
  const gitRo = o.git ? pick([path.join(o.git, 'config'), path.join(o.git, 'hooks')]) : []
  return [
    '--dev-bind', '/', '/',
    ...hide.flatMap((p) => ['--tmpfs', p]),
    ...files.flatMap((p) => ['--ro-bind', '/dev/null', p]),
    ...ro.flatMap((p) => ['--ro-bind', p, p]),
    ...rw.flatMap((p) => ['--bind', p, p]),
    ...gitRo.flatMap((p) => ['--ro-bind', p, p]),
    '--die-with-parent',
    '--',
  ]
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
  /** Waits for Claude to be back (server/relay.ts): released as soon as it is. */
  held?: boolean
  /** The agent of the current (or last) run: Codex while Claude is at its limit. */
  tool?: 'claude' | 'codex'
  /** Its local branch, fixed at the first start (a later run or a retry finds the same worktree). */
  branch?: string
  /** A change of scope agreed while it was running: applied when it comes back for its next run. */
  pending?: Partial<Pick<Stored, (typeof SCOPE)[number]>>
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
  /** Tries the jail (bwrap <args> true): true when it holds, false without bwrap on this machine; throws if it fails. */
  jail: (args: string[]) => Promise<boolean>
}
const gitWorktree = (repo: string, dir: string, branch: string) =>
  new Promise<void>((resolve, reject) =>
    execFile('git', ['-C', repo, 'worktree', 'add', dir, '-b', branch], { timeout: 60_000 }, (e, _out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').pop())) : resolve())),
  )
const tryJail = (args: string[]) =>
  new Promise<boolean>((resolve, reject) =>
    execFile('bwrap', [...args, 'true'], { timeout: 15_000 }, (e, _out, err) =>
      !e ? resolve(true) : (e as NodeJS.ErrnoException).code === 'ENOENT' ? resolve(false) : reject(new Error(String(err || e.message).trim().split('\n').pop())),
    ),
  )
const realSys: Sys = { load: () => os.loadavg()[0], cpus: () => os.cpus().length || 1, free: () => os.freemem(), logged: claudeLogged, worktree: gitWorktree, jail: tryJail }

// ---------------------------------------------------------------- pure helpers (tested)

/** A rewrite from the model, checked: null clears a condition (as soon as possible, any time, just once). */
export interface Patch {
  title?: string
  why?: string
  kind?: Optimizer['kind']
  repo?: string | null
  prompt?: string
  est?: number
  priority?: 1 | 2 | 3
  heavy?: boolean
  notBefore?: number | null
  window?: Window | null
  every?: number | null
}

const oneLine = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["«“'\s]+|["»”'\s]+$/g, '')
    .slice(0, max)
    .trim()

/**
 * A title or a why line as the app shows it: one line, no quotes around words (« mygame », "the site" → mygame, the
 * site); apostrophes stay.
 */
export function tidy(s: unknown, max: number): string {
  return oneLine(String(s ?? '').replace(/[«»“”„‟"]/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '('), max)
}

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
    const title = tidy(x.title, 80)
    const prompt = String(x.prompt ?? '').trim().slice(0, 6000)
    if (title.length < 3 || prompt.length < 20) continue
    if (isRepeat(title, [...known, ...out])) continue
    const want = typeof x.repo === 'string' ? x.repo.trim() : ''
    const repo = want ? (repos.find((n) => n === want) ?? repos.find((n) => n.toLowerCase() === want.toLowerCase()) ?? null) : null
    out.push({
      title,
      why: tidy(x.why, 220),
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

const isNull = (v: unknown) => v === null || (typeof v === 'string' && /^(null|none|never|once|aucune?|jamais|une fois|)$/i.test(v.trim()))

/**
 * The model's rewrite of a task, every field checked (never trusted): a title and a why that read well, a known kind,
 * a repo that really is on the machine (else ignored; null: its own folder), a full brief, an estimate of 5 min to
 * 4 h, priority 1–3, a start within 60 days (in the user's zone), a daily window of 30 min at least, a period of
 * 1 h to 90 days. Anything else is dropped, field by field.
 */
export function parsePatch(raw: unknown, ctx: { repos: string[]; tz: string; now: number }): Patch {
  const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const p: Patch = {}
  if ('title' in x) {
    const t = tidy(x.title, 60)
    if (t.length >= 3) p.title = t
  }
  if ('why' in x) {
    const w = tidy(x.why, 220)
    if (w.length >= 3) p.why = w
  }
  if ((KINDS as readonly string[]).includes(String(x.kind))) p.kind = x.kind as Optimizer['kind']
  if ('repo' in x) {
    if (isNull(x.repo)) p.repo = null
    else if (typeof x.repo === 'string') {
      const want = x.repo.trim()
      const hit = ctx.repos.find((n) => n === want) ?? ctx.repos.find((n) => n.toLowerCase() === want.toLowerCase())
      if (hit) p.repo = hit
    }
  }
  if (typeof x.prompt === 'string') {
    const b = x.prompt.trim().slice(0, 6000)
    if (b.length >= 20) p.prompt = b
  }
  const num = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN)
  const est = num(x.est)
  if (Number.isFinite(est)) p.est = clamp(Math.round(est), 5, 240)
  const pr = num(x.priority)
  if (Number.isFinite(pr)) p.priority = clamp(Math.round(pr), 1, 3) as 1 | 2 | 3
  if (typeof x.heavy === 'boolean') p.heavy = x.heavy
  if ('notBefore' in x) {
    if (isNull(x.notBefore)) p.notBefore = null
    else {
      const at = typeof x.notBefore === 'number' ? x.notBefore : parseLocal(x.notBefore, ctx.tz)
      // Already past (a few minutes of slack): as soon as possible. Too far or unreadable: ignored.
      if (at !== null && Number.isFinite(at) && at <= ctx.now + MAX_AHEAD_MS && at > ctx.now - 24 * 3600_000) p.notBefore = at > ctx.now + 60_000 ? at : null
    }
  }
  if ('window' in x) {
    if (isNull(x.window)) p.window = null
    else {
      const w = parseWindow(x.window)
      if (w) p.window = w
    }
  }
  if ('every' in x) {
    if (isNull(x.every) || x.every === 0 || x.every === false) p.every = null
    else {
      const e = parseEvery(x.every)
      if (e) p.every = e
    }
  }
  return p
}

/** The last lines of an exchange, each one cut (what is kept on a task). */
export function capTalk(lines: OptimizerLine[], max = MAX_TALK): OptimizerLine[] {
  return lines.slice(-max).map((l) => ({ ...l, text: l.text.length > TALK_CHARS ? `${l.text.slice(0, TALK_CHARS - 1).trimEnd()}…` : l.text }))
}

/**
 * What the agent reads at launch about the negotiation: the user's last requests and the last answer kept, 2 to 4
 * lines (empty when the task was accepted as proposed).
 */
export function agreedDigest(talk: OptimizerLine[] | undefined, line: { user: (s: string) => string; auto: (s: string) => string }): string {
  if (!talk?.some((l) => l.who === 'user')) return ''
  const asked = talk.filter((l) => l.who === 'user').slice(-3).map((l) => line.user(oneLine(l.text, 180)))
  const last = [...talk].reverse().find((l) => l.who === 'auto')
  return [...asked, ...(last ? [line.auto(oneLine(last.text, 240))] : [])].join('\n')
}

/** How long a task may run: 2 h, or 1.5 × its estimate when longer, 6 h at most. */
export const runLimit = (est?: number) => clamp(Math.round((est ?? 0) * 1.5) * 60_000, MAX_RUN_MS, MAX_RUN_CAP_MS)

/** A period as the model reads it: « 7d », « 12h », « 90min ». */
export function fmtSpan(ms: number): string {
  const h = ms / 3600_000
  if (h >= 24 && Number.isInteger(h / 24)) return `${h / 24}d`
  if (h >= 1 && Number.isInteger(h)) return `${h}h`
  return `${Math.round(ms / 60_000)}min`
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
  private noJailSaid = false
  /** bwrap works on this machine (asked once, when Claude first hits its limit). */
  private bwrap: boolean | undefined
  private probingJail = false
  private auto = false
  /** Tasks with an exchange turn in flight (one at a time each), and those waiting after a failed one. */
  private talking = new Set<string>()
  private talkFailUntil = new Map<string, number>()

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
      jail: (args) => (sys.jail ?? realSys.jail)(args),
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
      .map((o) => this.view(o, now))
  }

  /** A task as the app sees it: without the brief and the runner's bookkeeping; when it may start, if its time holds it. */
  view(o: Stored, now = Date.now()): Optimizer {
    const { prompt: _p, acceptedAt: _a, seenWorking: _w, seenAt: _s, tries: _t, held: _h, tool: _tool, branch: _b, pending: _n, ...v } = o
    const at = o.state === 'queued' ? this.timeAt(o, now) : now
    return at > now ? { ...v, startAt: at } : v
  }

  /** When its conditions let a task start (now when it has none). */
  private timeAt(o: Stored, now: number): number {
    return o.notBefore || o.window ? nextStart(o, now, o.tz ?? serverTz()) : now
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

  /**
   * One tap: the proposal, as it stands after the exchange (the version on screen: `rev`, when given, must match),
   * waits for a free machine and its time. Never while the model is rewriting it.
   */
  accept(id: string, rev?: number): boolean | 'busy' {
    const o = this.get(id)
    if (!o || o.state !== 'proposed') return false
    if (this.talking.has(id) || (rev !== undefined && rev !== (o.rev ?? 0))) return 'busy'
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

  // ---------------------------------------------------------------- the exchange about a task

  /**
   * One turn of the exchange about a task (typed or spoken, any state but refused): the model answers and may rewrite
   * it (parsePatch checks every field). What changes depends on the state (patchable): all of it before it starts;
   * while it runs, its conditions now and its scope at its next run (the running session is never touched); nothing
   * once it is over. The exchange stays on the task. One turn at a time per task; a model that fails answers with a
   * note from the catalog, nothing changes and the question is not kept. null: no such task.
   */
  async talk(id: string, text: string, tz?: unknown): Promise<OptimizerTalkReply | null> {
    const o = this.get(id)
    if (!o || o.state === 'refused') return null
    const said = text.replace(/\s+/g, ' ').trim().slice(0, TALK_CHARS)
    const replyLang: Lang = detectLang(said) ?? lang()
    const note = (k: 'talkFailed' | 'talkBusy'): OptimizerTalkReply => ({ reply: withLang(replyLang, () => tr(O)[k]), item: this.view(o), changed: [], failed: true })
    if (!said) return { reply: '', item: this.view(o), changed: [] }
    if (this.talking.has(id)) return note('talkBusy')
    if (Date.now() < (this.talkFailUntil.get(id) ?? 0) || !this.sys.logged()) return note('talkFailed')
    const zone = validTz(tz) ?? o.tz ?? serverTz()
    this.talking.add(id)
    try {
      let out: { reply?: unknown; patch?: unknown } | null = null
      try {
        out = parseJson(await smart(this.talkPrompt(o, said, zone, replyLang), TALK_TIMEOUT_MS))
      } catch (e) {
        console.error(`[auto] échange sur « ${o.title} » : ${(e as Error).message}`)
      }
      const reply = typeof out?.reply === 'string' ? oneLine(out.reply, 700) : ''
      if (!reply) {
        this.talkFailUntil.set(id, Date.now() + TALK_BACKOFF_MS)
        return note('talkFailed')
      }
      this.talkFailUntil.delete(id)
      // The task may have moved on while the model thought (accepted, started, ended): the rules of its state now.
      const now = Date.now()
      const changed = this.patch(o, parsePatch(out?.patch, { repos: this.w.allRepos(), tz: zone, now }))
      if (validTz(tz)) o.tz = zone
      o.talk = capTalk([...(o.talk ?? []), { who: 'user', text: said, at: now }, { who: 'auto', text: reply, at: Date.now() }])
      if (changed.length) {
        o.changed = { at: now, fields: changed }
        o.rev = (o.rev ?? 0) + 1
        console.log(`[auto] « ${o.title} » réécrite (${changed.join(', ')})`)
      }
      this.changed()
      if (changed.length && this.auto) setTimeout(() => this.tick(), 1000).unref?.()
      return { reply, item: this.view(o), changed }
    } finally {
      this.talking.delete(id)
    }
  }

  /** Applies a checked rewrite as the task's state allows; the fields that really changed (what the app flashes). */
  private patch(o: Stored, p: Patch): OptimizerField[] {
    if (o.state !== 'proposed' && o.state !== 'queued' && o.state !== 'running') return []
    const changed: OptimizerField[] = []
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
    for (const k of TERMS) {
      if (!(k in p) || same(o[k], p[k])) continue
      if (p[k] === null) delete o[k]
      else (o as unknown as Record<string, unknown>)[k] = p[k]
      changed.push(k)
    }
    for (const k of SCOPE) {
      if (!(k in p) || same(o[k], p[k])) continue
      // Running: its session already has its brief; the new scope waits for its next run.
      if (o.state === 'running') o.pending = { ...o.pending, [k]: p[k] }
      else {
        ;(o as unknown as Record<string, unknown>)[k] = p[k]
        changed.push(k)
      }
    }
    // A new scope before the first start: a fresh branch name follows the new title.
    if (o.state !== 'running' && (changed.includes('title') || changed.includes('repo')) && !o.startedAt) delete o.branch
    return changed
  }

  /** The prompt of one exchange turn (also read by the tests). */
  talkPrompt(o: Stored, said: string, tz: string, replyLang: Lang, now = Date.now()): string {
    const t = tr(O)
    const name = user()
    const when = [o.notBefore && o.notBefore > now ? t.whenNotBefore(fmtLocal(o.notBefore, tz)) : '', o.window ? t.whenWindow(windowText(o.window)) : ''].filter(Boolean).join(', ') || t.whenAsap
    const item = t.talkItem({
      title: o.title,
      why: o.why,
      kind: o.kind,
      repo: o.repo,
      est: o.est ?? 30,
      priority: o.priority ?? 2,
      heavy: o.heavy,
      when,
      every: o.every ? t.everyEvery(fmtSpan(o.every)) : t.everyOnce,
      prompt: o.prompt,
    })
    const history = (o.talk ?? []).map((l) => (l.who === 'user' ? t.lineUser(name, l.text) : t.lineAuto(l.text))).join('\n')
    const weekday = new Intl.DateTimeFormat(lang() === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', timeZone: tz }).format(now)
    const repos = this.w.allRepos().slice(0, 80).join(', ')
    const machine = t.machine(this.sys.cpus(), Math.round(os.totalmem() / 1024 ** 3), `${os.platform()} ${os.arch()}`)
    const rules = o.state === 'proposed' ? t.rules_proposed : o.state === 'queued' ? t.rules_queued : o.state === 'running' ? t.rules_running : t.rules_ended
    return t.talk({
      user: name,
      state: t[`state_${o.state}`],
      rules,
      item,
      live: this.liveText(o, now, tz),
      memory: this.memory.asText(),
      projects: this.projectsText(),
      repos,
      machine,
      now: `${weekday} ${fmtLocal(now, tz)} (${tz})`,
      history,
      said: t.lineUser(name, said),
      replyLang: t.langName(replyLang),
      appLang: t.langName(lang()),
    })
  }

  /** What a started task did: the agent's last words (running), its last news and report (over), its past runs. */
  private liveText(o: Stored, now: number, tz: string): string {
    const t = tr(O)
    const out: string[] = []
    if (o.state === 'running') {
      const d = o.sessionId ? this.w.detail?.(o.sessionId) : undefined
      let said = (d?.messages ?? [])
        .filter((m) => m.role === 'assistant' && m.text.trim())
        .slice(-2)
        .map((m) => m.text.replace(/\s+/g, ' ').trim().slice(0, 900))
      if (!said.length) {
        const s = o.sessionId ? this.w.snapshot().sessions.find((x) => x.id === o.sessionId) : undefined
        if (s?.lastMessage) said = [s.lastMessage.slice(0, 900)]
      }
      out.push(t.liveRunning(Math.round((now - (o.startedAt ?? now)) / 60_000), said.join('\n')))
    } else if (o.state === 'done' || o.state === 'failed') out.push(t.liveEnded(t[`state_${o.state}`], o.lastEvent ?? ''))
    if (o.state !== 'proposed') {
      const report = this.reportFile(o)
      try {
        const text = fs.readFileSync(report, 'utf8').trim().slice(0, 1500)
        if (text) out.push(t.liveReport(text))
      } catch {
        /* no report (yet) */
      }
    }
    if (o.runs?.length) out.push(t.liveRuns(o.runs.slice(-4).map((r) => t.runLine(fmtLocal(r.at, tz), r.ok, r.note ?? '')).join('\n')))
    return out.join('\n\n')
  }

  /** Where a task writes its report (beside its worktree, or in its workspace). */
  private reportFile(o: Stored): string {
    const cwd = this.workspace(o)
    return o.repo ? path.join(path.dirname(cwd), `${o.id}.md`) : path.join(cwd, 'report.md')
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
    // Claude at its limit (server/relay.ts): new tasks start on Codex when the relay is automatic, otherwise every
    // task waits for the reset time.
    const hold = this.w.relay?.holdUntil(now) ?? 0
    // Codex has no deny list: only on a machine where the jail holds (probed once), otherwise the tasks wait too.
    if (hold && this.bwrap === undefined && !this.probingJail) {
      this.probingJail = true
      void this.sys
        .jail(['--dev-bind', '/', '/', '--'])
        .catch(() => false)
        .then((ok) => {
          this.bwrap = ok
          this.probingJail = false
        })
    }
    const codex = !!hold && !!this.w.relay?.autoOnCodex() && this.bwrap === true
    if (hold && !codex)
      for (const o of queue)
        if (!o.held || (o.retryAt ?? 0) < hold) {
          o.held = true
          o.retryAt = hold
          dirty = true
        }
    // Stopped by a limit or an error: it waits for its retry time, the others go first. Same for one held by its
    // conditions (not before, its window, its next run).
    const later = (o: Stored) => !!o.retryAt && o.retryAt > now
    const ready = queue.filter((o) => !later(o) && this.timeAt(o, now) <= now)
    queue.forEach((o) => {
      const i = ready.indexOf(o)
      const wait = i < 0 ? (later(o) ? 'later' : 'time') : running || this.launching || i > 0 ? 'queue' : (reason ?? undefined)
      if (o.waiting !== wait) {
        if (wait) o.waiting = wait
        else delete o.waiting
        dirty = true
      }
    })
    if (dirty) this.changed()
    // Never without Claude logged in: the session would open on a login screen and sit there.
    if (!running && !this.launching && !reason && ready[0] && (codex || this.sys.logged())) void this.launch(ready[0], now, codex ? { tool: 'codex' } : undefined)
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
    const end = (state: 'done' | 'failed', note: string) => this.finish(o, now, state === 'done', note)
    const limit = runLimit(o.est)
    if (now - (o.startedAt ?? now) > limit) return end('failed', t.timedOut(Math.round(limit / 3600_000)))
    const sid = o.sessionId ? (this.w.sessionIdOf?.(o.sessionId) ?? o.sessionId) : undefined
    const s = sid ? this.w.snapshot().sessions.find((x) => x.id === sid) : undefined
    if (!s) return now - Math.max(o.seenAt ?? o.startedAt ?? now, this.bootAt) > VANISH_MS ? end('failed', t.vanished) : false
    if (o.sessionId !== s.id) o.sessionId = s.id
    o.seenAt = now
    if (s.status === 'working' || s.status === 'needs_user') {
      if (o.seenWorking || s.status !== 'working') return false
      o.seenWorking = true
      return true
    }
    // Handed over to Codex (told to stop before the limit, or cut by it): it waits for its plan's fate, or for Claude.
    if (this.w.relay?.holds(s.id)) return this.hold(o, now)
    const last = s.lastMessage ?? ''
    if (isStall(last)) return this.later(o, now, last)
    // Codex stopped the same way (its own limit, its login, its API).
    if (s.tool === 'codex' && s.status === 'interrupted' && s.interrupted && s.interrupted.reason !== 'died' && s.interrupted.reason !== 'dirty')
      return this.later(o, now, s.interrupted.reason === 'quota' ? 'usage limit' : s.interrupted.reason === 'auth' ? 'login expired' : 'api error')
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

  /**
   * A run is over. A one-off task ends there (done or failed). A recurring one keeps the run's line and goes back to
   * the queue for its next occurrence (with the scope agreed while it ran), unless its last runs all failed.
   */
  private finish(o: Stored, now: number, ok: boolean, note: string): true {
    o.endedAt = now
    o.lastEvent = note
    if (o.every) {
      o.runs = [...(o.runs ?? []), { at: now, ok, ...(note ? { note } : {}) }].slice(-MAX_RUNS)
      const streak = o.runs.slice(-MAX_FAILED_RUNS)
      if (ok || streak.length < MAX_FAILED_RUNS || streak.some((r) => r.ok)) {
        Object.assign(o, o.pending ?? {})
        delete o.pending
        o.state = 'queued'
        o.notBefore = Math.max(nextRun(o.startedAt ?? now, o.every, now), o.notBefore ?? 0)
        delete o.waiting
        delete o.retryAt
        delete o.tries
        delete o.seenWorking
        delete o.seenAt
        console.log(`[auto] « ${o.title} » ${ok ? 'faite' : 'échouée'} · prochain passage ${new Date(o.notBefore).toISOString()}`)
        return true
      }
    }
    delete o.pending
    o.state = ok ? 'done' : 'failed'
    return true
  }

  /** Stopped by a limit, a login or an API error: no work was done, it goes back to the queue for later (a few tries). */
  private later(o: Stored, now: number, why: string): boolean {
    o.tries = (o.tries ?? 0) + 1
    o.lastEvent = tr(O)[`stall_${stallKind(why)}`]
    if (o.tries >= MAX_TRIES) {
      console.log(`[auto] « ${o.title} » abandonnée après ${o.tries} essais (${oneLine(why, 160)})`)
      return this.finish(o, now, false, o.lastEvent)
    }
    o.state = 'queued'
    // A usage limit with a known reset time: back then, not in an hour.
    const hold = stallKind(why) === 'limit' && o.tool !== 'codex' ? (this.w.relay?.holdUntil(now) ?? 0) : 0
    o.retryAt = hold || now + RETRY_MS
    if (hold) o.held = true
    o.waiting = 'later'
    console.log(`[auto] « ${o.title} » arrêtée (${oneLine(why, 160)}) · nouvel essai dans ${Math.round((o.retryAt - now) / 60_000)} min`)
    return true
  }

  /** The task's session is handed over to Codex: back in the queue, its worktree kept, until its plan is approved or Claude is back. */
  private hold(o: Stored, now: number): boolean {
    o.state = 'queued'
    o.held = true
    o.retryAt = this.w.relay?.holdUntil(now) || now + RETRY_MS
    o.waiting = 'later'
    o.lastEvent = tr(O).stall_limit
    console.log(`[auto] « ${o.title} » attend le relais Codex ou le retour de Claude`)
    return true
  }

  /** The session of one of the tasks (its current or last run). */
  owns(sessionId: string): boolean {
    return this.s.items.some((o) => !!o.sessionId && (o.sessionId === sessionId || this.w.sessionIdOf?.(o.sessionId) === sessionId))
  }

  /** Claude is back (or gone): tasks that waited for it are released, and the queue is looked at now. */
  poke() {
    if (!(this.w.relay?.holdUntil() ?? 0))
      for (const o of this.s.items)
        if (o.held) {
          delete o.held
          if (o.state === 'queued') delete o.retryAt
        }
    this.changed()
    if (this.auto) setTimeout(() => this.tick(), 1000).unref?.()
  }

  /**
   * The approved takeover plan of a task's session (server/relay.ts): the task restarts on Codex in the same worktree,
   * behind the same barriers. Returns the new session; throws when it cannot start (the task then waits for Claude).
   */
  async relayRun(sessionId: string, text: string): Promise<string> {
    const o = this.s.items.find((x) => !!x.sessionId && (x.sessionId === sessionId || this.w.sessionIdOf?.(x.sessionId) === sessionId))
    if (!o || (o.state !== 'queued' && o.state !== 'running')) throw new Error(tr(O).vanished)
    if (!(await this.sys.jail(['--dev-bind', '/', '/', '--']))) throw new Error(tr(O).noJail)
    await this.launch(o, Date.now(), { tool: 'codex', relay: text })
    if (o.state !== 'running' || !o.sessionId) throw new Error(o.lastEvent || tr(O).startFailed)
    return o.sessionId
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

  /**
   * The jail of a task (jailArgs), tried before the session starts: bwrap's command prefix, or [] on a machine without
   * bwrap (macOS…), where the environment barriers and the deny list are all there is. A jail that fails stops the task.
   */
  private async jail(o: Stored, cwd: string, guard: string, show: string[] = []): Promise<string[]> {
    const uid = os.userInfo().uid
    const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`
    const tmp = process.env.TMUX_TMPDIR || '/tmp'
    const repoGit = o.repo ? path.join(this.w.repoDir(o.repo), '.git') : undefined
    const args = jailArgs({
      home: os.homedir(),
      hide: [DATA_DIR, runtime, path.join(tmp, `tmux-${uid}`), path.join(os.tmpdir(), `zellij-${uid}`)],
      roots: PROJECT_ROOTS,
      // The task's folder: its worktree and the report beside it, or its workspace; the guard's empty configs.
      rw: [o.repo ? path.dirname(cwd) : cwd, guard],
      git: repoGit && fs.statSync(repoGit, { throwIfNoEntry: false })?.isDirectory() ? repoGit : undefined,
      show,
    })
    if (await this.sys.jail(args)) return ['bwrap', ...args]
    if (!this.noJailSaid) console.log("[auto] bwrap absent : les tâches tournent sans prison (barrières d'environnement et interdits seuls)")
    this.noJailSaid = true
    return []
  }

  /** Starts a task in a Claude session: in its own worktree of its repo (on a fresh local branch), or in its workspace. */
  private async launch(o: Stored, now: number, on: { tool?: 'claude' | 'codex'; /** the approved takeover plan, first in the brief */ relay?: string } = {}) {
    const tool = on.tool ?? 'claude'
    this.launching = true
    o.state = 'running'
    o.startedAt = now
    o.tool = tool
    delete o.waiting
    delete o.lastEvent
    delete o.retryAt
    delete o.held
    delete o.seenWorking
    delete o.seenAt
    delete o.sessionId
    this.changed()
    let step: 'branch' | 'jail' | 'start' = 'start'
    try {
      const cwd = this.workspace(o)
      // A retry or the next run of a recurring task finds its worktree already there (same branch).
      const fresh = !!o.repo && !fs.existsSync(cwd)
      const branch = (!fresh && o.branch) || `auto/${slug(o.title)}-${o.id.slice(0, 4)}`
      if (o.repo && fresh) {
        step = 'branch'
        fs.mkdirSync(path.dirname(cwd), { recursive: true })
        await this.sys.worktree(this.w.repoDir(o.repo), cwd, branch)
        step = 'start'
      } else fs.mkdirSync(cwd, { recursive: true })
      if (o.repo) o.branch = branch
      const writesReport = !o.repo || o.kind === 'watch' || o.kind === 'content' || o.kind === 'explore'
      const brief = tr(O).brief({
        title: o.title,
        branch,
        checkout: o.repo ? this.w.repoDir(o.repo) : '',
        // Beside the worktree, never in it (the branch stays the work itself).
        report: this.reportFile(o),
        inRepo: !!o.repo,
        writesReport,
        heavy: o.heavy,
        prompt: o.prompt,
        minutes: o.est ?? 60,
        agreed: agreedDigest(o.talk, { user: tr(O).agreedUser, auto: tr(O).agreedAuto }),
      })
      const text = on.relay ? `${on.relay}\n\n${tr(O).relayRules}\n${brief}` : brief
      const guard = this.guard()
      step = 'jail'
      // Codex has no deny list: its tasks run only inside the jail (which keeps its login, nothing else of the user's).
      const wrap = await this.jail(o, cwd, guard, tool === 'codex' ? ['.codex'] : [])
      if (tool === 'codex' && !wrap.length) throw new Error(tr(O).noJail)
      step = 'start'
      const { id } = tool === 'codex' ? await this.w.createIn(cwd, o.title, text, [], { ...guardEnv(guard), wrap }, 'codex') : await this.w.createIn(cwd, o.title, text, SAFETY_ARGS, { ...guardEnv(guard), wrap })
      o.sessionId = id
      o.seenAt = Date.now()
      console.log(`[auto] lancée : ${o.title} (${cwd})${tool === 'codex' ? ' · sur Codex (Claude à sa limite)' : ''}`)
    } catch (e) {
      // The app shows a short note; the raw error (tmux, git) stays in the log.
      this.finish(o, Date.now(), false, step === 'branch' ? tr(O).branchFailed : tr(O).startFailed)
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

/** POST /api/optimizers/:id/accept { rev? } · POST /api/optimizers/:id/refuse · POST /api/optimizers/:id/talk { text, tz? } → OptimizerTalkReply */
export function optimizerRoutes(o: Optimizers, json: Json, readBody: ReadBody): [string, RegExp, Handler][] {
  return [
    ['POST', /^\/api\/optimizers\/([\w-]+)\/accept$/, async (req, res, _u, [id]) => {
      const body = await readBody(req).catch(() => ({}))
      const rev = Number.isInteger(body?.rev) ? Number(body.rev) : undefined
      const ok = o.accept(id, rev)
      json(res, ok === true ? 200 : ok === 'busy' ? 409 : 404, { ok: ok === true })
    }],
    ['POST', /^\/api\/optimizers\/([\w-]+)\/talk$/, async (req, res, _u, [id]) => {
      const body = await readBody(req)
      const r = await o.talk(id, String(body?.text ?? ''), body?.tz)
      json(res, r ? 200 : 404, r ?? { reply: '', changed: [], failed: true })
    }],
    ['POST', /^\/api\/optimizers\/([\w-]+)\/refuse$/, (_req, res, _u, [id]) => {
      const ok = o.refuse(id)
      json(res, ok ? 200 : 404, { ok })
    }],
  ]
}
