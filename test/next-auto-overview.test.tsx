// @vitest-environment happy-dom
// An automation's overview in next, its « Last run » fact: under the check, how the run went in the first whole
// sentence of what it told the person, as plain words. Never the stored note raw (stars around « Done », a folded
// list, a word cut in the middle), never the technical report's heading while the run said something.
import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AutoRun, AutoRunDetail, Optimizer, Snapshot } from '../shared/api.ts'

const fixtures = vi.hoisted(() => ({ runs: [] as unknown[], detail: null as unknown }))
vi.mock('../src/api', () => ({ api: { auto: async () => ({ id: 'a1', runs: fixtures.runs, machine: 'm' }), autoRun: async () => fixtures.detail } }))
// The overview never draws another page; the app's whole page switch stays out of this test.
vi.mock('../src/ui/pages.tsx', () => ({ PageView: () => null }))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { NextAutoPage } = await import('../next/src/auto.tsx')
const { Ctx } = await import('../src/ui/app-context')
const { setLang } = await import('../src/i18n/index.ts')

const NOW = Date.now()
const HOUR = 3_600_000
const run = (r: Partial<AutoRun>): AutoRun => ({ at: NOW - 2 * HOUR, startedAt: NOW - 2 * HOUR - 9 * 60_000, ok: true, ...r })
const detail = (r: AutoRun, d: Partial<AutoRunDetail>): AutoRunDetail => ({ run: r, files: [], links: [], images: [], ...d })

let root: Root
let host: HTMLElement
let pushed: unknown[]
let shown = 0
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  pushed = []
  fixtures.runs = []
  fixtures.detail = null
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
})

/** The overview of an accepted task whose runs (newest first) are `runs`; `d` is what the newest run's detail answers. */
async function show(runs: AutoRun[], d: AutoRunDetail | null = null) {
  fixtures.runs = runs
  fixtures.detail = d
  const o: Optimizer = { id: 'a1', title: 'Price watch', why: 'watch the prices', repo: 'shop-app', kind: 'tests', heavy: false, state: 'queued', createdAt: NOW, runs: [...runs].reverse(), runCount: runs.length }
  const snap = { now: NOW, projects: [], sessions: [], optimizers: [o], h24: [], main: [], config: {} } as unknown as Snapshot
  const ctx = { snap, now: NOW, colors: {}, push: (p: unknown) => pushed.push(p), replace: () => {}, back: () => {}, home: () => {}, theme: 'light', setTheme: () => {}, refresh: () => {} }
  // A new page each time (its key): what an earlier one had loaded is not carried over.
  await act(async () => root.render(<Ctx.Provider key={shown++} value={ctx as never}><NextAutoPage id="a1" /></Ctx.Provider>))
  await act(async () => new Promise((r) => setTimeout(r, 30)))
}
const fact = () => [...host.querySelectorAll<HTMLElement>('.nx-auto-fact')].find((f) => f.classList.contains('go'))!
const said = () => host.querySelector('.nx-auto-note')?.textContent
const mark = () => fact().querySelector('dd svg path:last-child')!.getAttribute('d')

it('a run that went well: the first whole sentence of its note, without its « Done: » label, its stars or its folded list', async () => {
  const r = run({ note: '**Done:** I checked one new price list, which holds 4 items. - Nothing blocked..' })
  await show([r])
  expect(fact().querySelector('dt')!.textContent).toBe('Last run')
  expect(said()).toBe('I checked one new price list, which holds 4 items.')
  expect(fact().querySelector('dd > span:first-child')!.textContent!.trim()).toBe('2h ago')
  // The whole fact still opens the run in full.
  await act(async () => fact().click())
  expect(pushed).toEqual([{ kind: 'autorun', id: 'a1', at: r.at }])
})

it('a run that stopped keeps its label as plain words: it is the news, beside the pause mark', async () => {
  await show([run({ note: 'all good' })])
  const check = mark()
  await show([run({ ok: false, note: '**Stopped:** the check failed on its first step, so no price was read. - **Why:** the price tool was not instal…' })])
  expect(said()).toBe('Stopped: the check failed on its first step, so no price was read.')
  expect(fact().querySelector('dd > span:first-child')!.textContent!.trim()).toBe('2h ago, stopped early')
  expect(check).toBeTruthy()
  expect(mark()).not.toBe(check)
  // A stopped run that says « Done » is not believed on its word: nothing is taken away from what it said.
  await show([run({ ok: false, note: '**Done:** everything is in place.' })])
  expect(said()).toBe('Done: everything is in place.')
})

it("the run's full message, once loaded, is read before its cut note and before its technical report's heading", async () => {
  const r = run({ note: '**Done:** I skipped this run. No price was checked and nothing was sp…' })
  const report = '# Price watch run 0a1b2c3d4e (2026-11-26): skipped, no price checked\n\nqueue: 0'
  await show([r], detail(r, { message: '**Done:** I skipped this run. No price was checked and nothing was spent.\n\n- **Why:** the last check is still running.\n- **Needs you:** nothing.', report }))
  expect(said()).toBe('I skipped this run.')
  // « Skipped: » is no « Done »: it stays.
  await show([r], detail(r, { message: '**Skipped:** the last check is still running.\n\n- Nothing was spent.', report }))
  expect(said()).toBe('Skipped: the last check is still running.')
})

it('a run that did not go well shows the reason the server noted, before what its session said last', async () => {
  // The server stopped it (its note says why); the session's last message is from before that, and says all is well.
  const r = run({ ok: false, note: 'no progress for 52 min' })
  await show([r], detail(r, { message: '**Done:** the check is saved.', report: '# Price watch run 0a1b2c3d4e (2026-11-26): stopped\n\nqueue: 0' }))
  expect(said()).toBe('no progress for 52 min')
  expect(fact().querySelector('dd > span:first-child')!.textContent!.trim()).toBe('2h ago, stopped early')
  // No note at all: what the session said is all there is, its label kept (the run is not believed on its word).
  const bare = run({ ok: false })
  await show([bare], detail(bare, { message: '**Done:** the check is saved.' }))
  expect(said()).toBe('Done: the check is saved.')
})

it('a note cut before its first sentence ended shows its whole words, never half of one', async () => {
  await show([run({ note: '**Done:** I checked one new price list, which holds four items for the shop and then sav…' })])
  expect(said()).toBe('I checked one new price list, which holds four items for the shop and then…')
})

it("the report's first line is the last resort, for a run that said nothing", async () => {
  const r = run({})
  await show([r], detail(r, { report: '# Price watch run 0a1b2c3d4e (2026-11-26): skipped, no price checked\n\nqueue: 0' }))
  expect(said()).toBe('Price watch run 0a1b2c3d4e (2026-11-26): skipped, no price checked')
  // Nothing said and nothing written: the mark and the time alone, no empty line under them.
  await show([r])
  expect(host.querySelector('.nx-auto-note')).toBeNull()
  expect(fact().querySelector('dd')!.textContent!.trim()).toBe('2h ago')
})

it("another run's detail says nothing about this one", async () => {
  const older = run({ at: NOW - 30 * HOUR, startedAt: NOW - 31 * HOUR, note: '**Done:** I checked 4 prices.' })
  const newest = run({ note: '**Done:** I checked 2 prices.' })
  await show([newest, older], detail(older, { message: '**Done:** I checked 4 prices.', report: '# older report' }))
  expect(said()).toBe('I checked 2 prices.')
})

it('a very long sentence is shown whole up to about 220 characters, then stops on a whole word', async () => {
  const long = `I looked at ${Array.from({ length: 60 }, (_, i) => `page${i}`).join(', ')} and found nothing to change.`
  const r = run({})
  await show([r], detail(r, { message: `**Done:** ${long}` }))
  const text = said()!
  expect(text.length).toBeLessThanOrEqual(220)
  expect(text.length).toBeGreaterThan(180)
  expect(text.endsWith('…')).toBe(true)
  // Every word it shows is a word of the sentence, whole.
  const words = text.slice(0, -1).split(/,? /)
  expect(long.split(/,? /).slice(0, words.length)).toEqual(words)
  // A sentence of ordinary length is never touched.
  const plain = 'I checked the four prices of the autumn sale and put them on the results page, each one in the three currencies the shop uses.'
  await show([r], detail(r, { message: `**Done:** ${plain}\n\n- Nothing blocked.` }))
  expect(said()).toBe(plain)
})

it('the words of the fact follow the language', async () => {
  setLang('fr')
  await show([run({ ok: false, note: '**Arrêté :** le build a échoué. - **Pourquoi :** un outil manque.' })])
  expect(fact().querySelector('dt')!.textContent).toBe('Dernier passage')
  expect(fact().querySelector('dd > span:first-child')!.textContent!.trim()).toBe('il y a 2h, arrêté avant la fin')
  expect(said()).toBe('Arrêté : le build a échoué.')
  await show([run({ note: '**Fait :** les prix sont dans le tableau. - Rien de bloqué.' })])
  expect(fact().querySelector('dd > span:first-child')!.textContent!.trim()).toBe('il y a 2h')
  expect(said()).toBe('Les prix sont dans le tableau.')
})

it('the sentence is shown whole: no two-line clamp, no cut by the stylesheet, and a long word wraps', () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes('.nx-auto-note'))
  expect(rules.map((m) => m[1].trim())).toEqual(['.nx-auto-note'])
  const body = rules[0][2]
  expect(body).not.toMatch(/line-clamp|overflow:\s*hidden|text-overflow|white-space:\s*nowrap|max-height/)
  expect(body).toMatch(/overflow-wrap:\s*anywhere/)
  // Calm, in every theme: the page's own colour, only lighter. No colour of its own.
  expect(body).not.toMatch(/(?:^|[;\s])(?:color|background)[^;]*:/)
})
