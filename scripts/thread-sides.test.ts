// In a session's thread, whoever prompts the agent sits on the right, on your side; the agent's replies on the left
// (2026-11-21: what prompts the agent is an input to it, like your own words, never one of its replies).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const body = (css: string, sel: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(';')

it('the app: someone else’s prompt is pushed to the right, its edge line on the right', () => {
  const b = body(fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8'), '.session-thread .msg.band.orch')
  expect(b).toMatch(/margin-left:\s*calc\(var\(--pad\) \* 2\.5\)/)
  expect(b).toMatch(/border-inline-end:/)
  expect(b).not.toMatch(/border-inline-start:/)
})

it('next (on its branch): someone else’s prompt reaches the right edge exactly like yours', () => {
  const f = path.join(root, 'next/src/next.css')
  if (!fs.existsSync(f)) return
  const css = fs.readFileSync(f, 'utf8')
  const orch = body(css, '.nx-session-host .session-thread .msg.band.orch')
  expect(orch).toMatch(/margin-right:\s*0/)
  expect(orch).not.toMatch(/margin-left:\s*calc/)
})
