// From automation to factory, in the app (docs/automations/PROTOCOL.md): the icon of one or the other, the opens that
// count as the person's, the quiet line on an eligible automation's page with its unlock, and the unlock's moment.
// Shared by the classic app and next. The rule itself is the server's (shared/factory.ts): nothing here decides.
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Optimizer } from '../../shared/api.ts'
import type { PromotionReason } from '../../shared/factory.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/h24'
import { useApp } from './app-context'
import { Collapse, Line, spring } from './bits'
import { AutoMark, FactoryMark, Icon } from './icons'
import './factory.css'

/** The sign of an automation or a factory: its icon at rest, the travelling mark while it runs. */
export function AutoIcon({ factory, running }: { factory?: boolean; running?: boolean }) {
  if (running) return factory ? <FactoryMark /> : <AutoMark />
  return <Icon name={factory ? 'factory' : 'cycle'} />
}

/** One open of an automation's screen, counted for the person (the server ignores agents and scripts, and repeats). */
export function useSeen(id: string | undefined, what: 'page' | 'run' | 'results') {
  useEffect(() => {
    if (id && !/^(timer|job):/.test(id)) countSeen(id, what)
  }, [id, what])
}
/** A counter never breaks a screen: whatever happens to the call, nothing is shown and nothing is thrown. */
export function countSeen(id: string, what: 'page' | 'run' | 'results') {
  try {
    void api.autoSeen(id, what).catch(() => undefined)
  } catch {
    /* an older server, or no network */
  }
}

// ---------------------------------------------------------------- the unlock's moment

/** The factories unlocked from this device a moment ago: their page plays the moment once. */
const fresh = new Map<string, number>()
const MOMENT_MS = 6000
const mark = (id: string) => {
  fresh.set(id, Date.now())
  setTimeout(() => fresh.delete(id), MOMENT_MS)
}
/** This device unlocked that factory a moment ago: read once, when its page opens, and kept while the page stays
 *  (nothing jumps when the few seconds are over; a later visit opens the plain page). */
export function useJustUnlocked(id: string): boolean {
  return useState(() => fresh.has(id))[0]
}

const CYCLE = 'M4 14v6h16V4H4v6M1 7l3 3 3-3'
const FACTORY = 'M4 20V10l5.5 4v-4l5.5 4V4h5v16z'

/**
 * The moment, about a second, once: the loop fades as the factory's outline draws itself over it, and one line says
 * what it is now. No sound, no confetti, nothing to dismiss. Reduced motion: the icon is simply the factory.
 * MomentIcon and MomentLine sit in the page's hero, in place of its icon and under it: nothing else moves or hides.
 */
export function MomentIcon() {
  const calm = useReducedMotion()
  return (
    <svg className="ic factory-moment-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={10} aria-hidden focusable="false">
      {!calm && <motion.path d={CYCLE} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.5, delay: 0.25 }} />}
      <motion.path d={FACTORY} initial={calm ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: 'easeInOut' }} />
    </svg>
  )
}
export function MomentLine({ title }: { title: string }) {
  const t = useT(M)
  const calm = useReducedMotion()
  return (
    <motion.div className="factory-moment-line" role="status" initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={calm ? { duration: 0 } : { ...spring, delay: 0.7 }}>
      {t.unlocked(title)}
    </motion.div>
  )
}
/** The moment on its own, for a factory whose page declares no hero. */
export function UnlockMoment({ title }: { title: string }) {
  return (
    <div className="factory-moment">
      <MomentIcon />
      <MomentLine title={title} />
    </div>
  )
}

// ---------------------------------------------------------------- the quiet line on an eligible automation's page

/** Why, in one clause, from the server's measured reason (the first one: one reason is enough). */
export function useReasonText(): (r: PromotionReason | undefined) => string {
  const t = useT(M)
  return (r) => {
    if (!r) return ''
    switch (r.kind) {
      case 'used': return t.why_used(r.count, r.days)
      case 'pushed': return t.why_pushed(r.pushes, r.requests)
      case 'proven': return t.why_proven(r.runs, r.ok, r.of)
      case 'grown': return t.why_grown(r.commits)
    }
  }
}

/**
 * « Ready to become a factory »: shown only while the server says so. Unlock is the person's tap; « not now » puts it
 * off. One sentence under the button says all the unlock does. No badge elsewhere, no counter, no progress bar.
 */
export function PromotionLine({ o }: { o: Optimizer }) {
  const t = useT(M)
  const { refresh } = useApp()
  const why = useReasonText()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [open, setOpen] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  if (!o.promotion || o.factory || gone) return null
  const run = (p: Promise<unknown>, then?: () => void) => {
    setBusy(true)
    setErr(null)
    p.then(() => {
      then?.()
      refresh()
    })
      .catch((e) => alive.current && setErr((e as Error).message))
      .finally(() => alive.current && setBusy(false))
  }
  // One quiet line; a tap unfolds what the unlock does and the two answers. Nothing is asked before the person looks.
  return (
    <div className="factory-ready" data-factory-ready={o.id}>
      <Line ch={<Icon name="factory" />} go={open ? '↑' : '↓'} onClick={() => setOpen((v) => !v)} meta={why(o.promotion.reasons[0])} label={`${t.factoryReady}. ${why(o.promotion.reasons[0])}`}>
        {t.factoryReady}
      </Line>
      <Collapse open={open}>
        <div className="in factory-ready-body">
          <div className="meta factory-ready-what">{t.unlockWhat}</div>
          <div className="factory-ready-acts">
            <button className="factory-unlock" disabled={busy} onClick={() => run(api.unlockFactory(o.id), () => mark(o.id))} aria-label={t.unlockLabel(o.title)}>
              {busy ? <AutoMark /> : t.unlock}
            </button>
            <button className="factory-later" disabled={busy} onClick={() => run(api.laterFactory(o.id), () => setGone(true))}>
              {t.notNow}
            </button>
          </div>
          {err && <div className="meta alert" role="alert">{err}</div>}
        </div>
      </Collapse>
    </div>
  )
}
