// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { followSwipe, swipeTo } from './swipe.ts'

const fire = (type: string, x = 0, y = 0) => {
  const e = new Event(type)
  if (type.startsWith('touch')) Object.defineProperty(e, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
  else Object.assign(e, { clientX: x, clientY: y })
  dispatchEvent(e)
}
const down = (x: number, y: number, pointerType = 'touch') => ({ clientX: x, clientY: y, pointerType, target: document.body })

afterEach(() => { fire('touchcancel'); fire('pointercancel') })

it('reads a mostly horizontal move of 70 px or more as a swipe', () => {
  expect(swipeTo(-240, 10)).toBe('foryou')
  expect(swipeTo(240, -10)).toBe('boss')
  expect(swipeTo(60, 0)).toBeNull()
  expect(swipeTo(100, 80)).toBeNull()
})

it('keeps For you open on a phone: a scroll, then a tap elsewhere, is never a swipe back to the thread', () => {
  const go = vi.fn()
  // A thumb scrolls For you from the left edge: the browser takes the gesture (pointercancel), the touch ends higher.
  followSwipe(down(60, 600), go)
  fire('pointercancel')
  fire('touchend', 62, 350)
  // Then taps a card on the right, level with where the scroll began.
  followSwipe(down(330, 610), go)
  fire('pointerup', 330, 610)
  fire('touchend', 330, 610)
  expect(go).not.toHaveBeenCalled()
})

it('a finger swipe switches where the finger lifts, though the browser cancelled its pointer', () => {
  const go = vi.fn()
  followSwipe(down(320, 500), go)
  fire('pointercancel')
  fire('touchend', 80, 510)
  expect(go).toHaveBeenCalledExactlyOnceWith('foryou')
})

it('with a mouse, the release decides and a cancelled drag is forgotten', () => {
  const go = vi.fn()
  followSwipe(down(80, 500, 'mouse'), go)
  fire('pointercancel')
  fire('pointerup', 320, 500)
  expect(go).not.toHaveBeenCalled()
  followSwipe(down(80, 500, 'mouse'), go)
  fire('pointerup', 320, 505)
  expect(go).toHaveBeenCalledExactlyOnceWith('boss')
})
