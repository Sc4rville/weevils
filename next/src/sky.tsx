// The star sky at the top of weevboss's screen: one star per agent at work, real sessions only.
// The star is weevils' own « working » star (icons.tsx `star`: three strokes, square ends, 2.5 on a 24 grid), in the
// theme's --fluo, turning and pulsing like `.spin.fluo` (2.6 s a turn, 1.6 s a pulse to 0.35), all in step. They stand
// in a strict grid from the top right corner, in the order the agents started: one row first, then rows stacked below,
// all a little smaller with each new star. Each star glides to its new slot when the count changes; a new one grows
// from nothing in its slot, a finished one shrinks away in place.
import { useEffect, useRef } from 'react'
import type { Theme } from '../../src/ui/app-context.tsx'

type Star = { id: string; x: number; y: number; s: number; born: number; gone?: number }

const STROKES: [number, number, number, number][] = [
  [12, 3, 12, 21],
  [4.2, 7.5, 19.8, 16.5],
  [4.2, 16.5, 19.8, 7.5],
]

/** reserve: the band's middle kept clear (the « weevboss · for you » words), in px each side of the centre. */
export function Sky({ ids, theme, onTap, reserve = 0 }: { ids: string[]; theme: Theme; onTap?: () => void; reserve?: number }) {
  const keep = useRef(reserve)
  keep.current = reserve
  const canvas = useRef<HTMLCanvasElement>(null)
  const want = useRef(ids)
  want.current = ids
  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const css = getComputedStyle(document.documentElement)
    const fluo = css.getPropertyValue('--fluo').trim() || '#39ff14'
    const halo = theme === 'light'
    const stars = new Map<string, Star>()
    let raf = 0
    let w = 0
    let h = 0
    const size = () => {
      const r = c.getBoundingClientRect()
      const dpr = Math.min(3, devicePixelRatio || 1)
      w = r.width
      h = r.height
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(c)
    const frame = (now: number) => {
      const ids = want.current
      const n = ids.length
      const live = new Set(ids)
      for (const s of stars.values()) if (!live.has(s.id) && s.gone === undefined) s.gone = now
      for (const id of ids) if (!stars.has(id) || stars.get(id)!.gone !== undefined) stars.set(id, { id, x: w - 26, y: 30, s: 0, born: now })
      // Targets: a strict grid from the top-right corner. One row fills first (up to 6 stars, 12 on a wide screen),
      // every new star shrinking all of them a little; a full row starts the next one below, same spacing.
      const padR = 14
      const padT = 6
      const spanX = Math.max(1, w - padR - (keep.current ? w / 2 + keep.current : 64)) // the menu button (and the words) keep their place
      const spanY = Math.max(1, h - padT - 4)
      let cols = Math.min(Math.max(1, n), w >= 600 ? 12 : 6)
      let rows = Math.ceil(Math.max(1, n) / cols)
      // Many agents: rather than stars too small to see, the rows get longer until the grid fits the band.
      if (Math.min(spanX / cols, spanY / rows) < 14) {
        cols = Math.min(n, Math.ceil(Math.sqrt((n * spanX) / spanY)))
        rows = Math.ceil(n / cols)
      }
      const cell = Math.min(46 * Math.pow(Math.max(1, n), -0.18), spanX / cols, spanY / rows)
      const big = Math.min(22, cell * 0.62)
      ids.forEach((id, i) => {
        const st = stars.get(id)!
        const tx = w - padR - cell / 2 - (i % cols) * cell
        const ty = padT + cell / 2 + Math.floor(i / cols) * cell
        const k = st.born === now ? 1 : 0.12
        st.x += (tx - st.x) * k
        st.y += (ty - st.y) * k
        st.s += (big - st.s) * 0.12
      })
      ctx.clearRect(0, 0, w, h)
      ctx.lineCap = 'square'
      ctx.lineJoin = 'miter'
      for (const st of [...stars.values()]) {
        if (st.gone !== undefined) {
          st.s *= 0.86
          if (st.s < 0.3) { stars.delete(st.id); continue }
        }
        const turn = ((now / 2600) % 1) * Math.PI * 2
        const pulse = 0.675 + 0.325 * Math.cos(((now / 1600) % 1) * Math.PI * 2)
        const sc = st.s / 24
        ctx.save()
        ctx.translate(st.x, st.y)
        ctx.rotate(turn)
        ctx.scale(sc, sc)
        ctx.translate(-12, -12)
        ctx.globalAlpha = pulse
        ctx.beginPath()
        for (const [x1, y1, x2, y2] of STROKES) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2) }
        if (halo) { ctx.strokeStyle = '#000'; ctx.lineWidth = 4.5; ctx.stroke() }
        ctx.strokeStyle = fluo
        ctx.lineWidth = 2.5
        ctx.stroke()
        ctx.restore()
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [theme])
  return <canvas ref={canvas} className="nx-sky" onClick={onTap} aria-label={ids.length === 1 ? '1 agent at work' : `${ids.length} agents at work`} role="img" />
}
