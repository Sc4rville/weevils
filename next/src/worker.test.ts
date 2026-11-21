import { describe, expect, it } from 'vitest'
import { notificationTarget } from './worker.ts'

describe('a notification tapped in next', () => {
  it('opens the session it points to, else weevboss', () => {
    expect(notificationTarget('/#s=abc-123')).toEqual({ session: 'abc-123' })
    expect(notificationTarget('https://x.example/#mid=9&s=s%201')).toEqual({ session: 's 1' })
    expect(notificationTarget('/')).toBe('boss')
  })
})
