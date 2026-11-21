// Requests: weevboss's request ledger, read by the user in plain words.
//
// One column, the same everywhere (a repo's page, the page of all requests): one band per request, like the automation
// rows. A band is a short title, a small star before it while its session works, and a small bar that says how far it
// is. What runs now sits on top, then every request ever asked, the newest first, whatever its state: nothing is
// folded away or dropped from the list. A tap opens a request in place: the whole sentence, the user's exact words,
// where it was sent (a tap opens that session), what came back; « done » and « drop » close it.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SessionStatus } from '../../shared/api.ts'
import type { Dispatch } from '../../shared/ledger.ts'
import type { LedgerView } from '../../shared/ledger.ts'
import { noticeKey } from '../../shared/notices.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/requests'
import { useApp } from './app-context'
import { Collapse } from './bits'
import { Icon } from './icons'
import { Notice } from './notice'
import { Shell } from './shell'
import './requests.css'

type Row = LedgerView['asks'][number]

const hhmm = (at: number) => new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })

/** « weevils · claude · Onboarding link » → « weevils · Onboarding link » ; no label: a plain word, never a session id. */
const who = (d: Dispatch, none: string) => {
  const p = (d.label ?? '').split(' · ')
  return p.length >= 3 ? `${p[0]} · ${p.slice(2).join(' · ')}` : d.label || none
}

type Chip = 'queued' | 'running' | 'blocked' | 'needs' | 'check' | 'paused' | 'done' | 'dropped'

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

/**
 * The one word that says where a request stands, read from the real session it was sent to (never from the ledger's
 * « dispatched » alone: a session gone for days is not running). `session`: its state, 'gone' when it no longer
 * exists, undefined when nothing was sent. Exported for tests.
 */
export function chipOf(a: Row, session?: SessionStatus | 'gone'): Chip {
  if (a.status === 'done') return 'done'
  if (a.status === 'dropped') return 'dropped'
  const d = a.dispatches.at(-1)
  if (!d) return 'queued'
  if (session === 'working') return 'running'
  if (session === 'needs_user') return 'needs'
  // Its session finished long ago, or no longer exists, and nobody closed it: nothing is happening, said plainly
  // (a failure or a question days old included: it opens with the report).
  if (a.stale || session === 'gone') return 'paused'
  if (session === 'interrupted' || d.outcome === 'failed') return 'blocked'
  if (d.outcome === 'question') return 'needs'
  return 'check'
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
 *  worked on · 3 it came back (to check, or a question for you) · 4 done. Exported for tests. */
export function stageOf(chip: Chip): 0 | 1 | 2 | 3 | 4 {
  if (chip === 'done') return 4
  if (chip === 'check' || chip === 'needs') return 3
  if (chip === 'running') return 2
  return chip === 'queued' || chip === 'dropped' ? 0 : 1
}

/** The column's order: what runs right now on top, then every request, the newest asked first. Exported for tests. */
export function columnOf(asks: Row[], state: (a: Row) => SessionStatus | 'gone' | undefined): { a: Row; chip: Chip }[] {
  return asks
    .map((a) => ({ a, chip: chipOf(a, state(a)) }))
    .sort((x, y) => Number(y.chip === 'running') - Number(x.chip === 'running') || y.a.at - x.a.at)
}

const PAGE = 40
const STEPS = 8

/**
 * The request column: one band per request, like the automation rows (one colour, each band one small tone step from
 * the one above, no line, no gap). A band is a short title, a small star before it while its session works (the
 * title never moves: the star's place is always kept), and a small bar that says how far it is. Every request is
 * there whatever its state; a tap opens it in place.
 */
export function RequestColumn({ asks, onChanged }: { asks: Row[]; onChanged?: () => void }) {
  const t = useT(M)
  const { snap } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const status = new Map<string, SessionStatus>(snap.sessions.map((x) => [x.id, x.status]))
  const rows = columnOf(asks, (a) => {
    const d = a.dispatches.at(-1)
    return d ? (status.get(d.session) ?? 'gone') : undefined
  })
  const act = (a: Row) => (action: 'done' | 'drop' | 'open') => void api.askAction(a.id, action).then(() => onChanged?.()).catch(() => undefined)
  return (
    <div className="rc">
      {rows.slice(0, shown).map(({ a, chip }, i) => (
        <div key={a.id} className={`rc-row c-${chip}${open === a.id ? ' open' : ''}`} style={{ '--step': Math.min(i, STEPS) } as CSSProperties}>
          <button type="button" className="in rc-line" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} aria-label={`${askLabel(a)} · ${t.chip(chip)}`}>
            <span className="rc-star">{chip === 'running' && <span className="spin fluo"><Icon name="star" /></span>}</span>
            <span className="rc-title">{askLabel(a)}</span>
            <span className="rc-bar" data-stage={stageOf(chip)} aria-hidden><i style={{ width: `${stageOf(chip) * 25}%` }} /></span>
          </button>
          <Collapse open={open === a.id}>
            <AskDetail a={a} onAction={act(a)} />
          </Collapse>
        </div>
      ))}
      {rows.length > shown && (
        <div className="rc-row" style={{ '--step': STEPS } as CSSProperties}>
          <button type="button" className="in rc-line rc-more" onClick={() => setShown(shown + PAGE)}>
            <span className="rc-star" />
            <span className="rc-title">{t.earlier(rows.length - shown)}</span>
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
  useEffect(() => void load(), [snap.asksOpen, load])
  useEffect(() => {
    if (Date.now() - last.current > 8000) void load()
  }, [snap.version, load])

  return (
    <Shell slot={colors.__foot ?? 'p3'} kicker="weevboss" title={t.title}>
      {err && (
        <Notice eventId={noticeKey('error:requests', location.pathname, location.hash, err)} className="band invert" role="alert">
          <div className="in meta" style={{ paddingBlock: 12 }}>! {err}</div>
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
          <RequestColumn asks={v.asks} onChanged={load} />
        </>
      )}
      <div style={{ height: 96 }} />
    </Shell>
  )
}
