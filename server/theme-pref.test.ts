import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { ThemePref } from './theme-pref.ts'

/** The selector's themes, read from the app's source (the server does not build its JSX). */
const THEMES = [...fs.readFileSync(path.join(import.meta.dirname, '../src/ui/app-context.tsx'), 'utf8').match(/export const THEMES: Theme\[\] = \[([^\]]*)\]/)![1].matchAll(/'([\w-]+)'/g)].map((m) => m[1])

it('keeps one theme id across a restart and refuses anything that is not one', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theme-')), 'theme.json')
  const a = new ThemePref(file)
  expect(a.get()).toBeUndefined()
  expect(a.set('desert')).toBe(true)
  for (const bad of [42, '', 'x', 'Neon', "x' onload", 'a'.repeat(30), null]) expect(a.set(bad)).toBe(false)
  expect(a.get()).toBe('desert')
  expect(new ThemePref(file).get()).toBe('desert')
  fs.writeFileSync(file, '{"theme":"<b>"}')
  expect(new ThemePref(file).get()).toBeUndefined()
})

it('takes every theme of the selector, and a theme added later, without a server change', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theme-')), 'theme.json')
  const a = new ThemePref(file)
  expect(THEMES).toContain('vaporwave')
  for (const t of THEMES) expect(a.set(t), t).toBe(true)
  expect(a.set('some-future-theme')).toBe(true)
  expect(new ThemePref(file).get()).toBe('some-future-theme')
})
