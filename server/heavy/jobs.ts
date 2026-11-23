// Heavy jobs between the user's machines. Two halves, both in every weevilsd:
//
// - The runner (any machine): takes a job another machine of the user's sends it, through the link weevils already
//   has between them (the main machine reaches the others over their reverse SSH tunnel, with their local token). It
//   keeps one copy of each repository (a bare clone fed by git bundles, a working folder whose node_modules stays
//   from one job to the next), checks out the session's exact working tree, installs dependencies when the lockfile
//   changed, runs the command in its own queue, and hands back the output, the exit code, and the files the job wrote.
// - The hub (the main machine): says which machines can take a job now (online, not turned off in Your factory,
//   sharing on, and idle: nothing heavy running or waiting there, load under half its cores), and passes the job's
//   requests to the machine chosen. Never a conversation: only the command, and its result back to the session.
import { execFile, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { acquire, cores, freeMemMb, heavyDir, status } from './queue.ts'
import os from 'node:os'

type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Route = [string, RegExp, Handler]

export interface Capacity {
  cores: number
  load: number
  memMb: number
  running: number
  waiting: number
  /** This machine takes jobs from the others (WEEVILS_TAKE_JOBS=0: never). */
  takes: boolean
  idle: boolean
}

export function capacity(env: NodeJS.ProcessEnv = process.env, dir = heavyDir(env)): Capacity {
  const q = status(dir)
  const c = cores()
  const load = Math.round(os.loadavg()[0] * 100) / 100
  const memMb = freeMemMb()
  const takes = env.WEEVILS_TAKE_JOBS !== '0'
  return { cores: c, load, memMb, running: q.running.length, waiting: q.waiting.length, takes, idle: isIdle({ takes, running: q.running.length, waiting: q.waiting.length, load, cores: c, memMb }) }
}

/** Idle enough to take someone else's job: nothing heavy of its own, load under half its cores, 2 GB free. */
export const isIdle = (c: Omit<Capacity, 'idle'>) => c.takes && c.running === 0 && c.waiting === 0 && c.load < c.cores / 2 && c.memMb >= 2048

// ---------------------------------------------------------------- the runner

export type Phase = 'waiting' | 'preparing' | 'running' | 'done' | 'failed'

interface Job {
  id: string
  key: string
  commit: string
  dir: string
  argv: string[]
  from: string
  phase: Phase
  code: number | null
  /** Set when the job never reached the command (the sender runs it itself then). */
  setupError?: string
  log: string
  started: number
  ended?: number
  files?: string
  child?: ReturnType<typeof spawn>
  stopped?: boolean
}

const SAFE_KEY = /^[A-Za-z0-9_.-]{1,80}$/
const SHA = /^[0-9a-f]{40,64}$/

const run = (cmd: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; onOut?: (s: string) => void; job?: Job } = {}) =>
  new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    if (o.job) o.job.child = child
    const out = (b: Buffer) => o.onOut?.(b.toString('utf8'))
    child.stdout.on('data', out)
    child.stderr.on('data', out)
    child.on('error', (e) => {
      o.onOut?.(`${e.message}\n`)
      resolve(127)
    })
    child.on('close', (code, sig) => resolve(code ?? (sig ? 128 + (os.constants.signals[sig] ?? 1) : 1)))
  })

const capture = async (cmd: string, args: string[], cwd?: string) => {
  let s = ''
  const code = await run(cmd, args, { cwd, onOut: (x) => (s += x) })
  if (code !== 0) throw new Error(s.trim().split('\n').slice(-3).join(' ') || `${cmd} ${code}`)
  return s.trim()
}

/** Dependencies to install in a folder of the checkout: the lockfile and its installer. */
export function installerFor(dir: string): { lock: string; argv: string[] } | null {
  const has = (f: string) => fs.existsSync(path.join(dir, f))
  if (!has('package.json')) return null
  if (has('package-lock.json')) return { lock: 'package-lock.json', argv: ['npm', 'ci', '--no-audit', '--no-fund'] }
  if (has('pnpm-lock.yaml')) return { lock: 'pnpm-lock.yaml', argv: ['pnpm', 'install', '--frozen-lockfile'] }
  if (has('yarn.lock')) return { lock: 'yarn.lock', argv: ['yarn', 'install', '--frozen-lockfile'] }
  if (has('bun.lock')) return { lock: 'bun.lock', argv: ['bun', 'install', '--frozen-lockfile'] }
  if (has('bun.lockb')) return { lock: 'bun.lockb', argv: ['bun', 'install', '--frozen-lockfile'] }
  return null
}

/** The files a job wrote in its folder (outside .git and node_modules), newer than its start: what goes back. */
export function writtenSince(root: string, since: number, max = 20_000): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    if (out.length >= max) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(r)
      else if (e.isFile()) {
        try {
          if (fs.statSync(path.join(root, r)).mtimeMs >= since) out.push(r)
        } catch {
          /* gone */
        }
      }
    }
  }
  walk('')
  return out
}

/**
 * The PATH the user's own terminal has (their login shell's: ~/.cargo/bin, nvm…) ahead of weevilsd's. Asked with
 * `printenv`, a program and not shell syntax, so any login shell answers it the same way (fish included, CachyOS's).
 */
export function loginPath(shell: string, own = process.env.PATH ?? ''): Promise<string> {
  return new Promise((resolve) => {
    execFile(shell, ['-lc', 'printenv PATH'], { timeout: 8000, env: { ...process.env, WEEVILS_HEAVY: '1' } }, (_e, out) => {
      const login = String(out ?? '').trim().split('\n').pop() ?? ''
      resolve([...new Set([...login.split(':'), ...own.split(':')].filter((d) => d.startsWith('/')))].join(':'))
    })
  })
}

export interface RunnerOptions {
  /** Where the copies of the repositories live (default ~/.cache/weevils-jobs). */
  dir?: string
  env?: NodeJS.ProcessEnv
  /** The user's login shell, so the job finds the tools the user has (~/.cargo/bin…). */
  shell?: string
  maxBundle?: number
  maxFiles?: number
}

export class Runner {
  private jobs = new Map<string, Job>()
  readonly dir: string
  private env: NodeJS.ProcessEnv
  private shell: string
  private path?: Promise<string>
  readonly maxBundle: number
  private maxFiles: number

  constructor(o: RunnerOptions = {}) {
    this.env = o.env ?? process.env
    this.dir = o.dir ?? path.join(this.env.XDG_CACHE_HOME || path.join(this.env.HOME || os.homedir(), '.cache'), 'weevils-jobs')
    this.shell = o.shell ?? (this.env.SHELL || '/bin/sh')
    this.maxBundle = o.maxBundle ?? 600 << 20
    this.maxFiles = o.maxFiles ?? 300 << 20
    // Working folders claimed by jobs of an earlier run of weevilsd: free again.
    try {
      for (const e of fs.readdirSync(this.dir, { withFileTypes: true })) {
        const p = path.join(this.dir, e.name)
        if (e.isFile() && e.name.endsWith('.tgz')) fs.rmSync(p, { force: true })
        else if (e.isDirectory()) for (const f of fs.readdirSync(p)) if (f.endsWith('.busy')) fs.rmSync(path.join(p, f), { recursive: true, force: true })
      }
    } catch {
      /* nothing yet */
    }
  }

  /** The tools the job finds: the user's login PATH (asked once), then weevilsd's. */
  private userPath() {
    return (this.path ??= loginPath(this.shell, this.env.PATH))
  }

  private repo(key: string) {
    return path.join(this.dir, key, 'repo.git')
  }

  /** The commits this machine has for the repository (newest first), so the sender bundles only what is missing. */
  async have(key: string): Promise<string[]> {
    const repo = this.repo(key)
    if (!fs.existsSync(repo)) return []
    const out = await capture('git', ['-C', repo, 'for-each-ref', '--sort=-committerdate', '--count=20', '--format=%(objectname)', 'refs/jobs/']).catch(() => '')
    return out.split('\n').filter(Boolean)
  }

  /** Takes a bundle in: its commit is kept under refs/jobs/<commit> (the last 20 stay). */
  async receive(key: string, ref: string, commit: string, body: NodeJS.ReadableStream): Promise<void> {
    const repo = this.repo(key)
    if (!fs.existsSync(repo)) {
      fs.mkdirSync(repo, { recursive: true })
      await capture('git', ['init', '-q', '--bare', repo])
    }
    const file = path.join(this.dir, key, `in-${crypto.randomBytes(6).toString('hex')}.bundle`)
    try {
      await new Promise<void>((resolve, reject) => {
        let size = 0
        const w = fs.createWriteStream(file)
        body.on('data', (b: Buffer) => {
          size += b.length
          if (size > this.maxBundle) {
            ;(body as unknown as http.IncomingMessage).destroy?.()
            reject(new Error('bundle too large')) // i18n-ignore: machine-to-machine answer
          }
        })
        body.pipe(w)
        w.on('finish', resolve)
        w.on('error', reject)
        body.on('error', reject)
      })
      await capture('git', ['-C', repo, 'fetch', '-q', file, `+${ref}:refs/jobs/${commit}`])
      const refs = (await capture('git', ['-C', repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/jobs/'])).split('\n').filter(Boolean)
      for (const r of refs.slice(20)) await capture('git', ['-C', repo, 'update-ref', '-d', r]).catch(() => undefined)
    } finally {
      fs.rmSync(file, { force: true })
    }
  }

  start(b: { key: string; commit: string; dir: string; argv: string[]; from: string }): Job {
    const id = crypto.randomBytes(9).toString('hex')
    const job: Job = { id, key: b.key, commit: b.commit, dir: b.dir, argv: b.argv, from: b.from, phase: 'waiting', code: null, log: '', started: Date.now() }
    this.jobs.set(id, job)
    void this.work(job)
    this.prune()
    return job
  }

  get(id: string) {
    return this.jobs.get(id)
  }

  stop(id: string) {
    const j = this.jobs.get(id)
    if (!j) return false
    j.stopped = true
    if (j.child?.pid) {
      try {
        process.kill(-j.child.pid, 'SIGTERM')
      } catch {
        /* gone */
      }
    }
    return true
  }

  private prune(now = Date.now()) {
    for (const [id, j] of this.jobs) {
      if (j.ended && now - j.ended > 3600_000) {
        if (j.files) fs.rmSync(j.files, { force: true })
        this.jobs.delete(id)
      }
    }
  }

  /** A working folder of the repository nobody else uses right now (one per job running at once). */
  private claim(key: string): { work: string; free: () => void } {
    for (let n = 1; ; n++) {
      const work = path.join(this.dir, key, n === 1 ? 'work' : `work-${n}`)
      try {
        fs.mkdirSync(`${work}.busy`)
      } catch {
        continue
      }
      return { work, free: () => fs.rmSync(`${work}.busy`, { recursive: true, force: true }) }
    }
  }

  /** A job's environment: weevilsd's, without what is weevilsd's own (NODE_ENV=production in its service would make
   *  `npm ci` skip the dev dependencies every test run needs), the user's tools first in PATH. */
  private async jobEnv(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...this.env, PATH: await this.userPath(), WEEVILS_HEAVY: '1' }
    delete env.NODE_ENV
    return env
  }

  private async work(job: Job) {
    const say = (s: string) => {
      job.log += s
      if (job.log.length > 8 << 20) job.log = job.log.slice(-(8 << 20))
    }
    const slot = await acquire({ cmd: job.argv.join(' '), cwd: job.key, from: job.from, dir: heavyDir(this.env) }).catch(() => null)
    const repo = this.repo(job.key)
    const { work, free } = this.claim(job.key)
    try {
      if (job.stopped) throw Object.assign(new Error('stopped'), { setup: true }) // i18n-ignore: machine-to-machine
      job.phase = 'preparing'
      try {
        if (!fs.existsSync(path.join(work, '.git'))) {
          fs.rmSync(work, { recursive: true, force: true })
          await capture('git', ['-C', repo, 'worktree', 'prune'])
          await capture('git', ['-C', repo, 'worktree', 'add', '-q', '--detach', '--force', work, job.commit])
        } else {
          await capture('git', ['-C', work, 'checkout', '-q', '-f', '--detach', job.commit])
          await capture('git', ['-C', work, 'clean', '-q', '-ffdx', '-e', 'node_modules'])
        }
        const cwd = path.join(work, job.dir)
        if (!cwd.startsWith(work) || !fs.existsSync(cwd)) throw new Error(`no folder ${job.dir}`) // i18n-ignore: machine-to-machine
        // Dependencies: at the top and in the job's folder, installed again only when their lockfile changed.
        for (const d of [...new Set([work, cwd])]) {
          const inst = installerFor(d)
          if (!inst) continue
          // « 2 »: installs made before NODE_ENV was left out lack the dev dependencies, so they are made again.
          const sum = `2:${crypto.createHash('sha256').update(fs.readFileSync(path.join(d, inst.lock))).digest('hex')}`
          const stamp = path.join(this.dir, job.key, `deps-${crypto.createHash('sha1').update(d).digest('hex').slice(0, 12)}`)
          if (fs.existsSync(path.join(d, 'node_modules')) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === sum) continue
          const code = await run(inst.argv[0], inst.argv.slice(1), { cwd: d, env: await this.jobEnv(), onOut: say, job })
          if (code !== 0) throw new Error(`${inst.argv.join(' ')}: exit ${code}`) // i18n-ignore: machine-to-machine
          fs.writeFileSync(stamp, sum)
        }
      } catch (e) {
        throw Object.assign(e as Error, { setup: true })
      }
      if (job.stopped) throw Object.assign(new Error('stopped'), { setup: true }) // i18n-ignore: machine-to-machine
      job.phase = 'running'
      const since = Date.now() - 1000
      job.code = await run('nice', ['-n', String(Math.max(0, 10 - os.getPriority())), ...job.argv], { cwd: path.join(work, job.dir), env: await this.jobEnv(), onOut: say, job })
      // What the job wrote (a build's output, an updated snapshot), packed for the sender.
      const files = writtenSince(work, since)
      if (files.length) {
        const list = path.join(this.dir, job.key, `${job.id}.list`)
        const tgz = path.join(this.dir, `${job.id}.tgz`)
        fs.writeFileSync(list, files.join('\n'))
        const code = await run('tar', ['czf', tgz, '-C', work, '-T', list])
        fs.rmSync(list, { force: true })
        if (code === 0 && fs.statSync(tgz).size <= this.maxFiles) job.files = tgz
        else fs.rmSync(tgz, { force: true })
      }
      job.phase = 'done'
    } catch (e) {
      const err = e as Error & { setup?: boolean }
      job.phase = 'failed'
      if (err.setup) job.setupError = err.message
      say(`\n${err.message}\n`)
      job.code = job.code ?? 1
    } finally {
      job.child = undefined
      job.ended = Date.now()
      free()
      slot?.release()
    }
  }
}

async function readJson(req: http.IncomingMessage, max = 1 << 20): Promise<any> {
  let s = ''
  for await (const c of req) {
    s += c
    if (s.length > max) throw new Error('too large') // i18n-ignore: machine-to-machine answer
  }
  return s ? JSON.parse(s) : {}
}

/** The runner's routes: this machine's own tools and the main machine (through the tunnel), never the phone. */
export function runnerRoutes(r: Runner, json: Json, trusted: (req: http.IncomingMessage) => boolean, env: NodeJS.ProcessEnv = process.env, cap: () => Capacity = () => capacity(env)): Route[] {
  const guard = (h: Handler): Handler => (req, res, url, p) => (trusted(req) ? h(req, res, url, p) : json(res, 403, { error: 'local only' })) // i18n-ignore: machine-to-machine answer
  return [
    ['GET', /^\/api\/jobs\/capacity$/, guard((_q, res) => json(res, 200, cap()))],
    ['GET', /^\/api\/jobs\/repo\/([^/]+)$/, guard(async (_q, res, _u, [key]) => {
      if (!SAFE_KEY.test(key)) return json(res, 400, { error: 'bad key' }) // i18n-ignore: machine-to-machine answer
      json(res, 200, { have: await r.have(key) })
    })],
    ['POST', /^\/api\/jobs\/repo\/([^/]+)$/, guard(async (req, res, url, [key]) => {
      const ref = url.searchParams.get('ref') ?? ''
      const commit = url.searchParams.get('commit') ?? ''
      if (!SAFE_KEY.test(key) || !/^refs\/weevils-heavy\/[A-Za-z0-9_-]+$/.test(ref) || !SHA.test(commit)) return json(res, 400, { error: 'bad request' }) // i18n-ignore: machine-to-machine answer
      if (!cap().takes) return json(res, 409, { error: 'not taking jobs' }) // i18n-ignore: machine-to-machine answer
      await r.receive(key, ref, commit, req)
      json(res, 200, { ok: true })
    })],
    ['POST', /^\/api\/jobs\/run$/, guard(async (req, res) => {
      const b = await readJson(req)
      const argv = Array.isArray(b.argv) ? (b.argv as unknown[]).map(String) : []
      const dir = String(b.dir ?? '')
      if (!SAFE_KEY.test(String(b.key)) || !SHA.test(String(b.commit)) || !argv.length || argv.length > 200 || dir.split('/').includes('..') || path.isAbsolute(dir)) return json(res, 400, { error: 'bad request' }) // i18n-ignore: machine-to-machine answer
      if (!cap().takes) return json(res, 409, { error: 'not taking jobs' }) // i18n-ignore: machine-to-machine answer
      const j = r.start({ key: b.key, commit: b.commit, dir, argv, from: String(b.from ?? '').slice(0, 40) })
      json(res, 200, { id: j.id })
    })],
    ['GET', /^\/api\/jobs\/run\/([0-9a-f]+)$/, guard((_q, res, url, [id]) => {
      const j = r.get(id)
      if (!j) return json(res, 404, { error: 'no such job' }) // i18n-ignore: machine-to-machine answer
      const from = Math.max(0, Number(url.searchParams.get('from')) || 0)
      json(res, 200, { phase: j.phase, out: j.log.slice(from), next: j.log.length, code: j.code, files: !!j.files, ...(j.setupError ? { setupError: j.setupError } : {}) })
    })],
    ['GET', /^\/api\/jobs\/run\/([0-9a-f]+)\/files$/, guard((_q, res, _u, [id]) => {
      const j = r.get(id)
      if (!j?.files || !fs.existsSync(j.files)) return json(res, 404, { error: 'no files' }) // i18n-ignore: machine-to-machine answer
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': fs.statSync(j.files).size })
      fs.createReadStream(j.files).pipe(res)
    })],
    ['POST', /^\/api\/jobs\/run\/([0-9a-f]+)\/stop$/, guard((_q, res, _u, [id]) => json(res, r.stop(id) ? 200 : 404, { ok: true }))],
  ]
}

// ---------------------------------------------------------------- the hub (main machine)

export interface HubRemote {
  id: string
  url: string
  online: boolean
  machineId: () => string
  headers: () => Record<string, string>
}

export interface HubDeps {
  remotes: () => HubRemote[]
  /** Names as the snapshot has them (renamed in Your factory included). */
  name: (machineId: string) => string
  /** Sharing on (Your factory, Machines: on unless turned off). */
  share: () => boolean
  /** Machines turned off in Your factory: they get no job. */
  off: () => string[]
  fetch?: typeof fetch
}

const JOB_PATH = /^(capacity|repo\/[A-Za-z0-9_.-]{1,80}|run|run\/[0-9a-f]{1,64}(\/files|\/stop)?)$/

export class Hub {
  private caps = new Map<string, { at: number; c: Capacity | null }>()
  /** Jobs away now, by machine: what Your factory's line counts. */
  private away = new Map<string, { machine: string; seen: number; done: boolean }>()
  private d: HubDeps
  constructor(d: HubDeps) {
    this.d = d
  }

  private get f() {
    return this.d.fetch ?? fetch
  }

  async helpers(now = Date.now()) {
    if (!this.d.share()) return []
    const off = new Set(this.d.off())
    const list = this.d.remotes().filter((r) => r.online && !off.has(r.machineId()))
    return Promise.all(
      list.map(async (r) => {
        const id = r.machineId()
        let hit = this.caps.get(id)
        if (!hit || now - hit.at > 4000) {
          const c = await this.f(`${r.url}/api/jobs/capacity`, { headers: r.headers(), signal: AbortSignal.timeout(3000) })
            .then((x) => (x.ok ? (x.json() as Promise<Capacity>) : null))
            .catch(() => null)
          hit = { at: now, c }
          this.caps.set(id, hit)
        }
        // A job already sent there and not finished counts as busy, even before its machine's queue shows it.
        const sent = [...this.away.values()].some((a) => a.machine === id && !a.done)
        return { id, name: this.d.name(id), idle: !!hit.c?.idle && !sent }
      }),
    )
  }

  /** Jobs running elsewhere now, and where (for Your factory). */
  awayNow(now = Date.now()) {
    for (const [k, a] of this.away) if (a.done || now - a.seen > 120_000) this.away.delete(k)
    const by = new Map<string, number>()
    for (const a of this.away.values()) by.set(a.machine, (by.get(a.machine) ?? 0) + 1)
    return [...by].map(([machine, n]) => ({ machine, name: this.d.name(machine), n }))
  }

  /** Passes one request of the job's protocol to the machine (its body streamed: a bundle can be large). */
  async pass(req: http.IncomingMessage, res: http.ServerResponse, machine: string, rest: string, search: string) {
    // Only the job protocol's own requests go through (nothing else of the other machine's API).
    if (!JOB_PATH.test(rest)) return void (res.writeHead(404, { 'content-type': 'application/json' }), res.end('{"error":"unknown"}'))
    const r = this.d.remotes().find((x) => x.online && x.machineId() === machine)
    if (!r || !this.d.share() || this.d.off().includes(machine)) return void (res.writeHead(409, { 'content-type': 'application/json' }), res.end('{"error":"machine not available"}'))
    const upload = req.method === 'POST' && rest.startsWith('repo/')
    const body = req.method === 'POST' ? (req as unknown as ReadableStream) : undefined
    const init: RequestInit & { duplex?: 'half' } = {
      method: req.method,
      headers: { ...r.headers(), 'content-type': String(req.headers['content-type'] ?? 'application/json') },
      body: body as RequestInit['body'],
      signal: AbortSignal.timeout(upload ? 15 * 60_000 : 30_000),
      ...(body ? { duplex: 'half' } : {}),
    }
    let up: Response
    try {
      up = await this.f(`${r.url}/api/jobs/${rest}${search}`, init)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify({ error: (e as Error).message }))
    }
    const buf = Buffer.from(await up.arrayBuffer())
    if (up.ok && req.method === 'POST' && rest === 'run') {
      try {
        const id = JSON.parse(buf.toString()).id as string
        if (id) this.away.set(id, { machine, seen: Date.now(), done: false })
      } catch {
        /* not json */
      }
    }
    const polled = /^run\/([0-9a-f]+)$/.exec(rest)
    if (polled && this.away.has(polled[1])) {
      const a = this.away.get(polled[1])!
      a.seen = Date.now()
      try {
        const p = JSON.parse(buf.toString()).phase as Phase
        if (p === 'done' || p === 'failed') a.done = true
      } catch {
        /* not json */
      }
    }
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/octet-stream', 'content-length': buf.length })
    res.end(buf)
  }
}

export function hubRoutes(h: Hub, json: Json, trusted: (req: http.IncomingMessage) => boolean, here: () => { id: string; name: string }): Route[] {
  const guard = (fn: Handler): Handler => (req, res, url, p) => (trusted(req) ? fn(req, res, url, p) : json(res, 403, { error: 'local only' })) // i18n-ignore: machine-to-machine answer
  return [
    ['GET', /^\/api\/jobs\/helpers$/, guard(async (_q, res) => json(res, 200, { here: here(), helpers: await h.helpers() }))],
    ...(['GET', 'POST'] as const).map((m): Route => [m, /^\/api\/jobs\/at\/([^/]+)\/(.+)$/, guard((req, res, url, [machine, rest]) => h.pass(req, res, decodeURIComponent(machine), rest, url.search))]),
  ]
}
