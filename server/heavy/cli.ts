// weevils-heavy -- <command…>: a test run, a build or a check, in its turn (server/heavy/queue.ts). The sessions'
// npm, npx, cargo… stand-ins (server/heavy/shims.ts) send their heavy commands here; the CI and anyone else can too.
//
//   weevils-heavy [--here] -- <command…>   run it when a slot is free here, or on an idle machine of the user's
//   weevils-heavy --status                 what runs and waits here
//
// When this machine is busy (every slot taken, or no room) and another machine of the user's is connected and idle,
// the command runs there instead, on this session's exact working tree, and its output, exit code and the files it
// wrote come back here (server/heavy/jobs.ts). --here, WEEVILS_HEAVY_OFFLOAD=0 or Your factory's switch keep it here.
// Messages go to stderr, in English: they are read by the agent that ran the command.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquire, hasRoom, heavyDir, room, slotCount, status } from './queue.ts'
import { bundle, snapshot } from './snapshot.ts'

const say = (s: string) => process.stderr.write(`[weevils] ${s}\n`)

const args = process.argv.slice(2)
const sep = args.indexOf('--')
const opts = sep < 0 ? args : args.slice(0, sep)
const argv = sep < 0 ? [] : args.slice(sep + 1)
const here = opts.includes('--here')

const describe = (cmd: string, cwd: string) => `${cmd.length > 60 ? `${cmd.slice(0, 57)}…` : cmd} (${path.basename(cwd)})`

if (opts.includes('--status')) {
  const q = status()
  console.log(`slots ${slotCount()} · running ${q.running.length} · waiting ${q.waiting.length}`)
  for (const t of [...q.running, ...q.waiting]) console.log(`${t.state.padEnd(8)} ${describe(t.cmd, t.cwd)}${t.from ? ` from ${t.from}` : ''}`)
  process.exit(0)
}
if (!argv.length) {
  process.stderr.write('usage: weevils-heavy [--here] -- <command…> | weevils-heavy --status\n')
  process.exit(2)
}

// ---------------------------------------------------------------- local weevilsd (the hub, for another machine)

const base = `http://127.0.0.1:${process.env.WEEVILS_PORT || 4179}`
function token(): Record<string, string> {
  try {
    const line = fs.readFileSync(path.join(os.homedir(), '.local', 'share', 'weevils', 'local-token'), 'utf8').trim()
    const i = line.indexOf(':')
    return i > 0 ? { [line.slice(0, i).trim()]: line.slice(i + 1).trim() } : {}
  } catch {
    return {}
  }
}
async function api<T>(method: string, p: string, body?: unknown, timeout = 30_000): Promise<T> {
  const r = await fetch(base + p, {
    method,
    headers: { ...token(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  })
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
  return data
}

interface Helpers {
  here: { id: string; name: string }
  helpers: { id: string; name: string; idle: boolean }[]
}
// An install is for this machine's own folder: it never goes elsewhere.
const install = /^(npm|pnpm|yarn|bun)$/.test(argv[0] ?? '') && /^(ci|clean-install|install|i|add)$/.test(argv[1] ?? '')
const offloadOn = !here && !install && process.env.WEEVILS_HEAVY_OFFLOAD !== '0'
async function idleHelper(): Promise<{ helper: Helpers['helpers'][number]; here: Helpers['here'] } | null> {
  if (!offloadOn || offloadFailed) return null
  try {
    const h = await api<Helpers>('GET', '/api/jobs/helpers', undefined, 5000)
    const helper = h.helpers.find((x) => x.idle)
    return helper ? { helper, here: h.here } : null
  } catch {
    return null
  }
}

/** Runs the job on `helper`. Returns its exit code, or null when it could not run there (then it runs here). */
let offloadFailed = false
async function offload(helper: { id: string; name: string }, from: string): Promise<number | null> {
  const code = await offloadOnce(helper, from)
  if (code === null) offloadFailed = true
  return code
}
async function offloadOnce(helper: { id: string; name: string }, from: string): Promise<number | null> {
  const at = `/api/jobs/at/${encodeURIComponent(helper.id)}`
  const snap = await snapshot(process.cwd()).catch(() => null)
  if (!snap) return null
  try {
    const { have } = await api<{ have: string[] }>('GET', `${at}/repo/${snap.key}`, undefined, 10_000)
    const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'weevils-heavy')
    fs.mkdirSync(cache, { recursive: true })
    const file = path.join(cache, `${process.pid}.bundle`)
    try {
      const b = await bundle(snap.root, snap.commit, have, file)
      if (b) {
        const size = fs.statSync(b.file).size
        if (size > 500 << 20) return null
        const r = await fetch(`${base}${at}/repo/${snap.key}?ref=${encodeURIComponent(b.ref)}&commit=${snap.commit}`, {
          method: 'POST',
          headers: { ...token(), 'content-type': 'application/octet-stream', 'content-length': String(size) },
          body: fs.readFileSync(b.file),
          signal: AbortSignal.timeout(15 * 60_000),
        })
        if (!r.ok) return null
      }
    } finally {
      fs.rmSync(file, { force: true })
    }
    const { id } = await api<{ id: string }>('POST', `${at}/run`, { key: snap.key, commit: snap.commit, dir: snap.dir, argv, from })
    // i18n-ignore: read by the agent that ran the command, in English
    say(`this machine is busy: ${argv.join(' ')} runs on ${helper.name}, on this exact working tree. Output follows.`)
    const stop = () => {
      void api('POST', `${at}/run/${id}/stop`, {}, 5000).catch(() => undefined).finally(() => process.exit(143))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    process.on('SIGHUP', stop)
    let next = 0
    let misses = 0
    for (;;) {
      let p: { phase: string; out: string; next: number; code: number | null; files: boolean; setupError?: string }
      try {
        p = await api('GET', `${at}/run/${id}?from=${next}`, undefined, 15_000)
        misses = 0
      } catch (e) {
        if (++misses >= 20) {
          // i18n-ignore: read by the agent that ran the command, in English
          say(`lost ${helper.name} (${(e as Error).message}): running it here instead.`)
          return null
        }
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      if (p.out) process.stdout.write(p.out)
      next = p.next
      if (p.phase === 'failed' && p.setupError) {
        // i18n-ignore: read by the agent that ran the command, in English
        say(`${helper.name} could not prepare the job (${p.setupError}): running it here instead.`)
        return null
      }
      if ((p.phase === 'done' || p.phase === 'failed') && p.code === 127) {
        // i18n-ignore: read by the agent that ran the command, in English
        say(`${helper.name} could not start ${argv[0]} (missing there): running it here instead.`)
        return null
      }
      if (p.phase === 'done' || p.phase === 'failed') {
        if (p.files) {
          const r = await fetch(`${base}${at}/run/${id}/files`, { headers: token(), signal: AbortSignal.timeout(10 * 60_000) }).catch(() => null)
          const buf = r?.ok ? Buffer.from(await r.arrayBuffer()) : null
          const code = buf
            ? await new Promise<number>((resolve) => {
                const tar = spawn('tar', ['xzf', '-', '-C', snap.root], { stdio: ['pipe', 'ignore', 'inherit'] })
                tar.on('close', (c) => resolve(c ?? 1))
                tar.on('error', () => resolve(1))
                tar.stdin.end(buf)
              })
            : 1
          // i18n-ignore: read by the agent that ran the command, in English
          if (code !== 0) say(`the files the job wrote on ${helper.name} did not come back.`)
        }
        // i18n-ignore: read by the agent that ran the command, in English
        say(`finished on ${helper.name}: exit ${p.code ?? 1}.`)
        return p.code ?? 1
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  } catch (e) {
    // i18n-ignore: read by the agent that ran the command, in English
    say(`could not send it to ${helper.name} (${(e as Error).message}): running it here.`)
    return null
  }
}

// ---------------------------------------------------------------- here

function runHere(): Promise<number> {
  return new Promise((resolve) => {
    // Niceness 10, not 10 more: a caller already lowered (the CI under nice) is not pushed to the bottom (19).
    const child = spawn('nice', ['-n', String(Math.max(0, 10 - os.getPriority())), ...argv], { stdio: 'inherit', env: { ...process.env, WEEVILS_HEAVY: '1' } })
    const fwd = (sig: NodeJS.Signals) => () => child.kill(sig)
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(s, fwd(s))
    child.on('error', (e) => {
      say(e.message)
      resolve(127)
    })
    child.on('close', (code, sig) => resolve(code ?? (sig ? 128 + (os.constants.signals[sig] ?? 1) : 1)))
  })
}

async function main(): Promise<number> {
  // Already inside a job (a check that runs the tests): its slot covers this too; waiting for another would deadlock.
  if (process.env.WEEVILS_HEAVY) return runHere()
  const cmd = argv.join(' ')
  const slots = slotCount()
  const q = status()
  const busy = q.running.length >= slots || q.waiting.length > 0 || (q.running.length > 0 && !hasRoom(room()))
  if (busy) {
    const h = await idleHelper()
    if (h) {
      const code = await offload(h.helper, h.here.name)
      if (code !== null) return code
    }
  }
  let slot
  try {
    slot = await acquire({
      cmd,
      cwd: process.cwd(),
      dir: heavyDir(),
      slots,
      onWait: (a) => {
        const what = a.running.map((t) => describe(t.cmd, t.cwd)).join(', ')
        // i18n-ignore: read by the agent that ran the command, in English
        say(`waiting for a turn: ${a.running.length} heavy job${a.running.length === 1 ? '' : 's'} running on this machine${what ? ` (${what})` : ''}${a.waiting ? `, ${a.waiting} ahead in line` : ''}. It starts by itself; give this command a long timeout.`)
      },
      giveUp: offloadOn && !offloadFailed ? async () => !!(await idleHelper()) : undefined,
    })
  } catch {
    return runHere() // no queue reachable (a jail, a read-only home): as if it were not there
  }
  if (!slot) {
    const h = await idleHelper()
    const code = h ? await offload(h.helper, h.here.name) : null
    if (code !== null) return code
    return main()
  }
  // i18n-ignore: read by the agent that ran the command, in English
  if (slot.waitedMs > 5000) say(`starting after ${Math.round(slot.waitedMs / 1000)} s in line.`)
  try {
    return await runHere()
  } finally {
    slot.release()
  }
}

main().then((c) => process.exit(c), (e) => {
  say((e as Error).message)
  process.exit(1)
})
