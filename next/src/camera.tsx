// The app's camera: a small mark on the edge of the screen, always there, never in the way (drag it along the edge; it
// steps aside while you type). A tap freezes the app; a double tap takes the whole screen, a drag takes the part you
// draw; then one line to send it to weevboss or to the conversation that is open.
//
// The picture is made by the app itself, from its own page (modern-screenshot: the page drawn again by the phone's own
// browser engine, with its fonts, its theme and every scroll position), never by the phone's screenshot: nothing lands
// in the camera roll, and what is sent is exactly what was frozen on the screen. It is kept in weevils' capture library
// (server/captures.ts) with what it shows (screen, conversation, page, theme, size), and the thread only carries its
// small thumbnail.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../src/ui/icons.tsx'
import { useT } from '../../src/i18n/index.ts'
import CM from '../../src/i18n/camera.ts'
import { api } from '../../src/api.ts'
import { call } from './data.ts'
import { screenHeight } from '../../src/ui/viewport.ts'
import { mark, isMark, place, region, type Box } from './camera-geometry.ts'

/** What is on the screen, read at the moment of the tap (main.tsx knows it). */
export interface Spot {
  context: Record<string, unknown>
  /** The conversation open under the camera, the second place to send to; self: it works on weevils itself. */
  session?: { id: string; title: string; self: boolean }
}

const POS = 'weevils-camera-y'
type Mode = 'off' | 'frozen' | 'sheet' | 'sending'

/** The page drawn again by the browser itself, at the size of the screen; the camera's own layers left out. */
async function shoot(): Promise<HTMLCanvasElement> {
  const bg = getComputedStyle(document.body).backgroundColor
  // Loaded on the first tap only: the app itself never pays for it.
  const { domToCanvas } = await import('modern-screenshot')
  // An empty box's hint (« tell me what to do ») keeps its own faded colour: the copy carries no style sheet, so each
  // one is named and its colour written next to the picture.
  const named: Element[] = []
  const rules: string[] = []
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]').forEach((el, i) => {
    if (el.value || isMark(el)) return
    const ph = getComputedStyle(el, '::placeholder')
    el.setAttribute('data-wv-ph', String(i))
    named.push(el)
    rules.push(`[data-wv-ph="${i}"]::placeholder{color:${ph.color};-webkit-text-fill-color:${ph.color};opacity:${ph.opacity}}`)
  })
  try {
    return await domToCanvas(document.body, {
      width: innerWidth,
      // Installed on an iPhone, the stage can be a status bar taller than innerHeight (src/ui/viewport.ts).
      height: screenHeight(),
      scale: Math.min(devicePixelRatio || 1, 2),
      backgroundColor: bg,
      filter: (n) => !isMark(n),
      timeout: 8000,
      features: { restoreScrollPosition: true },
      onCreateForeignObjectSvg: (svg) => {
        if (!rules.length) return
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        style.textContent = rules.join('\n')
        svg.prepend(style)
      },
    })
  } finally {
    named.forEach((el) => el.removeAttribute('data-wv-ph'))
  }
}

function crop(src: HTMLCanvasElement, b: Box | null): HTMLCanvasElement {
  if (!b) return src
  const k = src.width / innerWidth
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(b.w * k))
  out.height = Math.max(1, Math.round(b.h * k))
  out.getContext('2d')!.drawImage(src, Math.round(b.x * k), Math.round(b.y * k), out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function Camera({ spot }: { spot: () => Spot }) {
  const t = useT(CM)
  const [mode, setMode] = useState<Mode>('off')
  const [frozen, setFrozen] = useState<string | null>(null)
  const shot = useRef<Promise<HTMLCanvasElement> | null>(null)
  const [pick, setPick] = useState<Box | null>(null)
  const [done, setDone] = useState<{ box: Box | null; url: string; spot: Spot } | null>(null)
  const [line, setLine] = useState('')
  const [error, setError] = useState(false)
  const [typing, setTyping] = useState(false)
  const [y, setY] = useState(() => { try { return Number(localStorage.getItem(POS)) || 0.58 } catch { return 0.58 } })
  const here = useRef<Spot | null>(null)

  // It steps aside while you type anywhere in the app (the keyboard is up; the box to write in is under the finger).
  useEffect(() => {
    const on = () => setTyping(!!(document.activeElement as HTMLElement | null)?.closest?.('textarea, input, [contenteditable]') && !(document.activeElement as HTMLElement).closest('[data-wv-camera]'))
    const off = () => setTimeout(on, 0)
    addEventListener('focusin', on)
    addEventListener('focusout', off)
    return () => { removeEventListener('focusin', on); removeEventListener('focusout', off) }
  }, [])

  const close = useCallback(() => {
    setMode('off'); setFrozen(null); setPick(null); setDone(null); setLine(''); setError(false)
    shot.current = null
  }, [])

  const freeze = () => {
    navigator.vibrate?.(8)
    here.current = spot()
    setMode('frozen')
    const p = shoot()
    shot.current = p
    p.then((c) => { if (shot.current === p) setFrozen(c.toDataURL('image/png')) }).catch(() => { if (shot.current === p) close() })
  }

  const take = async (box: Box | null) => {
    const p = shot.current
    if (!p) return
    const c = await p.catch(() => null)
    if (!c || shot.current !== p) return
    setDone({ box, url: crop(c, box).toDataURL('image/png'), spot: here.current ?? spot() })
    setMode('sheet')
  }

  const send = async (to: 'weevboss' | string) => {
    if (!done || mode === 'sending') return
    setMode('sending'); setError(false)
    const ctx = { ...done.spot.context, ...(done.box ? { region: done.box } : {}) }
    try {
      // About the interface (feeds the improvement loop): what goes to weevboss, or to a session working on weevils.
      const feedback = to === 'weevboss' || !!done.spot.session?.self
      const r = await call<{ message: string; note: string; here: boolean }>('POST', '/api/captures', { data: done.url, context: ctx, text: line.trim(), to, feedback })
      if (to === 'weevboss') await api.main(r.message)
      else if (r.here) await api.send(to, r.message)
      // A conversation on another machine gets the picture itself (it cannot open this one's library).
      else await api.attach(to, `${line.trim()} ⟦weevils — ${r.note}⟧`, [{ name: 'capture.png', type: 'image/png', data: done.url.split(',')[1] }])
      navigator.vibrate?.(8)
      close()
    } catch {
      setError(true); setMode('sheet')
    }
  }

  // The mark: a tap freezes (or lets go), a drag along the edge moves it; where it sits is kept.
  const onMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    const y0 = e.clientY
    let moved = false
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 8) return
      moved = true
      setY(place(ev.clientY, screenHeight()))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) { setY((v) => { try { localStorage.setItem(POS, String(v)) } catch { /* no storage */ } return v }); return }
      if (mode === 'off') freeze()
      else close()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // On the frozen screen: a drag draws the part to take; a double tap takes it all.
  const lastTap = useRef({ at: 0, x: 0, y: 0 })
  const onFrozen = (e: React.PointerEvent<HTMLDivElement>) => {
    // Around the send sheet, a touch goes back to choosing (a click would also catch the end of the double tap).
    if (mode === 'sheet' && e.target === e.currentTarget) { setDone(null); setPick(null); setMode('frozen'); return }
    if (mode !== 'frozen') return
    const a = { x: e.clientX, y: e.clientY }
    let drawing = false
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const b = { x: ev.clientX, y: ev.clientY }
      if (!drawing && Math.hypot(b.x - a.x, b.y - a.y) < 10) return
      drawing = true
      setPick(region(a, b, innerWidth, screenHeight()))
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (drawing) {
        const box = region(a, { x: ev.clientX, y: ev.clientY }, innerWidth, screenHeight())
        if (box.w >= 24 && box.h >= 24) void take(box)
        else setPick(null)
        return
      }
      const l = lastTap.current
      const now = performance.now()
      if (now - l.at < 380 && Math.hypot(ev.clientX - l.x, ev.clientY - l.y) < 40) { lastTap.current = { at: 0, x: 0, y: 0 }; setPick(null); void take(null) }
      else lastTap.current = { at: now, x: ev.clientX, y: ev.clientY }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const session = done?.spot.session
  const box = mode === 'frozen' ? pick : done?.box ?? null
  return (
    <>
      {mode !== 'off' && (
        <div className={`cam-freeze ${box ? 'cam-picking' : ''}`} {...mark} style={{ height: screenHeight() }} onPointerDown={onFrozen}>
          {/* The screen as it was at the tap: from here on, what you see is what is sent. */}
          {frozen && <img className="cam-still" src={frozen} alt="" draggable={false} />}
          <div className="cam-veil" style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined} />
          {(mode === 'sheet' || mode === 'sending') && done && (
            <div className="cam-sheet band tone" onPointerDown={(e) => e.stopPropagation()}>
              <img className="cam-thumb" src={done.url} alt={t.shot} />
              <div className="cam-say">
                <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={t.line} enterKeyHint="send"
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(session?.id ?? 'weevboss') }} />
                <div className="cam-to">
                  <button className="living lk-library" disabled={mode === 'sending'} aria-label={t.sendTo('weevboss')} onClick={() => void send('weevboss')}>weevboss</button>
                  {session && <button className="living lk-preview" disabled={mode === 'sending'} aria-label={t.sendTo(session.title)} onClick={() => void send(session.id)}>{session.title}</button>}
                </div>
                {error && <span className="cam-error">{t.failed}</span>}
              </div>
            </div>
          )}
        </div>
      )}
      {!(typing && mode === 'off') && (
        <button className={`cam-mark ${mode !== 'off' ? 'cam-on' : ''}`} {...mark} style={{ top: `calc(${(y * 100).toFixed(2)}% - 22px)` }}
          aria-label={mode === 'off' ? t.camera : t.cancel} onPointerDown={onMark}>
          <Icon name={mode === 'off' ? 'camera' : 'close'} />
        </button>
      )}
    </>
  )
}
