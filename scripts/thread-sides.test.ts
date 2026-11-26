// In the app's session thread only your own words sit on the right; whoever else prompts the agent (weevboss, another
// agent, an automation) is their mirror, against the left edge (2026-11-22). In weevils next, every message stands in
// weevboss's one column instead (2026-11-26).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const body = (css: string, sel: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(';')

it('the app: only your words sit on the right; someone else’s prompt sits against the left edge, its edge line on the left', () => {
  const b = body(fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8'), '.session-thread .msg.band.orch')
  expect(b).toMatch(/margin-left:\s*0/)
  expect(b).toMatch(/margin-right:\s*calc\(var\(--pad\) \* 2\.5\)/)
  expect(b).toMatch(/border-inline-start:/)
  expect(b).not.toMatch(/border-inline-end:/)
})

it('next: every message in weevboss’s one column, someone else’s prompt included: no offset of its own (2026-11-26)', () => {
  const f = path.join(root, 'next/src/next.css')
  if (!fs.existsSync(f)) return
  const css = fs.readFileSync(f, 'utf8')
  expect(body(css, '.session-page .session-thread .msg.band.orch')).not.toMatch(/margin-left/)
  // Your own words reach the column's right edge; everyone else's keep its small gap.
  expect(body(css, '.nx-stage .session-page .session-thread > :not(:has(.msg.band.tone))')).toMatch(/margin-right:\s*var\(--pad\)/)
})
