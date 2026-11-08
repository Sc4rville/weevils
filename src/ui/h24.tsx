import { animate, motion, useDragControls, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { h24Stats } from '../state/store'
import { useApp } from './app-context'
import { spring } from './bits'
import { durLong } from './format'

/** Bande H24 collée en bas : on la tire vers le haut (ou on la touche) pour voir les activités permanentes. */
export function H24Rail() {
  const { state, dispatch, now, h24Open: open, setH24Open: setOpen } = useApp()
  const stats = h24Stats(state)
  const y = useMotionValue(0)
  const drawer = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const controls = useDragControls()
  const [closedY, setClosedY] = useState(0)

  const measure = useCallback(() => {
    const h = drawer.current?.offsetHeight ?? 0
    const visible = probe.current?.offsetHeight ?? 56
    setClosedY(Math.max(0, h - visible))
  }, [])

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  // Position initiale sans animation, puis ressort à chaque ouverture/fermeture.
  const first = useRef(true)
  useEffect(() => {
    const target = open ? 0 : closedY
    if (first.current) {
      y.set(target)
      first.current = false
      return
    }
    const ctrl = animate(y, target, spring)
    return () => ctrl.stop()
  }, [open, closedY, y])

  const summary = [`${stats.enabled} ${stats.enabled > 1 ? 'activés' : 'activé'}`, `${stats.running} en cours`, stats.paused ? `${stats.paused} en pause` : null]
    .filter(Boolean)
    .join(' · ')
  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name ?? '?'

  return (
    <>
      {open && <div className="catcher" onClick={() => setOpen(false)} aria-hidden />}
      <motion.div
        ref={drawer}
        className="h24 band"
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: closedY }}
        dragElastic={{ top: 0.05, bottom: 0.2 }}
        dragMomentum={false}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          const current = y.get()
          const next = info.velocity.y < -300 ? true : info.velocity.y > 300 ? false : current < closedY / 2
          if (next === open) animate(y, next ? 0 : closedY, spring)
          setOpen(next)
        }}
        role="region"
        aria-label="activités h24"
      >
        <div ref={probe} className="h24-probe" />
        <button
          className="h24-head"
          onPointerDown={(e) => {
            dragged.current = false
            controls.start(e)
          }}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false
              return
            }
            setOpen(!open)
          }}
          aria-expanded={open}
          aria-controls="h24-body"
          aria-label={`h24 : ${summary}. ${open ? 'replier' : 'déplier'}`}
        >
          <span className="h24-grip" aria-hidden>
            ===
          </span>
          <span className="in" aria-hidden>
            <span className="h2">h24</span>
            <span className="meta" style={{ flex: 1 }}>
              {summary}
            </span>
            <span className="h2" style={{ fontWeight: 500 }}>
              {open ? '↓' : '↑'}
            </span>
          </span>
        </button>

        <div id="h24-body" className="h24-body" inert={!open}>
          {state.h24.map((a) => {
            const running = a.runState === 'running'
            const paused = a.runState === 'paused'
            return (
              <div key={a.id} className="band tone" style={{ marginBottom: 2 }}>
                <div className="in" style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBlock: 12 }}>
                  <span className="st h2" aria-hidden style={{ width: 28, textAlign: 'center' }}>
                    {running ? <span className="spin">*</span> : paused ? '||' : '_'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="strong" style={{ fontSize: '1.0625rem' }}>
                      {a.title}
                    </div>
                    <div className="meta">
                      {projectName(a.projectId)} · {a.enabled ? 'activé' : 'désactivé'} · {a.schedule}
                    </div>
                    <div className="meta strong">
                      {running && a.runStartedAt ? `en cours depuis ${durLong(now - a.runStartedAt)}` : paused ? 'en pause' : 'en veille'}
                    </div>
                    <div className="small">{a.lastEvent}</div>
                  </div>
                  <button
                    className="ch"
                    onClick={() => dispatch({ type: 'h24/toggle', id: a.id, at: Date.now() })}
                    aria-label={paused ? `reprendre ${a.title}` : `mettre en pause ${a.title}`}
                  >
                    {paused ? '>' : '||'}
                  </button>
                </div>
              </div>
            )
          })}
          <div className="in meta" style={{ paddingBlock: 14 }}>
            Activé = planifié en permanence. En cours = exécute une tâche maintenant. Activités fictives.
          </div>
        </div>
      </motion.div>
    </>
  )
}
