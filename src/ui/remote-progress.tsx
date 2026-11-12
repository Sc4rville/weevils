import { useEffect, useState } from 'react'
import type { SessionProgress } from '../../shared/api'
import { useT, intlLocale } from '../i18n'
import M from '../i18n/remote-progress'
import { useApp } from './app-context'
import { Icon } from './icons'

/** A live observer is not evidence that the remote job is advancing. */
export function progressPhase(p: SessionProgress, now: number, offline = false) {
  if (p.state === 'done' || p.state === 'error') return p.state
  if (offline) return 'offline'
  const age = now - p.updatedAt
  if (!Number.isFinite(age) || age < -30000 || age > p.staleAfterMs) return 'stale'
  const deltaAge = p.lastProgressAt == null ? Infinity : now - p.lastProgressAt
  return p.state === 'working' && deltaAge >= -30000 && deltaAge <= 90000 ? 'working' : 'waiting'
}
const timestamp = (at: number) => new Date(at).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
export function RemoteProgress({ progress: p, agentWorking, secondary: subordinate = false }: { progress: SessionProgress; agentWorking?: boolean; secondary?: boolean }) {
  const t = useT(M)
  const { offline } = useApp()
  // Independent of SSE: an interrupted connection cannot leave an infinite animation on screen.
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = window.setInterval(tick, 5000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])
  const phase = progressPhase(p, Math.max(now, Date.now()), offline)
  const historical = !Number.isFinite(p.updatedAt) || Date.now() - p.updatedAt > p.staleAfterMs
  const secondary = subordinate || agentWorking === true || phase === 'done' || phase === 'stale' || phase === 'offline' || historical
  const completed = p.completed != null && Number.isFinite(p.completed) ? Math.max(0, p.completed) : null
  const total = p.total != null && Number.isFinite(p.total) && p.total > 0 ? p.total : null
  // Older snapshots carried localized prose. Extract only its numeric fact, never show stale-language labels.
  const legacyVerified = /^(\d+) (?:images vérifiées et récupérées|images verified and downloaded|verified frames)$/.exec(p.detail ?? '')
  const verified = p.verified ?? (legacyVerified ? Number(legacyVerified[1]) : null)
  const number = (n: number) => new Intl.NumberFormat(intlLocale()).format(n)
  const reason = p.pauseReason === 'worker-stopped' ? t.workerStopped : p.pauseReason === 'capacity' ? t.capacity : p.pauseReason === 'retry-stopped' ? t.retryStopped : t.pausedUnknown
  return <section className="remote-progress in" data-progress-state={phase} data-progress-secondary={secondary} aria-label={t.source}>
    <details className="remote-progress-details">
      <summary className="remote-progress-title">{!secondary && <span className={phase === 'working' ? 'spin fluo' : ''} aria-hidden><Icon name={phase === 'working' ? 'star' : 'pause'} /></span>}<span className={secondary ? 'meta' : 'strong'} role={secondary ? undefined : 'status'}>{secondary ? t.details : t[phase]}</span><span className="remote-progress-chevron" aria-hidden><Icon name="chevron" dir="down" /></span></summary>
      <div className="remote-progress-facts">
        {secondary && <p>{t[phase]}</p>}
        {historical && <p className="meta">{t.historical}</p>}
        {phase === 'error' && secondary && <p>{reason}</p>}
        {completed !== null && <div>{total === null ? t.reported(number(completed)) : t.fraction(number(completed), number(total))}</div>}
        {completed !== null && total !== null && <progress value={Math.min(completed, total)} max={total} aria-label={t.reported(number(completed))} />}
        {verified != null && Number.isFinite(verified) && <div>{t.verified(number(verified))}</div>}
        <div className="meta">{Number.isFinite(p.updatedAt) ? <time dateTime={new Date(p.updatedAt).toISOString()}>{t.observed(timestamp(p.updatedAt))}</time> : t.unknown}</div>
        {p.lastProgressAt != null && Number.isFinite(p.lastProgressAt) && <div className="meta"><time dateTime={new Date(p.lastProgressAt).toISOString()}>{t.advanced(timestamp(p.lastProgressAt))}</time></div>}
        {phase === 'working' && agentWorking === false && <p className="meta">{t.independent}</p>}
      </div>
    </details>
    {phase === 'error' && !secondary && <p className="remote-progress-reason">{reason}</p>}
  </section>
}
