// « Pour toi » : the stream next to weevboss, full screen. Every item is a full-width band in its own colour
// (project, author, weevboss, or the colour of what it says: done, asks, cut), one renderer per kind (docs/foryou.md §2.1).
import { AnimatePresence, motion, type PanInfo, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react'
import type { ForYouCard, ForYouGauge, ForYouItem, ForYouMedia, ForYouPulse } from '../../shared/foryou.ts'
import { useApp } from './app-context'
import { Collapse, spring, useAuthors } from './bits'
import { flash, focusBoss } from './follow'
import { ago } from './format'
import { cardSlots, itemSlot, itemWho, matchesWho, participants, useForYou, WHO_ALL, type ForYouStore } from './foryou-store'
import { markSeen as gestureSeen } from './hints'
import { Icon } from './icons'
import { usePageChrome } from './shell'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/foryou'
import './foryou.css'

const slot = (name: string) => ({ '--c': `var(--${name})` }) as CSSProperties
/** The left edge stays with the page's back gesture (same width as the code viewer's). */
const EDGE = 22
const WHO_KEY = 'weevils-foryou-who'
const LOOK_KEY = 'weevils-foryou-look'
const SEEN_AFTER = 1200

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A light tap under the finger where the device allows it (accept, send). */
const buzz = () => {
  try {
    navigator.vibrate?.(8)
  } catch {
    /* not allowed here */
  }
}

/** A strip that scrolls sideways natively keeps its swipes: the page (swipe right = back) only gets the left edge.
 * Motion listens natively on the page, so only a native bubble-phase stop keeps it out (as askthread.tsx does). */
function useOwnSwipe(ref: RefObject<HTMLElement | null>, on = true) {
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const claim = (e: PointerEvent) => {
      if (e.clientX >= EDGE) e.stopPropagation()
    }
    el.addEventListener('pointerdown', claim)
    return () => el.removeEventListener('pointerdown', claim)
  }, [ref, on])
}

/** Under the eyes: `ratio` of it shows, or it fills that share of the screen when it is taller. Without an observer: yes. */
function useInView(ref: RefObject<Element | null>, ratio = 0.5, on = true): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    if (typeof IntersectionObserver === 'undefined') return void setInView(true)
    const io = new IntersectionObserver(
      ([e]) => {
        const fills = !!e.rootBounds && e.intersectionRect.height >= e.rootBounds.height * ratio
        setInView(e.isIntersecting && (e.intersectionRatio >= ratio || fills))
      },
      { threshold: [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, ratio, on])
  return inView
}

// ---------------------------------------------------------------------------
// Pieces shared by the items.

interface KindProps {
  item: ForYouItem
  who: string
  project?: string
  inView: boolean
  fy: ForYouStore
}

/** Where a tap on the item goes. */
function useOpen(item: ForYouItem): (() => void) | undefined {
  const { push, home, setH24Open } = useApp()
  const o = item.open ?? (item.sessionId ? ({ page: 'session', id: item.sessionId } as const) : undefined)
  if (!o) return undefined
  switch (o.page) {
    case 'session':
      return () => push({ kind: 'session', id: o.id })
    case 'boss':
      return () => focusBoss({ mid: o.mid, flash: !!o.mid })
    case 'auto':
      return () => {
        home()
        setH24Open(true, o.id)
      }
    case 'usage':
      return () => push({ kind: 'usage' })
    case 'machine':
      return () => push({ kind: 'machine', projectId: item.projectId ?? '' })
  }
}

/** The speaker line: unseen dot, who, when; a tap opens the place it speaks of. */
function Who({ item, who, extra, children }: { item: ForYouItem; who: string; extra?: string; children?: ReactNode }) {
  const t = useT(M)
  const { now } = useApp()
  const open = useOpen(item)
  const line = (
    <>
      <span className="dot fy-dot" role={item.seen ? undefined : 'img'} aria-label={item.seen ? undefined : t.unseen} aria-hidden={item.seen ? true : undefined} />
      <span className="fy-who-name">{who}</span>
      {extra && <span className="fy-who-extra"> · {extra}</span>}
      <span className="fy-at"> · {ago(Math.max(0, now - item.at))}</span>
    </>
  )
  return (
    <div className="fy-who">
      {open ? (
        <button className="fy-who-line" onClick={open} aria-label={t.openIt(extra ? `${who} · ${extra}` : who)}>
          {line}
        </button>
      ) : (
        <span className="fy-who-line">{line}</span>
      )}
      {children}
    </div>
  )
}

/** One voice at a time, started by a tap (iOS plays nothing without one). Nothing is synthesised before. */
let voice: HTMLAudioElement | null = null
let voiceOff: (() => void) | null = null

function Listen({ item, who }: { item: ForYouItem; who: string }) {
  const t = useT(M)
  const [on, setOn] = useState(false)
  const mine = useRef<(() => void) | null>(null)
  const stop = () => {
    if (voiceOff && voiceOff === mine.current) {
      voice?.pause()
      voiceOff()
    }
  }
  useEffect(() => stop, [])
  const toggle = () => {
    if (on) return stop()
    voice?.pause()
    voiceOff?.()
    const a = (voice ??= new Audio())
    const end = () => {
      setOn(false)
      if (voiceOff === end) voiceOff = null
    }
    mine.current = end
    voiceOff = end
    a.onended = end
    a.onerror = end
    a.src = `/api/speak/stream?${new URLSearchParams({ text: item.text.slice(0, 1500), oral: '0', voice: item.voice ?? '' })}`
    setOn(true)
    void a.play().catch(end)
  }
  return (
    <button className={on ? 'fy-listen on' : 'fy-listen'} onClick={toggle} aria-label={on ? t.stop : t.listen(who)} aria-pressed={on}>
      <Icon name={on ? 'pause' : 'play'} />
      <span className="fy-wave" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </button>
  )
}

/** Where things stand, as bars; they fill when they come under the eyes. */
function Gauges({ list, inView }: { list: ForYouGauge[]; inView: boolean }) {
  const { colors } = useApp()
  return (
    <div className="fy-gauges">
      {list.map((g, i) => {
        const pct = g.max > 0 ? Math.max(0, Math.min(100, (g.value / g.max) * 100)) : 0
        const own = g.projectId && colors[g.projectId] ? ({ '--g': `var(--${colors[g.projectId]})` } as CSSProperties) : undefined
        return (
          <div key={i} className={`fy-gauge${g.hot ? ' hot' : ''}${own ? ' own' : ''}`} style={own} role="meter" aria-label={g.label} aria-valuemin={0} aria-valuemax={g.max} aria-valuenow={g.value} aria-valuetext={g.shown}>
            <span className="fy-gauge-label ellipsis">{g.label}</span>
            <span className="fy-gauge-bar" aria-hidden>
              <i style={{ width: inView ? `${pct}%` : 0 }} />
            </span>
            <span className="fy-gauge-shown tab">{g.shown}</span>
          </div>
        )
      })}
    </div>
  )
}

/** The item's buttons: the server knows what each one does. The item leaves once tapped. */
function Actions({ item, fy }: { item: ForYouItem; fy: ForYouStore }) {
  if (!item.actions?.length) return null
  return (
    <div className="in fy-acts">
      {item.actions.map((a) => (
        <button
          key={a.id}
          className="fy-btn"
          onClick={() => {
            buzz()
            void fy.act(item.id, a.id)
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/** A reply typed right under the item: « > », the field, the arrow. Said « sent » at once; the text comes back if it failed. */
function ReplyLine({ item, who, fy }: { item: ForYouItem; who: string; fy: ForYouStore }) {
  const t = useT(M)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Who receives it, not who spoke: under an idea of weevils, the words go to weevboss.
  const to = item.reply === 'boss' ? 'weevboss' : who
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setText('')
    setErr(null)
    setSent(true)
    setBusy(true)
    buzz()
    flash(form.current)
    clearTimeout(timer.current)
    try {
      await fy.reply(item.id, body)
      timer.current = window.setTimeout(() => setSent(false), 2600)
    } catch (e) {
      setSent(false)
      setText(body)
      setErr(e instanceof Error && e.message ? e.message : t.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form ref={form} className="tone fy-reply" onSubmit={submit}>
      <div className="in fy-reply-in">
        <span className="fy-reply-gt" aria-hidden>
          <Icon name="chevron" dir="right" />
        </span>
        <input
          type="text"
          name={`fy-reply-${item.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.replyTo(to)}
          aria-label={t.replyLabel(to, item.title ?? item.text.slice(0, 60))}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="sentences"
        />
        <span className="fy-sent" role="status">
          {sent && (
            <>
              <Icon name="check" /> {t.sent}
            </>
          )}
        </span>
        <button type="submit" className="fy-send" aria-label={t.send} disabled={!text.trim() || busy}>
          <Icon name="arrow" />
        </button>
      </div>
      {err && (
        <div className="in meta fy-reply-err" role="alert">
          ! {err}
        </div>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Media: edge to edge, the video plays muted while it is under the eyes, a tap opens it alone, with sound.

function MediaTile({ m }: { m: ForYouMedia }) {
  const t = useT(M)
  const { push } = useApp()
  const tile = useRef<HTMLButtonElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const inView = useInView(tile, 0.6)
  useEffect(() => {
    const v = video.current
    if (!v) return
    try {
      if (inView) void v.play()?.catch(() => undefined)
      else v.pause()
    } catch {
      /* no player here */
    }
  }, [inView])
  return (
    <button ref={tile} className={inView ? 'fy-media fy-inview' : 'fy-media'} onClick={() => push({ kind: 'media', url: m.url, type: m.type, name: m.name })} aria-label={t.openMedia(m.name)}>
      {m.type === 'video' ? <video ref={video} src={m.url} playsInline muted loop preload="metadata" /> : <img src={m.url} alt="" loading="lazy" decoding="async" draggable={false} />}
      {m.type === 'video' && (
        <span className="fy-media-mark" aria-hidden>
          <Icon name="play" />
        </span>
      )}
    </button>
  )
}

function MediaStrip({ media }: { media: ForYouMedia[] }) {
  const t = useT(M)
  const strip = useRef<HTMLDivElement>(null)
  const many = media.length > 1
  useOwnSwipe(strip, many)
  return (
    <div ref={strip} className={many ? 'fy-media-strip many' : 'fy-media-strip'} role={many ? 'group' : undefined} aria-label={many ? t.mediaStrip(media.length) : undefined}>
      {media.map((m) => (
        <MediaTile key={m.id} m={m} />
      ))}
    </div>
  )
}

function MediaItem({ item, who, fy, inView }: KindProps) {
  return (
    <>
      {!!item.media?.length && <MediaStrip media={item.media} />}
      <div className="tone fy-cap">
        <div className="in">
          <Who item={item} who={who}>
            {item.voice && <Listen item={item} who={who} />}
          </Who>
          {item.title && <div className="fy-title">{item.title}</div>}
          {item.text && item.text !== item.title && <div className="fy-text">{item.text}</div>}
          {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
        </div>
      </div>
      <Actions item={item} fy={fy} />
      {item.reply && <ReplyLine item={item} who={who} fy={fy} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// weevboss, mail.

function BossItem({ item, who, fy, inView }: KindProps) {
  return (
    <>
      <div className="in fy-pad">
        <Who item={item} who={who}>
          {item.voice && <Listen item={item} who={who} />}
        </Who>
        {item.title && <div className="fy-title">{item.title}</div>}
        <div className="fy-text">{item.text}</div>
        {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
      </div>
      {!!item.media?.length && <MediaStrip media={item.media} />}
      <Actions item={item} fy={fy} />
      {item.reply && <ReplyLine item={item} who={who} fy={fy} />}
    </>
  )
}

/** A thin line (who · what was done); a tap unfolds the whole message, and the reply line with it. */
function MailItem({ item, who, fy }: KindProps) {
  const [open, setOpen] = useState(false)
  const more = !!item.body || !!item.reply
  return (
    <>
      <button className="fy-mail" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!more}>
        <span className="in fy-mail-in">
          <span className="dot fy-dot" aria-hidden />
          <span className="fy-who-name">{who}</span>
          <span className="fy-mail-sum ellipsis">{item.text}</span>
          {more && (
            <span className="fy-go" aria-hidden>
              <Icon name="chevron" dir={open ? 'up' : 'down'} />
            </span>
          )}
        </span>
      </button>
      <Collapse open={open}>
        <div className="tone">
          <div className="in fy-mail-body">
            {item.title && <div className="fy-title">{item.title}</div>}
            <div className="fy-text">{item.body ?? item.text}</div>
            {item.voice && <Listen item={item} who={who} />}
          </div>
        </div>
        {item.reply && <ReplyLine item={item} who={who} fy={fy} />}
      </Collapse>
    </>
  )
}

// ---------------------------------------------------------------------------
// Proposals: always the same trait, « + » before the title and the ✓ × pair. One: a wide band. Several: columns side by
// side that scroll natively, each in its own colour. ✓ leaves to the right, × to the left.

function Proposals({ item, who, fy }: KindProps) {
  const t = useT(M)
  const strip = useRef<HTMLDivElement>(null)
  const cards = item.cards ?? []
  const scrolls = cards.length > 2
  useOwnSwipe(strip, scrolls)
  // A colour per card, kept while it stays: one leaving does not repaint the others.
  const slots = useRef(new Map<string, string>())
  slots.current = cardSlots(
    cards.map((c) => c.id),
    slots.current,
  )
  const basis = cards.length <= 1 ? '100%' : cards.length === 2 ? '50%' : '44%'
  const answer = (c: ForYouCard, yes: boolean) => {
    if (yes) buzz()
    void fy.act(item.id, yes ? 'accept' : 'refuse', c.id)
  }
  const gone = (id: string) => ({ x: fy.leaving(id) < 0 ? '-100%' : '100%', opacity: 0, flexBasis: '0%' })
  return (
    <>
      <div ref={strip} className={scrolls ? 'fy-props scroll' : 'fy-props'} role="list" aria-label={t.proposals}>
        <AnimatePresence initial={false}>
          {cards.map((c) => (
            <motion.div
              key={c.id}
              role="listitem"
              className={cards.length <= 1 ? 'fy-card wide' : 'fy-card'}
              style={slot(slots.current.get(c.id) ?? 'p9')}
              variants={{ gone: () => gone(c.id) }}
              initial={{ flexBasis: '0%', opacity: 0 }}
              animate={{ flexBasis: basis, opacity: 1, x: 0 }}
              exit="gone"
              transition={spring}
            >
              <div className="fy-card-in">
                <div className="fy-card-text">
                  <div className="fy-card-t">
                    <span className="fy-plus" aria-hidden>
                      <Icon name="plus" />
                    </span>
                    {c.title}
                  </div>
                  {c.why && <div className="fy-card-w">{c.why}</div>}
                </div>
                <div className="fy-card-acts">
                  <button className="fy-ok" onClick={() => answer(c, true)} aria-label={t.accept(c.title)}>
                    <Icon name="check" />
                    {c.accept && <span className="fy-ok-word">{c.accept}</span>}
                  </button>
                  <button className="fy-no" onClick={() => answer(c, false)} aria-label={t.refuse(c.title)}>
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {item.reply && <ReplyLine item={item} who={who} fy={fy} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// A session: project · title (a tap opens the real conversation), what it did / asks / why it stopped.

function SessionItem({ item, who, project, fy, inView }: KindProps) {
  const t = useT(M)
  const { now } = useApp()
  const open = useOpen(item)
  const said = item.tone === 'result' ? t.toneResult : item.tone === 'question' ? t.toneQuestion : item.tone === 'alert' ? t.toneAlert : null
  const name = project ?? who
  const label = item.title ? `${name} · ${item.title}` : name
  return (
    <>
      <button className="fy-head" onClick={open} disabled={!open} aria-label={t.openSession(label)}>
        <span className="in fy-head-in">
          <span className="fy-head-text">
            <span className="dot fy-dot" aria-hidden />
            <span className="fy-who-name">{name}</span>
            {item.title && <span className="fy-head-title"> · {item.title}</span>}
          </span>
          {open && (
            <span className="fy-go" aria-hidden>
              <Icon name="arrow" dir="right" />
            </span>
          )}
        </span>
      </button>
      <div className="in fy-pad-b">
        <div className="fy-said">
          {said && <span className="fy-said-word">{said}</span>}
          <span className="fy-at">
            {said ? ' · ' : ''}
            {ago(Math.max(0, now - item.at))}
          </span>
          {item.voice && <Listen item={item} who={name} />}
        </div>
        <div className="fy-text">{item.text}</div>
        {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
      </div>
      {!!item.media?.length && <MediaStrip media={item.media} />}
      <Actions item={item} fy={fy} />
      {/* The project is enough here: the title sits just above, and with it the placeholder was cut mid-word on a phone. */}
      {item.reply && <ReplyLine item={item} who={name} fy={fy} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Improve (the one place colour goes wild), alert (sober), insight (a page you learn from), milestone, stat.

function ImproveItem({ item, who, fy, inView }: KindProps) {
  const t = useT(M)
  return (
    <>
      <div className="in fy-pad">
        <Who item={item} who={who}>
          <button className="fy-x" onClick={() => void fy.dismiss(item.id)} aria-label={t.dismiss(item.title ?? item.text.slice(0, 60))}>
            <Icon name="close" />
          </button>
        </Who>
        {item.title && <div className="fy-title">{item.title}</div>}
        <div className="fy-text fy-lead">{item.text}</div>
        {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
      </div>
      <Actions item={item} fy={fy} />
      {item.reply && <ReplyLine item={item} who={who} fy={fy} />}
    </>
  )
}

function AlertItem({ item, fy }: KindProps) {
  const t = useT(M)
  const open = useOpen(item)
  const text = item.title && item.title !== item.text ? `${item.title} · ${item.text}` : item.text
  return (
    <>
      <button className="fy-alert" onClick={open} disabled={!open} aria-label={open ? t.openIt(text) : undefined}>
        <span className="in fy-alert-in">
          <span className="fy-bang" aria-hidden>
            <Icon name="bang" />
          </span>
          <span className="fy-alert-text">{text}</span>
          {open && (
            <span className="fy-go" aria-hidden>
              <Icon name="arrow" dir="right" />
            </span>
          )}
        </span>
      </button>
      <Actions item={item} fy={fy} />
    </>
  )
}

function InsightItem({ item, who, project, fy }: KindProps) {
  const t = useT(M)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const toggle = async () => {
    if (open) return setOpen(false)
    if (item.moreText) return setOpen(true)
    setBusy(true)
    setErr(null)
    try {
      await fy.more(item.id)
      setOpen(true)
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t.failed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="in fy-pad">
      <Who item={item} who={project ?? who} />
      {item.title && <div className="fy-title">{item.title}</div>}
      <p className="fy-big">{item.text}</p>
      <Collapse open={open && !!item.moreText}>
        <div className="fy-text fy-more">{item.moreText}</div>
      </Collapse>
      {item.more && (
        <button className="link fy-more-btn" onClick={() => void toggle()} aria-expanded={open} disabled={busy}>
          {busy ? (
            <>
              {t.searching}
              <span className="dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </>
          ) : open ? (
            t.less
          ) : (
            t.more
          )}
        </button>
      )}
      {err && (
        <div className="meta" role="alert">
          ! {err}
        </div>
      )}
    </div>
  )
}

function MilestoneItem({ item, who, project, inView }: KindProps) {
  return (
    <div className="in fy-pad">
      <Who item={item} who={project ?? who} />
      {item.title && <div className="fy-title">{item.title}</div>}
      <div className="fy-shift">{item.text}</div>
      {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
    </div>
  )
}

function StatItem({ item, who, project, fy, inView }: KindProps) {
  return (
    <>
      <div className="in fy-pad">
        <Who item={item} who={project ?? who} />
        {item.title && <div className="fy-title">{item.title}</div>}
        {item.text && <div className="fy-text">{item.text}</div>}
        {!!item.gauges?.length && <Gauges list={item.gauges} inView={inView} />}
      </div>
      <Actions item={item} fy={fy} />
    </>
  )
}

const KINDS: Record<ForYouItem['kind'], (p: KindProps) => ReactNode> = {
  media: MediaItem,
  boss: BossItem,
  mail: MailItem,
  proposals: Proposals,
  session: SessionItem,
  improve: ImproveItem,
  alert: AlertItem,
  insight: InsightItem,
  milestone: MilestoneItem,
  stat: StatItem,
}

/** The band's extra classes: an alert and a milestone are drawn inverted (ink band, coloured words). */
const bandClass = (item: ForYouItem) => `band fy-k-${item.kind} fy-t-${item.tone}${item.kind === 'alert' || item.kind === 'milestone' ? ' invert' : ''}${item.seen ? '' : ' fy-unseen'}`

/** One line of an item, for the thin strips of the top band's preview. */
const oneLine = (item: ForYouItem) => (item.kind === 'proposals' ? (item.cards?.[0]?.title ?? item.text) : item.kind === 'media' ? item.title || item.text : item.text || item.title || '')

/** One item of the stream. compact: a thin strip (speaker · one line), nothing to tap inside. */
export function ForYouItemView({ item, compact }: { item: ForYouItem; compact?: boolean }) {
  const fy = useForYou()
  const { colors, snap } = useApp()
  const authors = useAuthors()
  const project = item.projectId ? snap.projects.find((p) => p.id === item.projectId)?.name : undefined
  const who = itemWho(item, authors, project)
  const style = itemSlot(item, colors, authors)
  const band = useRef<HTMLElement>(null)
  const inView = useInView(band, 0.5, !compact)
  const { markSeen } = fy
  // Seen once it stayed under the eyes a moment (any device then knows).
  useEffect(() => {
    if (compact || item.seen || !inView) return
    const timer = setTimeout(() => markSeen([item.id]), SEEN_AFTER)
    return () => clearTimeout(timer)
  }, [compact, item.id, item.seen, inView, markSeen])

  if (compact) {
    return (
      <div className={`${bandClass(item)} fy-strip`} style={style} data-fy={item.id}>
        <div className="in fy-strip-in">
          <span className="dot fy-dot" aria-hidden />
          {item.kind === 'proposals' && (
            <span className="fy-plus" aria-hidden>
              <Icon name="plus" />
            </span>
          )}
          <span className="fy-who-name">{who}</span>
          <span className="fy-strip-text ellipsis">{oneLine(item)}</span>
        </div>
      </div>
    )
  }
  const Kind = KINDS[item.kind]
  const err = fy.error(item.id)
  return (
    <article ref={band} className={`${bandClass(item)} fy-item${inView ? ' fy-inview' : ''}`} style={style} data-fy={item.id} data-fy-kind={item.kind}>
      {Kind && <Kind item={item} who={who} project={project} inView={inView} fy={fy} />}
      {err && (
        <div className="fy-err" role="alert">
          <div className="in meta">! {err}</div>
        </div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// The page.

const slide: Variants = { enter: { x: '100%' }, shown: { x: 0 }, leave: { x: '100%' } }

/** A full-screen page like Shell's: slides in from the right, swipe right = back. */
function usePageMotion() {
  const { back } = useApp()
  return {
    variants: slide,
    initial: 'enter',
    animate: 'shown',
    exit: 'leave',
    transition: spring,
    drag: 'x' as const,
    dragDirectionLock: true,
    dragConstraints: { left: 0, right: 0 },
    dragElastic: { left: 0, right: 0.9 },
    dragSnapToOrigin: true,
    onDragEnd: (_: unknown, info: PanInfo) => {
      if (info.offset.x > 110 || info.velocity.x > 600) {
        gestureSeen('g-back')
        back()
      }
    },
  }
}

/** The line: what is turning right now. The only thing always alive. */
function ForYouPulse({ pulse }: { pulse: ForYouPulse }) {
  const t = useT(M)
  const stars = Math.min(pulse.working, 6)
  const parts = [pulse.working > 0 && t.pulseWorking(pulse.working), pulse.delivered > 0 && t.pulseDelivered(pulse.delivered), pulse.waiting > 0 && t.pulseWaiting(pulse.waiting), pulse.auto > 0 && t.pulseAuto(pulse.auto)].filter(
    (p): p is string => !!p,
  )
  return (
    <div className="band fy-pulse" role="group" aria-label={t.pulseLabel}>
      <div className="in fy-pulse-in">
        {stars > 0 && (
          <span className="fy-stars" aria-hidden>
            {Array.from({ length: stars }, (_, i) => (
              <span key={i} className="spin fluo" style={{ animationDelay: `${-i * 0.43}s` }}>
                <Icon name="star" />
              </span>
            ))}
          </span>
        )}
        <span className="fy-pulse-text">{parts.length ? parts.join(' · ') : t.pulseQuiet}</span>
      </div>
    </div>
  )
}

function Participants({ list, sel, onPick }: { list: string[]; sel: string; onPick: (who: string) => void }) {
  const t = useT(M)
  const authors = useAuthors()
  const row = useRef<HTMLDivElement>(null)
  useOwnSwipe(row)
  const name = (w: string) => (w === WHO_ALL ? t.whoAll : w === 'weevboss' ? w : w === 'session' ? t.whoSessions : w === 'media' ? t.whoMedia : w === 'ideas' ? t.whoIdeas : authors(w).name)
  return (
    <div ref={row} className="fy-people" role="group" aria-label={t.participants}>
      {list.map((w) => (
        <button key={w} className={w === sel ? 'word on' : 'word'} aria-pressed={w === sel} onClick={() => onPick(w)}>
          {name(w)}
        </button>
      ))}
    </div>
  )
}

/** An item's place in the stream: it comes in with the house spring, and leaves sideways when acted on (the next ones close the gap). */
function Slot({ item, index, opening }: { item: ForYouItem; index: number; opening: boolean }) {
  const { leaving } = useForYou()
  const id = item.id
  const variants = useMemo<Variants>(
    () => ({
      gone: () => {
        const d = leaving(id)
        if (!d) return { opacity: 0, height: 0 }
        return { x: d > 0 ? '100%' : '-100%', opacity: 0, height: 0, transition: { default: spring, opacity: { duration: 0.22 }, height: { ...spring, delay: 0.16 } } }
      },
    }),
    [id, leaving],
  )
  // Opening the page: the first six come in one after the other, the next ones as they reach the screen (once).
  const later = opening && index >= 6
  return (
    <motion.div
      className="clip fy-slot"
      variants={variants}
      initial={opening ? { opacity: 0, y: 22 } : { opacity: 0, height: 0 }}
      animate={later ? undefined : opening ? { opacity: 1, y: 0 } : { opacity: 1, height: 'auto' }}
      whileInView={later ? { opacity: 1, y: 0 } : undefined}
      viewport={later ? { once: true, amount: 0.05 } : undefined}
      exit="gone"
      transition={opening && !later ? { ...spring, delay: index * 0.04 } : spring}
    >
      <ForYouItemView item={item} />
    </motion.div>
  )
}

function Stream({ items }: { items: ForYouItem[] }) {
  const opening = useRef(true)
  useEffect(() => {
    opening.current = false
  }, [])
  return (
    <AnimatePresence>
      {items.map((it, i) => (
        <Slot key={it.id} item={it} index={i} opening={opening.current} />
      ))}
    </AnimatePresence>
  )
}

/** The time of the previous look, short: the hour today, the day before that. */
function lookTime(at: number): string {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  return new Intl.DateTimeFormat(intlLocale(), today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

/** « Pour toi » in full screen. who: the participant isolated at opening (else the one chosen last time). */
export function ForYouPage({ who }: { who?: string }) {
  const t = useT(M)
  const { back } = useApp()
  const fy = useForYou()
  const page = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  usePageChrome('agent', page)
  const move = usePageMotion()
  const [sel, setSel] = useState(() => who ?? read(WHO_KEY) ?? WHO_ALL)
  const [lastLook] = useState(() => Number(read(LOOK_KEY)) || 0)
  const { showFresh, setReading } = fy
  useLayoutEffect(() => {
    // Opening the page is a fresh look: what waited comes in, in the server's order.
    showFresh()
    heading.current?.focus({ preventScroll: true })
    write(LOOK_KEY, String(Date.now()))
    return () => setReading(false)
  }, [showFresh, setReading])

  const toTop = (smooth: boolean) => body.current?.scrollTo?.({ top: 0, behavior: smooth && !reduced() ? 'smooth' : 'auto' })
  const pick = (w: string) => {
    const next = w === sel ? WHO_ALL : w
    setSel(next)
    write(WHO_KEY, next)
    toTop(false)
  }
  const people = useMemo(() => {
    const list = participants(fy.items)
    return list.includes(sel) ? list : [...list, sel]
  }, [fy.items, sel])
  const shown = useMemo(() => fy.items.filter((i) => matchesWho(i, sel)), [fy.items, sel])

  return (
    <motion.div ref={page} className="page fy-page" style={slot('agent')} {...move} role="dialog" aria-modal="true" aria-label={t.title}>
      <div className="page-head band tone fy-top">
        <div className="in fy-top-in">
          <button className="back" onClick={back} aria-label={t.back}>
            <span aria-hidden>
              <Icon name="chevron" dir="left" />
            </span>
          </button>
          <div className="fy-words">
            <button className="word" onClick={() => focusBoss({ flash: false })} aria-label={t.openBoss}>
              weevboss
            </button>
            <h1 ref={heading} tabIndex={-1} className="word on">
              {t.title}
            </h1>
          </div>
        </div>
        <Participants list={people} sel={sel} onPick={pick} />
      </div>
      <div ref={body} className="page-body fy-body" data-scroll onScroll={(e) => setReading(e.currentTarget.scrollTop > 48)}>
        <AnimatePresence initial={false}>
          {fy.fresh > 0 && (
            <motion.button
              key="fresh"
              className="band invert fy-fresh"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              onClick={() => {
                showFresh()
                toTop(true)
              }}
            >
              <span className="in fy-fresh-in">
                <Icon name="arrow" /> {t.fresh(fy.fresh)}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
        {fy.feed && <ForYouPulse pulse={fy.feed.pulse} />}
        <Stream key={sel} items={shown} />
        {fy.feed &&
          (shown.length ? (
            <div className="fy-end">
              <div className="in meta">
                <Icon name="check" /> {lastLook ? t.upToDateSince(lookTime(lastLook)) : t.upToDate}
              </div>
            </div>
          ) : (
            <div className="fy-end fy-quiet">
              <div className="in meta">{sel === WHO_ALL ? t.empty : t.emptyWho}</div>
            </div>
          ))}
        <div className="fill" />
      </div>
    </motion.div>
  )
}

/** One media of the stream, alone and whole, on the page's colour (never black). Back: the chevron or a swipe right. */
export function MediaPage({ url, type, name }: { url: string; type: 'image' | 'video'; name: string }) {
  const t = useT(M)
  const { back } = useApp()
  const page = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  usePageChrome('agent', page)
  const move = usePageMotion()
  // The player's own bar (scrubbing) keeps its drags.
  useOwnSwipe(video, type === 'video')
  return (
    <motion.div ref={page} className="page fy-viewer" style={slot('agent')} {...move} role="dialog" aria-modal="true" aria-label={name}>
      <div className="fy-viewer-top">
        <button className="ch" onClick={back} aria-label={t.back}>
          <Icon name="chevron" dir="left" />
        </button>
        <span className="meta ellipsis">{name}</span>
      </div>
      <div className="fy-stage">{type === 'video' ? <video ref={video} src={url} controls autoPlay playsInline loop /> : <img src={url} alt={name} draggable={false} />}</div>
    </motion.div>
  )
}
