// The camera's geometry (camera.tsx), kept apart so it is tested: the part drawn by a finger, and where the mark sits.

export interface Box { x: number; y: number; w: number; h: number }

/** The rectangle between where the finger went down and where it is, kept inside the screen, in whole pixels. */
export function region(a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number): Box {
  const cx = (v: number) => Math.min(w, Math.max(0, v))
  const cy = (v: number) => Math.min(h, Math.max(0, v))
  const x0 = Math.round(cx(Math.min(a.x, b.x)))
  const y0 = Math.round(cy(Math.min(a.y, b.y)))
  const x1 = Math.round(cx(Math.max(a.x, b.x)))
  const y1 = Math.round(cy(Math.max(a.y, b.y)))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Where the mark sits along the edge, as a share of the screen's height: never under the top band nor the box to
 *  write in at the bottom. */
export function place(clientY: number, h: number): number {
  return Math.min(0.8, Math.max(0.14, clientY / Math.max(1, h)))
}

/** The camera's own layers carry this attribute: they are never in the picture. */
export const mark = { 'data-wv-camera': '' } as const
export const isMark = (n: Node) => n instanceof Element && n.hasAttribute('data-wv-camera')

/** How long a first tap waits for its second (a double tap) before it counts alone: from the finger lifted to the
 *  finger down again. 0.35 s from lift to lift missed a real thumb's double tap: the screen let go instead (2026-11-23). */
export const TAP_MS = 450
/** How far the second tap of a double tap may land from the first, in screen pixels. */
export const TAP_PX = 60
/** Past this, a finger held without drawing is not a tap. */
export const PRESS_MS = 600

export interface Tap { x: number; y: number; at: number; t?: number }

/** A finger going down on the frozen screen soon after a tap, close to it: the second tap of a double tap. « at » is
 *  when the page saw it, « t » when the phone did (the event's own time): either is enough, so a page busy making the
 *  picture, that sees both taps late, still counts them as one double tap. */
export function secondTap(last: Tap | null, now: Tap): boolean {
  if (!last) return false
  if (Math.hypot(now.x - last.x, now.y - last.y) >= TAP_PX) return false
  const soon = (a?: number, b?: number) => a !== undefined && b !== undefined && a > 0 && b >= a && b - a < TAP_MS
  return soon(last.at, now.at) || soon(last.t, now.t)
}
