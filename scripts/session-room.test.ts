// A session's screen gives the thread the room (2026-11-22, docs/next-interaction.md): one compact head row, no second
// status-bar gap under weevboss's strip, and a quiet « new below » mark rather than a dark block over the text. Its box to
// write in is weevboss's own since 2026-11-24 (test/next-composer-look.test.ts).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const body = (css: string, sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';')

it('both apps: a session head is one row (the row of back, model and avatar holds the title too)', () => {
  const css = read('src/styles.css')
  expect(body(css, '.page-head > .in > .session-header-row')).toMatch(/display:\s*contents/)
  expect(body(css, '.page-head > .in:has(> .session-header-row)')).toMatch(/flex-wrap:\s*wrap/)
  expect(body(css, '.page-head > .in > .session-context-row')).toMatch(/flex:\s*1 1 0/)
})

it('both apps: « new below » is a quiet tone of the page, never an ink block', () => {
  const b = body(read('src/styles.css'), '.follow-down')
  expect(b).not.toMatch(/background:\s*var\(--ink\)/)
  expect(b).toMatch(/color:\s*var\(--ink\)/)
})

it("next: no second top gap; the box to write in is weevboss's, standing above the bottom inset", () => {
  const css = read('next/src/next.css')
  expect(body(css, '.nx-session-host > .page > .page-head')).toMatch(/padding-top:\s*0/)
  expect(css).toMatch(/:is\(\.nx-composer, \.nx-stage \.page-foot\) \{[^}]*/)
  expect(body(css, ':is(.nx-composer')).toMatch(/padding:\s*0 0 calc\(var\(--safe-b\) \+ 10px\)/)
  expect(css).not.toMatch(/\.session-page \.(composer|page-foot)/)
})

it('both apps: a session head drops the repo name and the logo; the chevron, the title and the model share the row', () => {
  const css = read('src/styles.css')
  expect(body(css, '.page-head > .in > .session-header-row .back .meta')).toMatch(/display:\s*none/)
  expect(fs.readFileSync(path.join(root, 'src/ui/pages.tsx'), 'utf8')).not.toMatch(/dock=\{th\.voice\}/)
})
