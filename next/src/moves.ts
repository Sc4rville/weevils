// Where things move in weevils next (docs/next-interaction.md), in one place so it cannot drift screen by screen:
// a screen you open comes in from the right edge and goes back out to the right (an iOS push and pop), wherever it was
// opened from; weevboss alone comes down from the top and goes back up; the side bar is a drawer from the left.
import { animate, type MotionValue, type Transition } from 'motion/react'

export type Move = 'push' | 'pop' | 'boss-down' | 'boss-up' | 'drawer-open' | 'drawer-close'

/** The x (or y for weevboss) a screen starts from and ends at, for a screen `size` px wide (or tall). `dragged`: how far
 *  the finger already took it (a back swipe), so the pop goes on from there. */
export function travel(move: Move, size: number, dragged = 0): { from: number; to: number; axis: 'x' | 'y' } {
  switch (move) {
    case 'push': return { axis: 'x', from: size, to: 0 }
    case 'pop': return { axis: 'x', from: Math.max(0, dragged), to: size }
    case 'boss-down': return { axis: 'y', from: -size, to: 0 }
    case 'boss-up': return { axis: 'y', from: 0, to: -size }
    case 'drawer-open': return { axis: 'x', from: -size, to: 0 }
    case 'drawer-close': return { axis: 'x', from: 0, to: -size }
  }
}

/** Runs a move on a motion value, as one motion: it is placed at its start (a jump, which carries no speed: a plain
 *  set from where it was would hand the spring that leap as a speed, and the screen would first fly the wrong way, then
 *  come back), then travels to its end. */
export function slide(v: MotionValue<number>, move: Move, size: number, transition: Transition, dragged = 0) {
  const go = travel(move, size, dragged)
  v.jump(go.from)
  return animate(v, go.to, transition)
}
