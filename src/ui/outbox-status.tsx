import { useState } from 'react'
import { useOutbox } from '../outbox'
import { useT } from '../i18n'
import M from '../i18n/outbox'
import { copyText } from './copy'
const recoverable = (status: string) => ['failed', 'uncertain', 'sending'].includes(status)
/** Acceptance is a server receipt, never a claim that the agent read or answered the message. */
export function OutboxStatus({ scope, eventId }: { scope: string; eventId?: string }) {
 const rows = useOutbox()
 const t = useT(M)
 const [copied, setCopied] = useState('')
 const relevant = rows.filter(r => r.url.startsWith(scope) && (!eventId || !r.eventId || r.eventId === eventId))
 const visible = relevant.filter(r => r.status !== 'delivered').slice(-3)
 if (!visible.length) return null
 return <div className="outbox-status in" aria-live="polite">{visible.map(r => <div key={r.messageId} data-delivery={r.status}>
  <span>{t[r.status]}{r.trackingLost ? ` · ${t.trackingLost}` : ''}</span>
  {r.error && <span className="meta"> · {r.error}</span>}
  {r.text && recoverable(r.status) && <button type="button" className="link" onClick={() => void copyText(r.text!).then(ok => ok && setCopied(r.messageId))}>{copied === r.messageId ? t.copied : t.recover}</button>}
 </div>)}</div>
}
