// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { motionValue } from 'motion/react'
import { slide, travel } from './moves.ts'

describe('where screens move in next', () => {
  it('a screen opened (from the side bar, a page or weevboss) comes in from the right edge', () => {
    expect(travel('push', 390)).toEqual({ axis: 'x', from: 390, to: 0 })
  })
  it('going back takes it out to the right, on from where the finger left it', () => {
    expect(travel('pop', 390)).toEqual({ axis: 'x', from: 0, to: 390 })
    expect(travel('pop', 390, 120)).toEqual({ axis: 'x', from: 120, to: 390 })
    expect(travel('pop', 390, -30).from).toBe(0)
  })
  it('weevboss alone moves vertically; the side bar is the only thing from the left', () => {
    expect(travel('boss-down', 800).axis).toBe('y')
    expect(travel('drawer-open', 340)).toEqual({ axis: 'x', from: -340, to: 0 })
  })
})

describe('a screen moves in one motion', () => {
  // 2026-11-21: a conversation tapped in the side bar came in twice (it flew past the edge, stopped, came back),
  // because its start was set, not jumped to, and the spring took that leap as a speed.
  const run = async (move: 'push' | 'pop', start: number) => {
    // A value that has moved before (as the app's layer has: it rests where its last move left it).
    const v = motionValue(start + 1)
    await new Promise((r) => setTimeout(r, 50))
    v.set(start)
    await new Promise((r) => setTimeout(r, 50))
    const seen: number[] = []
    v.on('change', (x) => seen.push(x))
    await slide(v, move, 390, { type: 'spring', stiffness: 400, damping: 40 })
    return seen
  }
  it('opening: from the right edge straight to its place, never back toward the edge', async () => {
    const seen = await run('push', 0)
    const moving = seen.slice(1)
    expect(Math.max(...moving)).toBeLessThanOrEqual(390)
    for (let i = 1; i < moving.length && moving[i - 1] > 1; i++) expect(moving[i]).toBeLessThanOrEqual(moving[i - 1])
    expect(seen.at(-1)).toBe(0)
  })
  it('going back: from where it is straight out to the right, never back toward the left first', async () => {
    const seen = await run('pop', 0)
    for (let i = 1; i < seen.length && seen[i] < 389; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen.at(-1)).toBe(390)
  })
})
