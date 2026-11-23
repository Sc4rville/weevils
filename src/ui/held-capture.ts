// A capture from weevils next's camera (next/src/camera.tsx), held in the box to write in until it is sent or removed:
// a small square in weevboss's box and in every conversation's, it follows you from one screen to the next and goes
// with the next message sent from any of them (bits.tsx Composer). Kept for the tab (a reload, an app update), never
// more than an hour.
import { useSyncExternalStore } from 'react'
import { api } from '../api'
import type { Attachment } from './bits'

export interface Held {
  /** The picture, as a data URL (PNG). */
  url: string
  /** What it shows (screen, conversation, page, theme, size, part): written next to it in the library. */
  context: Record<string, unknown>
  at: number
}

const KEY = 'weevils-held-capture'
const TTL = 60 * 60_000
const subs = new Set<() => void>()
let held: Held | null = read()

function read(): Held | null {
  try {
    const h = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Held | null
    return h && typeof h.url === 'string' && Date.now() - h.at < TTL ? h : null
  } catch {
    return null
  }
}

export function hold(h: Held | null) {
  held = h
  try {
    if (h) sessionStorage.setItem(KEY, JSON.stringify(h))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* too big or no storage: it stays held for this page */
  }
  subs.forEach((f) => f())
}

export const heldNow = () => held

export function useHeld(): Held | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => held, () => null)
}

/** Where a box sends: weevboss, or a conversation (feedback: it works on weevils itself, so the capture is about the
 *  interface and feeds the improvement loop). */
export interface CaptureTo { to: string; feedback: boolean }

/** The message that carries the capture, kept in the library first. A conversation on another machine cannot open
 *  this one's library: it gets the picture itself, as an attached photo. */
export async function withHeld(h: Held, text: string, where: CaptureTo, files: Attachment[]): Promise<{ text: string; files: Attachment[] }> {
  const r = await api.capture({ data: h.url, context: h.context, text, to: where.to, feedback: where.feedback })
  if (r.here) return { text: r.message, files }
  return { text: `${text} ⟦weevils — ${r.note}⟧`.trim(), files: [{ name: 'capture.png', type: 'image/png', data: h.url.split(',')[1] ?? '' }, ...files] }
}
