import { describe, expect, it } from 'vitest'
import { closesSideBar } from './keys.ts'

const key = (k: string, more: Partial<{ defaultPrevented: boolean; repeat: boolean; isComposing: boolean }> = {}) =>
  ({ key: k, defaultPrevented: false, repeat: false, isComposing: false, ...more })

describe('the side bar and the keyboard', () => {
  it('Escape closes it, as a tap outside does', () => {
    expect(closesSideBar(key('Escape'))).toBe(true)
  })
  it('any other key leaves it open', () => {
    for (const k of ['Enter', 'Tab', 'ArrowLeft', 'Backspace', 'e']) expect(closesSideBar(key(k))).toBe(false)
  })
  it('an Escape something else already answered, held down or ending a composed word leaves it open', () => {
    expect(closesSideBar(key('Escape', { defaultPrevented: true }))).toBe(false)
    expect(closesSideBar(key('Escape', { repeat: true }))).toBe(false)
    expect(closesSideBar(key('Escape', { isComposing: true }))).toBe(false)
  })
})
