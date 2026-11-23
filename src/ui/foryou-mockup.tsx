// A media of a post inside its mockup (shared/mockup.ts): a phone, a window, a tablet, a print, a screen or a board,
// drawn in CSS (foryou-mockup.css), sized to the post, on the post's own colour. The media fills the mockup's screen. The
// side and bottom faces give the board its solid thickness (like the weevils logo); the others do not show them.
import type { CSSProperties, ReactNode } from 'react'
import { pickMockup, screenRatio, type Mockup } from '../../shared/mockup.ts'
import type { ForYouMedia } from '../../shared/foryou.ts'
import './foryou-mockup.css'

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** The mockup of a media and the shape of its screen (height / width), from what is known of it so far. */
export function mockupOf(m: Pick<ForYouMedia, 'type' | 'name' | 'mockup'>, w?: number, h?: number): { kind: Mockup; sr: number } {
  const kind = pickMockup({ type: m.type, name: m.name, w, h, mockup: m.mockup })
  return { kind, sr: screenRatio(kind, w && h ? h / w : 0) }
}

/** Turned left or right, always the same way for the same media: neighbours never all lean alike. */
export const sideOf = (id: string) => (hash(id) % 2 ? 1 : -1)

export function MockupFrame({ kind, sr, side, children }: { kind: Mockup; sr: number; side: number; children: ReactNode }) {
  return (
    <span className={`fy-mock fy-mock-${kind}`} data-mockup={kind} style={{ '--sr': sr, '--s': side } as CSSProperties}>
      <span className="fy-mock-side" aria-hidden="true" />
      <span className="fy-mock-base" aria-hidden="true" />
      <span className="fy-mock-screen">{children}</span>
    </span>
  )
}
