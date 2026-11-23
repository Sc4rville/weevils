// End to end, on this machine: a session's heavy command, with every slot here taken, runs on « the PC » (a second
// weevilsd's runner, reached through the main machine's hub), on the session's exact working tree, and its output,
// exit code and written files come back. Then: the PC can't prepare the job → it runs here after all.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hub, hubRoutes, isIdle, Runner, runnerRoutes, writtenSince, type Capacity } from './jobs.ts'
import { bundle, snapshot } from './snapshot.ts'

type Route = [string, RegExp, (req: http.IncomingMessage, res: http.ServerResponse, url: URL, p: string[]) => unknown]
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
function serve(routes: Route[]): Promise<{ url: string; close: () => void }> {
  const s = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    for (const [m, re, h] of routes) {
      const hit = re.exec(url.pathname)
      if (hit && m === req.method) return void (await h(req, res, url, hit.slice(1)))
    }
    json(res, 404, {})
  })
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() })))
}
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim()

let root: string
let repo: string
let pc: { url: string; close: () => void }
let main: { url: string; close: () => void }
let takes = true
const free: Capacity = { cores: 8, load: 0.2, memMb: 9000, running: 0, waiting: 0, takes: true, idle: true }

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-jobs-'))
  repo = path.join(root, 'shop-app')
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, '.gitignore'), 'out/\nsecret.env\n')
  fs.writeFileSync(path.join(repo, 'pkg', 'note.txt'), 'committed\n')
  // The job: says where it runs, reads the session's uncommitted change and new file, writes a build output.
  fs.writeFileSync(path.join(repo, 'pkg', 'job.sh'), 'echo "heavy=$WEEVILS_HEAVY"; cat note.txt new.txt; [ -f ../secret.env ] && echo LEAK; mkdir -p ../out && echo built > ../out/result.txt; exit 3\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'first')
  fs.writeFileSync(path.join(repo, 'pkg', 'note.txt'), 'changed, not committed\n')
  fs.writeFileSync(path.join(repo, 'pkg', 'new.txt'), 'new, untracked\n')
  fs.writeFileSync(path.join(repo, 'secret.env'), 'TOKEN=x\n')

  const pcEnv = { ...process.env, HOME: path.join(root, 'pc-home'), WEEVILS_HEAVY_DIR: path.join(root, 'pc-queue') }
  fs.mkdirSync(pcEnv.HOME, { recursive: true })
  const runner = new Runner({ dir: path.join(root, 'pc-cache'), env: pcEnv, shell: '/bin/sh' })
  pc = await serve(runnerRoutes(runner, json, () => true, pcEnv, () => ({ ...free, takes, idle: takes })) as Route[])
  const hub = new Hub({
    remotes: () => [{ id: 'pc', url: pc.url, online: true, machineId: () => 'pc-id', headers: () => ({}) }],
    name: () => 'the PC',
    share: () => true,
    off: () => [],
  })
  main = await serve(hubRoutes(hub, json, () => true, () => ({ id: 'vps-id', name: 'the VPS' })) as Route[])
})
afterAll(() => {
  pc?.close()
  main?.close()
  fs.rmSync(root, { recursive: true, force: true })
})

/** weevils-heavy, as a session runs it, with this machine's only slot taken by `holder`. */
function cli(holder: number, home: string) {
  const q = path.join(home, 'queue')
  fs.mkdirSync(q, { recursive: true })
  fs.writeFileSync(path.join(q, '00000000000001-1-held.json'), JSON.stringify({ pid: holder, at: 1, cmd: 'npm run check', cwd: '/elsewhere', state: 'running' }))
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(import.meta.dirname, 'cli.ts'), '--', 'sh', 'job.sh'], {
      cwd: path.join(repo, 'pkg'),
      env: { ...process.env, HOME: home, WEEVILS_PORT: new URL(main.url).port, WEEVILS_HEAVY_DIR: q, WEEVILS_HEAVY_SLOTS: '1', WEEVILS_HEAVY: '' },
    })
    let out = ''
    let err = ''
    p.stdout.on('data', (b) => (out += b))
    p.stderr.on('data', (b) => (err += b))
    p.on('close', (code) => resolve({ code: code ?? -1, out, err }))
  })
}

describe('heavy jobs on another machine', () => {
  it('runs a busy machine’s job on the idle one, on the exact working tree, and brings the result back', async () => {
    const home = path.join(root, 'vps-home-1')
    const r = await cli(process.pid, home)
    expect(r.err).toContain('runs on the PC')
    expect(r.out).toContain('heavy=1')
    expect(r.out).toContain('changed, not committed')
    expect(r.out).toContain('new, untracked')
    expect(r.out).not.toContain('LEAK') // what .gitignore leaves out stays here
    expect(r.code).toBe(3)
    expect(r.err).toContain('finished on the PC: exit 3')
    expect(fs.readFileSync(path.join(repo, 'out', 'result.txt'), 'utf8')).toBe('built\n')
    // The session's own git state is untouched.
    expect(git(repo, 'status', '--porcelain')).toBe(' M pkg/note.txt\n?? pkg/new.txt'.trim())
    expect(git(repo, 'for-each-ref', 'refs/weevils-heavy')).toBe('')
    fs.rmSync(path.join(repo, 'out'), { recursive: true, force: true })
  }, 60_000)

  it('sends only what the other machine lacks the second time', async () => {
    const snap = (await snapshot(path.join(repo, 'pkg')))!
    const have = fs.readdirSync(path.join(root, 'pc-cache', snap.key, 'repo.git', 'refs', 'jobs'))
    expect(have.length).toBeGreaterThan(0)
    expect(await bundle(snap.root, have[0], have, path.join(root, 'b1'))).toBeNull()
    const thin = (await bundle(snap.root, snap.commit, have, path.join(root, 'b2')))!
    const full = (await bundle(snap.root, snap.commit, [], path.join(root, 'b3')))!
    expect(fs.statSync(thin.file).size).toBeLessThanOrEqual(fs.statSync(full.file).size)
  })

  it('runs it here when the other machine stops taking jobs', async () => {
    takes = false
    try {
      const holder = spawn('sleep', ['2'])
      const r = await cli(holder.pid!, path.join(root, 'vps-home-2'))
      expect(r.err).toContain('waiting for a turn')
      expect(r.err).not.toContain('runs on the PC')
      expect(r.out).toContain('changed, not committed')
      expect(r.code).toBe(3)
      fs.rmSync(path.join(repo, 'out'), { recursive: true, force: true })
    } finally {
      takes = true
    }
  }, 60_000)

  it('calls a machine idle only with nothing heavy of its own and a low load', () => {
    expect(isIdle({ ...free })).toBe(true)
    expect(isIdle({ ...free, running: 1 })).toBe(false)
    expect(isIdle({ ...free, waiting: 1 })).toBe(false)
    expect(isIdle({ ...free, load: 4 })).toBe(false)
    expect(isIdle({ ...free, memMb: 1000 })).toBe(false)
    expect(isIdle({ ...free, takes: false })).toBe(false)
  })

  it('lists what a job wrote, never .git or node_modules', () => {
    const d = path.join(root, 'w')
    fs.mkdirSync(path.join(d, 'node_modules', 'x'), { recursive: true })
    fs.mkdirSync(path.join(d, 'dist'), { recursive: true })
    const t = Date.now() - 5000
    fs.writeFileSync(path.join(d, 'old.txt'), '')
    fs.utimesSync(path.join(d, 'old.txt'), new Date(t - 10_000), new Date(t - 10_000))
    fs.writeFileSync(path.join(d, 'dist', 'a.js'), '')
    fs.writeFileSync(path.join(d, 'node_modules', 'x', 'b.js'), '')
    expect(writtenSince(d, t)).toEqual(['dist/a.js'])
  })
})

describe('the hub', () => {
  it('passes only the job protocol to the other machine', async () => {
    const calls: string[] = []
    const hub = new Hub({
      remotes: () => [{ id: 'pc', url: 'http://pc', online: true, machineId: () => 'pc-id', headers: () => ({}) }],
      name: () => 'the PC', share: () => true, off: () => [],
      fetch: (async (u: string) => (calls.push(u), new Response('{}'))) as unknown as typeof fetch,
    })
    const res = () => {
      const r = { status: 0, writeHead: (s: number) => ((r.status = s), r), end: () => r }
      return r as unknown as http.ServerResponse & { status: number }
    }
    const get = { method: 'GET', headers: {} } as http.IncomingMessage
    for (const rest of ['../sessions', 'capacity/../../sessions/x/send', 'run/abc/../../x', 'repo/a b']) {
      const r = res()
      await hub.pass(get, r, 'pc-id', rest, '')
      expect(r.status).toBe(404)
    }
    const r = res()
    await hub.pass(get, r, 'pc-id', 'run/abc123/files', '')
    expect(r.status).toBe(200)
    expect(calls).toEqual(['http://pc/api/jobs/run/abc123/files'])
    const off = res()
    await hub.pass(get, off, 'elsewhere', 'capacity', '')
    expect(off.status).toBe(409)
  })
})

describe('the tools a job finds', () => {
  it('takes the login shell’s PATH with printenv, whatever the shell (fish has no "$@")', async () => {
    const { loginPath } = await import('./jobs.ts')
    const fake = path.join(os.tmpdir(), `fake-fish-${process.pid}`)
    // A shell that understands nothing but its -lc command run as a program, like fish running printenv.
    fs.writeFileSync(fake, '#!/bin/sh\n[ "$2" = "printenv PATH" ] || exit 9\necho "Welcome to fish"\necho /home/user/.cargo/bin:/usr/bin\n', { mode: 0o755 })
    try {
      expect(await loginPath(fake, '/usr/bin:/home/user/.local/bin')).toBe('/home/user/.cargo/bin:/usr/bin:/home/user/.local/bin')
    } finally {
      fs.rmSync(fake, { force: true })
    }
  })
})
