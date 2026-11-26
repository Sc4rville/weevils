// A session's thread is weevboss's (2026-11-26): one reading column, 720px like .nx-thread, centred on every width, with
// the head over it and the page's own bands (the pause card) in it; no full-width bands, no per-message offsets (the
// ragged « C » of the full-width bands).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../next/src/next.css'), 'utf8')
const rule = (sel: string) => css.split('\n').find((l) => l.startsWith(`${sel} {`)) ?? ''

it('lays the whole body out in weevboss’s column, centred', () => {
  const col = rule('.nx-thread').match(/max-width: (\d+px)/)?.[1]
  expect(col).toBe('720px')
  expect(rule('.nx-stage .session-page .page-body > :not(.fill):not(.session-heading)')).toMatch(new RegExp(`max-width: ${col}; margin-inline: auto`))
  expect(rule('.nx-stage .session-page .page-head > .in')).toMatch(new RegExp(`max-width: ${col}`))
})

it('gives each message weevboss’s room and edges, and no offset of its own', () => {
  expect(rule('.nx-stage .session-page .session-thread')).toMatch(/padding: 4px 0 18px var\(--pad\)/)
  expect(rule('.nx-boss .nx-thread')).toMatch(/padding-right: 0/)
  expect(rule('.nx-stage .session-page .session-thread > :not(:has(.msg.band.tone))')).toMatch(/margin-right: var\(--pad\)/)
  expect(css).not.toMatch(/\.session-page \.session-thread \.msg\.band(\.orch)? \{ margin-left/)
})
