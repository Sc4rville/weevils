import { describe, expect, it } from 'vitest'
import { toAutos, toBoss, type Reach } from './reach.ts'

/** A stand-in for next's screen: what is shown, changed by the same calls main.tsx makes. */
function screen(start: Partial<{ pages: number; side: boolean; session: boolean; top: 'boss' | 'foryou'; autosFolded: boolean }> = {}) {
  const s = { pages: 0, side: false, session: false, top: 'foryou' as 'boss' | 'foryou', autosFolded: true, ...start }
  const r: Reach = {
    closePages: () => void (s.pages = 0),
    setSide: (open) => void (s.side = open),
    bossDown: () => void (s.session = false),
    showThread: () => void (s.top = 'boss'),
    unfoldAutos: () => void (s.autosFolded = false),
  }
  return { s, r }
}

describe('For you destinations that are not pages, in next', () => {
  it('weevboss’s thread: from For you, from under a page, from a session, it is what shows', () => {
    for (const start of [{}, { pages: 2 }, { session: true }, { side: true }]) {
      const { s, r } = screen(start)
      toBoss(r)
      expect(s).toEqual({ pages: 0, side: false, session: false, top: 'boss', autosFolded: true })
    }
  })
  it('the automations: the side bar opens on its Autonomous section, unfolded', () => {
    for (const start of [{}, { pages: 1 }, { autosFolded: false }]) {
      const { s, r } = screen(start)
      toAutos(r)
      expect(s).toMatchObject({ pages: 0, side: true, autosFolded: false })
    }
  })
  it('neither is ever a tap that changes nothing', () => {
    const before = JSON.stringify(screen().s)
    for (const go of [toBoss, toAutos]) {
      const { s, r } = screen()
      go(r)
      expect(JSON.stringify(s)).not.toBe(before)
    }
  })
})
