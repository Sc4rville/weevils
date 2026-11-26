// The side bar's pins (2026-11-26): a pinned drawer wears a small pin between its icon and its name, unpinned it is
// gone; every drawer (projects, misc, autonomous, pages, settings) is pinned, taken out or left to its own rule from
// Your factory. Your factory's Sessions: every session, the most recent first, a run of one repo stepping its tone.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project, Snapshot } from '../shared/api.ts'
import { DRAWERS, drawerShown } from '../shared/drawers.ts'
import { drawerOn, drawerPinned, flipProject, looseSessions, pinnedProject, runTone, sessionPinned, sessionRuns } from '../next/src/factory.tsx'

const p = (id: string, repos = [id]): Project => ({ id, name: id, kind: 'repo', repos, where: {}, lastActivityAt: 0 })
const snap = (over: Partial<Snapshot>) => ({ pinnedRepos: [], hiddenProjects: [], sessions: [], projects: [], optimizers: [], sideDrawers: {}, ...over }) as unknown as Snapshot
const ses = (id: string, projectId: string, at: number, status = 'done') => ({ id, projectId, lastActivityAt: at, status, archived: false })
afterEach(() => { for (const d of DRAWERS) flipProject(`drawer:${d}`, null); flipProject('shop', null); flipProject('session:a', null) })

describe('the pin', () => {
  it('is on a pinned project, gone once it is unpinned or switched off', () => {
    expect(pinnedProject(snap({ pinnedRepos: ['shop-web'] }), p('shop', ['shop-web']))).toBe(true)
    expect(pinnedProject(snap({}), p('shop', ['shop-web']))).toBe(false)
    expect(pinnedProject(snap({ pinnedRepos: ['shop-web'], hiddenProjects: ['shop'] }), p('shop', ['shop-web']))).toBe(false)
    flipProject('shop', false)
    expect(pinnedProject(snap({ pinnedRepos: ['shop-web'] }), p('shop', ['shop-web']))).toBe(false)
  })
  it('sits in the icon of every drawer that can be pinned, never on weevils', () => {
    const main = fs.readFileSync(path.join(import.meta.dirname, '../next/src/main.tsx'), 'utf8')
    const pages = fs.readFileSync(path.join(import.meta.dirname, '../next/src/pages.tsx'), 'utf8')
    expect(main.match(/<PinMark \/>/g)).toHaveLength(4) // a repo, a conversation with no repo, autonomous, settings
    expect(pages).toMatch(/<Icon name="page" \/>\{pinned && <PinMark \/>\}/)
    expect(main).not.toMatch(/WeevbossLogo[^\n]*PinMark/)
  })
})

describe('every drawer, chosen in Your factory', () => {
  const facts = { autonomous: false }
  it('left alone, each keeps its own rule; no catch-all drawer any more', () => {
    expect(DRAWERS).not.toContain('misc')
    expect(drawerShown(undefined, 'autonomous', facts)).toBe(false)
    expect(drawerShown(undefined, 'pages', facts)).toBe(true)
    expect(drawerShown(undefined, 'settings', facts)).toBe(true)
  })
  it('pinned, always there; out, never', () => {
    for (const d of DRAWERS) expect(drawerShown(true, d, facts)).toBe(true)
    for (const d of DRAWERS) expect(drawerShown(false, d, { autonomous: true })).toBe(false)
  })
  it('a switch flipped shows at once, with its pin', () => {
    const s = snap({})
    expect(drawerPinned(s, 'pages')).toBe(false)
    flipProject('drawer:pages', true)
    expect(drawerPinned(s, 'pages')).toBe(true)
    flipProject('drawer:pages', false)
    expect(drawerOn(s, 'pages')).toBe(false)
    expect(drawerOn(snap({ sideDrawers: { settings: false } }), 'settings')).toBe(false)
  })
})

describe('a conversation started with no repo', () => {
  const loose = ses('a', 'divers', 5, 'idle') as never
  it('is its own band while pinned, never under a catch-all; a page\'s conversation is not one', () => {
    const s = snap({ sessions: [loose, ses('b', 'divers', 4), ses('c', 'shop', 3)] as never, pinnedSessions: ['a'], pageBand: [{ slug: 'x', session: 'b' }] as never })
    expect(looseSessions(s).map((x) => x.id)).toEqual(['a'])
    expect(sessionPinned(s, loose)).toBe(true)
    expect(sessionPinned(snap({ pinnedSessions: [] }), loose)).toBe(false)
    const main = fs.readFileSync(path.join(import.meta.dirname, '../next/src/main.tsx'), 'utf8')
    expect(main).toMatch(/p\.id !== AUTO_DIR && p\.id !== MISC && shownNow\(snap, p\)/)
    expect(main).toMatch(/<LooseBand key=\{s\.id\}/)
  })
  it('on a server that keeps no pins yet, shows while it needs you', () => {
    expect(sessionPinned(snap({ pinnedSessions: undefined }), ses('a', 'divers', 5, 'interrupted') as never)).toBe(true)
    expect(sessionPinned(snap({ pinnedSessions: undefined }), loose)).toBe(false)
  })
})

describe('Sessions', () => {
  it('lists every session, the most recent first, each run of one repo stepping from 0', () => {
    const runs = sessionRuns([ses('a', 'shop', 1), ses('b', 'shop', 5), ses('c', 'pli', 4), ses('d', 'shop', 3), ses('e', 'shop', 2)] as never)
    expect(runs.map((r) => `${r.s.id}${r.run}`)).toEqual(['b0', 'c0', 'd0', 'e1', 'a2'])
  })
  it('every band of a long run differs from the one above it', () => {
    const tones = Array.from({ length: 20 }, (_, i) => runTone(i))
    for (let i = 1; i < tones.length; i++) expect(Math.abs(tones[i] - tones[i - 1])).toBe(1)
  })
  it('separates a run by tone alone, never a line', () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8')
    const rule = css.split('\n').find((l) => l.startsWith('.nx-fx-band.nx-fx-session {'))!
    expect(rule).toMatch(/var\(--run, 0\)/)
    expect(rule).not.toMatch(/border|box-shadow/)
  })
})
