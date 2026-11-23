import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Snapshot } from '../shared/api.ts'
import { PageBand, pageData, themeCss, titleOf } from './page-band.ts'
import { PageRefused, Pages } from './pages.ts'
import { internalCwd, MADE_PAGES_DIR, DATA_DIR, madePageCwd, madePageTranscript } from './config.ts'

let tmp: string
let pages: Pages
let band: PageBand
let started: { cwd: string; title: string; text: string }[]
let changes: number

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-band-'))
  const data = path.join(tmp, 'data')
  pages = new Pages({ dataDir: data, secret: 'secret', roots: [path.join(tmp, 'projects')] })
  started = []
  changes = 0
  band = new PageBand({
    dataDir: data,
    root: path.join(data, 'made-pages'),
    pages,
    start: async (cwd, title, text) => (started.push({ cwd, title, text }), { id: `s-${started.length}` }),
    url: (p) => `https://weevils.example.com${p}`,
    local: 'http://127.0.0.1:4179',
    resolve: (id) => (id === 's-1' ? 's-1b' : id),
    changed: () => void changes++,
  })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('the pages band', () => {
  it('makes a page from an idea: its folder, a blank first version, its address, its brief, its conversation', async () => {
    const r = await band.make('A visualizer for the nightly test sweep')
    expect(r).toEqual({ slug: 'a-visualizer-for-the-nightly-test-sweep', session: 's-1', path: '/p/preview/a-visualizer-for-the-nightly-test-sweep' })
    const dir = path.join(tmp, 'data', 'made-pages', r.slug)
    expect(started).toEqual([{ cwd: dir, title: 'A visualizer for the nightly test sweep', text: 'A visualizer for the nightly test sweep' }])
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toContain('<link rel="stylesheet" href="weevils.css">')
    const brief = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')
    expect(brief).toContain('https://weevils.example.com/p/preview/a-visualizer-for-the-nightly-test-sweep')
    expect(brief).toContain(`http://127.0.0.1:4179/api/page/${pages.key(r.slug)}/${r.slug}/weevils.json`)
    expect(brief).toContain(`--slug ${r.slug}`)
    expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(brief)
    // Listed with its conversation's current id (a resumed one moved on), and the app was told.
    expect(band.list()).toEqual([{ slug: r.slug, title: 'A visualizer for the nightly test sweep', kind: 'preview', path: r.path, session: 's-1b' }])
    expect(band.made(r.slug)).toBe(true)
    expect(changes).toBe(1)
  })

  it('never reuses the folder or the address of another page', async () => {
    const a = await band.make('A studio for shop-app')
    const b = await band.make('A studio for shop-app')
    expect(a.slug).toBe('a-studio-for-shop-app')
    expect(b.slug).toBe('a-studio-for-shop-app-2')
    expect(band.list().map((p) => p.slug)).toEqual([a.slug, b.slug])
  })

  it('refuses an empty idea, and leaves nothing behind when the conversation does not start', async () => {
    await expect(band.make('  ')).rejects.toBeInstanceOf(PageRefused)
    const failing = new PageBand({
      dataDir: path.join(tmp, 'data'), root: path.join(tmp, 'data', 'made-pages'), pages, local: 'http://127.0.0.1:1', url: (p) => p,
      resolve: (id) => id, changed: () => undefined,
      start: async () => { throw new Error('machine off') },
    })
    await expect(failing.make('A board')).rejects.toThrow('machine off')
    expect(pages.list()).toEqual([])
    expect(fs.existsSync(path.join(tmp, 'data', 'made-pages', 'a-board'))).toBe(false)
    expect(failing.list()).toEqual([])
  })

  it('takes a page published elsewhere (no conversation, no data), lets it go, and drops what was unpublished', async () => {
    const dir = path.join(tmp, 'projects', 'report')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>How it works</h1>')
    pages.publish({ path: dir, title: 'How it works', kind: 'report' })
    expect(() => band.add('nothing-here')).toThrow(PageRefused)
    expect(band.add('how-it-works')).toEqual({ slug: 'how-it-works', title: 'How it works', kind: 'report', path: '/p/report/how-it-works' })
    band.add('how-it-works')
    expect(band.list()).toHaveLength(1)
    expect(band.made('how-it-works')).toBe(false)
    expect(band.drop('how-it-works')).toBe(true)
    expect(band.list()).toEqual([])
    band.add('how-it-works')
    pages.remove('how-it-works')
    expect(band.list()).toEqual([])
  })

  it('says when a page last changed, so its preview reloads', async () => {
    const r = await band.make('A clock')
    const file = path.join(tmp, 'data', 'made-pages', r.slug, 'index.html')
    fs.utimesSync(file, new Date(1_000_000), new Date(1_000_000))
    expect(band.stamp(r.slug)).toBe(1_000_000)
    fs.utimesSync(file, new Date(2_000_000), new Date(2_000_000))
    expect(band.stamp(r.slug)).toBe(2_000_000)
    expect(band.stamp('nothing-here')).toBe(0)
  })
})

describe('what a made page reads', () => {
  it('serves weevils.json and weevils.css at its keyed address, never to a page that was not made in the band', async () => {
    const r = await band.make('A board')
    const other = path.join(tmp, 'projects', 'other')
    fs.mkdirSync(other, { recursive: true })
    fs.writeFileSync(path.join(other, 'index.html'), 'x')
    pages.publish({ path: other, title: 'Other', kind: 'report' })
    band.add('other')
    pages.extra = (slug, rest) => (band.made(slug) && rest === '/weevils.json' ? { type: 'application/json', body: '{"sessions":[]}' } : undefined)
    const get = async (slug: string, rest: string) => {
      const server = http.createServer((req, res) => pages.serve(req, res, pages.key(slug), slug, rest))
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
      try {
        const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/`)
        return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
      } finally {
        server.close()
      }
    }
    expect(await get(r.slug, '/weevils.json')).toEqual({ status: 200, type: 'application/json', body: '{"sessions":[]}' })
    expect((await get('other', '/weevils.json')).status).toBe(404)
  })

  it('tells sessions, automations and projects, without their folders or anything archived', () => {
    const snap = {
      theme: 'dark',
      projects: [{ id: 'shop', name: 'shop', kind: 'repo', repos: ['shop-app'], where: {}, lastActivityAt: 5 }],
      sessions: [
        { id: 'a', title: 'Fix checkout', projectId: 'shop', tool: 'claude', status: 'working', now: 'running tests', openedAt: 1, lastActivityAt: 5, cwd: '/home/user/projects/shop-app' },
        { id: 'b', title: 'Old', projectId: 'shop', tool: 'codex', status: 'done', openedAt: 1, lastActivityAt: 2, archived: true },
      ],
      optimizers: [
        { id: 'o1', title: 'Nightly tests', state: 'done', why: 'keeps main green', runCount: 3, runs: [{ at: 9, startedAt: 8, ok: true, note: 'all green' }], repo: 'shop-app' },
        { id: 'o2', title: 'Proposal', state: 'proposed', why: '' },
      ],
    } as unknown as Snapshot
    const d = pageData(snap, [{ title: 'Ship it' }]) as any
    expect(d.theme).toBe('dark')
    expect(d.sessions).toEqual([{ id: 'a', title: 'Fix checkout', project: 'shop', tool: 'claude', status: 'working', now: 'running tests', openedAt: 1, lastActivityAt: 5 }])
    expect(d.automations).toEqual([{ id: 'o1', title: 'Nightly tests', state: 'done', what: 'keeps main green', runCount: 3, runs: [{ at: 9, ok: true, note: 'all green' }] }])
    expect(d.requests).toEqual([{ title: 'Ship it' }])
    expect(JSON.stringify(d)).not.toContain('/home/user')
  })
})

describe('the first title and the look', () => {
  it('takes the idea\'s first line, cut on a word', () => {
    expect(titleOf('a studio for shop-app.')).toBe('A studio for shop-app')
    expect(titleOf('A visualizer\nwith every run')).toBe('A visualizer')
    const t = titleOf('A page that shows every automation I have, every run they made, and how long each one took to finish')
    expect(t.length).toBeLessThanOrEqual(60)
    expect(t).toBe('A page that shows every automation I have, every run they')
  })

  it('gives the picked theme\'s colours, else light and dark by the device', () => {
    const sheet = `:root {\n  --font: system-ui;\n}\n:root,\n[data-theme='light'] {\n  color-scheme: light;\n  --ink: #000;\n  --p0: red;\n}\n[data-theme='dark'] {\n  color-scheme: dark;\n  /* deep */\n  --ink: #fff;\n  --p0: maroon;\n}\n:root[data-theme='zen'] {\n  color-scheme: light;\n  --ink: #33302b;\n}\n\n* {\n  box-sizing: border-box;\n}\n[data-theme='dark'] { --ink: blue; }\n`
    const dark = themeCss('dark', sheet)
    expect(dark).toContain('--ink: #fff')
    expect(dark).toContain('--bg: #000')
    expect(dark).not.toContain('--ink: blue')
    expect(dark).toContain('--font: system-ui')
    const zen = themeCss('zen', sheet)
    expect(zen).toContain('--ink: #33302b')
    expect(zen).toContain('--p0: red') // what zen does not set comes from light
    const none = themeCss(undefined, sheet)
    expect(none).toContain('@media (prefers-color-scheme: dark)')
    expect(themeCss(undefined, null)).toContain('--ink: #000')
  })
})

describe('a page\'s conversation', () => {
  it('is the person\'s session (not weevils\' machinery) and is followed whatever its age', () => {
    const cwd = path.join(MADE_PAGES_DIR, 'a-board')
    expect(internalCwd(cwd)).toBe(false)
    expect(madePageCwd(cwd)).toBe(true)
    expect(internalCwd(path.join(DATA_DIR, 'orchestrator'))).toBe(true)
    expect(madePageCwd(path.join(DATA_DIR, 'orchestrator'))).toBe(false)
    expect(madePageTranscript(path.join('/x/.claude/projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'id.jsonl'))).toBe(true)
    expect(madePageTranscript(path.join('/x/.claude/projects', '-home-user-projects-shop', 'id.jsonl'))).toBe(false)
  })
})
