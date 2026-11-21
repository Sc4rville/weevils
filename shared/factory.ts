// Automation → factory (docs/automations/PROTOCOL.md): the measured signals, the rule that makes an automation
// eligible, the manifest's mirror of a schedule, and the panels a factory declares for its page. Pure: shared by the
// server (which measures and decides) and the app (which says why and draws the panels). Tested in factory.test.ts.

/** Every number of the rule, in one place (PROTOCOL.md, section 8). */
export const FACTORY = {
  /** Mature: this many runs, accepted this many days ago, this many of its last ten runs good. */
  MATURE_RUNS: 10,
  MATURE_DAYS: 7,
  MATURE_OK: 8,
  /** The other reasons look at this many days. */
  WINDOW_DAYS: 30,
  USED_COUNT: 12,
  USED_DAYS: 4,
  PUSHED_COUNT: 5,
  REQUESTS: 3,
  PROVEN_RUNS: 30,
  PROVEN_OK: 9,
  GROWN_COMMITS: 3,
  /** One new proposal a week for the whole installation. */
  PROPOSE_EVERY_DAYS: 7,
  /** « Not now »: silent this long and until this many more runs; after this many, weevboss never says it again. */
  LATER_DAYS: 30,
  LATER_RUNS: 10,
  MAX_LATER: 3,
  /** Daily usage counters are kept this long. */
  USAGE_KEEP_DAYS: 60,
  MAX_PANELS: 8,
} as const

/** What the person did with an automation on one day (whole numbers; a signed-in browser only). */
export type UsageKind = 'page' | 'run' | 'results' | 'card' | 'now'
export type UsageDay = Partial<Record<UsageKind, number>>
export const USAGE_KINDS: readonly UsageKind[] = ['page', 'run', 'results', 'card', 'now']
/** A consumption: its page, one of its runs, its results page, one of its For you cards. « now » is a push. */
const CONSUMED: readonly UsageKind[] = ['page', 'run', 'results', 'card']

export interface AutoSignals {
  accepted: boolean
  recurring: boolean
  builtin: boolean
  paused: boolean
  /** Its source is adopted and committed. */
  ready: boolean
  runs: number
  /** Of its last `lastOf` runs (ten at most), how many succeeded. */
  lastOk: number
  lastOf: number
  ageDays: number
  /** Last WINDOW_DAYS days. */
  consumed: number
  consumedDays: number
  pushes: number
  requests: number
  /** Commits in its source beyond the adoption commit. */
  commits: number
  resultsPage: boolean
}

export type PromotionReason =
  | { kind: 'used'; count: number; days: number }
  | { kind: 'pushed'; pushes: number; requests: number }
  | { kind: 'proven'; runs: number; ok: number; of: number }
  | { kind: 'grown'; commits: number }

export interface Eligibility {
  mature: boolean
  reasons: PromotionReason[]
  eligible: boolean
}

/** Eligible = mature, and one more reason (used, pushed, proven or grown). No score, no weighting. */
export function eligibility(s: AutoSignals): Eligibility {
  const mature = s.accepted && s.recurring && !s.builtin && !s.paused && s.ready && s.runs >= FACTORY.MATURE_RUNS && s.ageDays >= FACTORY.MATURE_DAYS && s.lastOf >= 10 && s.lastOk >= FACTORY.MATURE_OK
  const reasons: PromotionReason[] = []
  if (s.consumed >= FACTORY.USED_COUNT && s.consumedDays >= FACTORY.USED_DAYS) reasons.push({ kind: 'used', count: s.consumed, days: s.consumedDays })
  if (s.pushes >= FACTORY.PUSHED_COUNT || s.requests >= FACTORY.REQUESTS) reasons.push({ kind: 'pushed', pushes: s.pushes, requests: s.requests })
  if (s.runs >= FACTORY.PROVEN_RUNS && s.lastOk >= FACTORY.PROVEN_OK) reasons.push({ kind: 'proven', runs: s.runs, ok: s.lastOk, of: s.lastOf })
  if (s.commits >= FACTORY.GROWN_COMMITS && s.resultsPage) reasons.push({ kind: 'grown', commits: s.commits })
  return { mature, reasons, eligible: mature && reasons.length > 0 }
}

const DAY_MS = 86_400_000
/** The local-free day key of an instant (UTC): counters need a stable bucket, not a calendar. */
export const usageDay = (at: number) => new Date(at).toISOString().slice(0, 10)

/** One more of `kind` today; days older than USAGE_KEEP_DAYS are dropped. Returns the same object. */
export function countUsage(usage: Record<string, UsageDay>, kind: UsageKind, now: number): Record<string, UsageDay> {
  const day = usageDay(now)
  const d = (usage[day] ??= {})
  d[kind] = (d[kind] ?? 0) + 1
  const oldest = usageDay(now - FACTORY.USAGE_KEEP_DAYS * DAY_MS)
  for (const k of Object.keys(usage)) if (k < oldest) delete usage[k]
  return usage
}

/** Over the last WINDOW_DAYS: consumptions, the days that had one, and « run now » taps. */
export function usageTotals(usage: Record<string, UsageDay> | undefined, now: number): { consumed: number; consumedDays: number; now: number } {
  const from = usageDay(now - FACTORY.WINDOW_DAYS * DAY_MS)
  let consumed = 0
  let consumedDays = 0
  let taps = 0
  for (const [day, d] of Object.entries(usage ?? {})) {
    if (day < from) continue
    const n = CONSUMED.reduce((sum, k) => sum + (d[k] ?? 0), 0)
    consumed += n
    if (n) consumedDays++
    taps += d.now ?? 0
  }
  return { consumed, consumedDays, now: taps }
}

/** The repository name of an automation: lowercase words of its title joined by « - » (40 characters at most). */
export function slugName(title: string, fallback = 'automation'): string {
  const s = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return s || fallback
}

/** A name nobody in `taken` has: the slug, else the slug with the first characters of the id. */
export function uniqueName(title: string, id: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugName(title)
  if (!used.has(base)) return base
  const withId = `${base.slice(0, 34)}-${id.slice(0, 4)}`
  return used.has(withId) ? `${base.slice(0, 28)}-${id}` : withId
}

// ---------------------------------------------------------------- the manifest's mirror of a schedule

export interface ManifestSchedule {
  trigger: 'every' | 'window' | 'time' | 'idle' | 'sleep'
  /** « 3h », « 24h », « 7d ». */
  every?: string
  /** « 01:00-05:00 », local time. */
  window?: string
  /** ISO date of a one-off. */
  at?: string
}

const span = (ms: number) => (ms % DAY_MS === 0 && ms >= 2 * DAY_MS ? `${ms / DAY_MS}d` : ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`)
const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** What the manifest says of a schedule (a mirror: the scheduler's record is the authority). */
export function scheduleMirror(o: { every?: number; window?: { from: number; to: number }; notBefore?: number; onSleep?: boolean }): ManifestSchedule {
  const every = o.every ? { every: span(o.every) } : {}
  const window = o.window ? { window: `${clock(o.window.from)}-${clock(o.window.to)}` } : {}
  if (o.onSleep) return { trigger: 'sleep', ...every, ...window }
  if (o.every) return { trigger: 'every', ...every, ...window }
  if (o.window) return { trigger: 'window', ...window }
  if (o.notBefore) return { trigger: 'time', at: new Date(o.notBefore).toISOString() }
  return { trigger: 'idle' }
}

// ---------------------------------------------------------------- the page a factory declares

/** A label in the manifest: one string, or one per language. */
export type Label = string | { en?: string; fr?: string }
export const labelText = (l: Label | undefined, lang: string): string | undefined => (typeof l === 'string' ? l : l ? (l[lang as 'en' | 'fr'] ?? l.en ?? l.fr) : undefined)

export const FACT_ITEMS = ['next', 'schedule', 'last', 'runs', 'owner', 'repository'] as const
export type FactItem = (typeof FACT_ITEMS)[number]
export const ACTION_DOS = ['run', 'pause', 'results', 'conversation', 'repository'] as const
export type ActionDo = (typeof ACTION_DOS)[number]

export interface MetricRef { key: string; label?: Label }
export type PanelAction = { do: ActionDo; label?: Label } | { ask: string; label: Label }

export type FactoryPanel =
  | { type: 'hero' }
  | { type: 'facts'; items?: FactItem[] }
  | { type: 'metrics'; items: MetricRef[] }
  | { type: 'chart'; metric: string; runs?: number; label?: Label }
  | { type: 'results'; limit?: number }
  | { type: 'gallery'; limit?: number }
  | { type: 'report' }
  | { type: 'runs' }
  | { type: 'actions'; items: PanelAction[] }
  | { type: 'text'; title?: Label; body: Label }

const KEY = /^[a-z][a-z0-9_.-]{0,39}$/i
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const text = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined)
function label(x: unknown, max = 60): Label | undefined {
  if (typeof x === 'string') return text(x, max)
  if (!isObj(x)) return undefined
  const en = text(x.en, max)
  const fr = text(x.fr, max)
  return en || fr ? { ...(en ? { en } : {}), ...(fr ? { fr } : {}) } : undefined
}
const int = (x: unknown, min: number, max: number): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : undefined)
const metric = (x: unknown): MetricRef | undefined => {
  if (!isObj(x) || typeof x.key !== 'string' || !KEY.test(x.key)) return undefined
  const l = label(x.label)
  return { key: x.key, ...(l ? { label: l } : {}) }
}

/**
 * The panels of a manifest's `page`, checked: a closed vocabulary, plain text only, bounded sizes. An unknown panel or
 * option is skipped, never an error (a newer manifest still draws on an older weevils). Never HTML, colours or code.
 */
export function parsePanels(raw: unknown): FactoryPanel[] {
  const list = isObj(raw) && Array.isArray(raw.panels) ? raw.panels : Array.isArray(raw) ? raw : []
  const out: FactoryPanel[] = []
  for (const p of list) {
    if (out.length >= FACTORY.MAX_PANELS) break
    if (!isObj(p)) continue
    switch (p.type) {
      case 'hero': case 'report': case 'runs':
        out.push({ type: p.type })
        break
      case 'facts': {
        const items = Array.isArray(p.items) ? (p.items.filter((i) => (FACT_ITEMS as readonly unknown[]).includes(i)) as FactItem[]) : undefined
        out.push(items?.length ? { type: 'facts', items } : { type: 'facts' })
        break
      }
      case 'metrics': {
        const items = (Array.isArray(p.items) ? p.items : []).map(metric).filter((m): m is MetricRef => !!m).slice(0, 4)
        if (items.length) out.push({ type: 'metrics', items })
        break
      }
      case 'chart': {
        if (typeof p.metric !== 'string' || !KEY.test(p.metric)) break
        const runs = int(p.runs, 2, 30)
        const l = label(p.label)
        out.push({ type: 'chart', metric: p.metric, ...(runs ? { runs } : {}), ...(l ? { label: l } : {}) })
        break
      }
      case 'results': case 'gallery': {
        const limit = int(p.limit, 1, p.type === 'results' ? 10 : 6)
        out.push(limit ? { type: p.type, limit } : { type: p.type })
        break
      }
      case 'actions': {
        const items: PanelAction[] = []
        for (const a of Array.isArray(p.items) ? p.items : []) {
          if (!isObj(a) || items.length >= 4) continue
          const l = label(a.label, 40)
          if ((ACTION_DOS as readonly unknown[]).includes(a.do)) items.push({ do: a.do as ActionDo, ...(l ? { label: l } : {}) })
          else if (l && text(a.ask, 2000)) items.push({ ask: text(a.ask, 2000)!, label: l })
        }
        if (items.length) out.push({ type: 'actions', items })
        break
      }
      case 'text': {
        const body = label(p.body, 600)
        const title = label(p.title)
        if (body) out.push({ type: 'text', ...(title ? { title } : {}), body })
        break
      }
      default:
        break
    }
  }
  return out
}

/** The page of a factory that declares none: who it is, how it does, when it runs, what it made, its runs, what to
 *  do with it. */
export function defaultPanels(o: { resultsPage: boolean }): FactoryPanel[] {
  return [
    { type: 'hero' },
    { type: 'metrics', items: [{ key: 'runs.total' }, { key: 'runs.ok' }, { key: 'runs.streak' }] },
    { type: 'facts', items: ['next', 'schedule'] },
    o.resultsPage ? { type: 'results', limit: 5 } : { type: 'report' },
    { type: 'runs' },
    { type: 'actions', items: [{ do: 'run' }, { do: 'conversation' }, { do: 'repository' }] },
  ]
}

/** A run card's numbers (PROTOCOL.md, section 6): finite numbers under plain keys, twelve at most. */
export function parseMetrics(raw: unknown): Record<string, number> | undefined {
  if (!isObj(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= 12) break
    if (KEY.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** A weevils page named in a manifest or a run card: `<kind>/<slug>` (a leading « /p/ » is accepted). */
export function pageRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const m = /^(?:\/?p\/)?([a-z]+)\/([a-z0-9][a-z0-9-]{0,80})$/.exec(raw.trim())
  return m ? `${m[1]}/${m[2]}` : undefined
}
