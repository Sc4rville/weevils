// The requests page (bottom of the machines band): weevboss's request ledger, read by the user in plain words.
//
// - « open »: the goals, each with its progress and its open requests (stale ones first), then the requests with no
//   goal, then the messages still being read. A request opens in place: the user's exact words, where it was sent,
//   what is expected back, what came back; « done » and « drop » (two taps) close it from here.
// - « closed »: what was done or dropped, newest first, and by whom.
// - « trace »: the work journal, newest first, by day: requests, dispatches (who, why, what must come back), reports,
//   decisions.
// Flat bands, bold type, no help text: the words of the ledger are the page.

import { motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Ask, Dispatch, TraceEntry } from '../../shared/ledger.ts'
import type { LedgerView } from '../../shared/ledger.ts'
import { noticeKey } from '../../shared/notices.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/requests'
import { useApp } from './app-context'
import { Collapse, spring } from './bits'
import { Notice } from './notice'
import { Shell } from './shell'
import './requests.css'

type Tab = 'open' | 'done' | 'trace'
type Row = LedgerView['asks'][number]

const hhmm = (at: number) => new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })

function useAge() {
  const t = useT(M)
  return (ms: number) => {
    const m = Math.max(1, Math.floor(ms / 60_000))
    return m < 60 ? t.age(m, 'm') : m < 1440 ? t.age(Math.floor(m / 60), 'h') : t.age(Math.floor(m / 1440), 'd')
  }
}

/** « weevils · claude · Onboarding link » → « weevils · Onboarding link ». */
const who = (d: Dispatch) => {
  const p = (d.label ?? '').split(' · ')
  return p.length >= 3 ? `${p[0]} · ${p.slice(2).join(' · ')}` : d.label || d.session.slice(0, 8)
}

function glyph(a: Row) {
  if (a.stale) return '!'
  return { open: '○', dispatched: '→', done: '✓', dropped: '×' }[a.status]
}

/** One line under the request: where it stands, in words. */
function useStatus() {
  const t = useT(M)
  const age = useAge()
  return (a: Row, now: number) => {
    const d = a.dispatches.at(-1)
    if (a.status === 'done' || a.status === 'dropped') {
      const by = a.closedBy === 'auto' ? t.closedByAuto : a.closedBy === 'user' ? t.closedByYou : t.closedByBoss
      return `${a.status === 'done' ? t.done : t.dropped} · ${by}${a.closedAt ? ` · ${age(now - a.closedAt)}` : ''}`
    }
    const where = d ? t.sentTo(who(d)) : t.open
    const how = d?.outcome === 'question' ? ` · ${t.waitsForYou}` : d?.outcome === 'failed' ? ` · ${t.failed}` : d?.outcome === 'progress' ? ` · ${t.partly}` : ''
    return a.stale ? `${t.stale(age(now - a.progressAt))} · ${where}` : `${where}${how} · ${age(now - a.at)}`
  }
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

function AskRow({ a, open, now, onToggle, onAction }: { a: Row; open: boolean; now: number; onToggle: () => void; onAction: (action: 'done' | 'drop' | 'open') => void }) {
  const t = useT(M)
  const { push } = useApp()
  const status = useStatus()
  const live = a.status === 'open' || a.status === 'dispatched'
  return (
    <motion.div layout="position" transition={spring} className={`req-item${open ? ' band tone open' : ''}${a.stale ? ' stale' : ''}`}>
      <button className="row req-row" onClick={onToggle} aria-expanded={open}>
        <span className="in">
          <span className="st" aria-hidden>{glyph(a)}</span>
          <span className="stack-text">
            <span className="req-text">{a.text}</span>
            <span className="meta req-status">{status(a, now)}</span>
          </span>
        </span>
      </button>
      <Collapse open={open}>
        <div className="in req-detail">
          <blockquote className="req-quote">“{a.quote}”</blockquote>
          <div className="meta">{t.yourWords}{a.from !== 'user' ? ` · ${t.from(a.from)}` : ''} · {hhmm(a.at)} · {a.id}</div>
          {a.dispatches.map((d) => (
            <div key={d.session + d.at} className="req-dispatch">
              <button type="button" className="link req-who" onClick={() => push({ kind: 'session', id: d.session })}>→ {who(d)}</button>
              {d.expect && <div className="meta"><span className="strong">{t.expects}</span> {d.expect}</div>}
              {d.report && <div className="meta"><span className="strong">{t.report}</span> {d.report}</div>}
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
      </Collapse>
    </motion.div>
  )
}

function GoalHead({ g }: { g: LedgerView['goals'][number] }) {
  const t = useT(M)
  const pct = g.total ? Math.round((g.done / g.total) * 100) : 0
  return (
    <div className="band tone req-goal">
      <div className="in">
        <div className="req-goal-title">{g.title}</div>
        <div className="meta req-goal-meta">
          {t.goalStats(g.done, g.total)}
          {g.stale ? ` · ${t.staleCount(g.stale)}` : ''}
          {g.sessions.length ? ` · ${t.sessions(g.sessions.length)}` : ''}
        </div>
        <div className="req-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
        {g.progress && <div className="meta req-goal-note">{g.progress}</div>}
      </div>
    </div>
  )
}

function TraceList({ trace, goals }: { trace: TraceEntry[]; goals: LedgerView['goals'] }) {
  const t = useT(M)
  const title = (id?: string) => goals.find((g) => g.id === id)?.title
  const day = (at: number) => {
    const d = new Date(at)
    const today = new Date()
    const y = new Date(Date.now() - 86400_000)
    if (d.toDateString() === today.toDateString()) return t.today
    if (d.toDateString() === y.toDateString()) return t.yesterday
    return d.toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'short' })
  }
  if (!trace.length) return <div className="in meta req-empty">{t.nothingTrace}</div>
  const list = [...trace].reverse()
  return (
    <>
      {list.map((e, i) => (
        <div key={`${e.at}-${i}`}>
          {(i === 0 || day(list[i - 1].at) !== day(e.at)) && <div className="in meta strong req-day">{day(e.at)}</div>}
          <div className={`in req-trace k-${e.kind}`}>
            <span className="meta tab req-time">{hhmm(e.at)}</span>
            <div className="req-trace-body">
              <div><span className="req-kind">{t.kind(e.kind)}{e.status ? ` · ${t.statusWord(e.status)}` : ''}</span> {e.text}{e.asks?.length ? <span className="meta"> ({e.asks.join(', ')})</span> : null}</div>
              {e.who && e.kind !== 'status' && <div className="meta">→ {e.who}</div>}
              {e.why && <div className="meta"><span className="strong">{t.why}</span> {e.why}</div>}
              {e.expect && <div className="meta"><span className="strong">{t.expects}</span> {e.expect}</div>}
              {e.goal && title(e.goal) && <div className="meta req-goal-tag"># {title(e.goal)}</div>}
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

export function RequestsPage() {
  const t = useT(M)
  const { snap, colors, now } = useApp()
  const [v, setV] = useState<LedgerView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [open, setOpen] = useState<string | null>(null)
  const last = useRef(0)
  const load = useCallback(() => api.ledger().then((r) => { last.current = Date.now(); setV(r); setErr(null) }).catch((e) => setErr((e as Error).message)), [])
  useEffect(() => void load(), [snap.asksOpen, load])
  useEffect(() => {
    if (Date.now() - last.current > 8000) void load()
  }, [snap.version, load])

  const act = (a: Ask) => (action: 'done' | 'drop' | 'open') => void api.askAction(a.id, action).then(load).catch((e) => setErr((e as Error).message))

  const asks = v?.asks ?? []
  const live = asks.filter((a) => a.status === 'open' || a.status === 'dispatched')
  const closed = asks.filter((a) => a.status === 'done' || a.status === 'dropped').sort((x, y) => (y.closedAt ?? y.at) - (x.closedAt ?? x.at))
  const stale = live.filter((a) => a.stale).length
  // Stale first, then newest.
  const order = (l: Row[]) => [...l].sort((x, y) => Number(y.stale) - Number(x.stale) || y.at - x.at)
  const goals = (v?.goals ?? []).filter((g) => g.status === 'active')
  const row = (a: Row) => <AskRow key={a.id} a={a} now={now} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onAction={act(a)} />
  const meta = v ? [t.openCount(live.length), stale ? t.staleCount(stale) : ''].filter(Boolean).join(' · ') : '…'

  return (
    <Shell slot={colors.__foot ?? 'p3'} kicker="weevboss" title={t.title} meta={meta}>
      {err && (
        <Notice eventId={noticeKey('error:requests', location.pathname, location.hash, err)} className="band invert" role="alert">
          <div className="in meta" style={{ paddingBlock: 12 }}>! {err}</div>
        </Notice>
      )}
      <div className="in req-tabs" role="tablist">
        {([['open', t.tabOpen], ['done', t.tabDone], ['trace', t.tabTrace]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'open' && v && (
        <>
          {goals.map((g) => {
            const mine = order(live.filter((a) => a.goal === g.id))
            return (
              <section key={g.id} className="req-group">
                <GoalHead g={g} />
                {mine.map(row)}
              </section>
            )
          })}
          {live.some((a) => !a.goal || !goals.some((g) => g.id === a.goal)) && (
            <section className="req-group">
              <div className="in meta strong req-day">{t.noGoal}</div>
              {order(live.filter((a) => !a.goal || !goals.some((g) => g.id === a.goal))).map(row)}
            </section>
          )}
          {!!v.pending.length && (
            <section className="req-group">
              <div className="in meta strong req-day">{t.reading}</div>
              {v.pending.map((p) => (
                <div key={p.cid} className="in req-pending">
                  <span className="st" aria-hidden>…</span>
                  <span className="req-quote small">“{p.text}”</span>
                </div>
              ))}
            </section>
          )}
          {!live.length && !v.pending.length && <div className="in meta req-empty">{t.nothingOpen}</div>}
        </>
      )}
      {tab === 'done' && v && (closed.length ? closed.map(row) : <div className="in meta req-empty">{t.nothingDone}</div>)}
      {tab === 'trace' && v && <TraceList trace={v.trace} goals={v.goals} />}
      <div style={{ height: 96 }} />
    </Shell>
  )
}
