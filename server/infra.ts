// Coin infrastructure, côté machine : mesures toutes les 15 s, une minute d'historique par ligne (DATA_DIR/infra/<jour>.jsonl),
// saturations, serveurs à l'écoute, conseils tirés des vraies mesures. Linux d'abord (/proc) ; ailleurs, ce que donne os.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Episode, FsListing, InfraDetail, InfraPoint, Level, ServerProc } from '../shared/infra.ts'
import { DATA_DIR, EXPOSE_DOMAIN, HOME, MACHINE, ORCHESTRATOR } from './config.ts'
import { tr } from './i18n.ts'
import M from './i18n/infra.ts'

const DIR = path.join(DATA_DIR, 'infra')
const TICK = 15_000
const PAGE = 4096
const HZ = 100

export const levelOf = (cpu: number, mem: number): Level => (cpu >= 90 || mem >= 92 ? 'crit' : cpu >= 70 || mem >= 80 ? 'warn' : 'ok')
const saturated = (p: { cpu: number; mem: number }) => p.cpu >= 90 || p.mem >= 92
const day = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const read = (f: string) => {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- mesures

function meminfo() {
  const txt = read('/proc/meminfo')
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(txt)?.[1] ?? NaN) * 1024
  const total = txt ? kb('MemTotal') : os.totalmem()
  const avail = txt ? kb('MemAvailable') : os.freemem()
  const swapTotal = txt ? kb('SwapTotal') : 0
  const swapUsed = txt ? swapTotal - kb('SwapFree') : 0
  return { total, used: total - avail, swapTotal, swapUsed }
}

function disk() {
  try {
    const s = fs.statfsSync(HOME)
    const total = s.blocks * s.bsize
    return { total, used: total - s.bavail * s.bsize }
  } catch {
    return { total: 0, used: 0 }
  }
}

let lastCpu = os.cpus().map((c) => c.times)
function cpuPercent() {
  const now = os.cpus().map((c) => c.times)
  let busy = 0
  let all = 0
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    const b = t.user - p.user + t.nice - p.nice + t.sys - p.sys + t.irq - p.irq
    busy += b
    all += b + t.idle - p.idle
  })
  lastCpu = now
  return all > 0 ? Math.round((busy / all) * 100) : 0
}

interface Proc {
  pid: number
  ppid: number
  comm: string
  ticks: number
  rss: number
}

function procs(): Proc[] {
  let pids: string[]
  try {
    pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p))
  } catch {
    return []
  }
  const out: Proc[] = []
  for (const pid of pids) {
    const s = read(`/proc/${pid}/stat`)
    const close = s.lastIndexOf(')')
    if (close < 0) continue
    const f = s.slice(close + 2).split(' ')
    out.push({ pid: Number(pid), ppid: Number(f[1]), comm: s.slice(s.indexOf('(') + 1, close), ticks: Number(f[11]) + Number(f[12]), rss: Number(f[21]) * PAGE })
  }
  return out
}

/** Une famille lisible pour un processus : docker, vitest, chrome, claude… (pour dire ce qui a fait saturer). */
function family(p: Proc): string {
  if (/^(dockerd|containerd|containerd-shim.*|docker.*|runc)$/.test(p.comm)) return 'docker'
  if (read(`/proc/${p.pid}/cgroup`).includes('docker')) return 'docker'
  if (/^(node|bun|deno|python3?|npm|npx)$/.test(p.comm)) {
    const args = read(`/proc/${p.pid}/cmdline`).split('\0').join(' ')
    const m = /\b(vitest|vite|tsc|next|jest|playwright|esbuild|webpack|tsx|eslint|pytest|ffmpeg|weevils?)\b/.exec(args)
    if (m) return m[1]
    const script = args.split(' ').find((a, i) => i > 0 && !a.startsWith('-'))
    return script ? `${p.comm} ${path.basename(script)}` : p.comm
  }
  if (/^(chrome|chromium|headless_shell)/.test(p.comm)) return 'chrome'
  return p.comm
}

const isAgent = (p: Proc) => p.comm === 'claude' || (p.comm === 'codex' && !read(`/proc/${p.pid}/cmdline`).includes('app-server'))

interface Live {
  at: number
  cpu: number
  mem: number
  swap: number | null
  load: number
  agents: number
  agentMem: number
  agentCpu: number
  fams: Map<string, number>
}

let prevTicks = new Map<number, number>()
let prevAt = Date.now()
let current: Live | null = null
let minute: Live[] = []
let today: InfraPoint[] = []
let todayKey = ''

function measure(): Live {
  const at = Date.now()
  const m = meminfo()
  const list = procs()
  const dt = (at - prevAt) / 1000
  const ticks = new Map<number, number>()
  const cpuOf = new Map<number, number>()
  for (const p of list) {
    ticks.set(p.pid, p.ticks)
    const before = prevTicks.get(p.pid)
    if (before != null && dt > 0) cpuOf.set(p.pid, ((p.ticks - before) / HZ / dt) * 100)
  }
  prevTicks = ticks
  prevAt = at
  // Chaque processus compte pour la session claude / codex dont il descend (tests, builds, serveurs lancés par l'agent).
  const byPid = new Map(list.map((p) => [p.pid, p]))
  const agentOf = new Map<number, number | null>()
  const owner = (p: Proc): number | null => {
    if (agentOf.has(p.pid)) return agentOf.get(p.pid)!
    agentOf.set(p.pid, null)
    const parent = byPid.get(p.ppid)
    const r = isAgent(p) ? p.pid : parent && p.ppid > 1 ? owner(parent) : null
    agentOf.set(p.pid, r)
    return r
  }
  let agentMem = 0
  let agentCpu = 0
  const agents = new Set<number>()
  for (const p of list) {
    const a = owner(p)
    if (a == null) continue
    agents.add(a)
    agentMem += p.rss
    agentCpu += cpuOf.get(p.pid) ?? 0
  }
  const cpu = cpuPercent()
  const mem = m.total ? Math.round((m.used / m.total) * 100) : 0
  // Les familles ne sont calculées que quand ça chauffe (lecture de cmdline / cgroup des plus gros seulement).
  const fams = new Map<string, number>()
  if (cpu >= 70 || mem >= 80) {
    const key = cpu >= 70 ? (p: Proc) => cpuOf.get(p.pid) ?? 0 : (p: Proc) => p.rss
    for (const p of [...list].sort((a, b) => key(b) - key(a)).slice(0, 12)) {
      const v = cpu >= 70 ? Math.round(cpuOf.get(p.pid) ?? 0) : Math.round((p.rss / m.total) * 100)
      if (v > 0) fams.set(family(p), (fams.get(family(p)) ?? 0) + v)
    }
  }
  return {
    at,
    cpu,
    mem,
    swap: m.swapTotal ? Math.round((m.swapUsed / m.swapTotal) * 100) : null,
    load: os.loadavg()[0],
    agents: agents.size,
    agentMem: Math.round(agentMem / 1048576),
    agentCpu: Math.round(agentCpu),
    fams,
  }
}

function load(key: string): InfraPoint[] {
  return read(path.join(DIR, `${key}.jsonl`))
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as InfraPoint]
      } catch {
        return []
      }
    })
}

function flush() {
  if (!minute.length) return
  const avg = (f: (l: Live) => number) => Math.round(minute.reduce((s, l) => s + f(l), 0) / minute.length)
  const fams = new Map<string, number>()
  for (const l of minute) for (const [k, v] of l.fams) fams.set(k, (fams.get(k) ?? 0) + v / minute.length)
  const last = minute[minute.length - 1]
  const p: InfraPoint = {
    at: last.at,
    cpu: avg((l) => l.cpu),
    cpuMax: Math.max(...minute.map((l) => l.cpu)),
    mem: Math.max(...minute.map((l) => l.mem)),
    swap: last.swap,
    load: Math.round(last.load * 100) / 100,
    agents: Math.max(...minute.map((l) => l.agents)),
    agentMem: avg((l) => l.agentMem),
    agentCpu: avg((l) => l.agentCpu),
  }
  if (fams.size) p.top = [...fams].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => [k, Math.round(v)])
  minute = []
  const key = day(p.at)
  if (key !== todayKey) {
    todayKey = key
    today = []
  }
  today.push(p)
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.appendFileSync(path.join(DIR, `${key}.jsonl`), JSON.stringify(p) + '\n')
  } catch {
    /* disque plein ou lecture seule : l'historique reste en mémoire */
  }
}

let started = false
export function startInfra() {
  if (started) return
  started = true
  todayKey = day(Date.now())
  today = load(todayKey)
  // Les jours de plus de 30 jours partent.
  try {
    for (const f of fs.readdirSync(DIR)) if (f.endsWith('.jsonl') && Date.now() - fs.statSync(path.join(DIR, f)).mtimeMs > 30 * 86400_000) fs.rmSync(path.join(DIR, f))
  } catch {
    /* pas encore d'historique */
  }
  let lastMinute = Math.floor(Date.now() / 60_000)
  const tick = () => {
    current = measure()
    minute.push(current)
    const m = Math.floor(current.at / 60_000)
    if (m !== lastMinute) {
      lastMinute = m
      flush()
    }
  }
  tick()
  setInterval(tick, TICK).unref()
}

// ---------------------------------------------------------------- ce qu'on montre

export function brief() {
  const c = current ?? measure()
  return { id: MACHINE.id, name: MACHINE.name, online: true, cpu: c.cpu, mem: c.mem, level: levelOf(c.cpu, c.mem), weevboss: ORCHESTRATOR }
}

/** Les minutes saturées, regroupées en épisodes (deux minutes d'accalmie au plus entre deux). */
export function episodes(points: InfraPoint[]): Episode[] {
  const out: (Episode & { fams: Map<string, number> })[] = []
  for (const p of points) {
    if (!saturated(p)) continue
    const last = out[out.length - 1]
    const e = last && p.at - last.to <= 3 * 60_000 ? last : (out.push({ from: p.at - 60_000, to: p.at, cpu: 0, mem: 0, fams: new Map() }), out[out.length - 1])
    e.to = p.at
    e.cpu = Math.max(e.cpu, p.cpuMax)
    e.mem = Math.max(e.mem, p.mem)
    for (const [k, v] of p.top ?? []) e.fams.set(k, (e.fams.get(k) ?? 0) + v)
  }
  return out.map(({ fams, ...e }) => ({ ...e, culprit: [...fams].sort((a, b) => b[1] - a[1])[0]?.[0] }))
}

/** Tranches de 5 minutes : la valeur la plus haute de chaque tranche (un pic ne disparaît pas dans une moyenne). */
function buckets(points: InfraPoint[]): InfraPoint[] {
  const map = new Map<number, InfraPoint>()
  for (const p of points) {
    const k = Math.floor(p.at / 300_000) * 300_000
    const b = map.get(k)
    if (!b) map.set(k, { ...p, at: k, top: undefined })
    else {
      b.cpu = Math.max(b.cpu, p.cpu)
      b.cpuMax = Math.max(b.cpuMax, p.cpuMax)
      b.mem = Math.max(b.mem, p.mem)
      b.agents = Math.max(b.agents, p.agents)
      b.load = Math.max(b.load, p.load)
    }
  }
  return [...map.values()]
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const tier = (x: number, tiers: number[]) => tiers.find((t) => t >= x) ?? tiers[tiers.length - 1]
const VCPU = [2, 4, 8, 12, 16, 24, 32, 48, 64]
const RAM = [4, 8, 16, 32, 64, 128, 256]
const GB = 1024 ** 3

/** Ce qu'il faudrait pour n sessions, d'après ce qu'une session a vraiment pris aujourd'hui ici. */
export function sizing(points: InfraPoint[], memTotal: number, cores: number) {
  const withAgents = points.filter((p) => p.agents > 0)
  if (withAgents.length < 10) return null
  const perMem = median(withAgents.map((p) => p.agentMem / p.agents)) // Mo
  // CPU : les minutes où les sessions travaillent vraiment (le 3e quartile), pas leurs heures d'attente.
  const perCpuList = withAgents.map((p) => p.agentCpu / p.agents).sort((a, b) => a - b)
  const perCpu = Math.max(3, perCpuList[Math.floor(perCpuList.length * 0.75)] ?? 0) // % d'un cœur
  const baseMem = median(points.map((p) => (p.mem / 100) * (memTotal / 1048576) - p.agentMem)) // Mo hors sessions
  const baseCpu = median(points.map((p) => Math.max(0, (p.cpu / 100) * cores * 100 - p.agentCpu)))
  const capMem = Math.floor(((memTotal / 1048576) * 0.85 - baseMem) / perMem)
  const capCpu = Math.floor((cores * 100 * 0.8 - baseCpu) / perCpu)
  const capacity = Math.max(0, Math.min(capMem, capCpu))
  const peak = Math.max(...points.map((p) => p.agents))
  const target = [10, 20, 40, 80, 160].find((n) => n > Math.max(capacity, peak)) ?? 160
  const needMem = ((baseMem + target * perMem) / 0.85) * 1048576
  const needCpu = (baseCpu + target * perCpu) / 80
  return { perMem, perCpu, capacity, peak, target, vcpu: tier(needCpu, VCPU), ram: tier(needMem / GB, RAM) }
}

const hhmm = (t: number) => {
  const d = new Date(t)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function advice(points: InfraPoint[], eps: Episode[], m: ReturnType<typeof meminfo>, d: ReturnType<typeof disk>, cores: number): string[] {
  const t = tr(M)
  const out: string[] = []
  if (eps.length) {
    const culprits = [...new Set(eps.map((e) => e.culprit).filter(Boolean))] as string[]
    const worst = [...eps].sort((a, b) => Math.max(b.cpu, b.mem) - Math.max(a.cpu, a.mem))[0]
    out.push(t.saturated(eps.length, culprits.slice(0, 2), worst.cpu >= worst.mem ? `${worst.cpu} % CPU` : t.memPct(worst.mem), hhmm(worst.from)))
  }
  const linux = fs.existsSync('/proc/meminfo')
  if (linux && m.swapTotal === 0) out.push(t.noSwap(m.total >= 8 * GB ? 4 : 2))
  else if (m.swapTotal && m.swapUsed / m.swapTotal > 0.5) out.push(t.swapHigh(Math.round((m.swapUsed / m.swapTotal) * 100)))
  const highMem = points.filter((p) => p.mem >= 85).length
  if (highMem >= 30) out.push(t.memHigh(highMem))
  const avgCpu = points.length ? points.reduce((s, p) => s + p.cpu, 0) / points.length : 0
  if (points.length >= 60 && avgCpu >= 60) out.push(t.cpuHigh(Math.round(avgCpu)))
  if (d.total && d.used / d.total >= 0.85) out.push(t.diskHigh(Math.round((d.used / d.total) * 100), Math.round((d.total - d.used) / GB)))
  const s = sizing(points, m.total, cores)
  if (s) {
    out.push(t.perSession(Math.round(s.perMem), Math.round(s.perCpu), s.capacity))
    out.push(t.forN(s.target, s.vcpu, s.ram))
  }
  return out
}

// ---------------------------------------------------------------- serveurs à l'écoute

function exposed(): Map<number, string> {
  const out = new Map<number, string>()
  const dir = '/etc/caddy/sites'
  if (!EXPOSE_DOMAIN) return out
  try {
    for (const f of fs.readdirSync(dir)) {
      const port = /localhost:(\d+)/.exec(read(path.join(dir, f)))?.[1]
      if (port && f.endsWith('.caddy')) out.set(Number(port), `https://${f.slice(0, -6)}.${EXPOSE_DOMAIN}`)
    }
  } catch {
    /* pas de Caddy */
  }
  return out
}

function servers(): Promise<ServerProc[]> {
  return new Promise((resolve) => {
    execFile('ss', ['-ltnpH'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([])
      const urls = exposed()
      const seen = new Set<number>()
      const out: ServerProc[] = []
      for (const line of stdout.split('\n')) {
        const m = /\s(\S+):(\d+)\s+\S+\s*(?:users:\(\("([^"]+)",pid=(\d+))?/.exec(line)
        if (!m) continue
        const port = Number(m[2])
        // Ports d’autres utilisateurs (root : Caddy, systemd) : bruit, sauf s’ils sont exposés.
        if (seen.has(port) || (!m[3] && !urls.has(port))) continue
        seen.add(port)
        let dir: string | undefined
        if (m[4]) {
          try {
            dir = fs.readlinkSync(`/proc/${m[4]}/cwd`).replace(HOME, '~')
          } catch {
            /* processus d'un autre utilisateur */
          }
        }
        out.push({ port, name: m[3] ?? '?', dir, url: urls.get(port) })
      }
      resolve(out.sort((a, b) => a.port - b.port))
    })
  })
}

export async function detail(): Promise<InfraDetail> {
  const m = meminfo()
  const d = disk()
  const cores = os.cpus().length
  const c = current ?? measure()
  const pts = [...today]
  const eps = episodes(pts)
  return {
    id: MACHINE.id,
    name: MACHINE.name,
    weevboss: ORCHESTRATOR,
    os: `${os.type()} ${os.release()}`,
    cores,
    memTotal: m.total,
    memUsed: m.used,
    swapTotal: m.swapTotal,
    swapUsed: m.swapUsed,
    diskTotal: d.total,
    diskUsed: d.used,
    cpu: c.cpu,
    load: os.loadavg().map((x) => Math.round(x * 100) / 100) as [number, number, number],
    uptime: os.uptime() * 1000,
    day: buckets(pts),
    episodes: eps,
    servers: await servers(),
    advice: advice(pts, eps, m, d, cores),
  }
}

// ---------------------------------------------------------------- système de fichiers (tout, pas seulement les repos)

export function listDir(p: string): FsListing {
  const dir = path.resolve(p.replace(/^~(?=\/|$)/, HOME) || '/')
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
      const full = path.join(dir, e.name)
      let isDir = e.isDirectory()
      let size = 0
      try {
        const st = fs.statSync(full)
        isDir = st.isDirectory()
        size = isDir ? 0 : st.size
      } catch {
        /* lien cassé, droits */
      }
      return { name: e.name, dir: isDir, size, ...(e.isSymbolicLink() ? { link: true } : {}) }
    })
    entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    return { path: dir, home: HOME, entries: entries.slice(0, 3000) }
  } catch (e) {
    return { path: dir, home: HOME, entries: [], error: (e as NodeJS.ErrnoException).code ?? (e as Error).message }
  }
}

export function readAny(p: string): { path: string; size: number; binary: boolean; content: string; truncated: boolean } {
  const full = path.resolve(p.replace(/^~(?=\/|$)/, HOME))
  const st = fs.statSync(full)
  if (!st.isFile()) throw new Error(`${full}: not a file`) // i18n-ignore : chemin technique
  const max = 400_000
  const fd = fs.openSync(full, 'r')
  const buf = Buffer.alloc(Math.min(st.size, max))
  fs.readSync(fd, buf, 0, buf.length, 0)
  fs.closeSync(fd)
  const binary = buf.subarray(0, 8000).includes(0)
  return { path: full, size: st.size, binary, content: binary ? '' : buf.toString('utf8'), truncated: st.size > max }
}
