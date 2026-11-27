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
    expect(main.match(/<PinMark /g)).toHaveLength(3) // a repo, a conversation with no repo, autonomous
    expect(pages).toMatch(/<Icon name="page" \/>\{pinned && <PinMark name="pages" onUnpin=\{onUnpin\} \/>\}/)
    // A tap on the pin unpins: every pin of the side bar carries what takes its drawer out.
    expect(main.match(/<PinMark [^\n>]*onUnpin=/g)).toHaveLength(3)
    const pin = fs.readFileSync(path.join(import.meta.dirname, '../next/src/pin.tsx'), 'utf8')
    expect(pin).toMatch(/e\.stopPropagation\(\)/)
    const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8')
    expect(css).toMatch(/\.nx-pin\.nx-pin-tap \{ pointer-events: auto/)
    expect(css).toMatch(/\.nx-pin\.nx-pin-tap::before \{ content: ''; position: absolute; inset: -16px -9px; \}/)
    expect(main).not.toMatch(/WeevbossLogo[^\n]*PinMark/)
    // The requests band is drawn in a file of its own (next/src/requests-band.tsx): its pin is there.
    const requests = fs.readFileSync(path.join(import.meta.dirname, '../next/src/requests-band.tsx'), 'utf8')
    expect(requests).toMatch(/<G c="!" \/>\{drawerPinned\(snap, 'requests'\) && <PinMark \/>\}/)
  })
})

describe('every drawer, chosen in Your factory', () => {
  // requests: 0, a ledger with nothing open.
  const facts = { autonomous: false, requests: 0 }
  it('left alone, each keeps its own rule; no catch-all drawer any more', () => {
    expect(DRAWERS).not.toContain('misc')
    expect(drawerShown(undefined, 'requests', facts)).toBe(false)
    expect(drawerShown(undefined, 'requests', { autonomous: false, requests: 3 })).toBe(true)
    expect(drawerShown(undefined, 'autonomous', facts)).toBe(false)
    expect(drawerShown(undefined, 'pages', facts)).toBe(true)
  })
  it('settings is no drawer: always in the side bar like weevils, no pin on it, no switch for it, whatever was kept', () => {
    expect(DRAWERS).not.toContain('settings')
    const main = fs.readFileSync(path.join(import.meta.dirname, '../next/src/main.tsx'), 'utf8')
    // Drawn with no condition before it and no pin in its mark.
    expect(main).toMatch(/\n\s*<div className="nx-settings"><FootBand toNext=\{false\} factory mark=\{<span className="nx-repo-mark"><Icon name="settings" \/><\/span>\} \/><\/div>/)
    expect(main).not.toMatch(/'settings'\)/)
  })
  it('pinned, always there; out, never', () => {
    for (const d of DRAWERS) expect(drawerShown(true, d, facts)).toBe(true)
    for (const d of DRAWERS) expect(drawerShown(false, d, { autonomous: true, requests: 3 })).toBe(false)
  })
  it('requests: in the side bar by default while one is open, and never where there is no ledger to list', () => {
    expect(DRAWERS[0]).toBe('requests')
    expect(drawerOn(snap({ asksOpen: 3 }), 'requests')).toBe(true)
    expect(drawerOn(snap({ asksOpen: 0 }), 'requests')).toBe(false)
    expect(drawerOn(snap({ asksOpen: 3, sideDrawers: { requests: false } }), 'requests')).toBe(false)
    expect(drawerOn(snap({ asksOpen: 0, sideDrawers: { requests: true } }), 'requests')).toBe(true)
    // Another machine, an older server: no ledger, so no band, pinned or not.
    expect(drawerShown(true, 'requests', { autonomous: false })).toBe(false)
    expect(drawerOn(snap({ sideDrawers: { requests: true } }), 'requests')).toBe(false)
    // Your factory lists its switch only where the server takes the choice: it sends asksWaiting as it knows this
    // drawer. No ledger, or a server from before the band (asksOpen alone): no switch, it would flip back by itself.
    const factory = fs.readFileSync(path.join(import.meta.dirname, '../next/src/factory.tsx'), 'utf8')
    expect(factory).toMatch(/DRAWERS\.filter\(\(id\) => id !== 'requests' \|\| snap\.asksWaiting !== undefined\)\.map/)
    expect(factory).not.toMatch(/id !== 'requests' \|\| snap\.asksOpen/)
  })
  it('a switch flipped shows at once, with its pin', () => {
    const s = snap({})
    expect(drawerPinned(s, 'pages')).toBe(false)
    flipProject('drawer:pages', true)
    expect(drawerPinned(s, 'pages')).toBe(true)
    flipProject('drawer:pages', false)
    expect(drawerOn(s, 'pages')).toBe(false)
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
