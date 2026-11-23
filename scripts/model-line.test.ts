// A session's header shows its model and the effort level alone, on one line, in regular weight (2026-11-23):
// « opus 5.5 · medium », never « … · medium effort » wrapping onto two bold lines.
import fs from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { setLang } from '../src/i18n'
import { modelLine } from '../src/ui/settings'

afterEach(() => setLang(null))

it('the level alone after the model, for every level, in both languages', () => {
  setLang('en')
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect(modelLine('claude-opus-5-5', e)).not.toMatch(/effort/)
  expect(modelLine('claude-opus-5-5', 'medium')).toMatch(/ · medium$/)
  expect(modelLine(undefined, 'high')).toBe('high')
  setLang('fr')
  expect(modelLine('claude-opus-5-5', 'medium')).toMatch(/ · moyen$/)
})

it('one line, regular weight, in both apps', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8')
  const rule = /\.page-head > \.in > \.session-header-row \.session-header-controls button \{([^}]*)\}/.exec(css)![1]
  expect(rule).toMatch(/font-weight:\s*400/)
  expect(rule).toMatch(/white-space:\s*nowrap/)
})
