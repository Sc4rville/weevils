import { useState } from 'react'
import { forgetReceipt, useOutbox } from '../outbox'
import { useT } from '../i18n'
import M from '../i18n/outbox'
import { copyText } from './copy'
const recoverable = (status: string) => ['failed', 'uncertain', 'sending'].includes(status)
/** A reply is not delivery evidence. Only an exact receipt or identical payload with confirmed delivery resolves an error. */
export function OutboxStatus({ scope, eventId }: { scope: string; eventId?: string }) {
 const rows = useOutbox()
 const t = useT(M)
 const [copied, setCopied] = useState('')
 // Old receipts may contain obsolete advice to open a new session. Keep recovery in the existing conversation.
 const errorText = (error: string) => /^(This session was opened elsewhere,|Cette session a été ouverte ailleurs,)/.test(error) ? t.unavailable : error
 const relevant = rows.filter(r => r.url.startsWith(scope) && (!eventId || !r.eventId || r.eventId === eventId))
 const visible = relevant.filter(r => !r.dismissed && r.status !== 'delivered' && !(r.status === 'failed' && r.fingerprint && relevant.some(done => done.status === 'delivered' && done.fingerprint === r.fingerprint && done.updatedAt >= r.updatedAt)))
 if (!visible.length) return null
 return <div className="outbox-status in" aria-live="polite">{visible.map(r => {
  const problem = r.status === 'failed' || r.status === 'uncertain'
  return <details key={r.messageId} data-delivery={r.status}>
   <summary>{t[r.status]}{r.text && <span className="outbox-excerpt"> — {r.text.slice(0, 100)}{r.text.length > 100 ? '…' : ''}</span>}</summary>
   {r.text && <blockquote>{r.text}</blockquote>}
   {r.error && <p className="meta">{errorText(r.error)}</p>}
   <div className="outbox-recovery">
    {r.text && recoverable(r.status) && <button type="button" className="link" onClick={() => void copyText(r.text!).then(ok => ok && setCopied(r.messageId))}>{copied === r.messageId ? t.copied : t.recover}</button>}
    {problem && <button type="button" className="link" aria-label={t.closeError} onClick={() => forgetReceipt(r.messageId)}>{t.closeError}</button>}
   </div>
  </details>
 })}</div>
}
