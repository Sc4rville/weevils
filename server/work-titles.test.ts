// A session's title names the work it does, as a short action (« Remaking the requests page »): never words lifted
// from the request, never the project's name in front (2026-11-21).
import { describe, expect, it } from 'vitest'
import { TITLE_RULE, weakTitle, withoutPlace } from './titles.ts'
import M from './i18n/titles.ts'

const places = ['weevils', 'weevils-next']
const request = 'ok so the architecture vision: the request section must show each request once, with its state, like a column'

describe('a title names the work', () => {
  it('the bad examples are caught', () => {
    expect(weakTitle('architecture vision', { places, request })).toBe(true)
    expect(weakTitle('Architecture Vision', { places, request })).toBe(true)
    expect(weakTitle('weevils next', { places, request })).toBe(true)
    expect(weakTitle('weevils pump reliability', { places, request })).toBe(true)
    expect(weakTitle('weevils-next: request column', { places, request })).toBe(true)
  })
  it('an action naming the work passes', () => {
    for (const t of ['Remaking the requests page', 'Separating public code from personal config', 'Reconnecting cut sessions'])
      expect(weakTitle(t, { places, request })).toBe(false)
  })
  it('the project name in front is cut, the rest kept', () => {
    expect(withoutPlace('weevils pump reliability', places)).toBe('Pump reliability')
    expect(withoutPlace('weevils · Reconnecting cut sessions', places)).toBe('Reconnecting cut sessions')
    expect(withoutPlace('Remaking the requests page', places)).toBe('Remaking the requests page')
    expect(withoutPlace('weevils', places)).toBe('weevils')
  })
  it('titles from before this rule are written again', () => {
    expect(TITLE_RULE).toBeGreaterThanOrEqual(2)
  })
  it('the namer is told so, with the bad examples, in both languages', () => {
    const en = M.en.prompt('Alex', '[]')
    expect(en).toMatch(/action phrase/)
    expect(en).toMatch(/Remaking the requests page/)
    expect(en).toMatch(/not "weevils pump reliability"/)
    expect(en).toMatch(/lifted from the request/)
    const fr = M.fr.prompt('Alex', '[]')
    expect(fr).toMatch(/Refonte de la page des demandes/)
    expect(fr).toMatch(/pas « weevils fiabilité de la pompe »/)
  })
})
