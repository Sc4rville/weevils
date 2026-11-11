import { useState } from 'react'
import { forgetReceipt, useOutbox } from '../outbox'
import { useT } from '../i18n'
import M from '../i18n/outbox'
import { copyText } from './copy'
import { useApp } from './app-context'
const recoverable = (status: string) => ['failed', 'uncertain', 'sending'].includes(status)
/** Acceptance is a server receipt, never a claim that the agent read or answered the message. */
export function OutboxStatus({ scope, unresolvedOnly = false, eventId }: { scope: string; unresolvedOnly?: boolean; eventId?: string }) {
 const rows = useOutbox()
 const t = useT(M)
 const { push } = useApp()
 const [copied, setCopied] = useState('')
 const relevant = rows.filter(r => r.url.startsWith(scope) && (!eventId || !r.eventId || r.eventId === eventId))
 const latest = relevant.at(-1)
 const visible = relevant.filter(r => r.status !== 'delivered' || (!unresolvedOnly && r === latest)).slice(-3)
 if (!visible.length) return null
 return <div className="outbox-status in" aria-live="polite">{visible.map(r => <div key={r.messageId} data-delivery={r.status}>
  <span>{t[r.status]}{r.trackingLost ? ` · ${t.trackingLost}` : ''}</span>
  {r.error && <span className="meta"> · {r.error}</span>}
  {r.text && recoverable(r.status) && <button type="button" className="link" onClick={() => void copyText(r.text!).then(ok => ok && setCopied(r.messageId))}>{copied === r.messageId ? t.copied : t.recover}</button>}
  {r.status === 'delivered' && r.result?.id && <button type="button" className="link" onClick={() => push({ kind: 'session', id: r.result!.id! })}>{t.open}</button>}
  {r.status === 'delivered' && <button type="button" className="link" onClick={() => forgetReceipt(r.messageId)}>{t.dismiss}</button>}
 </div>)}</div>
}
