import { useEffect, useRef } from 'react'
import type { TokenRate } from '../../shared/infra.ts'
import { api } from '../api'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/infra'
import { useApp } from './app-context'
import './rate.css'

const W = 56
const H = 16
/** La valeur affichée : les 2 dernières minutes, ramenées à la minute. */
const WINDOW = 120_000

/**
 * Le débit de tokens en direct, en haut à droite : une valeur en gras qui défile en douceur vers la mesure,
 * une courbe des 10 dernières minutes qui glisse avec le temps, un point qui bat d'autant plus vite que ça consomme.
 * Au repos (rien depuis 2 min) : tout se calme. Dessiné hors de React (rAF) pour ne pas re-rendre l'app.
 */
export function TokenMeter() {
  const t = useT(M)
  const label = useRef(t.rateLabel)
  label.current = t.rateLabel
  const { push } = useApp()
  const root = useRef<HTMLButtonElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const line = useRef<SVGPathElement>(null)
  const area = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  const data = useRef<TokenRate | null>(null)
  const shown = useRef({ value: 0, series: [] as number[], peak: 1 })

  useEffect(() => {
    let stop = false
    const load = () => {
      if (document.visibilityState !== 'visible') return
      void api
        .usageRate()
        .then((r) => {
          data.current = r
        })
        .catch(() => undefined)
    }
    load()
    const iv = setInterval(load, 5000)
    document.addEventListener('visibilitychange', load)

    const fmt = new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 })
    let last = 0
    let lastDraw = 0
    let lastText = ''
    const frame = (now: number) => {
      if (stop) return
      requestAnimationFrame(frame)
      const r = data.current
      const dt = last ? Math.min(0.25, (now - last) / 1000) : 0
      last = now
      if (!r || !r.buckets.length) return
      const n = r.buckets.length
      const per = Math.round(WINDOW / r.step)
      const target = (r.buckets.slice(-per).reduce((a, b) => a + b, 0) * 60_000) / WINDOW
      // Lissage doux (≈ 1,2 s) : le chiffre et la courbe glissent vers la mesure, jamais d'à-coup.
      const k = 1 - Math.exp(-dt * 2.5)
      const s = shown.current
      const smooth = r.buckets.map((_, i) => {
        const a = r.buckets.slice(Math.max(0, i - 2), i + 1)
        return a.reduce((x, y) => x + y, 0) / a.length
      })
      if (s.series.length !== n) s.series = smooth.slice()
      let moving = Math.abs(target - s.value) > Math.max(1, target * 0.002)
      s.value += (target - s.value) * k
      for (let i = 0; i < n; i++) {
        const d = smooth[i] - s.series[i]
        if (Math.abs(d) > 1) moving = true
        s.series[i] += d * k
      }
      s.peak += (Math.max(1, ...smooth) - s.peak) * k
      // Immobile : on redessine une fois par seconde (la courbe avance avec l'heure), sinon à chaque image.
      if (!moving && now - lastDraw < 1000) return
      lastDraw = now
      const idle = target < 1
      const text = idle ? '0' : fmt.format(Math.round(s.value))
      if (text !== lastText && num.current) num.current.textContent = lastText = text
      root.current?.classList.toggle('idle', idle)
      // Chaque tranche au milieu de son intervalle, placée selon l'heure qu'il est : la courbe défile lentement.
      const span = n * r.step
      const at = Date.now()
      const pts = s.series.map((v, i) => {
        const mid = r.end - (n - i - 0.5) * r.step
        const x = W - ((at - mid) / span) * W
        const y = H - 1.5 - (Math.min(1, v / s.peak) * (H - 3))
        return [Math.max(0, Math.min(W, x)), y] as const
      })
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
      line.current?.setAttribute('d', d)
      area.current?.setAttribute('d', `${d}L${pts[pts.length - 1][0].toFixed(1)} ${H}L${pts[0][0].toFixed(1)} ${H}Z`)
      const [lx, ly] = pts[pts.length - 1]
      dot.current?.setAttribute('cx', lx.toFixed(1))
      dot.current?.setAttribute('cy', ly.toFixed(1))
      // Le battement suit le débit (échelle log) : 2,6 s pour un filet, 1,1 s à plein régime.
      const beat = idle ? 0 : Math.max(1.1, 2.6 - Math.log10(Math.max(10, target)) * 0.25)
      root.current?.style.setProperty('--beat', `${beat.toFixed(2)}s`)
      root.current?.setAttribute('aria-label', label.current(text))
    }
    requestAnimationFrame(frame)
    return () => {
      stop = true
      clearInterval(iv)
      document.removeEventListener('visibilitychange', load)
    }
  }, [])

  return (
    <button ref={root} className="token-meter idle" onClick={() => push({ kind: 'usage' })}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <path ref={area} className="tm-area" />
        <path ref={line} className="tm-line" />
        <circle ref={dot} className="tm-dot" r="2" cx={W} cy={H - 1.5} />
      </svg>
      <span className="tm-val">
        <span ref={num} className="tm-num">
          0
        </span>
        <span className="tm-unit">{t.perMin}</span>
      </span>
    </button>
  )
}
