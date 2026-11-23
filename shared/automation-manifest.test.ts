import { describe, expect, it } from 'vitest'
import { pageRef, parseMetrics, scheduleMirror, slugName, uniqueName } from './automation-manifest.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-21T12:00:00Z')

describe('names', () => {
  it('a slug a repository can carry, from any title', () => {
    expect(slugName('Night lens')).toBe('night-lens')
    expect(slugName('  Veille : idées & café !  ')).toBe('veille-idees-cafe')
    expect(slugName('«»')).toBe('automation')
    expect(slugName('x'.repeat(80))).toHaveLength(40)
  })
  it('never the same name twice in the mother', () => {
    expect(uniqueName('Night lens', 'abcdef1234', [])).toBe('night-lens')
    expect(uniqueName('Night lens', 'abcdef1234', ['night-lens'])).toBe('night-lens-abcd')
    expect(uniqueName('Night lens', 'abcdef1234', ['night-lens', 'night-lens-abcd'])).toBe('night-lens-abcdef1234')
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
