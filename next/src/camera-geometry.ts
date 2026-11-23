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

/** How long a first tap waits for its second (a double tap) before it counts alone. */
export const TAP_MS = 350

/** A finger lifted without drawing, on the frozen screen: the second of a double tap (soon after the first, close to
 *  it), a tap alone, or none (held too long to be a tap). */
export function tapKind(last: { at: number; x: number; y: number }, now: { at: number; x: number; y: number }, pressMs: number): 'double' | 'single' | 'none' {
  if (pressMs > 600) return 'none'
  if (last.at && now.at - last.at < TAP_MS && Math.hypot(now.x - last.x, now.y - last.y) < 44) return 'double'
  return 'single'
}
