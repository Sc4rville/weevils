import { describe, expect, it } from 'vitest'
import { GLOBAL, PER_ADDRESS, WINDOW_MS, loginLimiter } from './login-limit.ts'

describe('login limit', () => {
  it('stops one address, then every address, and forgets after the window', () => {
    let t = 0
    const l = loginLimiter(() => t)
    for (let i = 0; i < PER_ADDRESS; i++) expect(l.attempt('a', false)).toBe('wrong')
    expect(l.attempt('a', false)).toBe('limited')
    expect(l.attempt('b', false)).toBe('wrong')
    for (let i = 0; i < GLOBAL; i++) l.attempt(`x${i}`, false)
    expect(l.attempt('fresh', false)).toBe('limited')
    t += WINDOW_MS + 1
    expect(l.attempt('a', false)).toBe('wrong')
    expect(l.attempt('fresh', false)).toBe('wrong')
  })
  it('the right code always gets in, however many wrong ones were tried, from that address or any other', () => {
    let t = 0
    const l = loginLimiter(() => t)
    for (let i = 0; i < GLOBAL + PER_ADDRESS; i++) l.attempt(i % 2 ? 'a' : `x${i}`, false)
    expect(l.attempt('a', false)).toBe('limited')
    expect(l.attempt('a', true)).toBe('ok')
    expect(l.attempt('phone', true)).toBe('ok')
  })
  it('attempts past the limit are not kept (an attack does not fill the memory)', () => {
    const l = loginLimiter(() => 0)
    for (let i = 0; i < 100_000; i++) l.attempt(`x${i}`, false)
    expect(l.size()).toBe(GLOBAL)
  })
})
