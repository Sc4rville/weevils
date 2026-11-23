import { describe, expect, it } from 'vitest'
import { place, region, tapKind, TAP_MS } from './camera-geometry.ts'

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
  it('tells a double tap from a tap alone and from a finger held down', () => {
    const first = { at: 1000, x: 200, y: 500 }
    expect(tapKind({ at: 0, x: 0, y: 0 }, first, 80)).toBe('single')
    expect(tapKind(first, { at: 1000 + 120, x: 206, y: 497 }, 70)).toBe('double')
    expect(tapKind(first, { at: 1000 + TAP_MS + 30, x: 200, y: 500 }, 70)).toBe('single')
    expect(tapKind(first, { at: 1100, x: 320, y: 500 }, 70)).toBe('single')
    expect(tapKind({ at: 0, x: 0, y: 0 }, first, 900)).toBe('none')
  })
})
