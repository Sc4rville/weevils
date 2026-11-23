// The heavy-job queue of one machine: tests, builds and checks wait their turn here, so a dozen sessions that start
// their tests at the same moment run them one or two at a time instead of all together (a 4-core server at load 14,
// every suite timing out). First come, first served: each job holds a ticket (one file); a ticket runs when one of the
// slots is free and the machine has room (load under 1.5 × its cores, at least 2 GB of memory free). A ticket whose
// process is gone is dropped by the next one that looks, so a killed job never holds a slot.
//
// No daemon and no lock that outlives a process: the tickets are files in WEEVILS_HEAVY_DIR (default
// ~/.local/share/weevils/heavy), and the one short critical section (choose who runs) holds a directory made with
// mkdir, atomic on every system weevils runs on (Linux and macOS, which has no flock).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const heavyDir = (env: NodeJS.ProcessEnv = process.env) =>
  env.WEEVILS_HEAVY_DIR || path.join(env.HOME || os.homedir(), '.local', 'share', 'weevils', 'heavy')

export const cores = () => (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1

/** How many heavy jobs run at once: WEEVILS_HEAVY_SLOTS, else 1 on 1 or 2 cores, 2 up to 11, then a quarter of the cores (at most 4). */
export function slotCount(env: NodeJS.ProcessEnv = process.env, n = cores()): number {
  const set = Number(env.WEEVILS_HEAVY_SLOTS)
  if (Number.isInteger(set) && set > 0) return Math.min(set, 64)
  return n <= 2 ? 1 : Math.min(4, Math.max(2, Math.floor(n / 4)))
}

/** Memory a program can still take, in MB (Linux: MemAvailable; elsewhere what the system calls free). */
export function freeMemMb(read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8')): number {
  try {
    const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(read('/proc/meminfo'))
    if (m) return Math.round(Number(m[1]) / 1024)
  } catch {
    /* not Linux */
  }
  return Math.round(os.freemem() / 1048576)
}

export interface Ticket {
  pid: number
  at: number
  cmd: string
  cwd: string
  state: 'waiting' | 'running'
  /** Where it came from when another machine sent it (its name), else absent. */
  from?: string
}

export interface Room {
  load: number
  cores: number
  memMb: number
}

export const room = (): Room => ({ load: os.loadavg()[0], cores: cores(), memMb: freeMemMb() })

/** The machine has room for one more heavy job: load under 1.5 × cores and at least 2 GB free. */
export const hasRoom = (r: Room) => r.load < 1.5 * r.cores && r.memMb >= 2048

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The tickets in line, oldest first, the dead ones removed on the way. */
export function tickets(dir = heavyDir(), isAlive: (pid: number) => boolean = alive): (Ticket & { file: string })[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
  const out: (Ticket & { file: string })[] = []
  for (const name of names) {
    const file = path.join(dir, name)
    try {
      const t = JSON.parse(fs.readFileSync(file, 'utf8')) as Ticket
      if (!isAlive(t.pid)) {
        fs.rmSync(file, { force: true })
        continue
      }
      out.push({ ...t, file })
    } catch {
      // Half-written by a process that died mid-write: gone after a minute.
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > 60_000) fs.rmSync(file, { force: true })
      } catch {
        /* already gone */
      }
    }
  }
  return out
}

/** What the queue holds now: running and waiting, for a status line (Your factory, the remote's capacity). */
export function status(dir = heavyDir()) {
  const all = tickets(dir)
  return { running: all.filter((t) => t.state === 'running'), waiting: all.filter((t) => t.state === 'waiting') }
}

function withLock<T>(dir: string, fn: () => T): T | undefined {
  const lock = path.join(dir, '.lock')
  try {
    fs.mkdirSync(lock)
  } catch {
    try {
      // A lock left by a process killed inside the critical section (a few milliseconds long): taken back after 10 s.
      if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmSync(lock, { recursive: true, force: true })
    } catch {
      /* gone meanwhile */
    }
    return undefined
  }
  try {
    return fn()
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

export interface AcquireOptions {
  cmd: string
  cwd: string
  from?: string
  dir?: string
  slots?: number
  room?: () => Room
  /** Called once, when the job has to wait (what is ahead of it). */
  onWait?: (ahead: { running: Ticket[]; waiting: number }) => void
  /** Called every `everyMs` while waiting: true gives up the place (the job went elsewhere): acquire returns null. */
  giveUp?: () => Promise<boolean> | boolean
  everyMs?: number
  tickMs?: number
  pid?: number
}

export interface Slot {
  release: () => void
  waitedMs: number
}

/**
 * Waits for a turn, then returns the slot (release it when the job ends; a process that dies releases it by dying).
 * Nothing heavy running here: the job starts at once whatever the load (the load is somebody else's, waiting would not
 * lower it). Otherwise: its turn in line, a free slot, and room on the machine.
 */
let seq = 0

export async function acquire(o: AcquireOptions): Promise<Slot | null> {
  const dir = o.dir ?? heavyDir()
  fs.mkdirSync(dir, { recursive: true })
  const pid = o.pid ?? process.pid
  const at = Date.now()
  // Named so that the order of names is the order of arrival (a counter for two tickets of one process in the same ms).
  const file = path.join(dir, `${String(at).padStart(14, '0')}-${String(++seq).padStart(6, '0')}-${pid}-${Math.random().toString(36).slice(2, 6)}.json`)
  const ticket: Ticket = { pid, at, cmd: o.cmd.slice(0, 200), cwd: o.cwd, state: 'waiting', ...(o.from ? { from: o.from } : {}) }
  const write = (t: Ticket) => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(t))
    fs.renameSync(`${file}.tmp`, file)
  }
  write(ticket)
  const release = () => fs.rmSync(file, { force: true })
  const slots = o.slots ?? slotCount()
  const measure = o.room ?? room
  let told = false
  let lastAsk = Date.now()
  for (;;) {
    const go = withLock(dir, () => {
      const all = tickets(dir)
      const running = all.filter((t) => t.state === 'running')
      const free = slots - running.length
      if (free <= 0) return false
      const mine = all.filter((t) => t.state === 'waiting').findIndex((t) => t.file === file)
      if (mine < 0 || mine >= free) return false
      if (running.length > 0 && !hasRoom(measure())) return false
      write({ ...ticket, state: 'running' })
      return true
    })
    if (go) return { release, waitedMs: Date.now() - at }
    // The whole queue folder gone (deleted by hand, a test's temporary folder): no queue left to wait in, run now.
    if (!fs.existsSync(dir)) return { release: () => undefined, waitedMs: Date.now() - at }
    try {
      if (!fs.existsSync(file)) write(ticket) // removed from outside (a clean-up): back in line, same place
    } catch {
      return { release, waitedMs: Date.now() - at }
    }
    if (!told && o.onWait) {
      told = true
      const all = tickets(dir)
      o.onWait({ running: all.filter((t) => t.state === 'running'), waiting: all.filter((t) => t.state === 'waiting' && t.file < file).length })
    }
    if (o.giveUp && Date.now() - lastAsk >= (o.everyMs ?? 15_000)) {
      lastAsk = Date.now()
      if (await o.giveUp()) {
        release()
        return null
      }
    }
    await new Promise((r) => setTimeout(r, o.tickMs ?? 1000))
  }
}
