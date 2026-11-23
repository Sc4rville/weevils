// @vitest-environment happy-dom
// An automation's conversation is a session's screen, one code path (docs/next-interaction.md, 2026-11-23): the app's
// own session page with its one-row head, and the way back to the overview is one more item of that row (the
// automation's icon alone), never laid over the title or the model.
import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Optimizer, Snapshot } from '../shared/api.ts'

vi.mock('../src/api', () => ({ api: { auto: async () => ({ runs: [] }), autoRun: async () => null } }))
// The session page, reduced to the app's real Shell in its session layout (the head every session wears).
vi.mock('../src/ui/pages.tsx', async () => {
  const { Shell } = await import('../src/ui/shell.tsx')
  return {
    PageView: ({ page }: { page: { id: string } }) => (
      <Shell slot="p2" kicker="weevils" title={`Session ${page.id}`} sessionLayout headerControls={<button>opus 5.5 · high effort</button>}>
        <p>hello</p>
      </Shell>
    ),
  }
})

const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { NextAutoPage } = await import('../next/src/auto.tsx')
const { Ctx } = await import('../src/ui/app-context')

const NOW = Date.now()
const o: Optimizer = { id: 'a1', title: 'Coastal themes', why: 'make themes', repo: 'weevils', kind: 'tests', heavy: false, state: 'queued', createdAt: NOW, sessionId: 's1' }
const snap = { now: NOW, projects: [], sessions: [{ id: 's1' }], optimizers: [o], h24: [], main: [], config: {} } as unknown as Snapshot

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it("an automation's conversation wears a session's one-row head; the flip back is an icon in that row, over no text", async () => {
  const ctx = { snap, now: NOW, colors: {}, push: () => {}, replace: () => {}, back: () => {}, home: () => {}, theme: 'light', setTheme: () => {}, refresh: () => {} }
  await act(async () => root.render(<Ctx.Provider value={ctx as never}><NextAutoPage id="a1" /></Ctx.Provider>))
  const toTalk = host.querySelector<HTMLButtonElement>('.nx-flip')!
  expect(toTalk.getAttribute('aria-label')).toBe('Conversation of Coastal themes')
  await act(async () => toTalk.click())
  await act(async () => new Promise((r) => setTimeout(r, 30)))

  expect(host.querySelector('.nx-auto-talk .page.session-page')).not.toBeNull()
  const flip = host.querySelector<HTMLElement>('.nx-flip')!
  expect(flip.getAttribute('aria-label')).toBe('Overview of Coastal themes')
  // One more item of the head row itself, beside the title and the model, not a layer inside them.
  const row = host.querySelector('.page-head > .in')!
  expect(flip.parentElement).toBe(row)
  expect(row.querySelector(':scope > .session-header-row')).not.toBeNull()
  expect(flip.textContent).toBe('')
  expect(flip.closest('.session-header-controls, .session-context-row')).toBeNull()

  // …laid out in the row's flow, never absolutely over it.
  const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === '.nx-auto-talk .page-head > .in:has(> .session-header-row) > .nx-flip.nx-flip')
  expect(rule?.[2]).toMatch(/position:\s*static/)
  expect(css).not.toMatch(/\.nx-auto-talk \.session-context-row/)
})

it("next: every rule shaping a session's thread and box is keyed on the session page itself, wherever it is shown", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Only where weevboss's strip sits above it is about the host; nothing about how a session reads is.
  const hosted = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s.includes('.nx-session-host'))
  expect(hosted.sort()).toEqual(['.nx-session-host', '.nx-session-host > .page', '.nx-session-host > .page > .page-head'])
})
