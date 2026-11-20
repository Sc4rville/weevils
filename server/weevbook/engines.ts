// A machine's engines.json (docs/spec/06-dispatch.md, « The engine table»): the accounts signed in here, their quota,
// the projects present. Each machine writes it to refs/engines/<machine> on the hub (one commit with no parent, forced,
// 03-sync-and-lease.md) on every change and at least every 60 s; the dispatcher reads them all back.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { QuotaInfo } from '../../shared/infra.ts'
import type { MachineFacts, Quota } from './dispatch.ts'
import { REMOTE } from './hub.ts'
import type { Provider } from './journal.ts'
import type { GitRunner } from './lease.ts'
import { machinePart } from './sync.ts'

/** A machine rewrites its engines.json at least this often. */
export const PUBLISH_EVERY = 60_000

export interface EnginesJson {
  v: 1
  machine: string
  /** When the machine wrote it, by its own clock (ISO). */
  seen: string
  projects: string[]
  engines: { engine: string; signedIn: boolean }[]
  /** Per account (`<provider>:<account>`): the figures read on this machine. */
  quotas: Record<string, { readAt: string; fiveHour: { used: number; resetsAt: string | null }; week: { used: number; resetsAt: string | null } }>
}

/** One account of a provider on this machine, as weevilsd knows it. */
export interface EngineSource {
  provider: Provider
  /** The six hex characters of the engine id (01-thread.md). */
  account: string
  signedIn: boolean
  quota: () => Promise<QuotaInfo | null>
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
const ms = (s: string | null) => (s === null ? null : Date.parse(s))

/** The account part of an engine id, from a provider account id (the same hash as sync.ts accountOf). */
export const accountHash = (id: string) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 6)

/** The account of a Claude Code folder (its .claude.json), `unknown` when it does not say. */
export function claudeAccountIn(file: string): string {
  try {
    const id = JSON.parse(fs.readFileSync(file, 'utf8'))?.oauthAccount?.accountUuid
    return typeof id === 'string' && id ? accountHash(id) : 'unknown'
  } catch {
    return 'unknown'
  }
}
/** The Claude account of a config folder (CLAUDE_CONFIG_DIR), or of the home one (null). */
export const claudeAccountOf = (dir: string | null, home: string) => claudeAccountIn(dir ? path.join(dir, '.claude.json') : path.join(home, '.claude.json'))

/** A provider's quota, as a quota of the table: the 5-hour window (Codex's shorter one) and the week. */
export function quotaFrom(q: QuotaInfo | null | undefined, now: number): Quota | null {
  if (!q?.ok) return null
  const five = q.windows.find((w) => w.kind === 'session')
  const week = q.windows.find((w) => w.kind === 'week')
  return { readAt: q.at || now, fiveHour: { used: five?.percent ?? 0, resetsAt: five?.resetsAt ?? null }, week: { used: week?.percent ?? 0, resetsAt: week?.resetsAt ?? null } }
}

/** This machine's engines.json, now. An account whose quota cannot be read has none in the file: the dispatcher reads
 *  no room on it until it can. */
export async function machineEngines(machine: string, projects: readonly string[], sources: readonly EngineSource[], now: number): Promise<EnginesJson> {
  const m = machinePart(machine)
  const engines: EnginesJson['engines'] = []
  const quotas: EnginesJson['quotas'] = {}
  for (const s of sources) {
    if (s.account === 'unknown') continue
    const engine = `${s.provider}:${s.account}@${m}`
    if (engines.some((e) => e.engine === engine)) continue
    engines.push({ engine, signedIn: s.signedIn })
    if (!s.signedIn) continue
    const q = quotaFrom(await s.quota().catch(() => null), now)
    if (q) quotas[`${s.provider}:${s.account}`] = { readAt: iso(q.readAt)!, fiveHour: { used: q.fiveHour.used, resetsAt: iso(q.fiveHour.resetsAt) }, week: { used: q.week.used, resetsAt: iso(q.week.resetsAt) } }
  }
  return { v: 1, machine: m, seen: new Date(now).toISOString(), projects: [...projects].sort(), engines: engines.sort((a, b) => (a.engine < b.engine ? -1 : 1)), quotas }
}

export function parseEngines(text: string): EnginesJson | null {
  try {
    const j = JSON.parse(text) as EnginesJson
    if (j?.v !== 1 || typeof j.machine !== 'string' || !Number.isFinite(Date.parse(j.seen)) || !Array.isArray(j.engines)) return null
    return { ...j, projects: Array.isArray(j.projects) ? j.projects.filter((p) => typeof p === 'string') : [], quotas: j.quotas && typeof j.quotas === 'object' ? j.quotas : {} }
  } catch {
    return null
  }
}

/** engines.json as the dispatcher's table takes it (times in ms). */
export function factsOf(j: EnginesJson): { facts: Omit<MachineFacts, 'seen' | 'answers'>; quotas: Record<string, Quota>; seen: number } {
  const quotas: Record<string, Quota> = {}
  for (const [acc, q] of Object.entries(j.quotas)) {
    const readAt = Date.parse(q.readAt)
    if (!Number.isFinite(readAt)) continue
    quotas[acc] = { readAt, fiveHour: { used: Number(q.fiveHour?.used) || 0, resetsAt: ms(q.fiveHour?.resetsAt ?? null) }, week: { used: Number(q.week?.used) || 0, resetsAt: ms(q.week?.resetsAt ?? null) } }
  }
  return { facts: { machine: j.machine, projects: j.projects, engines: j.engines.filter((e) => typeof e?.engine === 'string').map((e) => ({ engine: e.engine, signedIn: e.signedIn === true })) }, quotas, seen: Date.parse(j.seen) }
}

const ENV = { GIT_AUTHOR_NAME: 'weevils', GIT_AUTHOR_EMAIL: 'weevils@weevbook.invalid', GIT_COMMITTER_NAME: 'weevils', GIT_COMMITTER_EMAIL: 'weevils@weevbook.invalid' }

/** Writes engines.json to refs/engines/<machine> on the hub: one commit with no parent, forced. */
export async function publishEngines(git: GitRunner, j: EnginesJson): Promise<boolean> {
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: `${JSON.stringify(j, null, 1)}\n` })).stdout.trim()
  if (!blob) return false
  const tree = (await git(['mktree'], { input: `100644 blob ${blob}\tengines.json\n` })).stdout.trim()
  const commit = (await git(['commit-tree', tree, '-m', `engines · ${j.machine}`], { env: ENV })).stdout.trim()
  if (!commit) return false
  return (await git(['push', '--quiet', REMOTE, `+${commit}:refs/engines/${j.machine}`])).code === 0
}

/** Every machine's engines.json on the hub (the dispatcher's read). */
export async function readEngines(git: GitRunner): Promise<EnginesJson[] | null> {
  if ((await git(['fetch', '--quiet', '--prune', '--no-tags', REMOTE, '+refs/engines/*:refs/hub/engines/*'])).code !== 0) return null
  const refs = (await git(['for-each-ref', '--format=%(objectname)', 'refs/hub/engines/'])).stdout.split('\n').filter(Boolean)
  const out: EnginesJson[] = []
  for (const sha of refs) {
    const j = parseEngines((await git(['cat-file', 'blob', `${sha}:engines.json`])).stdout)
    if (j) out.push(j)
  }
  return out
}
