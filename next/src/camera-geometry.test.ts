import { describe, expect, it } from 'vitest'
import { place, region } from './camera-geometry.ts'

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
})
