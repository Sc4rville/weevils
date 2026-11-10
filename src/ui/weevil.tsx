import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { MemoryItem, WeevilQuestion } from '../../shared/api.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/weevil'
import { useApp } from './app-context'
import { Icon } from './icons'
import { WeevbossLogo } from './logo'
import { VoiceLogo, voiceBusy } from './voice'
import { DEBUG_MS, RETRY_MS, RETURN_MS, TICK_MS, calm, gap, markFlown, nextAt, parseState, type Calm } from './weevil-schedule'
import './weevil.css'

// Flying weevils: now and then a small weevil crosses the home screen towing a little question (server/weevil.ts
// writes it from the memory and the real projects). Tapped, it opens a short exchange, answered by voice (the same
// voice logo as everywhere) or in writing; each answer feeds the memory. Uncaught, it leaves and comes back later.
// When it may fly: src/ui/weevil-schedule.ts.
//
// Test hook (QA, screenshots): « #weevil » in the URL, or localStorage « weevils-weevil-now » = « 1 », sends a weevil
// ~3 s after the app opens (and again ~3 s after each flight), daily cap and gaps ignored. Calm is still required.

const KEY = 'weevils-weevil'
const DEBUG = 'weevils-weevil-now'
/** Pop palette slots for the label and the sheet (picked from the question id). */
const SLOTS = ['p0', 'p2', 'p4', 'p9', 'p11', 'p13']
/** After the last reply: the weevil leaves after this pause (longer once its reply has been spoken). */
const DONE_MS = 1800
const SPOKEN_MS = 700

type Line = { role: 'weevil' | 'user'; text: string }
type Phase = 'fly' | 'caught' | 'talk' | 'away'
interface Flight {
  q: WeevilQuestion
  /** 1: enters on the left and flies right; -1: the other way. */
  dir: 1 | -1
  /** Height of its path, in px from the top. */
  y: number
  /** Seconds to cross. */
  dur: number
  slot: string
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const loadState = () => parseState(read(KEY))
const saveState = (s: ReturnType<typeof parseState>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: the daily cap only lives in this run */
  }
}
const isDebug = () => /(^|[#&])weevil($|&)/.test(location.hash.slice(1)) || read(DEBUG) === '1'
const typing = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)
/** The intro (or not finished yet), a tip card, a hint bubble, the gesture coach. */
const overlay = () => read('weevils-onboarded') !== '1' || !!document.querySelector('.ob, .tip, .hint, .coach-ghost')
const slotOf = (id: string) => SLOTS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SLOTS.length]

/** Mounted once, next to the tips. `paused`: a page is open. */
export function FlyingWeevil({ paused }: { paused: boolean }) {
  const { h24Open, expanded } = useApp()
  const [flight, setFlight] = useState<Flight | null>(null)
  const [phase, setPhase] = useState<Phase>('fly')
  const reduce = !!useReducedMotion()
  const opened = useRef(Date.now())
  const target = useRef(0)
  const lastKey = useRef(0)
  const busy = useRef(false)
  const blocked = useRef({ paused, drawer: false })
  blocked.current = { paused, drawer: h24Open || expanded === 'agent' }
  busy.current = !!flight

  const moment = (): Calm => ({
    now: Date.now(),
    page: blocked.current.paused,
    drawer: blocked.current.drawer,
    overlay: overlay(),
    visible: document.visibilityState === 'visible',
    typing: typing(document.activeElement),
    lastKey: lastKey.current,
    voice: voiceBusy(),
  })

  // The clock: when it is time and everything is calm, ask weevilsd for the ready question, and fly.
  useEffect(() => {
    target.current = nextAt(loadState(), opened.current, Date.now(), isDebug())
    let fetching = false
    const onKey = () => (lastKey.current = Date.now())
    const onVisible = () => {
      if (document.visibilityState === 'visible') target.current = Math.max(target.current, Date.now() + (isDebug() ? DEBUG_MS : RETURN_MS))
    }
    const onHash = () => isDebug() && !busy.current && (target.current = Date.now() + DEBUG_MS)
    const tick = async () => {
      const now = Date.now()
      if (busy.current || fetching || now < target.current) return
      const debug = isDebug()
      if (!calm(moment())) return void (target.current = now + (debug ? DEBUG_MS : RETRY_MS))
      fetching = true
      try {
        const { question } = await api.weevil()
        if (!question) return void (target.current = Date.now() + (debug ? DEBUG_MS : gap()))
        if (!calm(moment())) return void (target.current = Date.now() + (debug ? DEBUG_MS : RETRY_MS))
        saveState(markFlown(loadState(), Date.now()))
        const dir = Math.random() < 0.5 ? 1 : -1
        const h = window.innerHeight
        setPhase('fly')
        setFlight({ q: question, dir, y: Math.round(h * (0.28 + Math.random() * 0.34)), dur: 16 + Math.random() * 6, slot: slotOf(question.id) })
      } catch {
        target.current = Date.now() + (debug ? DEBUG_MS : gap())
      } finally {
        fetching = false
      }
    }
    const id = setInterval(() => void tick(), TICK_MS)
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  /** The weevil is gone (flown off, or set free): the next one is scheduled. */
  const gone = useCallback(() => {
    setFlight(null)
    setPhase('fly')
    target.current = nextAt(loadState(), opened.current, Date.now(), isDebug())
  }, [])
  const missed = useCallback(
    (id: string) => {
      void api.weevilMissed(id).catch(() => undefined)
      gone()
    },
    [gone],
  )

  // A page, the drawer or weevboss opens while it flies: it slips away (it will come back with the same question).
  const interrupted = flight && phase === 'fly' && (paused || h24Open || expanded === 'agent')
  useEffect(() => {
    if (interrupted && flight) missed(flight.q.id)
  }, [interrupted, flight, missed])

  /** Sheet closed: answered, it just leaves; set free without a word, its question will come back. */
  const setFree = (answered: boolean) => {
    if (!answered && flight) void api.weevilMissed(flight.q.id).catch(() => undefined)
    setPhase('away')
  }

  if (!flight) return null
  return (
    <MotionConfig reducedMotion="never">
      <Flier key={flight.q.id} f={flight} phase={phase} reduce={reduce} onCatch={() => setPhase('caught')} onCaught={() => setPhase('talk')} onPassed={() => missed(flight.q.id)} onAway={gone} />
      <AnimatePresence>{phase === 'talk' && <Sheet key="sheet" f={flight} reduce={reduce} onLeave={setFree} />}</AnimatePresence>
    </MotionConfig>
  )
}

// ---------------------------------------------------------------- the weevil in flight

function Flier({ f, phase, reduce, onCatch, onCaught, onPassed, onAway }: { f: Flight; phase: Phase; reduce: boolean; onCatch: () => void; onCaught: () => void; onPassed: () => void; onAway: () => void }) {
  const t = useT(M)
  const ref = useRef<HTMLButtonElement>(null)
  const x = useMotionValue(-1000)
  const lift = useMotionValue(0)
  const run = useRef<AnimationPlaybackControls | null>(null)
  const live = useRef({ onPassed, onAway, onCaught })
  live.current = { onPassed, onAway, onCaught }

  // The crossing: from just outside one edge to just outside the other, at a steady pace.
  useLayoutEffect(() => {
    const w = window.innerWidth
    const size = ref.current?.offsetWidth ?? 240
    const from = f.dir > 0 ? -size - 8 : w + 8
    const to = f.dir > 0 ? w + 8 : -size - 8
    x.set(from)
    run.current = animate(x, to, { duration: reduce ? f.dur * 1.4 : f.dur, ease: 'linear', onComplete: () => live.current.onPassed() })
    return () => run.current?.stop()
  }, [])

  // Caught: it stops dead and hops; then the sheet. Set free: it flies off the way it was going, up and away.
  useEffect(() => {
    if (phase === 'caught') {
      run.current?.stop()
      const id = setTimeout(() => live.current.onCaught(), reduce ? 120 : 420)
      return () => clearTimeout(id)
    }
    if (phase === 'away') {
      const size = ref.current?.offsetWidth ?? 240
      const to = f.dir > 0 ? window.innerWidth + 8 : -size - 8
      run.current = animate(x, to, { duration: reduce ? 1.6 : 1.1, ease: [0.5, 0, 0.9, 0.6], onComplete: () => live.current.onAway() })
      const up = reduce ? null : animate(lift, -140, { duration: 1.1, ease: 'easeIn' })
      return () => {
        run.current?.stop()
        up?.stop()
      }
    }
  }, [phase])

  const bob = reduce
    ? {}
    : phase === 'caught'
      ? { animate: { scale: [1, 1.35, 0.85, 1.1], rotate: [0, -14 * f.dir, 10 * f.dir, 0], y: 0 }, transition: { duration: 0.4 } }
      : phase === 'away'
        ? { animate: { rotate: -18 * f.dir, scale: 1, y: 0 }, transition: { duration: 0.5 } }
        : { animate: { y: [0, -7, 0, 5, 0], rotate: [-3, 4, -3] }, transition: { y: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' as const }, rotate: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' as const } } }

  return (
    <motion.div className="weevil-fly" style={{ x, y: lift, top: f.y, '--c': `var(--${f.slot})` } as unknown as CSSProperties} animate={{ opacity: phase === 'talk' ? 0 : 1 }} initial={{ opacity: 0 }} transition={{ duration: 0.3 }}>
      <motion.div className="weevil-bob" {...bob}>
        <button
          ref={ref}
          className={`weevil-catch ${f.dir > 0 ? 'right' : 'left'}`}
          onClick={() => phase === 'fly' && onCatch()}
          aria-label={t.catch(f.q.text)}
          tabIndex={phase === 'fly' ? 0 : -1}
        >
          <span className="weevil-label">{f.q.text}</span>
          <span className="weevil-tow" aria-hidden />
          <WeevbossLogo className="weevil-svg" />
        </button>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------- the exchange

function Sheet({ f, reduce, onLeave }: { f: Flight; reduce: boolean; onLeave: (answered: boolean) => void }) {
  const t = useT(M)
  const [lines, setLines] = useState<Line[]>([{ role: 'weevil', text: f.q.text }])
  const [learned, setLearned] = useState<MemoryItem[]>([])
  const [draft, setDraft] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reply, setReply] = useState<{ key?: string; text?: string }>({})
  const answered = useRef(false)
  const heard = useRef('')
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const live = useRef({ lines, waiting, done, onLeave })
  live.current = { lines, waiting, done, onLeave }
  const leave = useCallback(() => live.current.onLeave(answered.current), [])

  // On a computer, the field is ready; on a phone, the keyboard waits for a tap (the voice logo is right there).
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && leave()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leave])

  // Finished: a short pause (its reply read out first, when it is spoken), then it flies away.
  useEffect(() => {
    if (!done) return
    let left = false
    let quietSince = 0
    const id = setInterval(() => {
      const now = Date.now()
      if (voiceBusy()) quietSince = 0
      else if (!quietSince) quietSince = now
      if (!left && quietSince && now - quietSince >= (reply.key ? SPOKEN_MS : DONE_MS)) {
        left = true
        leave()
      }
    }, 150)
    return () => clearInterval(id)
  }, [done])

  const send = async (text: string, voice = false) => {
    const said = text.trim()
    const { lines: history, waiting: w, done: d } = live.current
    if (!said || w || d) return
    setLines([...history, { role: 'user', text: said }])
    setDraft('')
    setErr(null)
    setWaiting(true)
    try {
      const r = await api.weevilAnswer(f.q.id, said, history)
      answered.current = true
      if (r.reply) setLines((l) => [...l, { role: 'weevil', text: r.reply }])
      if (r.learned.length) setLearned((l) => [...l, ...r.learned.filter((m) => !l.some((x) => x.id === m.id))])
      setReply(voice && r.reply ? { key: String(++seq.current), text: r.reply } : {})
      if (r.done) setDone(true)
    } catch (e) {
      setLines(history)
      setDraft(said)
      setErr((e as Error).message)
    } finally {
      setWaiting(false)
    }
  }
  const voiceText = (x: string) => {
    heard.current = heard.current ? `${heard.current} ${x}` : x
    setDraft(heard.current)
  }
  const voiceSend = () => {
    const q = heard.current.trim()
    heard.current = ''
    if (q) void send(q, true)
  }

  const slide = reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
  return (
    <>
      <motion.div className="weevil-scrim" onClick={leave} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />
      <div className="weevil-dock">
        <motion.section
          className="weevil-sheet"
          role="dialog"
          aria-label={f.q.text}
          style={{ '--c': `var(--${f.slot})` } as CSSProperties}
          {...slide}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <div className="weevil-head">
            <h2 className="weevil-q">{f.q.text}</h2>
            <button className="weevil-x" onClick={leave} aria-label={t.close}>
              <Icon name="close" />
            </button>
          </div>
          {(lines.length > 1 || waiting || err) && (
            <div className="weevil-lines" aria-live="polite">
              {lines.slice(1).map((l, i) => (
                <p key={i} className={`weevil-line ${l.role}`}>
                  {l.text}
                </p>
              ))}
              {learned.length > 0 && (
                <ul className="weevil-learned" aria-label={t.learned}>
                  {learned.map((m) => (
                    <li key={m.id}>
                      <span aria-hidden>+ </span>
                      {m.text}
                    </li>
                  ))}
                </ul>
              )}
              {waiting && (
                <span className="spin fluo weevil-wait">
                  <Icon name="star" />
                </span>
              )}
              {err && <p className="weevil-err">! {err}</p>}
            </div>
          )}
          <div className={done ? 'weevil-say done' : 'weevil-say'} inert={done}>
            <VoiceLogo take={() => ''} onText={voiceText} onSend={voiceSend} replyKey={reply.key} replyText={reply.text} working={waiting} />
            <form
              className="weevil-form"
              onSubmit={(e) => {
                e.preventDefault()
                heard.current = ''
                void send(draft)
              }}
            >
              <span className="strong" aria-hidden>
                <Icon name="chevron" dir="right" />
              </span>
              <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t.answer} enterKeyHint="send" maxLength={1200} />
              <button type="submit" className="weevil-send" aria-label={t.send} disabled={!draft.trim() || waiting}>
                <Icon name="arrow" dir="up" />
              </button>
            </form>
          </div>
        </motion.section>
      </div>
    </>
  )
}
