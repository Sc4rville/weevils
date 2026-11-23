// The guided tour of the interface (docs/onboarding.md), started from a link in weevboss's thread (/#do=tour,
// src/ui/tour-bus.ts). It never blocks: the screen stays live under a light veil, a halo glides from one place to the
// next (the side bar opens and closes by itself, the place scrolls into view), and one line in weevboss's voice says
// what it gives you. The first stop is a real tap (the menu); the others are a tap-through. « skip » or Escape ends it at
// any time. Its end goes to the server (toured / tourskip): weevboss then offers the next step in its thread.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../../src/api.ts'
import { device } from '../../src/ui/setup.tsx'
import { tourHost } from '../../src/ui/tour-bus.ts'
import { spring } from '../../src/ui/bits.tsx'
import { Icon } from '../../src/ui/icons.tsx'
import { WeevbossLogo } from '../../src/ui/logo.tsx'
import { useT } from '../../src/i18n/index.ts'
import M from '../../src/i18n/tour.ts'
import { captionAt, tourStops, type Screen, type Stop, type TourFacts } from './tour-stops.ts'

/** How long a stop's place may be missing (it went away under the person's own tap) before the tour moves on. */
const MISSING_MS = 1500

/** The tour's state in the app: its stops (fixed at the start) and where it is. */
export function useTour(facts: () => TourFacts, show: (s: Screen) => void) {
  const [tour, setTour] = useState<{ stops: Stop[]; i: number } | null>(null)
  const factsRef = useRef(facts)
  factsRef.current = facts
  const showRef = useRef(show)
  showRef.current = show
  useEffect(() => tourHost(() => setTour({ stops: tourStops(factsRef.current()), i: 0 })), [])
  // Each stop brings its screen, once, as it starts (never against the person afterwards).
  const stop = tour ? tour.stops[tour.i] : null
  useEffect(() => {
    if (stop) showRef.current(stop.screen)
  }, [stop])
  const finish = useCallback((how: 'toured' | 'tourskip') => {
    setTour(null)
    showRef.current('boss')
    void api.setupDo(how, device()).catch(() => undefined)
  }, [])
  const tourRef = useRef(tour)
  tourRef.current = tour
  const next = useCallback(() => {
    const t = tourRef.current
    if (!t) return
    if (t.i + 1 < t.stops.length) setTour({ ...t, i: t.i + 1 })
    else finish('toured')
  }, [finish])
  return { stop, i: tour?.i ?? 0, n: tour?.stops.length ?? 0, next, skip: () => finish('tourskip') }
}

type Rect = { top: number; left: number; width: number; height: number; bottom: number }

/** Where a stop's place is, frame by frame (it may be sliding in with the side bar); null while it is not there. */
function usePlace(target: string | undefined, onMissing: () => void): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  const missing = useRef(onMissing)
  missing.current = onMissing
  useEffect(() => {
    if (!target) return
    let raf = 0
    let since = performance.now()
    let scrolled = false
    let last = ''
    const look = () => {
      const el = document.querySelector<HTMLElement>(target)
      const r = el?.getBoundingClientRect()
      if (!el || !r || r.width === 0) {
        if (performance.now() - since > MISSING_MS) return missing.current()
        if (last) setRect((last = '', null))
      } else {
        since = performance.now()
        // Off screen (a long side bar): brought into view once, gently.
        if (!scrolled && (r.bottom > innerHeight || r.top < 0)) {
          scrolled = true
          el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }
        const key = `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(r.height)}`
        if (key !== last) {
          last = key
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom })
        }
      }
      raf = requestAnimationFrame(look)
    }
    raf = requestAnimationFrame(look)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return rect
}

export function TourLayer({ stop, i, n, next, skip }: { stop: Stop | null; i: number; n: number; next: () => void; skip: () => void }) {
  const t = useT(M)
  const rect = usePlace(stop?.target, next)
  const cap = useRef<HTMLDivElement>(null)
  const [capH, setCapH] = useState(96)
  useLayoutEffect(() => {
    if (cap.current) setCapH(cap.current.offsetHeight)
  }, [stop, rect?.width])
  // The real thing tapped, on a stop that asks for it: it does what it always does, and the tour moves on.
  useEffect(() => {
    if (!stop || stop.advance !== 'tap') return
    const on = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest(stop.target)) setTimeout(next, 0)
    }
    document.addEventListener('click', on, true)
    return () => document.removeEventListener('click', on, true)
  }, [stop, next])
  useEffect(() => {
    if (!stop) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [stop, skip])
  if (!stop) return null
  const pad = 6
  const vw = typeof innerWidth === 'number' ? innerWidth : 390
  const width = Math.min(vw - 24, 360)
  const at = rect ? captionAt(rect, innerHeight, capH) : null
  const left = rect ? Math.min(Math.max(12, rect.left), vw - width - 12) : 12
  const last = i + 1 === n
  return (
    <div className="nx-tour" aria-live="polite">
      <AnimatePresence>
        {rect && (
          <motion.div key="halo" className="nx-tour-halo" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {rect && at && (
          <motion.div key={stop.id} ref={cap} role="dialog" aria-label={t.label} className="nx-tour-line"
            style={{ top: at.top, left, width }}
            initial={{ opacity: 0, y: at.top > rect.top ? -10 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
            <p><WeevbossLogo className="nx-tour-logo" /> {t[stop.line]}</p>
            <div className="nx-tour-steps">
              <span className="nx-tour-count">{t.count(i + 1, n)}</span>
              <button type="button" className="nx-tour-skip" onClick={skip}>{t.skip}</button>
              {stop.advance === 'next' ? (
                <button type="button" className="nx-tour-next" onClick={next}>{last ? t.done : t.next} <Icon name="arrow" dir="right" /></button>
              ) : (
                <span className="nx-tour-tap">{t.tapIt} <Icon name="tap" /></span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
