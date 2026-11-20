// One machine of the two-machine threads scenario (test/docker/threads-two-machines.sh): what weevilsd runs with
// WEEVILS_THREADS=1, minus the app, with a fake engine. The real code: the shadow writer, the hub sync, the Threads
// service (dispatcher on the server), start.ts. The fake engine writes a Claude Code session file: the request, one
// Write, then, after FAKE_TURN_MS, the answer; killing the machine in between leaves a turn half done.
//
//   node test/docker/threads-machine.ts serve      the machine (env below), HTTP on THREADS_PORT
//   node test/docker/threads-machine.ts report <thread> <hub git dir>   the thread on the hub, as JSON
//
// Env: THREADS_MACHINE (name), THREADS_ROLE (server: dispatcher, hub here | laptop), THREADS_HUB (hub git dir or
// user@host:path), THREADS_PORT, THREADS_PEERS (name=url,…), THREADS_QUOTA (5-hour %), FAKE_TURN_MS, HOME.

import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { claudeSlug } from '../../server/bring.ts'
import type { Instruction } from '../../server/weevbook/dispatcher.ts'
import { claudeAccountOf } from '../../server/weevbook/engines.ts'
import { HubSync, checkpointHook } from '../../server/weevbook/hub.ts'
import { parseJournal, validateJournal, type Provider } from '../../server/weevbook/journal.ts'
import { parseLease } from '../../server/weevbook/lease.ts'
import { startTurn, type Launcher, type StartResult } from '../../server/weevbook/start.ts'
import { Threads, type Peer } from '../../server/weevbook/threads.ts'
import { startWeevbookWriter } from '../../server/weevbook/writer.ts'

const env = (k: string, d?: string) => process.env[k] ?? d ?? ''

if (process.argv[2] === 'report') {
  const [, , , id, hub] = process.argv
  const git = (...a: string[]) => execFileSync('git', ['--git-dir', hub, ...a], { encoding: 'utf8' })
  const events = parseJournal(git('cat-file', 'blob', `refs/threads/${id}:events.jsonl`)).events
  const lease = parseLease(git('cat-file', 'blob', `refs/leases/${id}:lease.json`))
  const orphans = git('for-each-ref', '--format=%(refname)', `refs/orphans/${id}/`).trim()
  console.log(
    JSON.stringify({
      invalid: validateJournal(events),
      turns: events.flatMap((e) => (e.type === 'turn' ? [[e.turn, e.state, e.state === 'assigned' ? e.rule : e.state === 'failed' ? e.reason : null]] : [])),
      legs: events.flatMap((e) => (e.type === 'leg.start' ? [[e.leg, e.engine, e.rung]] : [])),
      userMessages: events.filter((e) => e.type === 'message' && e.role === 'user').map((e) => (e.type === 'message' ? e.text : '')),
      signed: events.filter((e) => e.type === 'message' && e.text.includes('[from:weevbook')).length,
      lateNotes: events.filter((e) => e.type === 'note' && e.kind === 'late').length,
      lease: lease && { holder: lease.holder, state: lease.state },
      orphans: orphans ? orphans.split('\n') : [],
    }),
  )
  process.exit(0)
}

const machine = env('THREADS_MACHINE', 'server')
const server = env('THREADS_ROLE', 'server') === 'server'
const home = env('HOME')
const data = path.join(home, '.local', 'share', 'weevils')
const projects = path.join(home, 'projects')
const claudeDir = path.join(home, '.claude', 'projects')
const codexDir = path.join(home, '.codex', 'sessions')
const dir = path.join(data, 'weevbook')
const sessions = path.join(data, 'weevbook-sessions.jsonl')
const log = (l: string) => console.log(`${new Date().toISOString()} ${machine} ${l}`)
fs.mkdirSync(data, { recursive: true })

const sources = () => {
  const out: { file: string; provider: Provider }[] = []
  if (!fs.existsSync(claudeDir)) return out
  for (const d of fs.readdirSync(claudeDir)) for (const f of fs.readdirSync(path.join(claudeDir, d))) if (f.endsWith('.jsonl')) out.push({ file: path.join(claudeDir, d, f), provider: 'claude' })
  return out
}
startWeevbookWriter({ dir, sessions, machine, home, codexDir, roots: [projects], sources, intervalMs: 1000, quietMs: 2000, log, checkpoint: checkpointHook({ dataDir: data, home, weevbookGitDir: path.join(dir, '.git'), log }) })
const hubUrl = env('THREADS_HUB', path.join(data, 'hub.git'))
const sync = new HubSync({ dir, dataDir: data, sessions, machine, hub: { url: hubUrl, here: server }, steals: server, log, ...(process.env.THREADS_SSH ? { ssh: process.env.THREADS_SSH } : {}) })
sync.start()

/** The fake engine: the request and one Write now, the answer after FAKE_TURN_MS (unless the machine dies first). */
function engine(session: string, cwd: string, text: string) {
  const file = path.join(claudeDir, claudeSlug(cwd), `${session}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
  let parent: string | null = before.length ? (JSON.parse(before.at(-1)!).uuid ?? null) : null
  const line = (type: 'user' | 'assistant', message: unknown) => {
    const uuid = crypto.randomUUID()
    fs.appendFileSync(file, `${JSON.stringify({ parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.4', gitBranch: 'main', type, message, uuid, timestamp: new Date().toISOString() })}\n`)
    parent = uuid
  }
  const n = crypto.randomBytes(4).toString('hex')
  line('user', { role: 'user', content: text })
  line('assistant', { id: `msg_${n}a`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'Write', input: { file_path: path.join(cwd, 'src/money.ts'), content: `// ${machine}\n` } }], stop_reason: 'tool_use' })
  fs.writeFileSync(path.join(cwd, 'src', 'money.ts'), `export const fmt = (n: number) => \`\${n} €\` // ${machine}\n`)
  line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'written' }] })
  setTimeout(() => line('assistant', { id: `msg_${n}b`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: `Done on ${machine}.` }], stop_reason: 'end_turn' }), Number(env('FAKE_TURN_MS', '1000')))
}
const launch: Launcher = {
  async resume(l) {
    log(`engine resume ${l.session.slice(0, 8)} (${l.text.slice(0, 40).replace(/\s+/g, ' ')}…)`)
    engine(l.session, l.cwd, l.text)
  },
  async open(l) {
    log(`engine open ${l.session?.slice(0, 8)}`)
    engine(l.session ?? crypto.randomUUID(), l.cwd, l.text)
  },
}
const start = (ins: Instruction): Promise<StartResult> =>
  startTurn({ sync, sessionsFile: sessions, dataDir: data, machine, home, claudeDir, codexDir, roots: [projects], projectsDir: projects, launch, folderOf: (p) => (p && fs.existsSync(path.join(projects, p)) ? path.join(projects, p) : null), log }, ins)

const call = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json()
}
const online = new Map<string, boolean>()
const peers = (): Peer[] =>
  env('THREADS_PEERS')
    .split(',')
    .filter(Boolean)
    .map((p) => {
      const [name, url] = p.split('=')
      return { machine: name, online: online.get(name) ?? false, start: (ins) => call(`${url}/start`, ins) as Promise<StartResult>, deliver: async (thread, text) => void (await call(`${url}/deliver`, { thread, text })) }
    })
// What server/remotes.ts does: a remote is online while it answers.
setInterval(() => {
  for (const p of env('THREADS_PEERS').split(',').filter(Boolean)) {
    const [name, url] = p.split('=')
    fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => online.set(name, r.ok), () => online.set(name, false))
  }
}, 2000).unref()

const used = Number(env('THREADS_QUOTA', '10'))
const threads = new Threads({
  sync,
  machine,
  dispatcher: server,
  preferred: 'claude',
  inboxFile: path.join(data, 'threads-inbox.jsonl'),
  projects: () => (fs.existsSync(projects) ? fs.readdirSync(projects) : []),
  sources: () => [{ provider: 'claude', account: claudeAccountOf(null, home), signedIn: true, quota: async () => ({ ok: true, source: 'fake', at: Date.now(), windows: [{ kind: 'session', percent: used, resetsAt: Date.now() + 3 * 3600_000 }, { kind: 'week', percent: 5, resetsAt: null }] }) }],
  start,
  deliver: async () => {},
  peers,
  log,
})
await threads.start()

const read = (req: http.IncomingMessage) => new Promise<any>((resolve) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => resolve(b ? JSON.parse(b) : {}))
})
http
  .createServer(async (req, res) => {
    const out = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    try {
      if (req.url === '/health') return out(200, { ok: true, machine })
      if (req.url === '/start') return out(200, await start(await read(req)))
      if (req.url === '/deliver') {
        const b = await read(req)
        await threads.deliverHere(b.thread, b.text)
        return out(200, { ok: true })
      }
      if (req.url === '/send') {
        const b = await read(req)
        return out(200, await threads.accept(b.thread ?? null, { text: b.text, project: b.project }))
      }
      const m = /^\/view\/(\w+)$/.exec(req.url ?? '')
      if (m) return out(200, await threads.view(m[1]))
      out(404, {})
    } catch (e) {
      out(500, { error: (e as Error).message })
    }
  })
  .listen(Number(env('THREADS_PORT', '4180')), () => log(`up (${server ? 'dispatcher, hub here' : `hub ${hubUrl}`})`))
