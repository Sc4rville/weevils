import { useState } from 'react'
import { markHandedOver, retryReceipt, useOutbox, type LocalReceipt } from '../outbox'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/outbox'
import { useApp } from './app-context'
import { Icon } from './icons'

/** The server never took it and nothing is trying any more: a confirmed « not sent ». */
const notSent = (r: LocalReceipt) => r.status === 'sending' && !!r.stuck
/** The session a message went to, from its address. */
const sessionOf = (url: string) => { const m = /^\/api\/sessions\/([^/]+)\//.exec(url); return m ? decodeURIComponent(m[1]) : undefined }
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * A message that did not reach its agent: the person's own bubble, red, with one short line naming the problem and
 * « Notify weevboss » (Scarville, 2026-11-21: « juste mon message apparaît rouge et c écrit delivery problem »). Only a
 * confirmed failure speaks: a slow or unconfirmed send stays silent, and a message that arrived never shows here. No
 * toast, no notification. Once weevboss has it, the line goes quiet; once the text shows up in the thread, it is gone.
 * `seen`: the thread's messages, to know when the text finally arrived there.
 */
export function OutboxStatus({ scope, eventId, seen = [] }: { scope: string; eventId?: string; seen?: { text: string; at: number; role?: string }[] }) {
  const rows = useOutbox()
  const t = useT(M)
  // Outside the app (a test, a page of its own) there is no session list: the note links the bare id.
  let app: ReturnType<typeof useApp> | undefined
  try { app = useApp() } catch { app = undefined }
  const [busy, setBusy] = useState('')
  const [notifyError, setNotifyError] = useState('')
  const relevant = rows.filter(r => r.url.startsWith(scope) && (!eventId || !r.eventId || r.eventId === eventId))
  // Arrived: the person's text shows up in the thread after it was sent, as their message or inside a brief that
  // carries it (weevboss got it there). A short text (« ?? ») must be the whole message: it is in too many others.
  const arrived = (r: LocalReceipt) => {
    const want = norm(r.text ?? '')
    if (!want) return false
    return seen.some(m => (!m.role || m.role === 'user' || m.role === 'orchestrator') && m.at >= (r.acceptedAt ?? r.updatedAt) - 1000
      && (want.length < 12 ? norm(m.text).replace(/^\[from:[^\]]+\]\s*/, '') === want : norm(m.text).includes(want)))
  }
  const superseded = (r: LocalReceipt) => !!r.fingerprint && relevant.some(done => done.messageId !== r.messageId && done.status === 'delivered' && done.fingerprint === r.fingerprint && done.updatedAt >= r.updatedAt)
  const visible = relevant.filter(r => !r.dismissed && (r.status === 'failed' || notSent(r)) && !superseded(r) && !arrived(r))
  if (!visible.length) return null
  const cause = (r: LocalReceipt) => notSent(r) ? t.notSentCause : r.cause === 'unreachable' ? t.unreachableCause : r.cause === 'offline' ? t.offlineCause : t.deliveryProblem
  const notify = (r: LocalReceipt) => {
    const id = sessionOf(r.url)
    const title = id ? app?.snap?.sessions?.find(s => s.id === id)?.title : undefined
    const where = id ? `[${title || id.slice(0, 8)}](/#s=${id})` : r.url.startsWith('/api/foryou/') ? '[For you](/#foryou)' : 'weevboss'
    setBusy(r.messageId); setNotifyError('')
    void api.main(t.note(where, cause(r), r.messageId, r.text ?? ''))
      .then(() => markHandedOver(r.messageId))
      .catch(() => setNotifyError(r.messageId))
      .finally(() => setBusy(b => b === r.messageId ? '' : b))
  }
  return <div className="outbox-status" aria-live="polite">{visible.map(r => {
    // To weevboss itself, or never taken by the server: weevboss can't be the way round, the same send is. A reply under
    // a For you post that did not reach its session goes to weevboss like a session message.
    const direct = notSent(r) || r.url.startsWith('/api/main')
    return <div key={r.messageId} className="msg band tone delivery-failed" data-delivery={r.status}>
      <div className="in">
        <span className="who">{t.you}</span>
        {r.text && <p className="delivery-text">{r.text}</p>}
        <p className="delivery-line">
          <span className="delivery-cause">{r.handedOver ? t.onIt : cause(r)}</span>
          {!r.handedOver && (direct
            ? <button type="button" className="link delivery-act" disabled={busy === r.messageId} onClick={() => { setBusy(r.messageId); void retryReceipt(r.messageId).catch(() => undefined).finally(() => setBusy('')) }}>{t.retry} <Icon name="arrow" dir="right" /></button>
            : <button type="button" className="link delivery-act" disabled={busy === r.messageId} onClick={() => notify(r)}>{notifyError === r.messageId ? t.notifyFailed : t.notify} <Icon name="arrow" dir="right" /></button>)}
        </p>
      </div>
    </div>
  })}</div>
}
