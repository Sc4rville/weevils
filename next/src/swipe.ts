// The sideways swipe between weevboss's thread and For you (main.tsx BossInner), decided where the finger lifts.
//
// A finger that moves makes the browser take the gesture (pointercancel), so a touch never ends in pointerup: the
// swipe reads the touch's own end (touchend) instead, and a cancelled gesture is forgotten. Listening for pointerup
// alone left one listener behind per scroll, and the next tap anywhere (a card in For you, a button) was read as a
// swipe from where that scroll began: For you bounced back to the thread (2026-11-27).

/** Where a gesture leads: mostly horizontal, 70 px or more; leftwards to For you, rightwards to the thread. */
export function swipeTo(dx: number, dy: number): 'foryou' | 'boss' | null {
  if (Math.abs(dx) <= 70 || Math.abs(dx) <= Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'foryou' : 'boss'
}

/** Something under the finger that scrolls sideways itself (a row of photos): its swipe is its own. */
function scrollsSideways(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true
  }
  return false
}

/** Follows one gesture from its pointerdown to its end, once, and calls `go` when it was a swipe. */
export function followSwipe(e: { clientX: number; clientY: number; pointerType: string; target: EventTarget | null }, go: (to: 'foryou' | 'boss') => void) {
  const x0 = e.clientX
  const y0 = e.clientY
  if (e.pointerType === 'touch' && scrollsSideways(e.target as Element | null)) return
  const touch = e.pointerType === 'touch'
  const [end, cancel] = touch ? ['touchend', 'touchcancel'] as const : ['pointerup', 'pointercancel'] as const
  const done = (ev: Event) => {
    removeEventListener(end, done)
    removeEventListener(cancel, done)
    if (ev.type === cancel) return
    const p = touch ? (ev as TouchEvent).changedTouches?.[0] : (ev as PointerEvent)
    if (!p) return
    const to = swipeTo(p.clientX - x0, p.clientY - y0)
    if (to) go(to)
  }
  addEventListener(end, done)
  addEventListener(cancel, done)
}
