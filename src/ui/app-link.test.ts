// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { appLink } from './living-link'

describe('links weevboss writes to a place in the app', () => {
  it('opens a session or For you, nothing else', () => {
    expect(appLink('/#s=431a560f')).toEqual({ kind: 'session', id: '431a560f' })
    expect(appLink(`http://${location.host}/#foryou`)).toEqual({ kind: 'foryou' })
    expect(appLink('https://elsewhere.example/#s=431a560f')).toBeUndefined()
    expect(appLink('/p/report/x')).toBeUndefined()
    expect(appLink('/#boss')).toBeUndefined()
    // weevboss's own action links: only the known ones, on this app.
    expect(appLink('/#do=github')).toEqual({ kind: 'do', action: 'github' })
    expect(appLink('/#do=later')).toEqual({ kind: 'do', action: 'later' })
    expect(appLink('/#do=rm')).toBeUndefined()
    expect(appLink('https://elsewhere.example/#do=github')).toBeUndefined()
  })
})
