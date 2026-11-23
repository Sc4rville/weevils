// A question's answers in next (2026-11-23): next draws no thin lines, so the app's rule above each answer
// (styles.css .choice-band, border-top) is taken away there, and each answer is a step on its own tone instead.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].split(',').map((s) => s.trim()), body: m[2] }))
const next = rules(read('../next/src/next.css'))
const app = rules(read('../src/styles.css'))

it('the classic app still draws its rule above each answer (the reason next takes it away)', () => {
  expect(app.some((r) => r.sel.includes('.choice-band') && /border-top:\s*1px/.test(r.body))).toBe(true)
})

it('in next, an answer has no rule and sits on its own tone, with room above it', () => {
  const own = next.filter((r) => r.sel.includes('.nx-stage .choice-band'))
  expect(own.some((r) => /border-top:\s*0/.test(r.body))).toBe(true)
  expect(own.some((r) => /background:\s*oklch\(from var\(--c\)/.test(r.body))).toBe(true)
  expect(own.some((r) => /margin-top:\s*\d+px/.test(r.body))).toBe(true)
})
