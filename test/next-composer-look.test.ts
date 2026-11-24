import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// docs/next-interaction.md « Every chat's box to write in is weevboss's own » (2026-11-24).
const css = fs.readFileSync(path.join(import.meta.dirname, '../next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim())

it("next: every chat's box is drawn by weevboss's own rules, standing above the screen's edge", () => {
  const shared = ':is(.nx-composer, .nx-stage .page-foot)'
  const place = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === shared)
  expect(place?.[2]).toMatch(/padding:\s*0 0 calc\(var\(--safe-b\) \+ 10px\)/)
  expect(selectors).toContain(`${shared} .composer > .in`)
  expect(selectors).toContain(`${shared} .composer textarea`)
})

it('next: no chat reshapes its box on its own (it would drift from weevboss again)', () => {
  const own = selectors.filter((s) => /(\.composer|\.page-foot)/.test(s) && !s.startsWith(':is(.nx-composer, .nx-stage .page-foot)') && !s.startsWith('.nx-composer.lab-on'))
  expect(own).toEqual([])
})
