// Requests: weevboss's request ledger, read by the user in plain words.
//
// One column, the same everywhere (a repo's page, the page of all requests): one band per request, like the automation
// rows. A band is a short title, a small star before it while its session works, and a small bar that says how far it
// is; a request that waits on the user (an answer, a restart, a merge) says so in words instead, never a part-filled
// bar, and so does one where nothing moves any more: « paused » and for how long, quieter. What runs now sits on top,
// then what waits on the user, then every other request ever asked, the newest first, whatever its state: nothing is
// folded away or dropped from the list. A tap opens a request in place: the whole sentence, the user's exact words,
// where it was sent (a tap opens that session), what came back and the commit that shows it; « done » and « drop »
// close it.
//
// The word that says where a request stands (chipOf, stateIn) lives in shared/request-chip.ts: the server counts the
// requests that wait on the user with the very same rule.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Session, SessionStatus } from '../../shared/api.ts'
import type { Dispatch } from '../../shared/ledger.ts'
import type { LedgerView } from '../../shared/ledger.ts'
import { noticeKey } from '../../shared/notices.ts'
import { chipOf, stateIn, type Chip } from '../../shared/request-chip.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/requests'
import { useApp } from './app-context'
import { short } from './auto-model'
import { Collapse } from './bits'
import { winRef } from './celebrate'
import { askWin } from '../../shared/wins.ts'
import { Icon } from './icons'
import { Notice } from './notice'
import { Shell } from './shell'
import './requests.css'

// The reading of a request's state is shared with the server; every import of it from here keeps working.
export { chipOf, stateIn, waitingCount, type Chip } from '../../shared/request-chip.ts'

type Row = LedgerView['asks'][number]

const hhmm = (at: number) => new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })

/** « weevils · claude · Onboarding link » → « weevils · Onboarding link » ; no label: a plain word, never a session id. */
const who = (d: Dispatch, none: string) => {
  const p = (d.label ?? '').split(' · ')
  return p.length >= 3 ? `${p[0]} · ${p.slice(2).join(' · ')}` : d.label || none
}

/** A request in a list: its short title (the ledger writes one), else a heading made from its sentence: the words
 *  before the first clause break, six at most, never a sentence cut with « … ». */
export const askLabel = (a: { title?: string; text: string }) => a.title || headingOf(a.text)
const BREAK = /[:;,.?!(]|\s[—–-]\s|\s(?:so|so that|and|with|to|then|because|instead|without|by|when|where|which|that|in the|on the|inside)\s/i
export function headingOf(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim()
  const cut = s.split(BREAK)[0].trim()
  const words = (cut.split(' ').length >= 2 ? cut : s).split(' ')
  const kept = words.slice(0, 6)
  // Never end on a little word (« … page of each », « … use the »).
  while (kept.length > 2 && /^(?:the|a|an|of|in|on|at|to|each|every|its|their|your|my|our|this|that|use)$/i.test(kept.at(-1)!)) kept.pop()
  return kept.join(' ').replace(/[\s,;:.'"’-]+$/, '')
}

/** « drop »: a first tap arms it, a second one (within 3 s) drops. */
function Drop({ onDrop }: { onDrop: () => void }) {
  const t = useT(M)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const tm = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(tm)
  }, [armed])
  return (
    <button className={armed ? 'req-btn on' : 'req-btn'} onClick={() => (armed ? onDrop() : setArmed(true))}>
      {armed ? t.sure : t.drop}
    </button>
  )
}

/** What an opened request shows, in place: the whole sentence, the user's exact words, where it was sent (a tap opens
 *  that session), what came back, and « done » / « drop » (or « reopen »). Shared by the request column. */
export function AskDetail({ a, onAction }: { a: Row; onAction: (action: 'done' | 'drop' | 'open') => void }) {
  const t = useT(M)
  const { push } = useApp()
  const live = a.status === 'open' || a.status === 'dispatched'
  const words = [{ quote: a.quote, at: a.at, from: a.from }, ...(a.more ?? [])]
  return (
    <div className="in req-detail">
      <div className="req-whole">{a.text}</div>
      {/* The sentence already says the request: a quote only when the words differ (a follow-up, a longer original). */}
      {words.filter((w) => w.quote.trim() !== a.text.trim()).map((w, i) => (
        <div key={i} className="req-said req-said-row">
          <span className="req-quote">“{w.quote}”</span>
          <span className="meta">{hhmm(w.at)}</span>
        </div>
      ))}
      {a.dispatches.map((d) => (
        <div key={d.session + d.at} className="req-dispatch">
          <button type="button" className="link req-who" onClick={() => push({ kind: 'session', id: d.session })}>→ {who(d, t.aSession)}</button>
          {d.report && <div className="meta">{d.report}</div>}
          {d.evidence && <div className="meta req-proof">{t.commit(d.evidence)}</div>}
        </div>
      ))}
      {!a.dispatches.length && a.note && <div className="meta">{a.note}</div>}
      <div className="req-actions">
        {live ? (
          <>
            <button className="req-btn" onClick={() => onAction('done')}>{t.markDone}</button>
            <Drop onDrop={() => onAction('drop')} />
          </>
        ) : (
          <button className="req-btn" onClick={() => onAction('open')}>{t.reopen}</button>
        )}
      </div>
    </div>
  )
}

/** How far a request is, from facts only (never a guessed percent): 0 not started · 1 sent, nothing moving · 2 being
 *  worked on · 3 it came back, to check · 4 done. Two states have no bar, `null`, and say it in words instead: a
 *  request that waits on the user, and a paused one (nothing moved for a day, or its session is gone), which a
 *  quarter bar would show as work just sent. Exported for tests. */
export function stageOf(chip: Chip): 0 | 1 | 2 | 3 | 4 | null {
  if (chip === 'needs' || chip === 'paused') return null
  if (chip === 'done') return 4
  if (chip === 'check') return 3
  if (chip === 'running') return 2
  return chip === 'queued' || chip === 'dropped' ? 0 : 1
}

/** A paused request, in words: « paused · 1d », the word then how long since it last moved (its last progress, else
 *  the day it was asked). `now`: the app's clock. Exported for tests. */
export function pausedLine(a: Pick<Row, 'at' | 'progressAt'>, now: number, word: string): string {
  return `${word} · ${short(now - (a.progressAt || a.at), true)}`
}

/** One order for the column and for the rows of a group: what runs right now, then what waits on the user, then every
 *  other request; inside each, the newest asked first. */
const rank = (chip: Chip) => (chip === 'running' ? 0 : chip === 'needs' ? 1 : 2)
const byOrder = (x: { a: Row; chip: Chip }, y: { a: Row; chip: Chip }) => rank(x.chip) - rank(y.chip) || y.a.at - x.a.at

/** The column's order: what runs right now on top, then the requests that wait on the user, then every other request,
 *  the newest asked first. Exported for tests. */
export function columnOf(asks: Row[], state: (a: Row) => SessionStatus | 'gone' | undefined): { a: Row; chip: Chip }[] {
  return asks.map((a) => ({ a, chip: chipOf(a, state(a)) })).sort(byOrder)
}

/** Requests that only switch a session's model or effort (« Switch For you session Opus », « Architecture session top
 *  model »): settings asked in passing, not product work; a repo's page leaves them out. Read on the short title.
 *  Exported for tests. */
const MODEL_WORD = /\b(opus|sonnet|haiku|fable|mythos|codex|gpt-?\d[\w.-]*|model|modèle|effort)\b/i
const SWITCH_WORD = /\b(switch|swap|move|use|run|put|set|change|top|passe[rz]?|mets?|bascule[rz]?|change[rz]?|session)\b/i
export function isModelSwitch(a: { title?: string; text: string }): boolean {
  const label = askLabel(a)
  return MODEL_WORD.test(label) && SWITCH_WORD.test(label.replace(MODEL_WORD, ''))
}

export interface Group {
  /** The session's id; '' for the requests never sent. */
  key: string
  session?: Session
  /** The session's plain title (a session gone: the title its dispatch label kept). */
  label: string
  /** When the session was last active: the one order of the groups, the most recent on top. */
  at: number
  rows: { a: Row; chip: Chip }[]
}

/** « weevils · claude · Onboarding link » → « Onboarding link ». */
const titleOfLabel = (label?: string) => {
  const p = (label ?? '').split(' · ')
  return p.length >= 3 ? p.slice(2).join(' · ') : (label ?? '')
}

/**
 * Requests grouped under the session they were last sent to: the most recently active session first, then the others
 * by recency; inside a group what runs first, then what waits on the user, then the newest. Requests never sent make
 * one group at the bottom.
 * `idle`: open sessions with no request yet, shown as their own (empty) group. Exported for tests.
 */
export function groupsOf(asks: Row[], sessions: Session[], idle: Session[] = []): Group[] {
  const byId = new Map(sessions.map((x) => [x.id, x]))
  const state = stateIn(asks, sessions)
  const groups = new Map<string, Group>()
  for (const a of asks) {
    const d = a.dispatches.at(-1)
    const key = d?.session ?? ''
    let g = groups.get(key)
    if (!g) {
      const s = d ? byId.get(d.session) : undefined
      g = { key, ...(s ? { session: s } : {}), label: s?.title || titleOfLabel(d?.label), at: s?.lastActivityAt ?? 0, rows: [] }
      groups.set(key, g)
    }
    if (!g.session && d) g.at = Math.max(g.at, d.at)
    g.rows.push({ a, chip: chipOf(a, state(a)) })
  }
  for (const s of idle) if (!groups.has(s.id)) groups.set(s.id, { key: s.id, session: s, label: s.title, at: s.lastActivityAt, rows: [] })
  for (const g of groups.values()) g.rows.sort(byOrder)
  return [...groups.values()].sort((x, y) => Number(x.key === '') - Number(y.key === '') || y.at - x.at)
}

/** A row's state as its label says it to a screen reader: the word, and for a paused request how long it has rested. */
const stateWords = (a: Row, chip: Chip, now: number, word: (k: string) => string) => (chip === 'paused' ? pausedLine(a, now, word(chip)) : word(chip))

/**
 * The right end of a request's row: the small bar that says how far it is, or words in its place. A paused request
 * says « paused · 1d », quietly; one that waits on the user says « needs you », loud. `headed`: the row sits under its
 * session's band, where « needs you » is said once, on that band: its request keeps the bar of work that came back.
 */
function Mark({ chip, words, headed }: { chip: Chip; words: string; headed?: boolean }) {
  if (chip === 'paused') return <span className="rc-rests" aria-hidden>{words}</span>
  const stage = stageOf(chip) ?? (headed ? 3 : null)
  if (stage === null) return <span className="rc-waits" aria-hidden>{words}</span>
  return <span className="rc-bar" data-stage={stage} aria-hidden><i style={{ width: `${stage * 25}%` }} /></span>
}

const PAGE = 40
const STEPS = 8
/** Finished requests a session group shows before folding the older ones. */
const FOLD_AFTER = 2

/**
 * The request column: one band per request, like the automation rows (one colour, each band one small tone step from
 * the one above, no line, no gap). A band is a short title, a small star before it while its session works (the
 * title never moves: the star's place is always kept), and a small bar that says how far it is, or the words « needs
 * you » when what is left is the user's, or « paused » and for how long when nothing moves any more. Every request is
 * there whatever its state; a tap opens it in place. `fill`: the column is the whole page, so the tone of its last
 * band runs down to the bottom of the screen (no darker band under the list).
 */
export function RequestColumn({ asks, onChanged, fill }: { asks: Row[]; onChanged?: () => void; fill?: boolean }) {
  const t = useT(M)
  const { snap, now } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const rows = columnOf(asks, stateIn(asks, snap.sessions))
  // What runs and what waits on the person is always drawn; the page counts the rows after them, so a request just
  // asked is never behind « earlier » however many wait.
  const lead = rows.findIndex((r) => rank(r.chip) === 2)
  const cut = (lead < 0 ? rows.length : lead) + shown
  const act = (a: Row) => (action: 'done' | 'drop' | 'open') => void api.askAction(a.id, action).then(() => onChanged?.()).catch(() => undefined)
  return (
    <div className={fill ? 'rc fill' : 'rc'} style={{ '--last': Math.min(Math.max(rows.length - 1, 0), STEPS) } as CSSProperties}>
      {rows.slice(0, cut).map(({ a, chip }, i) => {
        const words = stateWords(a, chip, now, t.chip)
        return (
          <div key={a.id} ref={winRef(askWin(a))} className={`rc-row c-${chip}${open === a.id ? ' open' : ''}`} style={{ '--step': Math.min(i, STEPS) } as CSSProperties}>
            <button type="button" className="in rc-line" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} aria-label={`${askLabel(a)} · ${words}`}>
              <span className="rc-star">{chip === 'running' && <span className="spin fluo"><Icon name="star" /></span>}</span>
              <span className="rc-title">{askLabel(a)}</span>
              <Mark chip={chip} words={words} />
            </button>
            <Collapse open={open === a.id}>
              <AskDetail a={a} onAction={act(a)} />
            </Collapse>
          </div>
        )
      })}
      {rows.length > cut && (
        <div className="rc-row" style={{ '--step': STEPS } as CSSProperties}>
          <button type="button" className="in rc-line rc-more" onClick={() => setShown(shown + PAGE)}>
            <span className="rc-star" />
            <span className="rc-title">{t.earlier(rows.length - cut)}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * A repo's requests, grouped under their sessions: a session is one band with its plain title (a tap opens it), with
 * « needs you » when what is left is the user's, and its requests just under it, indented, one band each, a small
 * star on the one being worked on and a small bar for how far it is (« paused » and for how long, in words, when
 * nothing moves any more). Same bands, same staircase as the column; no box, no line. The requests never sent close
 * the list, under a quiet heading.
 */
export function RequestGroups({ groups, onChanged, fill }: { groups: Group[]; onChanged?: () => void; fill?: boolean }) {
  const t = useT(M)
  const { push, now } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())
  const act = (a: Row) => (action: 'done' | 'drop' | 'open') => void api.askAction(a.id, action).then(() => onChanged?.()).catch(() => undefined)
  const out: ReactNode[] = []
  let step = 0
  let count = 0
  let hidden = 0
  for (const g of groups) {
    if (count >= shown) {
      hidden += g.rows.length || 1
      continue
    }
    const s = g.session
    // What is left is the user's: the session asks, or one of its requests came back with a question while it rests.
    const needs = s?.status === 'needs_user' || (s?.status !== 'working' && g.rows.some((r) => r.chip === 'needs'))
    const runsHere = g.rows.some((r) => r.chip === 'running')
    const star = s?.status === 'working' && !runsHere
    const waits = t.chip('needs')
    const headLabel = needs ? `${g.label} · ${waits}` : g.label
    out.push(
      <div key={`g:${g.key}`} className={`rc-row rc-head${g.key ? '' : ' rc-unsent'}`} style={{ '--step': Math.min(step++, STEPS) } as CSSProperties}>
        {g.key ? (
          <button type="button" className="in rc-line" onClick={() => (s ? push({ kind: 'session', id: s.id }) : undefined)} disabled={!s} aria-label={headLabel}>
            <span className="rc-star">{star && <span className="spin fluo"><Icon name="star" /></span>}</span>
            <span className="rc-title">{g.label || t.aSession}</span>
            {needs && <span className="rc-waits" aria-hidden>{waits}</span>}
          </button>
        ) : (
          <div className="in rc-line">
            <span className="rc-star" />
            <span className="rc-title">{t.notSent}</span>
          </div>
        )}
      </div>,
    )
    count++
    // A session keeps its open requests in view and its last FOLD_AFTER finished ones; the older finished ones fold
    // behind one quiet line, so a long-lived session never pushes the others off the screen.
    const closed = g.rows.filter((r) => r.chip === 'done' || r.chip === 'dropped')
    const folded = unfolded.has(g.key) ? [] : closed.slice(FOLD_AFTER)
    const rows = g.rows.filter((r) => !folded.includes(r))
    for (const { a, chip } of rows) {
      if (count >= shown) {
        hidden++
        continue
      }
      const words = stateWords(a, chip, now, t.chip)
      out.push(
        <div key={a.id} ref={winRef(askWin(a))} className={`rc-row rc-sub c-${chip}${open === a.id ? ' open' : ''}`} style={{ '--step': Math.min(step++, STEPS) } as CSSProperties}>
          <button type="button" className="in rc-line" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} aria-label={`${askLabel(a)} · ${words}`}>
            <span className="rc-star">{chip === 'running' && <span className="spin fluo"><Icon name="star" /></span>}</span>
            <span className="rc-title">{askLabel(a)}</span>
            <Mark chip={chip} words={words} headed />
          </button>
          <Collapse open={open === a.id}>
            <AskDetail a={a} onAction={act(a)} />
          </Collapse>
        </div>,
      )
      count++
    }
    if (folded.length && count < shown) {
      out.push(
        <div key={`f:${g.key}`} className="rc-row rc-sub rc-fold" style={{ '--step': Math.min(step++, STEPS) } as CSSProperties}>
          <button type="button" className="in rc-line" onClick={() => setUnfolded(new Set([...unfolded, g.key]))}>
            <span className="rc-star" />
            <span className="rc-title">{t.moreDone(folded.length)}</span>
          </button>
        </div>,
      )
      count++
    }
  }
  return (
    <div className={fill ? 'rc fill' : 'rc'} style={{ '--last': Math.min(Math.max(step - 1, 0), STEPS) } as CSSProperties}>
      {out}
      {hidden > 0 && (
        <div className="rc-row" style={{ '--step': STEPS } as CSSProperties}>
          <button type="button" className="in rc-line rc-more" onClick={() => setShown(shown + PAGE)}>
            <span className="rc-star" />
            <span className="rc-title">{t.earlier(hidden)}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** Every request, all repos: the same column. The messages still being read sit above it. */
export function RequestsPage() {
  const t = useT(M)
  const { snap, colors } = useApp()
  const [v, setV] = useState<LedgerView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const last = useRef(0)
  const load = useCallback(() => api.ledger().then((r) => { last.current = Date.now(); setV(r); setErr(null) }).catch((e) => setErr((e as Error).message)), [])
  useEffect(() => void load(), [snap.asksOpen, snap.asksWaiting, load])
  useEffect(() => {
    if (Date.now() - last.current > 8000) void load()
  }, [snap.version, load])

  return (
    <Shell slot={colors.__foot ?? 'p3'} kicker="weevboss" title={t.title}>
      {err && (
        <Notice eventId={noticeKey('error:requests', location.pathname, location.hash, err)} className="band tone calm-note" role="alert">
          <div className="in meta" style={{ paddingBlock: 12 }}>{err}</div>
        </Notice>
      )}
      {v && (
        <>
          {v.pending.map((p) => (
            <div key={p.cid} className="in req-pending">
              <span className="st" aria-hidden>…</span>
              <span className="req-quote small">“{p.text}”</span>
            </div>
          ))}
          {!v.asks.length && !v.pending.length && <div className="in meta req-empty">{t.nothingOpen}</div>}
          <RequestColumn asks={v.asks} onChanged={load} fill />
        </>
      )}
    </Shell>
  )
}
