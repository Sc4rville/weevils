import { describe, expect, it } from 'vitest'
import { place, region, secondTap, TAP_MS } from './camera-geometry.ts'

describe('camera geometry', () => {
  it('draws the same box whichever way the finger goes', () => {
    expect(region({ x: 10, y: 20 }, { x: 110, y: 220 }, 390, 844)).toEqual({ x: 10, y: 20, w: 100, h: 200 })
    expect(region({ x: 110, y: 220 }, { x: 10, y: 20 }, 390, 844)).toEqual({ x: 10, y: 20, w: 100, h: 200 })
  })
  it('keeps the box inside the screen', () => {
    expect(region({ x: -30, y: 800 }, { x: 500, y: 900 }, 390, 844)).toEqual({ x: 0, y: 800, w: 390, h: 44 })
  })
  it('keeps the mark clear of the top band and of the box to write in', () => {
    expect(place(0, 844)).toBe(0.14)
    expect(place(844, 844)).toBe(0.8)
    expect(place(422, 844)).toBe(0.5)
  })
  it('counts a second tap from the lifted finger, generously, by either clock', () => {
    const first = { at: 1000, t: 1000, x: 200, y: 500 }
    expect(secondTap(null, first)).toBe(false)
    // A thumb's double tap: down again 0.3 s after the lift (it missed with the earlier 0.35 s from lift to lift).
    expect(secondTap(first, { at: 1300, t: 1300, x: 206, y: 497 })).toBe(true)
    expect(secondTap(first, { at: 1000 + TAP_MS + 30, t: 1000 + TAP_MS + 30, x: 200, y: 500 })).toBe(false)
    expect(secondTap(first, { at: 1100, t: 1100, x: 320, y: 500 })).toBe(false)
    // The page was busy making the picture: it saw the second tap late, the phone did not.
    expect(secondTap(first, { at: 1900, t: 1200, x: 200, y: 500 })).toBe(true)
  })
})
