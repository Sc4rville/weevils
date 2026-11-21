import { describe, expect, it } from 'vitest'
import { FACTORY, countUsage, defaultPanels, eligibility, labelText, pageRef, parseMetrics, parsePanels, scheduleMirror, slugName, uniqueName, usageDay, usageTotals, type AutoSignals } from './factory.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-21T12:00:00Z')
const base: AutoSignals = { accepted: true, recurring: true, builtin: false, paused: false, ready: true, runs: 12, lastOk: 9, lastOf: 10, ageDays: 9, consumed: 0, consumedDays: 0, pushes: 0, requests: 0, commits: 0, resultsPage: false }

describe('eligibility: mature, and one more reason', () => {
  it('a mature automation with no other reason stays an automation', () => {
    expect(eligibility(base)).toEqual({ mature: true, reasons: [], eligible: false })
  })
  it('each reason alone is enough once mature, and says its own numbers', () => {
    expect(eligibility({ ...base, consumed: 12, consumedDays: 4 })).toMatchObject({ eligible: true, reasons: [{ kind: 'used', count: 12, days: 4 }] })
    expect(eligibility({ ...base, pushes: 5 }).reasons).toEqual([{ kind: 'pushed', pushes: 5, requests: 0 }])
    expect(eligibility({ ...base, requests: 3 }).eligible).toBe(true)
    expect(eligibility({ ...base, runs: 37, lastOk: 10 }).reasons).toEqual([{ kind: 'proven', runs: 37, ok: 10, of: 10 }])
    expect(eligibility({ ...base, commits: 3, resultsPage: true }).reasons).toEqual([{ kind: 'grown', commits: 3 }])
  })
  it('one short of a threshold is not a reason', () => {
    expect(eligibility({ ...base, consumed: 11, consumedDays: 9 }).eligible).toBe(false)
    expect(eligibility({ ...base, consumed: 40, consumedDays: 3 }).eligible).toBe(false)
    expect(eligibility({ ...base, pushes: 4, requests: 2 }).eligible).toBe(false)
    expect(eligibility({ ...base, runs: 29, lastOk: 10 }).eligible).toBe(false)
    expect(eligibility({ ...base, runs: 40, lastOk: 8 }).eligible).toBe(false)
    expect(eligibility({ ...base, commits: 9, resultsPage: false }).eligible).toBe(false)
  })
  it('a strong reason never makes up for immaturity', () => {
    const strong = { ...base, runs: 80, lastOk: 10, consumed: 99, consumedDays: 20, pushes: 30 }
    for (const young of [{ runs: 9 }, { ageDays: 6 }, { lastOk: 7 }, { lastOf: 9 }, { recurring: false }, { builtin: true }, { paused: true }, { ready: false }, { accepted: false }])
      expect(eligibility({ ...strong, ...young }), JSON.stringify(young)).toMatchObject({ mature: false, eligible: false })
    expect(eligibility(strong).eligible).toBe(true)
  })
})

describe('usage counters', () => {
  it('count per day, total over the window, forget what is older than they are kept', () => {
    const u = {}
    countUsage(u, 'page', NOW - 70 * DAY)
    countUsage(u, 'page', NOW - 40 * DAY)
    for (let d = 0; d < 3; d++) for (let i = 0; i < 2; i++) countUsage(u, d === 0 ? 'results' : 'run', NOW - d * DAY)
    countUsage(u, 'now', NOW)
    countUsage(u, 'card', NOW)
    expect(Object.keys(u)).not.toContain(usageDay(NOW - 70 * DAY))
    expect(Object.keys(u)).toContain(usageDay(NOW - 40 * DAY))
    expect(usageTotals(u, NOW)).toEqual({ consumed: 7, consumedDays: 3, now: 1 })
    expect(usageTotals(undefined, NOW)).toEqual({ consumed: 0, consumedDays: 0, now: 0 })
  })
})

describe('names', () => {
  it('a slug a repository can carry, from any title', () => {
    expect(slugName('Night lens')).toBe('night-lens')
    expect(slugName('  Veille : idées & café !  ')).toBe('veille-idees-cafe')
    expect(slugName('«»')).toBe('automation')
    expect(slugName('x'.repeat(80))).toHaveLength(40)
  })
  it('never the same name twice in the mother', () => {
    expect(uniqueName('Ad factory', 'abcdef1234', [])).toBe('ad-factory')
    expect(uniqueName('Ad factory', 'abcdef1234', ['ad-factory'])).toBe('ad-factory-abcd')
    expect(uniqueName('Ad factory', 'abcdef1234', ['ad-factory', 'ad-factory-abcd'])).toBe('ad-factory-abcdef1234')
  })
})

describe('the manifest mirror of a schedule', () => {
  it('says the trigger, the period and the window in plain values', () => {
    expect(scheduleMirror({ every: 3 * 3_600_000 })).toEqual({ trigger: 'every', every: '3h' })
    expect(scheduleMirror({ every: 7 * DAY })).toEqual({ trigger: 'every', every: '7d' })
    expect(scheduleMirror({ every: DAY, window: { from: 60, to: 300 }, onSleep: true })).toEqual({ trigger: 'sleep', every: '24h', window: '01:00-05:00' })
    expect(scheduleMirror({ window: { from: 22 * 60 + 30, to: 6 * 60 } })).toEqual({ trigger: 'window', window: '22:30-06:00' })
    expect(scheduleMirror({ notBefore: NOW })).toEqual({ trigger: 'time', at: '2026-11-21T12:00:00.000Z' })
    expect(scheduleMirror({})).toEqual({ trigger: 'idle' })
  })
})

describe('the page a factory declares', () => {
  it('keeps the known panels, in order, with their checked options', () => {
    const panels = parsePanels({ panels: [
      { type: 'hero' },
      { type: 'facts', items: ['next', 'nope', 'runs'] },
      { type: 'metrics', items: [{ key: 'leads', label: { en: 'Leads', fr: 'Pistes' } }, { key: 'runs.ok' }, { key: 'bad key!' }] },
      { type: 'chart', metric: 'leads', runs: 99 },
      { type: 'results', limit: 50 },
      { type: 'actions', items: [{ do: 'run' }, { do: 'explode' }, { label: 'Stricter', ask: 'Make it stricter.' }, { ask: 'no label' }] },
      { type: 'text', title: 'Note', body: 'Plain words.' },
    ] })
    expect(panels).toEqual([
      { type: 'hero' },
      { type: 'facts', items: ['next', 'runs'] },
      { type: 'metrics', items: [{ key: 'leads', label: { en: 'Leads', fr: 'Pistes' } }, { key: 'runs.ok' }] },
      { type: 'chart', metric: 'leads', runs: 30 },
      { type: 'results', limit: 10 },
      { type: 'actions', items: [{ do: 'run' }, { label: 'Stricter', ask: 'Make it stricter.' }] },
      { type: 'text', title: 'Note', body: 'Plain words.' },
    ])
  })
  it('skips what it does not know and never throws on junk', () => {
    expect(parsePanels({ panels: [{ type: 'iframe', src: 'https://x' }, { type: 'html', html: '<script>' }, null, 'hero', { type: 'metrics', items: [] }, { type: 'runs', onClick: 'x' }] })).toEqual([{ type: 'runs' }])
    for (const junk of [undefined, null, 3, 'x', {}, { panels: 'x' }]) expect(parsePanels(junk)).toEqual([])
  })
  it('draws eight panels at most', () => {
    expect(parsePanels(Array.from({ length: 20 }, () => ({ type: 'runs' })))).toHaveLength(FACTORY.MAX_PANELS)
  })
  it('has a default page, with the results when there are some', () => {
    expect(defaultPanels({ resultsPage: true }).map((p) => p.type)).toEqual(['hero', 'metrics', 'facts', 'results', 'runs', 'actions'])
    expect(defaultPanels({ resultsPage: false }).map((p) => p.type)).toEqual(['hero', 'metrics', 'facts', 'report', 'runs', 'actions'])
    expect(parsePanels(defaultPanels({ resultsPage: true }))).toEqual(defaultPanels({ resultsPage: true }))
  })
  it('a label reads in the app language, else the other one', () => {
    expect(labelText('Leads', 'fr')).toBe('Leads')
    expect(labelText({ en: 'Leads', fr: 'Pistes' }, 'fr')).toBe('Pistes')
    expect(labelText({ en: 'Leads' }, 'fr')).toBe('Leads')
    expect(labelText(undefined, 'en')).toBeUndefined()
  })
})

describe('a run card', () => {
  it('keeps finite numbers under plain keys only', () => {
    expect(parseMetrics({ leads: 12, 'runs.ok': 3, bad: 'x', inf: Infinity, 'no space': 1 })).toEqual({ leads: 12, 'runs.ok': 3 })
    expect(parseMetrics({})).toBeUndefined()
    expect(parseMetrics([1])).toBeUndefined()
  })
  it('names a weevils page by kind and slug', () => {
    expect(pageRef('report/night-lens')).toBe('report/night-lens')
    expect(pageRef('/p/opportunities/leads-2')).toBe('opportunities/leads-2')
    for (const bad of ['https://evil.example/p/report/x', '../etc', 'report/', 3, undefined]) expect(pageRef(bad)).toBeUndefined()
  })
})
