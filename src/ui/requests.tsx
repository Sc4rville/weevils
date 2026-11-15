// The requests page (bottom of the machines band): weevboss's request ledger, read by the user in plain words.
//
// - « open »: the goals, each with its progress and its open requests (stale ones first), then the requests with no
//   goal, then the messages still being read, then what was done lately, folded. Each request is one compact line: its
//   title, a status chip (queued, running, blocked, needs you, done), a progress hint (steps, last update, why it
//   waits) and the session it is in (a tap opens it). It opens in place: every message merged into it with the user's
//   exact words, why it is handled that way, where it was sent, what came back; « done » and « drop » close it.
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

/** « weevils · claude · Onboarding link » → « weevils · Onboarding link » ; no label: a plain word, never a session id. */
const who = (d: Dispatch, none: string) => {
  const p = (d.label ?? '').split(' · ')
  return p.length >= 3 ? `${p[0]} · ${p.slice(2).join(' · ')}` : d.label || none
}

type Chip = 'queued' | 'running' | 'blocked' | 'needs' | 'done' | 'dropped'

/** The one word that says where a request stands. Exported for tests. */
export function chipOf(a: Row): Chip {
  if (a.status === 'done') return 'done'
  if (a.status === 'dropped') return 'dropped'
  if (a.dispatches.some((d) => d.outcome === 'question')) return 'needs'
  if (a.dispatches.some((d) => d.outcome === 'failed')) return 'blocked'
  if (a.status === 'dispatched') return 'running'
  return 'queued'
}

/** The progress hint after the chip: steps, the last real update and when, or why it waits. */
function useHint() {
  const t = useT(M)
  const age = useAge()
  return (a: Row, now: number) => {
    const parts: string[] = []
    const n = a.dispatches.length
    if (a.status === 'done' || a.status === 'dropped') {
      const by = a.closedBy === 'auto' ? t.closedByAuto : a.closedBy === 'user' ? t.closedByYou : t.closedByBoss
      return [by, a.closedAt ? age(now - a.closedAt) : ''].filter(Boolean).join(' · ')
    }
    if (n > 1) parts.push(t.steps(a.dispatches.filter((d) => d.outcome === 'done').length, n))
    if (a.status === 'open') parts.push(a.handling === 'send' ? `${t.whyWord(a.why ?? 'you-said-now')} · ${t.sendingNow}` : t.whyWord(a.why ?? 'waits-for-weevboss'))
    if (a.more?.length) parts.push(t.messages(a.more.length + 1))
    const last = Math.max(a.progressAt, ...a.dispatches.map((d) => d.reportAt ?? 0))
    parts.push(a.stale ? t.quiet(age(now - last)) : t.updated(age(now - last)))
    return parts.join(' · ')
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
  const hint = useHint()
  const live = a.status === 'open' || a.status === 'dispatched'
  const chip = chipOf(a)
  // The session to open: the one that needs the user or is stuck, else the latest.
  const d = a.dispatches.find((x) => x.outcome === 'question') ?? a.dispatches.find((x) => x.outcome === 'failed') ?? a.dispatches.at(-1)
  const words = [{ quote: a.quote, at: a.at, from: a.from }, ...(a.more ?? [])]
  return (
    <motion.div layout="position" transition={spring} className={`req-item c-${chip}${open ? ' band tone open' : ''}${a.stale ? ' stale' : ''}`}>
      <div className="in req-line">
        <button className="req-main" onClick={onToggle} aria-expanded={open}>
          <span className="req-text">{a.text}</span>
          <span className="meta req-status">
            <span className={`req-chip c-${chip}`}>{t.chip(chip)}</span>
            <span className="req-hint">{hint(a, now)}</span>
          </span>
        </button>
        {d && <button type="button" className="link req-sess" aria-label={t.openSession} onClick={() => push({ kind: 'session', id: d.session })}>{who(d, t.aSession)} →</button>}
      </div>
      <Collapse open={open}>
        <div className="in req-detail">
          {words.map((w, i) => (
            <div key={i} className="req-said">
              <blockquote className="req-quote">“{w.quote}”</blockquote>
              <div className="meta">{i === 0 ? t.yourWords : ''}{w.from !== 'user' ? ` · ${t.from(w.from)}` : ''}{i === 0 ? ' · ' : ''}{hhmm(w.at)}</div>
            </div>
          ))}
          {a.why && a.status === 'open' && <div className="meta req-why"><span className="strong">{t.why}</span> {t.whyWord(a.why)}</div>}
          {a.dispatches.map((d) => (
            <div key={d.session + d.at} className="req-dispatch">
              <button type="button" className="link req-who" onClick={() => push({ kind: 'session', id: d.session })}>→ {who(d, t.aSession)}</button>
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
  const [showDone, setShowDone] = useState(false)
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
  const recent = closed.filter((a) => a.status === 'done' && now - (a.closedAt ?? a.at) < 86400_000)
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
          {!!recent.length && (
            <section className="req-group">
              <button className="in meta strong req-day req-fold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? '−' : '+'} {t.doneRecent(recent.length)}</button>
              <Collapse open={showDone}>{recent.map(row)}</Collapse>
            </section>
          )}
        </>
      )}
      {tab === 'done' && v && (closed.length ? closed.map(row) : <div className="in meta req-empty">{t.nothingDone}</div>)}
      {tab === 'trace' && v && <TraceList trace={v.trace} goals={v.goals} />}
      <div style={{ height: 96 }} />
    </Shell>
  )
}
