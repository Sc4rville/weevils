// @vitest-environment happy-dom
// A real win celebrates once: never again for the same id (a reload, the line shown twice), never for an old win
// (another device opening the app), one celebration for a batch, and a still glow under « reduce motion ».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { celebrateWin, celebrations, resetWins, WIN_FRESH_MS } from './celebrate'

const reduce = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
const line = () => {
  const el = document.createElement('div')
  el.className = 'msg band'
  document.body.appendChild(el)
  return el
}
const settle = () => new Promise((r) => setTimeout(r, 260))
const win = (id: string, ago = 1000) => ({ id, at: Date.now() - ago, kind: 'move' as const })

beforeEach(() => {
  resetWins()
  reduce(false)
  document.body.innerHTML = ''
})
afterEach(() => vi.unstubAllGlobals())

describe('celebrateWin', () => {
  it('fires once per win, even when the line comes back (reload, another screen)', async () => {
    expect(celebrateWin(win('move:a'), line())).toBe(true)
    await settle()
    expect(celebrations.map((c) => c.id)).toEqual(['move:a'])
    expect(celebrateWin(win('move:a'), line())).toBe(false)
    await settle()
    expect(celebrations).toHaveLength(1)
  })

  it('remembers across a reload (the seen list lives on the device)', async () => {
    celebrateWin(win('done:r1'), line())
    await settle()
    vi.resetModules()
    const again = await import('./celebrate')
    expect(again.celebrateWin(win('done:r1'), line())).toBe(false)
  })

  it('an old win shown for the first time replays nothing', async () => {
    expect(celebrateWin(win('land:x', WIN_FRESH_MS + 1000), line())).toBe(false)
    await settle()
    expect(celebrations).toHaveLength(0)
  })

  it('several wins landing together make one celebration, on the last one', async () => {
    const a = line(), b = line(), c = line()
    celebrateWin(win('land:1'), a)
    celebrateWin(win('land:2'), b)
    celebrateWin(win('land:3'), c)
    await settle()
    expect(celebrations.map((x) => x.id)).toEqual(['land:3'])
    expect(c.querySelector('.win-layer')).not.toBeNull()
    // …and none of them comes back later.
    expect(celebrateWin(win('land:1'), line())).toBe(false)
  })

  it('a win arriving during a celebration joins it instead of starting another', async () => {
    celebrateWin(win('a'), line())
    await settle()
    celebrateWin(win('b'), line())
    await settle()
    expect(celebrations.map((x) => x.id)).toEqual(['a'])
  })

  it('under reduce motion: a soft glow, no confetti', async () => {
    reduce(true)
    const el = line()
    celebrateWin(win('machine:m1'), el)
    await settle()
    expect(celebrations).toEqual([expect.objectContaining({ id: 'machine:m1', mode: 'glow' })])
    expect(document.querySelector('.win-burst')).toBeNull()
  })

  it('with motion: the confetti layer appears, outside the thread so it is not clipped', async () => {
    const el = line()
    celebrateWin(win('vault:1'), el)
    await settle()
    expect(celebrations[0].mode).toBe('confetti')
    const burst = document.querySelector('.win-burst')
    expect(burst?.parentElement).toBe(document.body)
    expect(burst?.querySelectorAll('i').length).toBeGreaterThanOrEqual(18)
  })
})
