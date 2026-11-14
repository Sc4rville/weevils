// @vitest-environment happy-dom
// First steps: the install fact never mentions the terminal, the machine never says « vps » or « wsl ».
import { afterEach, expect, it, vi } from 'vitest'
import type { TourStep } from '../../shared/tour'
vi.mock('../api', () => ({ api: { tour: async () => null } }))
const { setLang, tr } = await import('../i18n')
const M = (await import('../i18n/tour')).default
const { factsOf } = await import('./tour')
afterEach(() => setLang(null))
const NOW = Date.now()
const step = (id: string, facts: Record<string, unknown>) => ({ id, state: 'done', facts }) as unknown as TourStep

it('the install step says « installed 5 min ago », whoever ran the installer', () => {
  setLang('en')
  for (const by of ['terminal', 'script', undefined]) expect(factsOf(step('install', { by, at: NOW - 5 * 60_000 }), NOW)).toBe('installed 5 min ago')
  expect(factsOf(step('install', { by: 'agent', agent: 'codex', at: NOW }), NOW)).toContain('Codex')
  setLang('fr')
  expect(factsOf(step('install', { at: NOW - 5 * 60_000 }), NOW)).toBe('installé il y a 5 min')
})

it('no hosting jargon in the machine fact or the night step', () => {
  for (const lang of ['en', 'fr'] as const) {
    setLang(lang)
    for (const kind of ['vps', 'wsl']) expect(factsOf(step('machine', { kind, cpus: 4, ram: 16 }), NOW)).not.toMatch(/vps|wsl/i)
    expect(tr(M).t_night).not.toMatch(/vps/i)
  }
})
