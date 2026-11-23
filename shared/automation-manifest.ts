// An automation's manifest (docs/automations/PROTOCOL.md): its name, the manifest's mirror of a schedule, and what a
// run card holds. Pure: shared by the server and the app. Tested in automation-manifest.test.ts.

const DAY_MS = 86_400_000
const KEY = /^[a-z][a-z0-9_.-]{0,39}$/i
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** The short name of an automation: lowercase words of its title joined by « - » (40 characters at most). */
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
