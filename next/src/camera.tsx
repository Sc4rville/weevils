// The app's camera: a small mark on the edge of the screen, always there, never in the way (drag it along the edge; it
// steps aside while you type). Three taps: the mark freezes the app (a finger shows, very fast, the double tap), a
// double tap takes the whole screen or a drawn part takes that part, and the capture is attached: a small square in
// the box to write in, weevboss's or any conversation's, sent with the next message from wherever you are
// (src/ui/held-capture.ts). A single tap on the frozen screen, or the mark again, lets go.
//
// The picture is the app's own (camera-shoot.ts), kept in weevils' capture library with what it shows (screen,
// conversation, page, theme, size) once it is sent (server/captures.ts); the thread only carries its small thumbnail.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../src/ui/icons.tsx'
import { useT } from '../../src/i18n/index.ts'
import CM from '../../src/i18n/camera.ts'
import { screenHeight } from '../../src/ui/viewport.ts'
import { hold, useHeld } from '../../src/ui/held-capture.ts'
import { mark, place, region, tapKind, TAP_MS, type Box } from './camera-geometry.ts'
import { crop, shoot } from './camera-shoot.ts'

/** What is on the screen, read at the moment of the tap (main.tsx knows it). */
export interface Spot { context: Record<string, unknown> }

const POS = 'weevils-camera-y'
type Mode = 'off' | 'frozen' | 'taking'

/** A held capture shown in a box to write in that is on the screen, on top (not under a page or the side bar). */
function boxShowsIt(): boolean {
  return [...document.querySelectorAll('.held-capture img')].some((el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || r.bottom < 0 || r.top > innerHeight) return false
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return !!top && !!el.parentElement?.contains(top)
  })
}

export function Camera({ spot }: { spot: () => Spot }) {
  const t = useT(CM)
  const [mode, setMode] = useState<Mode>('off')
  const modeRef = useRef<Mode>('off')
  modeRef.current = mode
  const [frozen, setFrozen] = useState<string | null>(null)
  const shot = useRef<Promise<HTMLCanvasElement> | null>(null)
  const [pick, setPick] = useState<Box | null>(null)
  const [hint, setHint] = useState(0)
  const [error, setError] = useState(false)
  const [typing, setTyping] = useState(false)
  const [y, setY] = useState(() => { try { return Number(localStorage.getItem(POS)) || 0.58 } catch { return 0.58 } })
  const here = useRef<Spot | null>(null)
  const held = useHeld()
  const [shown, setShown] = useState(true)

  // It steps aside while you type anywhere in the app (the keyboard is up; the box to write in is under the finger).
  useEffect(() => {
    const on = () => setTyping(!!(document.activeElement as HTMLElement | null)?.closest?.('textarea, input, [contenteditable]') && !(document.activeElement as HTMLElement).closest('[data-wv-camera]'))
    const off = () => setTimeout(on, 0)
    addEventListener('focusin', on)
    addEventListener('focusout', off)
    return () => { removeEventListener('focusin', on); removeEventListener('focusout', off) }
  }, [])

  // A capture waits to be sent and no box on this screen shows it (For you, the side bar, a page): the mark shows it.
  useEffect(() => {
    if (!held) return
    const look = () => setShown(boxShowsIt())
    look()
    const i = setInterval(look, 700)
    return () => clearInterval(i)
  }, [held])

  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const close = useCallback(() => {
    clearTimeout(tapTimer.current)
    setMode('off'); setFrozen(null); setPick(null)
    shot.current = null
  }, [])
  const fail = useCallback(() => {
    close(); setError(true)
    setTimeout(() => setError(false), 3500)
  }, [close])

  const freeze = () => {
    navigator.vibrate?.(8)
    here.current = spot()
    setError(false)
    setMode('frozen')
    setHint((n) => n + 1)
    const p = shoot()
    shot.current = p
    p.then((c) => { if (shot.current === p) setFrozen(c.toDataURL('image/png')) }).catch(() => { if (shot.current === p) fail() })
  }

  // Whole screen or a part: attached as soon as the picture is ready (a star turns meanwhile, the mark lets go).
  const take = async (box: Box | null) => {
    const p = shot.current
    if (!p) return
    setMode('taking'); setPick(box)
    const c = await p.catch(() => null)
    if (shot.current !== p) return
    if (!c) { fail(); return }
    const context = { ...(here.current ?? spot()).context, ...(box ? { region: box } : {}) }
    hold({ url: crop(c, box).toDataURL('image/png'), context, at: Date.now() })
    navigator.vibrate?.(8)
    close()
  }

  // The mark: a tap freezes (or lets go), a drag along the edge moves it; where it sits is kept.
  const onMark = (e: React.PointerEvent<HTMLButtonElement>) => {
    const y0 = e.clientY
    let moved = false
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* not a live pointer (tests) */ }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - y0) < 8) return
      moved = true
      setY(place(ev.clientY, screenHeight()))
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (moved) { setY((v) => { try { localStorage.setItem(POS, String(v)) } catch { /* no storage */ } return v }); return }
      if (ev.type === 'pointercancel') return
      if (modeRef.current === 'off') freeze()
      else close()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // On the frozen screen: a drag draws the part to take, a double tap takes it all, a single tap lets go.
  const lastTap = useRef({ at: 0, x: 0, y: 0 })
  const onFrozen = (e: React.PointerEvent<HTMLDivElement>) => {
    if (modeRef.current !== 'frozen') return
    e.preventDefault()
    clearTimeout(tapTimer.current)
    const a = { x: e.clientX, y: e.clientY }
    const t0 = performance.now()
    let drawing = false
    const el = e.currentTarget
    try { el.setPointerCapture(e.pointerId) } catch { /* not a live pointer (tests) */ }
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
        lastTap.current = { at: 0, x: 0, y: 0 }
        const box = region(a, { x: ev.clientX, y: ev.clientY }, innerWidth, screenHeight())
        if (box.w >= 24 && box.h >= 24) void take(box)
        else setPick(null)
        return
      }
      if (ev.type === 'pointercancel') return
      const now = performance.now()
      const kind = tapKind(lastTap.current, { at: now, x: ev.clientX, y: ev.clientY }, now - t0)
      if (kind === 'double') { lastTap.current = { at: 0, x: 0, y: 0 }; void take(null); return }
      if (kind === 'none') return
      lastTap.current = { at: now, x: ev.clientX, y: ev.clientY }
      // No second tap: let go of the frozen screen.
      tapTimer.current = setTimeout(() => { if (modeRef.current === 'frozen') close() }, TAP_MS)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const markShowsHeld = !!held && !shown && mode === 'off'
  return (
    <>
      {mode !== 'off' && (
        <div className={`cam-freeze ${pick ? 'cam-picking' : ''}`} {...mark} style={{ height: screenHeight() }} onPointerDown={onFrozen}>
          {/* The screen as it was at the tap: from here on, what you see is what is taken. */}
          {frozen && <img className="cam-still" src={frozen} alt="" draggable={false} />}
          <div className="cam-veil" style={pick ? { left: pick.x, top: pick.y, width: pick.w, height: pick.h } : undefined} />
          {mode === 'frozen' && hint > 0 && <span key={hint} className="cam-hint" aria-hidden><span className="cam-ring" /><Icon name="tap" /></span>}
          {mode === 'taking' && <span className="cam-wait spin fluo" aria-hidden><Icon name="star" /></span>}
        </div>
      )}
      {error && <div className="cam-error" role="status" {...mark}>{t.failed}</div>}
      {!(typing && mode === 'off') && (
        <button className={`cam-mark ${mode !== 'off' ? 'cam-on' : ''} ${markShowsHeld ? 'cam-has' : ''}`} {...mark} style={{ top: `calc(${(y * 100).toFixed(2)}% - 22px)` }}
          aria-label={mode === 'off' ? t.camera : t.cancel} onPointerDown={onMark}>
          {markShowsHeld ? <img src={held.url} alt="" /> : <Icon name={mode === 'off' ? 'camera' : 'close'} />}
        </button>
      )}
    </>
  )
}
