import { describe, expect, it } from 'vitest'
import { captionAt, tourStops } from './tour-stops.ts'
import M from '../../src/i18n/tour.ts'

// The guided tour's stops (docs/onboarding.md): a newcomer's tour is short, what is not there yet is left out.
describe('the tour', () => {
  it('a newcomer: the menu (a real tap), where projects will land, the factory, the field, the camera', () => {
    const stops = tourStops({ projects: 0, automations: 0, foryou: false })
    expect(stops.map((s) => s.id)).toEqual(['menu', 'projects', 'factory', 'composer', 'camera'])
    expect(stops[0]).toMatchObject({ screen: 'boss', advance: 'tap' })
    expect(stops[1]).toMatchObject({ screen: 'side', line: 'projectsNone', advance: 'next' })
    expect(stops.slice(1).every((s) => s.advance === 'next')).toBe(true)
  })
  it('with projects, automations and For you: their own stops, on their own screen', () => {
    const stops = tourStops({ projects: 3, automations: 1, foryou: true })
    expect(stops.map((s) => s.id)).toEqual(['menu', 'projects', 'autonomous', 'factory', 'foryou', 'composer', 'camera'])
    expect(stops.find((s) => s.id === 'projects')?.line).toBe('projects')
    expect(stops.find((s) => s.id === 'foryou')?.screen).toBe('boss')
  })
  it('every stop has its line in both languages', () => {
    const stops = tourStops({ projects: 1, automations: 1, foryou: true })
    for (const lang of ['en', 'fr'] as const) for (const s of [...stops, { line: 'projectsNone' as const }]) expect(M[lang][s.line]).toBeTruthy()
  })
  it('the line sits under the place when it fits, else above it', () => {
    expect(captionAt({ top: 10, bottom: 50 }, 800, 100)).toEqual({ top: 64 })
    expect(captionAt({ top: 700, bottom: 760 }, 800, 100)).toEqual({ top: 586 })
  })
})
