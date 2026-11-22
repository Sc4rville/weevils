// The side bar's bands meet colour to colour (2026-11-22): a band whose last row wears its own tone (the Autonomous
// staircase, a toned session row) ends on that row, never on a strip of its darker base that reads as a separator.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }))

it('the Autonomous band ends on its last row: no strip of its base above settings', () => {
  const last = rules.filter((r) => r.sel.includes('.nx-project.nx-autos') && /padding-bottom/.test(r.body)).at(-1)
  expect(last?.body).toMatch(/padding-bottom:\s*0/)
})

it('a project band whose last row is toned ends on that row too', () => {
  expect(rules.some((r) => r.sel.includes('.nx-project:has(.nx-row.nx-sub.tone:last-child)') && /padding-bottom:\s*0/.test(r.body))).toBe(true)
})
