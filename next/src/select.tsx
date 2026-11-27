// Explain any text of the app, riding on the real selection (2026-11-27): the phone's own selector (a held finger) or
// the mouse. When something is selected anywhere (a thread, For you, the side bar, a card), one small « Explain » pill
// sits just under it, never over the system's menu (which sits above the selection), never taking the selection nor a
// tap; a tap on it opens the bar of threads and files (src/ui/ask.tsx: explain, ask, copy) in its place, answered with
// the text around it (server/explain.ts, kind « ui »). No mode, no frozen screen, no button of its own: a page cannot
// add a line to Apple's own menu, so the pill stands beside it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AskPanel, useAsk } from '../../src/ui/ask.tsx'
import { useT } from '../../src/i18n/index.ts'
import SM from '../../src/i18n/select.ts'
import { mark } from './camera-geometry.ts'

/** The pill and the bar: their own taps, never read as a new selection. */
const OWN = '[data-wv-pick]'
/** A field's own selection (writing, editing) is never something to explain. */
const FIELD = 'input, textarea, select, [contenteditable]'
const SETTLE_MS = 250

export interface Picked { text: string; rect: { top: number; bottom: number; left: number }; where: string; around: string }

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const textOf = (el: Element) => flat((el as HTMLElement).innerText || el.textContent || '')
const elementOf = (n: Node | null): Element | null => (n instanceof Element ? n : (n?.parentElement ?? null))

/** Where the text is and what is around it, as shown: the nearest heading or label, and the block holding it. */
export function contextOf(node: Node): { where: string; around: string } {
  const el = elementOf(node)
  let around = ''
  for (let e = el, i = 0; e && e !== document.body && i < 12; e = e.parentElement, i++) {
    around = textOf(e)
    if (around.length >= 400) break
  }
  const region = el?.closest('section, aside, article, [role="dialog"], main')
  const heading = region?.querySelector('h1, h2, h3')
  const where = (heading ? textOf(heading) : '') || el?.closest('[aria-label]')?.getAttribute('aria-label') || ''
  return { where: where.slice(0, 120), around: around.slice(0, 3000) }
}

/** The real selection, if it is something to explain: not empty, not in a field, not in the pill or its bar. */
export function selectionNow(): Picked | null {
  const s = window.getSelection()
  if (!s || s.isCollapsed || !s.rangeCount) return null
  const range = s.getRangeAt(0)
  const text = flat(s.toString())
  const el = elementOf(range.commonAncestorContainer)
  if (!text || text.length > 2000 || !el || el.closest(OWN) || el.closest(FIELD)) return null
  // Under its last line: where the selection ends, the system's handle and menu are above or at its start.
  const rects = [...range.getClientRects()].filter((r) => r.width || r.height)
  const all = range.getBoundingClientRect()
  const last = rects.at(-1) ?? all
  return { text, rect: { top: all.top, bottom: last.bottom, left: last.left }, ...contextOf(range.commonAncestorContainer) }
}

export function Select() {
  const t = useT(SM)
  const [picked, setPicked] = useState<Picked | null>(null)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  // The pill was tapped: the bar is open, and stays while its answer is read, whatever the selection does.
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const a = useAsk(() => {
    const p = pickedRef.current
    return { kind: 'ui', repo: '', path: '', title: p?.where ?? '', selection: p?.text ?? '', from: 0, to: 0, around: p?.around ?? '' }
  })
  const aRef = useRef(a)
  aRef.current = a
  const close = useCallback(() => {
    aRef.current.reset()
    setOpen(false)
    setPicked(null)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let down = false
    const read = () => {
      if (openRef.current) return
      const p = down ? null : selectionNow()
      if (p) setPicked((cur) => (cur && cur.text === p.text && cur.rect.bottom === p.rect.bottom ? cur : p))
      else if (!down) setPicked(null)
    }
    const later = () => { clearTimeout(timer); timer = setTimeout(read, SETTLE_MS) }
    // A mouse still dragging is still choosing: read once it is let go.
    const press = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !(e.target as Element | null)?.closest?.(OWN)) down = true
      // A tap elsewhere while the bar is open closes it (the page's own tap goes on as usual).
      if (openRef.current && !(e.target as Element | null)?.closest?.(OWN)) close()
    }
    const release = (e: PointerEvent) => { if (e.pointerType === 'mouse') { down = false; later() } }
    const moved = () => { if (pickedRef.current && !openRef.current) later() }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('selectionchange', later)
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', later)
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('keydown', key)
    }
  }, [close])

  if (!picked) return null
  const h = window.innerHeight
  const below = picked.rect.bottom + 12
  const room = below + (open ? 200 : 40) < h
  const place = room ? { top: Math.max(8, below) } : { bottom: Math.max(8, h - picked.rect.top + 12) }
  if (!open) {
    const left = Math.min(Math.max(8, picked.rect.left), window.innerWidth - 120)
    return (
      <button className="pick-pill" data-wv-pick="" {...mark} style={{ ...place, left }}
        // Never takes the selection away: no focus, no default on the press.
        onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setOpen(true); void a.ask('explain') }}>
        {t.explain}
      </button>
    )
  }
  return (
    <div className="pick-bar" data-wv-pick="" {...mark} style={place}>
      <AskPanel a={a} text={picked.text} usage={false} onHit={() => {}} />
    </div>
  )
}
