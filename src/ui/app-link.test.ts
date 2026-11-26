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
    expect(appLink('/#do=codex')).toEqual({ kind: 'do', action: 'codex' })
    expect(appLink('/#do=rm')).toBeUndefined()
    expect(appLink('https://elsewhere.example/#do=github')).toBeUndefined()
    // The onboarding journey's steps and its examples to try (server/journey.ts), nothing else.
    expect(appLink('/#do=tour')).toEqual({ kind: 'do', action: 'tour' })
    expect(appLink('/#do=push')).toEqual({ kind: 'do', action: 'push' })
    expect(appLink('/#do=try.notes')).toEqual({ kind: 'do', action: 'try.notes' })
    expect(appLink('/#do=try.rmrf')).toBeUndefined()
    expect(appLink('/#do=toured')).toBeUndefined()
    expect(appLink('/#do=github.x')).toBeUndefined()
    // Claude's sign-in on another machine of yours.
    expect(appLink('/#do=claude.desk-2')).toEqual({ kind: 'do', action: 'claude.desk-2' })
    expect(appLink('/#do=claude.')).toBeUndefined()
    expect(appLink('/#do=claude.a/b')).toBeUndefined()
  })
})
