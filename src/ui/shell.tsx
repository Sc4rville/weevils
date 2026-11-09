import { motion } from 'motion/react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useApp } from './app-context'
import { spring } from './bits'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Page plein écran dans la couleur du projet. Glisser vers la droite = retour. */
export function Shell({
  slot,
  kicker,
  title,
  meta,
  children,
  foot,
  side,
}: {
  slot: string
  kicker: string
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  foot?: ReactNode
  /** Volet à côté du fil (navigateur intégré) : la page se partage en deux. */
  side?: ReactNode
}) {
  const { back } = useApp()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  return (
    <motion.div
      className={side ? 'page split' : 'page'}
      style={color(slot)}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={spring}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.9 }}
      dragSnapToOrigin
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 600) back()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : kicker}
    >
      <div className="page-head band tone">
        <div className="in">
          <button className="back" onClick={back} aria-label={`retour · ${kicker}`}>
            <span aria-hidden>&lt;</span>
            <span className="meta" aria-hidden>
              {kicker}
            </span>
          </button>
          <h1 ref={heading} tabIndex={-1} className="h2" style={{ margin: 0 }}>
            {title}
          </h1>
          {meta && (
            <div className="meta" style={{ marginTop: 4 }}>
              {meta}
            </div>
          )}
        </div>
      </div>
      <div className="page-cols">
        <div className="page-main">
          <div className="page-body" data-scroll>
            {children}
            <div className="fill" />
          </div>
          {foot && <div className="page-foot">{foot}</div>}
        </div>
        {side && <aside className="page-side">{side}</aside>}
      </div>
    </motion.div>
  )
}

