import { describe, expect, it } from 'vitest'
import { hostSlug } from './config.ts'

describe('hostSlug', () => {
  it('reduces a hostname like install.sh does', () => {
    expect(hostSlug('srv2135141')).toBe('srv2135141')
    expect(hostSlug('My-Laptop.local')).toBe('my-laptop')
    expect(hostSlug('_weird host_')).toBe('weird-host')
    expect(hostSlug('a-very-long-hostname-for-a-box')).toBe('a-very-long-hostname')
    expect(hostSlug('...')).toBe('main')
  })
})
