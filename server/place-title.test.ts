import { describe, expect, it } from 'vitest'
import { placeTitle } from './transcripts.ts'
import { askTitle } from './boss-ledger.ts'

describe('session titles that name only the place', () => {
  it('a title that is the repo, with or without « project », is no title', () => {
    expect(placeTitle('weevils project', ['weevils', 'weevils'])).toBe(true)
    expect(placeTitle('Weevils', ['weevils'])).toBe(true)
    expect(placeTitle('tux session', ['tux'])).toBe(true)
    expect(placeTitle('projet weevils', ['weevils'])).toBe(true)
  })
  it('a title about a subject stays, even when it names the repo', () => {
    expect(placeTitle('weevils onboarding via weevboss', ['weevils'])).toBe(false)
    expect(placeTitle('Autonomous & factories', ['weevils'])).toBe(false)
    expect(placeTitle(undefined, ['weevils'])).toBe(false)
  })
})

describe('request titles', () => {
  it('one short line, no final punctuation', () => {
    expect(askTitle('  For you feed\n overhaul.  ')).toBe('For you feed overhaul')
    expect(askTitle('')).toBeUndefined()
    expect(askTitle(undefined)).toBeUndefined()
  })
})
