// The mockup bank of « For you »: every picture or clip of a post is presented in a device or a support drawn in CSS
// (src/ui/foryou-mockup.css), sized to the post, on the post's own colour. One is picked per media from its shape and
// its name (pickMockup); `weevils show <file> --mockup <name>` forces one.

/** phone, browser, tablet: an interface (a phone screen, a desktop page, a tablet), shown as itself, never inside a drawn
 *  device · print: a still or a render, on a thin block · cinema: a clip that is not an interface, on a screen ·
 *  board: a diagram or a before/after, flat, on a thick block. */
export const MOCKUPS = ['phone', 'browser', 'tablet', 'print', 'cinema', 'board'] as const
export type Mockup = (typeof MOCKUPS)[number]

export const isMockup = (v: unknown): v is Mockup => typeof v === 'string' && (MOCKUPS as readonly string[]).includes(v)

/** Words in a file name that say it is a picture of a screen (an interface), not a render or a photo. */
const SCREEN = /(^|[^a-z])(screen\w*|capture\w*|ui|app|page|site|web|browser|desktop|dashboard|localhost|window|feed|thread|settings)([^a-z]|$)/i
const DESKTOP = /(^|[^a-z])(desktop|browser|web|site|page|localhost|window|dashboard|wide)([^a-z]|$)/i
const TABLET = /(^|[^a-z])(tablet|ipad)([^a-z]|$)/i

/**
 * Which mockup a media gets. `w`/`h`: its size in pixels when known (0 or missing: not known yet, a guess from the
 * name). Shape first (a tall screen is a phone), the name second (a wide screen capture is a window), else a print
 * for a still and a screen for a clip: the fallback always looks right.
 */
export function pickMockup(m: { type: 'image' | 'video'; name: string; w?: number; h?: number; mockup?: unknown }): Mockup {
  const name = m.name.toLowerCase()
  // A before/after or a diagram is read whole: always a board, whatever was asked (a phone's shape would cut it).
  if (/\.(diagram|compare)\.\w+$/.test(name) || /\.(mmd|mermaid)$/.test(name)) return 'board'
  if (isMockup(m.mockup)) return m.mockup
  const known = !!(m.w && m.h && m.w > 0 && m.h > 0)
  const r = known ? m.h! / m.w! : m.type === 'video' ? 9 / 16 : 1
  if (TABLET.test(name)) return 'tablet'
  // A phone screen is 2:1 or taller (390×844, 1170×2532, a long scrolling capture); a screen recording too.
  if (r >= 1.75) return 'phone'
  const screen = SCREEN.test(name)
  if (r < 0.85) {
    if (screen || DESKTOP.test(name)) return 'browser'
    return m.type === 'video' ? 'cinema' : 'print'
  }
  // 4:3 either way, said to be a screen: a tablet.
  if (screen && ((r >= 1.25 && r <= 1.45) || (r >= 0.7 && r <= 0.8))) return 'tablet'
  return m.type === 'video' ? 'cinema' : 'print'
}

/** The shape of the screen inside the mockup (height / width): the media's own, within what the device allows. */
export function screenRatio(mockup: Mockup, r: number): number {
  const ok = r > 0 && Number.isFinite(r)
  switch (mockup) {
    // A taller capture scrolls past the bottom of the screen: its top is shown, like on the phone.
    case 'phone': return ok ? Math.min(Math.max(r, 1), 2.17) : 2.17
    case 'tablet': return ok ? Math.min(Math.max(r, 0.56), 1.45) : 1.33
    case 'browser': return ok ? Math.min(Math.max(r, 0.42), 1.1) : 0.625
    case 'cinema': return ok ? Math.min(Math.max(r, 0.42), 1.78) : 0.5625
    // A diagram runs top to bottom: never cut, it gets narrower instead.
    case 'board': return ok ? Math.min(Math.max(r, 0.3), 2.6) : 1
    default: return ok ? Math.min(Math.max(r, 0.3), 1.8) : 1
  }
}
