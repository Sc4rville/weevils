// The « pages » band (docs/LINKS.md, « The pages band »): the person's own pages, in next's side bar. A page made there
// is a living link (server/pages.ts, kind preview) served from its own folder in weevils' data, <data>/made-pages/<slug>,
// and built by a conversation: an ordinary agent session working in that folder, told its job by the folder's
// CLAUDE.md / AGENTS.md. A page published elsewhere (a report…) can join the band too, without a conversation.
//
// A made page may read weevils' own data, read-only: its keyed address serves weevils.json (sessions, automations,
// requests, projects) and weevils.css (the current theme's colours). It still runs in the pages' sandbox, without
// weevils' origin, so nothing it does can drive the API.
import fs from 'node:fs'
import path from 'node:path'
import type { BandPage, Session, Snapshot } from '../shared/api.ts'
import { slugOf } from '../shared/pages.ts'
import { tr } from './i18n.ts'
import M from './i18n/page-band.ts'
import { PageRefused, type Pages } from './pages.ts'

interface Entry {
  slug: string
  /** The conversation that builds it (made here); none for a page that joined from elsewhere. */
  session?: string
  at: number
}

const IDEA_MAX = 2000

interface PageBandOptions {
  dataDir: string
  /** Where made pages live (MADE_PAGES_DIR). */
  root: string
  pages: Pages
  /** Starts the conversation that builds a page, in its folder; its first message is the idea. */
  start: (cwd: string, title: string, text: string) => Promise<{ id: string }>
  /** The page's public address (for its brief). */
  url: (pagePath: string) => string
  /** This machine's own address of weevils (http://127.0.0.1:<port>), for the agent to read what its page reads. */
  local: string
  /** A conversation's current id (a resumed one can come back under a new id). */
  resolve: (id: string) => string
  changed: () => void
}

export class PageBand {
  private file: string
  /** Where made pages live, one folder each. */
  readonly root: string

  private o: PageBandOptions

  constructor(o: PageBandOptions) {
    this.o = o
    this.file = path.join(o.dataDir, 'page-band.json')
    this.root = o.root
  }

  private read(): Entry[] {
    try {
      const list = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return Array.isArray(list) ? list.filter((e) => e && typeof e.slug === 'string') : []
    } catch {
      return []
    }
  }

  private write(list: Entry[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(list, null, 1))
    fs.renameSync(tmp, this.file)
    this.o.changed()
  }

  /** The band, in the order its pages joined; a page unpublished since is left out. */
  list(): BandPage[] {
    return this.read().flatMap((e) => {
      const p = this.o.pages.get(e.slug)
      if (!p || !fs.existsSync(path.join(p.root, p.entry))) return []
      return [{ slug: p.slug, title: p.title, kind: p.kind, path: p.path, ...(e.session ? { session: this.o.resolve(e.session) } : {}) }]
    })
  }

  /** A page made here (its data and theme are served to it). */
  made(slug: string): boolean {
    return this.read().some((e) => e.slug === slug && !!e.session)
  }

  /** A new page from an idea: its folder, a blank first version, its address, and the conversation that builds it. */
  async make(idea: unknown): Promise<{ slug: string; session: string; path: string }> {
    const t = tr(M)
    const text = typeof idea === 'string' ? idea.trim() : ''
    if (!text) throw new PageRefused(t.empty)
    if (text.length > IDEA_MAX) throw new PageRefused(t.tooLong)
    const title = titleOf(text)
    // A free folder: never an existing page's, never another page's folder.
    const base = slugOf(title)
    let slug = base
    for (let i = 2; this.o.pages.get(slug) || fs.existsSync(path.join(this.root, slug)); i++) slug = `${base}-${i}`
    const dir = path.join(this.root, slug)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), blankPage(title))
    const page = this.o.pages.publish({ path: dir, title, kind: 'preview', slug })
    const data = `${this.o.local}/api/page/${this.o.pages.key(page.slug)}/${page.slug}/weevils.json`
    const brief = t.brief({ title, url: this.o.url(page.path), slug: page.slug, data })
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), brief)
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), brief)
    let session: string
    try {
      session = (await this.o.start(dir, title, text)).id
    } catch (e) {
      this.o.pages.remove(page.slug)
      fs.rmSync(dir, { recursive: true, force: true })
      throw e
    }
    this.write([...this.read().filter((e) => e.slug !== page.slug), { slug: page.slug, session, at: Date.now() }])
    return { slug: page.slug, session, path: page.path }
  }

  /** An already published page joins the band (`weevils page pin <slug>`). */
  add(slug: string): BandPage {
    const p = this.o.pages.get(slug)
    if (!p) throw new PageRefused(tr(M).notPage)
    const list = this.read()
    if (!list.some((e) => e.slug === slug)) this.write([...list, { slug, at: Date.now() }])
    return this.list().find((x) => x.slug === slug)!
  }

  /** Leaves the band (`weevils page unpin <slug>`); the page itself stays published. */
  drop(slug: string): boolean {
    const list = this.read()
    if (!list.some((e) => e.slug === slug)) return false
    this.write(list.filter((e) => e.slug !== slug))
    return true
  }

  /** When the page's files last changed: the app reloads its preview when this moves. */
  stamp(slug: string): number {
    const p = this.o.pages.get(slug)
    return p ? newest(p.root, 2) : 0
  }
}

/** The idea, as the page's first title: its first line, at most 60 characters on a word. */
export function titleOf(idea: string): string {
  const line = idea.split('\n').map((l) => l.trim()).find(Boolean) ?? idea
  const flat = line.replace(/\s+/g, ' ').replace(/[.!?…:;,\s]+$/, '')
  if (flat.length <= 60) return flat.charAt(0).toUpperCase() + flat.slice(1)
  const cut = flat.slice(0, 60)
  const word = cut.lastIndexOf(' ')
  const t = (word > 30 ? cut.slice(0, word) : cut).replace(/[.!?…:;,\s]+$/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The first version, before the agent writes anything: the theme's empty page. */
function blankPage(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="weevils.css">
</head>
<body></body>
</html>
`
}

/** The newest modification time under a folder, a few levels deep, hidden folders and dependencies skipped. */
function newest(dir: string, depth: number): number {
  let max = 0
  let names: fs.Dirent[]
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const d of names) {
    if (d.name.startsWith('.') || d.name === 'node_modules' || /^(CLAUDE|AGENTS)\.md$/.test(d.name)) continue
    const p = path.join(dir, d.name)
    if (d.isDirectory()) {
      if (depth > 0) max = Math.max(max, newest(p, depth - 1))
    } else {
      try {
        max = Math.max(max, fs.statSync(p).mtimeMs)
      } catch { /* gone meanwhile */ }
    }
  }
  return Math.floor(max)
}

// ---------------------------------------------------------------- what a made page may read

/** weevils.json: what a page may know of weevils, read-only, nothing secret (no paths, keys, addresses). */
export function pageData(snap: Snapshot, requests: unknown[]): unknown {
  const projects = new Map(snap.projects.map((p) => [p.id, p.name]))
  const session = (s: Session) => ({
    id: s.id,
    title: s.title,
    project: projects.get(s.projectId) ?? s.projectId,
    tool: s.tool,
    status: s.status,
    ...(s.now ? { now: s.now } : {}),
    ...(s.attention ? { attention: s.attention } : {}),
    ...(s.asksYou ? { asksYou: s.asksYou } : {}),
    openedAt: s.openedAt,
    lastActivityAt: s.lastActivityAt,
    ...(s.workStartedAt != null ? { workStartedAt: s.workStartedAt } : {}),
  })
  return {
    at: Date.now(),
    theme: snap.theme ?? null,
    projects: snap.projects.map((p) => ({ id: p.id, name: p.name, lastActivityAt: p.lastActivityAt })),
    sessions: snap.sessions.filter((s) => !s.archived).map(session),
    automations: (snap.optimizers ?? []).filter((o) => o.state !== 'proposed' && o.state !== 'refused').map((o) => ({
      id: o.id,
      title: o.title,
      state: o.state,
      ...(o.scope || o.why ? { what: o.scope || o.why } : {}),
      ...(o.paused ? { paused: true } : {}),
      runCount: o.runCount ?? 0,
      ...(o.startedAt ? { startedAt: o.startedAt } : {}),
      runs: (o.runs ?? []).slice(0, 30).map((r) => ({ at: r.at, ok: r.ok, ...(r.note ? { note: r.note } : {}) })),
    })),
    requests,
  }
}

const THEME_BLOCK = /([^{}]+)\{([^{}]*)\}/g

/** weevils.css: the theme's colours as CSS variables, read from the app's own stylesheet, and the house look's few
 *  rules. With no theme picked, light, and dark where the device prefers it. */
export function themeCss(theme: string | undefined, stylesheet: string | null): string {
  const tokens = new Map<string, string>()
  if (stylesheet) {
    // Only the theme blocks at the head of the stylesheet (before its first element rule).
    const head = stylesheet.slice(0, Math.max(0, stylesheet.indexOf('\n* {')) || stylesheet.length).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of head.matchAll(THEME_BLOCK)) {
      const sel = m[1].trim()
      const vars = m[2].split(';').map((l) => l.trim()).filter((l) => l.startsWith('--') || l.startsWith('color-scheme')).join(';\n  ')
      if (sel === ':root') tokens.set('root', vars)
      for (const t of sel.matchAll(/data-theme='([\w-]+)'/g)) if (!tokens.has(t[1])) tokens.set(t[1], vars)
    }
  }
  const light = tokens.get('light') ?? 'color-scheme: light;\n  --ink: #000;\n  --agent: #b39bff;\n  --h24: #ffc64c'
  const dark = tokens.get('dark') ?? 'color-scheme: dark;\n  --ink: #fff;\n  --agent: #5522b5;\n  --h24: #744900'
  const root = tokens.get('root') ?? "--font: -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  const picked = theme && theme !== 'light' && tokens.get(theme)
  const bgOf = (scheme: string) => (/color-scheme:\s*dark/.test(scheme) ? '#000' : '#fff')
  const vars = picked
    ? `:root {\n  ${root};\n  ${light};\n  --bg: ${bgOf(light)};\n}\n:root {\n  ${picked};\n  --bg: ${bgOf(picked)};\n}\n`
    : `:root {\n  ${root};\n  ${light};\n  --bg: #fff;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n  ${dark};\n  --bg: #000;\n  }\n}\n`
  return `${vars}* { box-sizing: border-box; border-radius: 0; }
html { background: var(--bg); color: var(--ink); font-family: var(--font); -webkit-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
body { margin: 0; min-height: 100dvh; }
h1, h2, h3 { margin: 0; font-weight: 800; letter-spacing: -0.02em; }
a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.band { background: var(--c, var(--agent)); color: var(--ink); padding: 18px; }
`
}

/** The app's stylesheet beside the server (a checkout or an install's bundle); none: the built-in colours. */
export function readStylesheet(): string | null {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8')
  } catch {
    return null
  }
}
