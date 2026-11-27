// @vitest-environment happy-dom
// An automation's page in next answers four things at a glance (what it does, when it runs next, what it last made,
// on or paused) and manages it: a switch that pauses or resumes it at once, a delete that asks once. Nothing else
// shows: no prompt, no internal instructions, no ids, no run log unless its fold is opened.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AutoRun, Optimizer, Snapshot } from '../shared/api.ts'

const calls = vi.hoisted(() => ({ pause: [] as unknown[], del: [] as unknown[], runs: [] as unknown[], fail: false }))
vi.mock('../src/api', () => ({
  api: {
    auto: async () => ({ id: 'a1', runs: calls.runs, machine: 'm' }),
    autoRun: async () => null,
    pauseOptimizer: async (id: string, paused: boolean) => { calls.pause.push([id, paused]); if (calls.fail) throw new Error('no'); return { ok: true } },
    deleteAutomation: async (id: string) => { calls.del.push(id); if (calls.fail) throw new Error('no'); return { ok: true, running: false } },
  },
}))
vi.mock('../src/ui/pages.tsx', () => ({ PageView: () => null }))

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { NextAutoPage } = await import('../next/src/auto.tsx')
const { Ctx } = await import('../src/ui/app-context')
const { flipAuto, dropAuto } = await import('../next/src/auto-state.ts')

const NOW = Date.now()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const run = (at: number, note: string, ok = true): AutoRun => ({ at, startedAt: at - 9 * 60_000, ok, note })

let root: Root
let host: HTMLElement
let backs = 0
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  calls.pause = []
  calls.del = []
  calls.runs = []
  calls.fail = false
  backs = 0
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  flipAuto('a1', null)
  dropAuto('a1', false)
})

const base: Optimizer = {
  id: 'a1', title: 'Price watch', why: 'Checks the shop prices every night and tells you what changed.', repo: 'shop-app', kind: 'watch', heavy: false,
  state: 'queued', createdAt: NOW - 10 * DAY, every: DAY, notBefore: NOW + 3 * HOUR, waiting: 'time', startAt: NOW + 3 * HOUR,
  scope: 'This automation may, on its own, read the price pages and write one note.',
}
async function show(over: Partial<Optimizer> = {}, runs: AutoRun[] = []) {
  calls.runs = runs
  const o = { ...base, runs: [...runs].reverse(), runCount: runs.length, ...over } as Optimizer & { prompt?: string }
  o.prompt = 'INTERNAL PROMPT: run step 4 then write report.md'
  const snap = { now: NOW, projects: [], sessions: [], optimizers: [o], h24: [], main: [], config: {} } as unknown as Snapshot
  const ctx = { snap, now: NOW, colors: {}, push: () => {}, replace: () => {}, back: () => { backs++ }, home: () => {}, theme: 'light', setTheme: () => {}, refresh: () => {} }
  await act(async () => root.render(<Ctx.Provider value={ctx as never}><NextAutoPage id="a1" /></Ctx.Provider>))
  await act(async () => new Promise((r) => setTimeout(r, 30)))
}
const text = (sel: string) => host.querySelector(sel)?.textContent?.trim()
const sw = () => host.querySelector<HTMLButtonElement>('[role="switch"]')
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)

it('on: its name, its switch on, when it runs next, what it does in one sentence, when it runs', async () => {
  await show({}, [run(NOW - 2 * HOUR, '**Done:** 3 prices changed.')])
  expect(text('.nx-ao-name')).toBe('Price watch')
  expect(sw()!.getAttribute('aria-checked')).toBe('true')
  expect(text('.nx-ao-state')).toMatch(/^On · next run \S.*, in 3h/)
  expect(text('.nx-ao-what')).toBe('Checks the shop prices every night and tells you what changed.')
  expect(text('.nx-ao-said')).toBe('3 prices changed.')
  // Nothing internal: no prompt, no scope's legal wording, no id, no counters.
  expect(host.textContent).not.toMatch(/INTERNAL PROMPT|This automation may|a1|So far|Works in/)
})

it('the switch pauses it at once and tells the scheduler; paused, it reads calmly and switches back on', async () => {
  await show()
  await act(async () => sw()!.click())
  expect(calls.pause).toEqual([['a1', true]])
  expect(sw()!.getAttribute('aria-checked')).toBe('false')
  expect(host.querySelector('.nx-ao-paused')).not.toBeNull()
  expect(text('.nx-ao-state')).toBe('Paused until you switch it back on')
  // Paused by the server (tonight's pauses): shown paused, and the switch resumes it.
  flipAuto('a1', null)
  await show({ paused: true, waiting: 'paused' })
  expect(sw()!.getAttribute('aria-checked')).toBe('false')
  await act(async () => sw()!.click())
  expect(calls.pause.at(-1)).toEqual(['a1', false])
  expect(sw()!.getAttribute('aria-checked')).toBe('true')
})

it('a switch the server refuses goes back, with one plain line', async () => {
  calls.fail = true
  await show()
  await act(async () => sw()!.click())
  await act(async () => new Promise((r) => setTimeout(r, 10)))
  expect(sw()!.getAttribute('aria-checked')).toBe('true')
  expect(text('.nx-ao-failed')).toBe('Couldn’t change it. Try again.')
})

it('stopped after failed runs: the switch is off and turns it back on; a one-off that ran has no switch', async () => {
  await show({ state: 'failed' }, [run(NOW - DAY, 'no progress for 55 min', false)])
  expect(text('.nx-ao-state')).toBe('Stopped: its last runs didn’t finish')
  expect(sw()!.getAttribute('aria-checked')).toBe('false')
  await act(async () => sw()!.click())
  expect(calls.pause).toEqual([['a1', false]])
  await show({ state: 'done', every: undefined, notBefore: undefined, waiting: undefined, startAt: undefined }, [run(NOW - 2 * HOUR, '**Done:** checked.')])
  expect(sw()).toBeNull()
  expect(text('.nx-ao-state')).toBe('Ran once, 2h ago')
})

it('delete asks once: « Keep it » changes nothing, « Delete » deletes it and leaves the page', async () => {
  await show()
  await act(async () => button('Delete this automation')!.click())
  expect(text('.nx-ao-ask')).toMatch(/^Delete Price watch\? What it already made stays\./)
  await act(async () => button('Keep it')!.click())
  expect(calls.del).toEqual([])
  expect(button('Delete this automation')).toBeTruthy()
  await act(async () => button('Delete this automation')!.click())
  await act(async () => button('Delete')!.click())
  await act(async () => new Promise((r) => setTimeout(r, 10)))
  expect(calls.del).toEqual(['a1'])
  expect(backs).toBe(1)
})

it('earlier runs wait in a closed fold; opened, each one in a plain line', async () => {
  await show({}, [run(NOW - HOUR, '**Done:** newest.'), run(NOW - DAY, '**Done:** 2 prices changed.'), run(NOW - 2 * DAY, '**Done:** nothing changed.')])
  const more = host.querySelector<HTMLButtonElement>('.nx-ao-more')!
  expect(more.textContent?.trim()).toBe('Earlier runs')
  expect(host.querySelectorAll('.nx-ao-run')).toHaveLength(0)
  await act(async () => more.click())
  expect([...host.querySelectorAll('.nx-ao-run .nx-row-title')].map((e) => e.textContent)).toEqual(['2 prices changed.', 'Nothing changed.'])
})

it('what it does falls back on its scope, without the legal opening', async () => {
  await show({ why: '' })
  expect(text('.nx-ao-what')).toBe('Read the price pages and write one note.')
})
