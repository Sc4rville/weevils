// Explain any text of the app, wherever it is: a side bar row, a For you post, a card, a decision and its answers, a
// button, a caption. One handler for the whole app, and the same bar as threads and files (src/ui/ask.tsx: explain,
// ask, copy), answered with the text around it (server/explain.ts, kind « ui »).
//
// - Phone: a small mark under the camera's. A tap freezes the app the way the camera does (its veil, its cross), but
//   the screen stays live text: a tap takes a word (or a button's whole label), a held finger uses the phone's own
//   selector, and nothing under the finger acts (no tap, no link, no swipe). The mark again, or the cross, lets go.
//   Outside that mode the phone's long press and selector are never touched: fighting the system's selector made the
//   app hard to use.
// - Computer: text selected with the mouse anywhere opens the bar; a label that can't be selected (a button, a link)
//   opens it when the button is held. Threads and files keep their own bar (askthread.tsx, codeview.tsx).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AskPanel, useAsk } from '../../src/ui/ask.tsx'
import { caretAt } from '../../src/ui/textpick.ts'
import { wordAt } from '../../src/ui/codesel.ts'
import { Icon } from '../../src/ui/icons.tsx'
import { useT } from '../../src/i18n/index.ts'
import SM from '../../src/i18n/select.ts'
import { mark } from './camera-geometry.ts'

/** This mode's own layers (the mark, the cross, the bar): they keep their taps. */
const OWN = '[data-wv-pick]'
const FIELD = 'input, textarea, select, [contenteditable]'
/** On a computer these keep their own bar: a thread's messages, a file's lines. */
const HAS_OWN = '[data-mid], .code.lines, .qa'
/** What is read as one label: its whole text, never a word of it. */
const LABEL = 'button, a, [role="button"], label, summary'
const HOLD_MS = 500
const TAP_MS = 450
const HL = 'wv-pick'
/** Every event that could make something under the finger act, while the screen is frozen. */
const STOPPED = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const

export interface Picked { text: string; range: Range; where: string; around: string; native: boolean }

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()
const textOf = (el: Element) => flat((el as HTMLElement).innerText || el.textContent || '')
const elementOf = (n: Node | null): Element | null => (n instanceof Element ? n : (n?.parentElement ?? null))
const ownTarget = (e: Event) => !!elementOf(e.target as Node | null)?.closest(OWN)

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

/** What a tap at (x, y) takes: a label's whole text (a button, a link, a chip), otherwise the word under the finger. */
export function pickAt(x: number, y: number): Omit<Picked, 'where' | 'around' | 'native'> | null {
  const target = document.elementFromPoint(x, y)
  if (!target || target.closest(OWN) || target.closest(FIELD)) return null
  const label = target.closest(LABEL)
  if (label) {
    const text = textOf(label)
    if (text && text.length <= 80) {
      const range = document.createRange()
      range.selectNodeContents(label)
      return { text, range }
    }
  }
  const c = caretAt(x, y)
  if (!c || c.node.nodeType !== Node.TEXT_NODE) return null
  const data = (c.node as Text).data
  const w = wordAt(data, c.offset) ?? wordAt(data, c.offset - 1)
  if (!w || !/[\p{L}\p{N}]/u.test(data.slice(w[0], w[1]))) return null
  const range = document.createRange()
  range.setStart(c.node, w[0])
  range.setEnd(c.node, w[1])
  return { text: data.slice(w[0], w[1]), range }
}

/** The text the person selected with the system's selector, if it is something to explain here. */
function nativePick(frozen: boolean): Omit<Picked, 'where' | 'around'> | null {
  const s = window.getSelection()
  if (!s || s.isCollapsed || !s.rangeCount) return null
  const range = s.getRangeAt(0)
  const text = flat(s.toString())
  const el = elementOf(range.commonAncestorContainer)
  if (!text || text.length > 2000 || !el || el.closest(OWN) || el.closest(FIELD) || (!frozen && el.closest(HAS_OWN))) return null
  return { text, range: range.cloneRange(), native: true }
}

type Highlights = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
function highlight(range: Range | null) {
  const reg = (globalThis.CSS as unknown as { highlights?: Highlights })?.highlights
  const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
  if (!reg || !H) return
  if (range) reg.set(HL, new H(range))
  else reg.delete(HL)
}

const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** `top`: where the phone's mark sits (under the camera's); `hideMark`: the camera is busy or the keyboard is up. */
export function Select({ top, hideMark }: { top: string; hideMark: boolean }) {
  const t = useT(SM)
  const [phone] = useState(coarse)
  const [on, setOn] = useState(false)
  const onRef = useRef(on)
  onRef.current = on
  const [picked, setPicked] = useState<Picked | null>(null)
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top?: number; bottom?: number }>({})

  const a = useAsk(() => {
    const p = pickedRef.current
    return { kind: 'ui', repo: '', path: '', title: p?.where ?? '', selection: p?.text ?? '', from: 0, to: 0, around: p?.around ?? '' }
  })
  const aRef = useRef(a)
  aRef.current = a

  const show = useCallback((p: Omit<Picked, 'where' | 'around'> | null) => {
    aRef.current.reset()
    if (!p) return setPicked(null)
    const cur = pickedRef.current
    if (cur && cur.text === p.text && cur.native === p.native) return
    setPicked({ ...p, ...contextOf(p.range.commonAncestorContainer) })
  }, [])
  const leave = useCallback(() => {
    setOn(false)
    show(null)
    window.getSelection()?.removeAllRanges()
  }, [show])

  // The bar sits under what was taken, or over it when there is no room below.
  useLayoutEffect(() => {
    highlight(picked && !picked.native ? picked.range : null)
    if (!picked) return
    const r = picked.range.getBoundingClientRect()
    const h = window.innerHeight
    setPlace(r.bottom + 220 < h || r.top < h / 2 ? { top: Math.max(8, r.bottom + 10) } : { bottom: Math.max(8, h - r.top + 10) })
  }, [picked])
  useEffect(() => () => highlight(null), [])

  // ---- The phone's frozen screen: nothing under the finger acts; a tap takes a word, the system's selector a passage.
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    root.classList.add('wv-picking')
    let down: { x: number; y: number; t: number; id: number } | null = null
    const stop = (e: Event) => {
      if (ownTarget(e)) return
      e.stopPropagation()
      if (e.type === 'click' || e.type === 'dblclick' || e.type === 'auxclick') e.preventDefault()
      if (e.type === 'pointerdown') {
        const p = e as PointerEvent
        down = { x: p.clientX, y: p.clientY, t: performance.now(), id: p.pointerId }
      } else if (e.type === 'pointerup') {
        const p = e as PointerEvent
        const d = down
        down = null
        if (!d || d.id !== p.pointerId || Math.hypot(p.clientX - d.x, p.clientY - d.y) > 10 || performance.now() - d.t > TAP_MS) return
        window.getSelection()?.removeAllRanges()
        const hit = pickAt(p.clientX, p.clientY)
        show(hit ? { ...hit, native: false } : null)
      }
    }
    for (const k of STOPPED) window.addEventListener(k, stop, { capture: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const sel = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { const p = nativePick(true); if (p) show(p) }, 250)
    }
    document.addEventListener('selectionchange', sel)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && leave()
    window.addEventListener('keydown', key)
    return () => {
      root.classList.remove('wv-picking')
      for (const k of STOPPED) window.removeEventListener(k, stop, { capture: true })
      document.removeEventListener('selectionchange', sel)
      window.removeEventListener('keydown', key)
      clearTimeout(timer)
    }
  }, [on, show, leave])

  // ---- The computer: a mouse selection anywhere, or a held button on a label that can't be selected.
  useEffect(() => {
    if (phone) return
    let hold: ReturnType<typeof setTimeout> | undefined
    let at: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (onRef.current || e.pointerType !== 'mouse' || e.button !== 0) return
      if (ownTarget(e)) return
      if (pickedRef.current) show(null)
      const label = elementOf(e.target as Node)?.closest(LABEL)
      if (!label || label.closest(FIELD)) return
      at = { x: e.clientX, y: e.clientY }
      const x = e.clientX
      const y = e.clientY
      clearTimeout(hold)
      hold = setTimeout(() => {
        at = null
        const hit = pickAt(x, y)
        if (!hit) return
        // The release that follows is not a click on the label.
        const eat = (ev: Event) => { ev.preventDefault(); ev.stopPropagation() }
        window.addEventListener('click', eat, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 600)
        show({ ...hit, native: false })
      }, HOLD_MS)
    }
    const move = (e: PointerEvent) => { if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 6) { clearTimeout(hold); at = null } }
    const up = (e: PointerEvent) => {
      clearTimeout(hold)
      at = null
      if (onRef.current || e.pointerType !== 'mouse' || ownTarget(e)) return
      setTimeout(() => { const p = nativePick(false); if (p) show(p) }, 0)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && pickedRef.current && show(null)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(hold)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('keydown', key)
    }
  }, [phone, show])

  return (
    <>
      {on && (
        <div className="pick-freeze" {...mark}>
          <div className="cam-veil" />
          <span className="pick-hint" aria-hidden>{t.hint}</span>
          <button className="cam-close pick-close" data-wv-pick="" aria-label={t.leave} onClick={leave}><Icon name="close" /></button>
        </div>
      )}
      {picked && (
        <div ref={box} className="pick-bar" data-wv-pick="" {...mark} style={place}>
          <AskPanel a={a} text={picked.text} usage={false} onHit={() => {}} />
        </div>
      )}
      {phone && !(hideMark && !on) && (
        <button className={`cam-mark pick-mark ${on ? 'cam-on' : ''}`} data-wv-pick="" {...mark} style={{ top }}
          aria-label={on ? t.leave : t.select} aria-pressed={on} onClick={() => (on ? leave() : setOn(true))}>
          <Icon name={on ? 'close' : 'select'} />
        </button>
      )}
    </>
  )
}
