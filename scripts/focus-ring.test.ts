// Focus never draws a black box (2026-11-21: a thick black frame showed around the box you write in, on a tap).
// Every focus rule in the app's styles (and next's, on its branch) is none or the one soft halo; fields never get one.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const sheets = [path.join(root, 'src/styles.css'), ...fs.readdirSync(path.join(root, 'src/ui')).filter((f) => f.endsWith('.css')).map((f) => path.join(root, 'src/ui', f))]
const next = path.join(root, 'next/src/next.css')
if (fs.existsSync(next)) sheets.push(next)
/** Each rule as [selector, body], comments out. */
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const)

it('no focus rule draws a solid outline: none, or the soft halo', () => {
  expect(sheets.length).toBeGreaterThan(5)
  const bad: string[] = []
  for (const f of sheets) for (const [sel, body] of rules(fs.readFileSync(f, 'utf8'))) {
    if (!/:focus/.test(sel)) continue
    const o = /(?:^|;)\s*outline\s*:\s*([^;]+)/.exec(body)?.[1].trim()
    if (o && !/^(none|0)$/.test(o) && o !== 'var(--focus-halo)') bad.push(`${path.relative(root, f)}: ${sel} { outline: ${o} }`)
  }
  expect(bad).toEqual([])
})

it('the halo is soft (its own ink, faded), and a field you write in shows none', () => {
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
  expect(css).toMatch(/--focus-halo:\s*2px solid color-mix\(in oklab, currentColor \d+%, transparent\)/)
  const field = rules(css).find(([sel]) => /input, textarea/.test(sel) && /:focus-visible/.test(sel))
  expect(field?.[1]).toMatch(/outline:\s*none/)
})
