import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ThemePref } from './theme-pref.ts'

it('keeps one known theme across a restart and refuses anything else', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theme-')), 'theme.json')
  const a = new ThemePref(file)
  expect(a.get()).toBeUndefined()
  expect(a.set('desert')).toBe(true)
  expect(a.set('neon')).toBe(false)
  expect(a.set(42)).toBe(false)
  expect(a.get()).toBe('desert')
  expect(new ThemePref(file).get()).toBe('desert')
  fs.writeFileSync(file, '{"theme":"bogus"}')
  expect(new ThemePref(file).get()).toBeUndefined()
})
