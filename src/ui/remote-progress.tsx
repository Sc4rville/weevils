import { useEffect, useState } from 'react'
import type { SessionProgress } from '../../shared/api'
import { useT, getLang } from '../i18n'
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
const timestamp = (at: number) => new Date(at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export function RemoteProgress({ progress: p, agentWorking }: { progress: SessionProgress; agentWorking?: boolean }) {
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
  const completed = p.completed != null && Number.isFinite(p.completed) ? Math.max(0, p.completed) : null
  const total = p.total != null && Number.isFinite(p.total) && p.total > 0 ? p.total : null
  return <section className="remote-progress in" data-progress-state={phase} aria-label={t.source}>
    <div className="meta remote-progress-source">{t.source}{agentWorking === undefined ? '' : ` · ${agentWorking ? t.active : t.idle}`}</div>
    <div className="remote-progress-title"><span className={phase === 'working' ? 'spin fluo' : ''} aria-hidden><Icon name={phase === 'done' ? 'check' : phase === 'working' ? 'star' : 'arrow'} /></span><strong>{p.label}</strong></div>
    <div className="remote-progress-state" role="status">{t[phase]}</div>
    {completed !== null && <div>{total === null ? t.reported(completed) : t.fraction(completed, total)}</div>}
    {completed !== null && total !== null && <progress value={Math.min(completed, total)} max={total} aria-label={t.reported(completed)} />}
    {p.detail && <div>{p.detail}</div>}
    <div className="meta">{Number.isFinite(p.updatedAt) ? <time dateTime={new Date(p.updatedAt).toISOString()}>{t.observed(timestamp(p.updatedAt))}</time> : t.unknown}</div>
    {p.lastProgressAt != null && Number.isFinite(p.lastProgressAt) && <div className="meta"><time dateTime={new Date(p.lastProgressAt).toISOString()}>{t.advanced(timestamp(p.lastProgressAt))}</time></div>}
  </section>
}
