// factory (docs/next-interaction.md, « factory »): the machines weevils works on, the intelligence it works
// with (subscriptions and API keys), the projects in the side bar, read and switched from weevils next's side bar.
//
// Nothing here is guessed: a machine's health is its own measurement (server/infra.ts brief), its kind and host come
// from what it discovered about itself (server/discover.ts facts), what is left of a subscription from the provider's
// own meter (server/usage.ts). The switches are real: a machine turned off starts nothing new (core.ts create, the
// automations' queue) and the agents working there are stopped once you confirm; Codex turned off is never handed
// work; an API key turned off is taken out of weevils' environment (and out of the agents it starts) until it is
// turned back on, without being deleted. Settings live in state.json (core.ts FactoryState), on the main machine.

import fs from 'node:fs'
import type http from 'node:http'
import { KEYS, type FactoryIntel, type FactoryMachine, type FactoryView, type MachineKind } from '../shared/your-factory.ts'
import type { Level, MachineBrief, MachineFacts, QuotaInfo } from '../shared/infra.ts'
import type { Session } from '../shared/api.ts'
import { tr } from './i18n.ts'
import M from './i18n/your-factory.ts'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

/** A computer of yours (a laptop, a desktop, WSL) or a server at a host. Unknown facts: null, never a guess. */
export function machineKind(f: Partial<MachineFacts> | null | undefined): MachineKind | null {
  if (!f) return null
  if (f.laptop || f.hardware || f.virt === 'wsl') return 'pc'
  if (f.virt || f.provider) return 'server'
  return 'pc'
}

/** The host's own dashboard, for the hosts whose address is the same for everyone. */
const PANELS: [RegExp, string][] = [
  [/hostinger/i, 'https://hpanel.hostinger.com/vps'],
  [/hetzner/i, 'https://console.hetzner.cloud'],
  [/digitalocean/i, 'https://cloud.digitalocean.com/droplets'],
  [/\bovh/i, 'https://www.ovh.com/manager/'],
  [/scaleway|online s\.?a/i, 'https://console.scaleway.com'],
  [/linode|akamai/i, 'https://cloud.linode.com'],
  [/vultr|choopa/i, 'https://my.vultr.com'],
  [/contabo/i, 'https://my.contabo.com'],
  [/ionos|1&1/i, 'https://my.ionos.com'],
  [/amazon|aws/i, 'https://console.aws.amazon.com/ec2'],
  [/google/i, 'https://console.cloud.google.com/compute'],
  [/microsoft|azure/i, 'https://portal.azure.com'],
  [/oracle/i, 'https://cloud.oracle.com'],
]
export function panelUrl(provider: string | undefined): string | undefined {
  if (!provider) return undefined
  return PANELS.find(([re]) => re.test(provider))?.[1]
}

/** The host as people say it: « Hostinger Operations UAB » → « Hostinger », « Hetzner Online GmbH » → « Hetzner ». */
export function hostName(org: string | undefined): string | undefined {
  const first = org?.trim().split(/[\s,]+/)[0]?.replace(/[.,]+$/, '')
  return first || undefined
}

/** One figure for a machine's health: the fullest of processor, memory and disk, and how worried to be. */
export function health(b: { cpu: number; mem: number; disk?: number }): { load: number; level: Level } {
  const disk = b.disk ?? 0
  const load = Math.round(Math.max(b.cpu, b.mem, disk))
  const level: Level = b.cpu >= 90 || b.mem >= 92 || disk >= 95 ? 'crit' : b.cpu >= 70 || b.mem >= 80 || disk >= 85 ? 'warn' : 'ok'
  return { load, level }
}

/** What is left of a subscription: its fullest window (5 hours or the week), from the provider's meter. */
export function leftOf(q: QuotaInfo | null | undefined): { left: number; resetsAt: number | null } | null {
  const ws = (q?.ok ? q.windows : []).filter((w) => w.kind === 'session' || w.kind === 'week')
  if (!ws.length) return null
  const full = ws.reduce((a, b) => (b.percent > a.percent ? b : a))
  return { left: Math.max(0, Math.min(100, Math.round(100 - full.percent))), resetsAt: full.resetsAt }
}


/** A key's value as the config file holds it (never logged, never sent anywhere). */
export function configValue(file: string, name: string): string | undefined {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '') || undefined
    }
  } catch {
    /* no config file */
  }
  return undefined
}

/** Keys turned off stay in the config file but leave weevils' environment (and so the agents it starts). */
export function applyKeys(off: readonly string[], file: string, env: NodeJS.ProcessEnv = process.env) {
  for (const k of KEYS) {
    if (off.includes(`key:${k.name}`)) delete env[k.name]
    else if (!env[k.name]) {
      const v = configValue(file, k.name)
      if (v) env[k.name] = v
    }
  }
}

export interface FactoryState {
  names: Record<string, string>
  machinesOff: string[]
  intelOff: string[]
  hidden: string[]
  talks: Record<string, string>
}

export interface FactoryDeps {
  state: () => FactoryState
  change: (fn: (f: FactoryState) => void) => void
  /** This machine first, then the others: name and online as the snapshot has them. */
  machines: () => { id: string; name: string; online?: boolean }[]
  hereId: string
  briefs: () => Promise<MachineBrief[]>
  facts: (id: string) => Promise<MachineFacts | null>
  sessions: () => Session[]
  /** Stops one session's current turn (its Escape). */
  stop: (id: string) => Promise<void>
  quotas: () => Promise<{ claude: QuotaInfo; codex: QuotaInfo }>
  accounts: () => { id: string; n: number; label: string; plan?: string; percent: number | null; resetsAt: number | null; logged: boolean }[] | undefined
  codex: () => boolean
  configFile: string
  /** weevils' environment (process.env), where a key turned on lives. */
  env?: NodeJS.ProcessEnv
  pin: (repo: string, pinned: boolean) => void
  pinned: () => string[]
  /** Starts the machine's own conversation, with the person's first words. */
  startTalk: (machineId: string, name: string, kind: MachineKind | null, provider: string | undefined, text: string) => Promise<{ id: string }>
}

const working = (s: Session) => s.status === 'working' && !s.archived

export async function factoryView(d: FactoryDeps): Promise<FactoryView> {
  const st = d.state()
  const briefs = new Map((await d.briefs().catch(() => [] as MachineBrief[])).map((b) => [b.id, b]))
  const machines = await Promise.all(
    d.machines().map(async (m): Promise<FactoryMachine> => {
      const b = briefs.get(m.id)
      const f = m.online === false ? null : await d.facts(m.id).catch(() => null)
      const h = b && (b.online ?? true) ? health(b) : null
      const talk = st.talks[m.id]
      return {
        id: m.id,
        name: m.name,
        kind: machineKind(f),
        online: m.online !== false,
        off: st.machinesOff.includes(m.id),
        here: m.id === d.hereId,
        load: h?.load ?? null,
        level: h?.level ?? 'ok',
        ...(b && h ? { cpu: Math.round(b.cpu), mem: Math.round(b.mem), ...(b.disk != null ? { disk: b.disk } : {}) } : {}),
        ...(f?.provider ? { provider: hostName(f.provider) } : {}),
        ...(panelUrl(f?.provider) ? { panel: panelUrl(f?.provider) } : {}),
        ...(talk && d.sessions().some((s) => s.id === talk && !s.archived) ? { talk } : {}),
      }
    }),
  )
  const q = await d.quotas().catch(() => null)
  const intelligence: FactoryIntel[] = []
  const claude = leftOf(q?.claude)
  intelligence.push({ id: 'claude', kind: 'subscription', brand: 'claude', name: 'Claude', ...(q?.claude.plan ? { plan: q.claude.plan } : {}), left: claude?.left ?? null, resetsAt: claude?.resetsAt ?? null, off: false, toggle: false })
  for (const a of d.accounts() ?? []) {
    if (a.n === 1) continue
    intelligence.push({ id: `account:${a.id}`, kind: 'subscription', brand: 'claude', name: a.label || `Claude ${a.n}`, ...(a.plan ? { plan: a.plan } : {}), left: a.percent == null ? null : Math.max(0, 100 - a.percent), resetsAt: a.resetsAt, off: false, toggle: false })
  }
  const codexOff = st.intelOff.includes('codex')
  if (d.codex() || codexOff || q?.codex.ok) {
    const c = leftOf(q?.codex)
    intelligence.push({ id: 'codex', kind: 'subscription', brand: 'openai', name: 'Codex', ...(q?.codex.plan ? { plan: q.codex.plan } : {}), left: c?.left ?? null, resetsAt: c?.resetsAt ?? null, off: codexOff, toggle: true })
  }
  for (const k of KEYS) {
    const id = `key:${k.name}`
    const off = st.intelOff.includes(id)
    if (!off && !(d.env ?? process.env)[k.name] && !configValue(d.configFile, k.name)) continue
    intelligence.push({ id, kind: 'key', brand: k.brand, name: k.label, left: null, resetsAt: null, off, toggle: true })
  }
  return { machines, intelligence }
}

/** The routes (main machine only). Errors are refusals in plain words (400). */
export function factoryRoutes(d: FactoryDeps, json: Json, readBody: ReadBody): [string, RegExp, Handler][] {
  const t = () => tr(M)
  const known = (id: unknown) => typeof id === 'string' && d.machines().some((m) => m.id === id)
  return [
    ['GET', /^\/api\/factory$/, async (_req, res) => json(res, 200, await factoryView(d))],
    // A machine: its name, given in place (empty: back to its own), or on / off. Off stops what works there.
    ['POST', /^\/api\/factory\/machine$/, async (req, res) => {
      const b = await readBody(req)
      if (!known(b.id)) return json(res, 400, { error: t().unknownMachine })
      const id = b.id as string
      if (typeof b.name === 'string') {
        const name = b.name.replace(/\s+/g, ' ').trim().slice(0, 40)
        d.change((f) => {
          if (name) f.names[id] = name
          else delete f.names[id]
        })
      }
      let stopped = 0
      if (typeof b.off === 'boolean') {
        d.change((f) => {
          f.machinesOff = f.machinesOff.filter((x) => x !== id)
          if (b.off) f.machinesOff.push(id)
        })
        if (b.off) {
          const here = d.hereId
          for (const s of d.sessions().filter((x) => working(x) && (x.machineId ?? here) === id)) {
            await d.stop(s.id).then(() => stopped++, () => undefined)
          }
        }
      }
      json(res, 200, { ok: true, stopped })
    }],
    // A subscription or a key, on / off (Claude carries weevboss itself: it stays on).
    ['POST', /^\/api\/factory\/intelligence$/, async (req, res) => {
      const b = await readBody(req)
      const id = String(b.id ?? '')
      if (!(id === 'codex' || KEYS.some((k) => id === `key:${k.name}`)) || typeof b.off !== 'boolean') return json(res, 400, { error: t().cantSwitch })
      d.change((f) => {
        f.intelOff = f.intelOff.filter((x) => x !== id)
        if (b.off) f.intelOff.push(id)
      })
      applyKeys(d.state().intelOff, d.configFile, d.env)
      json(res, 200, { ok: true })
    }],
    // A project in the side bar or out of it. In: its repos pinned (the app's own pin, POST /api/github/pin), so it
    // stays even with no conversation. Out: unpinned and hidden, back by itself while one of its conversations works.
    ['POST', /^\/api\/factory\/project$/, async (req, res) => {
      const b = await readBody(req)
      const id = String(b.id ?? '')
      const repos = Array.isArray(b.repos) ? (b.repos as unknown[]).map(String).filter((r) => /^[\w.@+-]+$/.test(r)) : []
      if (!/^[\w.@+-]+$/.test(id) || typeof b.shown !== 'boolean') return json(res, 400, { error: t().cantSwitch })
      if (b.shown) {
        if (!repos.some((r) => d.pinned().includes(r))) d.pin(repos[0] ?? id, true)
      } else for (const r of [...new Set([id, ...repos])]) if (d.pinned().includes(r)) d.pin(r, false)
      d.change((f) => {
        f.hidden = f.hidden.filter((x) => x !== id)
        if (!b.shown) f.hidden.push(id)
      })
      json(res, 200, { ok: true })
    }],
    // A machine's own conversation: started with the person's first words, then found again from its band.
    ['POST', /^\/api\/factory\/talk$/, async (req, res) => {
      const b = await readBody(req)
      if (!known(b.machine) || typeof b.text !== 'string' || !b.text.trim()) return json(res, 400, { error: t().unknownMachine })
      const view = await factoryView(d)
      const m = view.machines.find((x) => x.id === b.machine)!
      if (m.talk) return json(res, 200, { id: m.talk })
      const r = await d.startTalk(m.id, m.name, m.kind, m.provider, b.text)
      d.change((f) => void (f.talks[m.id] = r.id))
      json(res, 200, r)
    }],
  ]
}

/** The hidden words that ride on a machine's first message: which machine this conversation is for. */
export function talkContext(name: string, kind: MachineKind | null, provider: string | undefined): string {
  return tr(M).talkContext(name, kind === 'server' ? (provider ? tr(M).serverAt(provider) : tr(M).server) : kind === 'pc' ? tr(M).pc : tr(M).machine)
}
