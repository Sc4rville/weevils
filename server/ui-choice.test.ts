import { describe, expect, it } from 'vitest'
import { uiChoice, uiDirs } from './ui-choice.ts'

describe('which interface a browser gets', () => {
  it('weevils next by default, for every install that has it built', () => {
    expect(uiChoice({ nextBuilt: true })).toEqual({ ui: 'next' })
  })
  it('the classic app stays one address away, and the browser keeps the choice', () => {
    expect(uiChoice({ nextBuilt: true, query: 'classic' })).toEqual({ ui: 'classic', set: 'classic' })
    expect(uiChoice({ nextBuilt: true, cookie: 'wv=abc; weevils-ui=classic' })).toEqual({ ui: 'classic' })
    expect(uiChoice({ nextBuilt: true, cookie: 'weevils-ui=classic', query: 'next' })).toEqual({ ui: 'next', set: 'next' })
  })
  it('an install can keep the classic app as its default; without next built, always the classic app', () => {
    expect(uiChoice({ nextBuilt: true, fallback: 'classic' }).ui).toBe('classic')
    expect(uiChoice({ nextBuilt: false }).ui).toBe('classic')
    expect(uiChoice({ nextBuilt: false, query: 'next' }).ui).toBe('classic')
  })
  it('a file is looked for in the chosen build first; the service worker always comes from the classic build', () => {
    const dirs = { classic: '/w/dist', next: '/w/next/dist' }
    expect(uiDirs('next', dirs, '/assets/x.js')).toEqual(['/w/next/dist', '/w/dist'])
    expect(uiDirs('classic', dirs, '/assets/x.js')).toEqual(['/w/dist', '/w/next/dist'])
    expect(uiDirs('next', dirs, '/sw.js')[0]).toBe('/w/dist')
  })
})
