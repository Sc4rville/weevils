// A diagram in a conversation (src/ui/diagram.ts): boxes and arrows in the message's own colours, so it reads in every
// theme; a tap opens it full screen.
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ranks, type Diagram } from './diagram'
import { useT } from '../i18n'
import M from '../i18n/bits'

interface Line { d: string; dashed?: boolean; label?: string; lx: number; ly: number; end?: boolean }

function Drawing({ d, big = false }: { d: Diagram; big?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Line[]>([])
  const rows = ranks(d)
  const byId = new Map(d.nodes.map((n) => [n.id, n]))
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const draw = () => {
      const o = el.getBoundingClientRect()
      const at = (id: string) => {
        const n = el.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)
        if (!n) return null
        const r = n.getBoundingClientRect()
        return { l: r.left - o.left, r: r.right - o.left, t: r.top - o.top, b: r.bottom - o.top, x: (r.left + r.right) / 2 - o.left, y: (r.top + r.bottom) / 2 - o.top }
      }
      const out: Line[] = []
      for (const e of d.edges) {
        const a = at(e.from), b = at(e.to)
        if (!a || !b) continue
        let path: string, lx: number, ly: number, end = false
        if (d.dir === 'down' && b.t >= a.b - 1) {
          const [x1, y1, x2, y2] = [a.x, a.b, b.x, b.t - 2]
          const m = (y1 + y2) / 2
          path = `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`
          // Beside the arrow's end, on the outer side, never on the curve.
          ;[lx, ly, end] = [Math.abs(x2 - x1) < 4 ? x2 + 8 : x2 > x1 ? x2 + 10 : x2 - 10, m, Math.abs(x2 - x1) >= 4 && x2 < x1]
        } else if (d.dir === 'right' && b.l >= a.r - 1) {
          const [x1, y1, x2, y2] = [a.r, a.y, b.l - 2, b.y]
          const m = (x1 + x2) / 2
          path = `M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`
          ;[lx, ly] = [m, Math.min(y1, y2) - 10]
        } else {
          // Back to an earlier step (a loop): around the right-hand side.
          const side = Math.max(a.r, b.r) + 22
          path = `M${a.r},${a.y} C${side},${a.y} ${side},${b.y} ${b.r + 2},${b.y}`
          ;[lx, ly] = [side + 4, (a.y + b.y) / 2]
        }
        out.push({ d: path, dashed: e.dashed, label: e.label, lx, ly, end })
      }
      setLines(out)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [d])
  const loops = d.edges.some((e) => rows.findIndex((r) => r.includes(e.to)) <= rows.findIndex((r) => r.includes(e.from)) && e.from !== e.to)
  return (
    <div ref={box} className={`dg dg-${d.dir} ${big ? 'dg-big' : ''} ${loops ? 'dg-loops' : ''} ${d.edges.some((e) => e.label) ? 'dg-labelled' : ''}`}>
      <svg className="dg-lines" aria-hidden>
        <defs>
          <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {lines.map((l, i) => <path key={i} d={l.d} className={l.dashed ? 'dashed' : ''} markerEnd="url(#dg-arrow)" />)}
      </svg>
      {rows.map((row, i) => (
        <div key={i} className="dg-rank">
          {row.map((id) => <span key={id} data-node={id} className={`dg-node ${byId.get(id)!.shape}`}>{byId.get(id)!.label}</span>)}
        </div>
      ))}
      {lines.map((l, i) => l.label ? <span key={i} className={`dg-label ${l.end ? 'end' : ''}`} style={{ left: l.lx, top: l.ly }}>{l.label}</span> : null)}
    </div>
  )
}

/** The message's colours (its band), for the full-screen view. */
function colours(el: HTMLElement | null) {
  let n: HTMLElement | null = el
  while (n) {
    const bg = getComputedStyle(n).backgroundColor
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return { background: bg, color: getComputedStyle(el!).color }
    n = n.parentElement
  }
  return undefined
}

export function DiagramView({ d }: { d: Diagram }) {
  const t = useT(M)
  const [full, setFull] = useState<React.CSSProperties | null>(null)
  const self = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={self} type="button" className="dg-open" aria-label={t.diagramOpen} onClick={(e) => { e.stopPropagation(); setFull(colours(self.current) ?? {}) }}>
        <Drawing d={d} />
      </button>
      {full && createPortal(
        <div className="dg-full" role="dialog" aria-modal style={full} onClick={() => setFull(null)}>
          <button type="button" className="link dg-close" onClick={() => setFull(null)}>{t.diagramClose}</button>
          <div className="dg-full-in" onClick={(e) => e.stopPropagation()}><Drawing d={d} big /></div>
        </div>,
        document.body,
      )}
    </>
  )
}
