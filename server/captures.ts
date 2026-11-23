// The camera's library (next/src/camera.tsx): every capture of the app the person takes from inside it, never from the
// phone's own screenshot, so nothing lands in their camera roll and threads only carry a small thumbnail.
//
// One folder, tidy and searchable:
//   <data>/captures/<group>/<YYYY-MM-DD>-<HHMMSS>-<screen>-<id>.png   the picture
//   <data>/captures/<group>/<same name>.json                          what it shows (the context below)
//   <data>/captures/index.jsonl                                       one line per capture, newest last
// <group> is the project of the screen (its id), else the screen itself (weevboss, for-you…).
// A capture about the interface (sent to weevboss, or to a session working on weevils itself) carries the tag « ui »:
// the improvement loop (a UI session, Night lens) finds them with `weevils captures --ui` or GET /api/captures?tag=ui.
// One sent to another project's session is about that conversation: tag « conversation ».
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface CaptureContext {
  /** Which interface: next or classic. */
  ui?: string
  /** The screen on top: weevboss, for you, session, side bar, or a page's kind (project, files, auto…). */
  screen?: string
  sessionId?: string
  sessionTitle?: string
  projectId?: string
  project?: string
  /** The page on top, when one is: its kind and what names it. */
  page?: { kind: string; id?: string; title?: string }
  theme?: string
  viewport?: { w: number; h: number; dpr: number }
  /** The part selected, in CSS pixels of the viewport; absent for the whole screen. */
  region?: { x: number; y: number; w: number; h: number }
  /** The app's build (dist/build.json commit), when the app knows it. */
  build?: string
}

export interface Capture extends CaptureContext {
  id: string
  at: number
  file: string
  group: string
  /** The line the person wrote with it. */
  text?: string
  /** Where it was sent: weevboss, or a session's id. */
  to?: string
  tags: string[]
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'screen'
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)

/** The context as the app sent it, kept to known fields and sane sizes (it is written to disk and into prompts). */
export function cleanContext(raw: unknown): CaptureContext {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const out: CaptureContext = {}
  for (const k of ['ui', 'screen', 'sessionId', 'sessionTitle', 'projectId', 'project', 'theme', 'build'] as const) {
    const v = str(c[k], k === 'sessionTitle' ? 160 : 80)
    if (v) out[k] = v
  }
  if (c.page && typeof c.page === 'object' && str(c.page.kind, 40)) {
    out.page = { kind: str(c.page.kind, 40)! }
    const id = str(c.page.id, 300)
    const title = str(c.page.title, 160)
    if (id) out.page.id = id
    if (title) out.page.title = title
  }
  if (c.viewport && typeof c.viewport === 'object') out.viewport = { w: num(c.viewport.w), h: num(c.viewport.h), dpr: num(c.viewport.dpr) || 1 }
  if (c.region && typeof c.region === 'object') out.region = { x: num(c.region.x), y: num(c.region.y), w: num(c.region.w), h: num(c.region.h) }
  return out
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const JPEG = Buffer.from([0xff, 0xd8, 0xff])

export class Captures {
  readonly dir: string
  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'captures')
  }

  /** Stores one capture (a PNG or JPEG, base64) with what it shows. Throws on anything that is not a picture. */
  save(input: { data: string; context?: unknown; text?: unknown; to?: unknown; feedback?: unknown }, now = Date.now()): Capture {
    const bytes = Buffer.from(String(input.data ?? '').replace(/^data:image\/\w+;base64,/, ''), 'base64')
    const ext = bytes.subarray(0, 4).equals(PNG) ? '.png' : bytes.subarray(0, 3).equals(JPEG) ? '.jpg' : ''
    if (!ext || bytes.length < 60) throw new Error('not an image') // i18n-ignore: the route answers with its own message
    const ctx = cleanContext(input.context)
    const group = slug(ctx.projectId ?? ctx.screen ?? 'screen')
    const id = crypto.randomBytes(4).toString('hex')
    const d = new Date(now)
    const stamp = d.toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')
    const name = `${stamp}-${slug(ctx.page?.kind ?? ctx.screen ?? 'screen')}-${id}`
    const folder = path.join(this.dir, group)
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    const file = path.join(folder, name + ext)
    fs.writeFileSync(file, bytes, { mode: 0o600 })
    const entry: Capture = { id, at: now, file, group, ...ctx, tags: [input.feedback === false ? 'conversation' : 'ui'] }
    const text = str(input.text, 2000)
    if (text) entry.text = text
    const to = str(input.to, 120)
    if (to) entry.to = to
    fs.writeFileSync(path.join(folder, name + '.json'), JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 })
    fs.appendFileSync(path.join(this.dir, 'index.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 })
    return entry
  }

  /** Every capture, newest first, filtered by words (text, titles, screen, project), group or tag. */
  list(opts: { q?: string; group?: string; tag?: string; limit?: number } = {}): Capture[] {
    let lines: string[] = []
    try { lines = fs.readFileSync(path.join(this.dir, 'index.jsonl'), 'utf8').split('\n') } catch { return [] }
    const words = (opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const out: Capture[] = []
    for (let i = lines.length - 1; i >= 0 && out.length < (opts.limit ?? 200); i--) {
      let c: Capture
      try { c = JSON.parse(lines[i]) as Capture } catch { continue }
      if (!fs.existsSync(c.file)) continue
      if (opts.group && c.group !== opts.group) continue
      if (opts.tag && !c.tags?.includes(opts.tag)) continue
      if (words.length) {
        const hay = [c.text, c.sessionTitle, c.project, c.screen, c.page?.kind, c.page?.title, c.group, c.theme, c.id].join(' ').toLowerCase()
        if (!words.every((w) => hay.includes(w))) continue
      }
      out.push(c)
    }
    return out
  }
}
