// What a page shows while its content is on its way: never a blank screen, never an error first. The weevil itself, big,
// in the middle, doing little jumps (2026-11-23), and under it a small turning « syncing… » line (2026-11-26); only after
// a long wait does the line say, calmly, that it is taking longer. Shared by weevils next and the classic app.
import { useEffect, useState } from 'react'
import { WeevbossLogo } from './logo'
import { Icon } from './icons'
import { useT } from '../i18n'
import M from '../i18n/loading'

/** How long content may take before the waiting line says so (calmly). */
export const LONG_WAIT_MS = 20_000

/** true once <on> has held for <ms> without a break (false again as soon as it stops). */
export function useLongWait(on: boolean, ms = LONG_WAIT_MS): boolean {
  const [long, setLong] = useState(false)
  useEffect(() => {
    setLong(false)
    if (!on) return
    const t = setTimeout(() => setLong(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && long
}

/** The small turning « syncing… » line: wherever content has not arrived yet, instead of a blank or an error. */
export function Syncing({ className = '' }: { className?: string }) {
  const t = useT(M)
  const slow = useLongWait(true)
  return (
    <span className={`syncing${className ? ` ${className}` : ''}`} role="status" aria-live="polite">
      <span className="syncing-turn" aria-hidden><Icon name="cycle" /></span>
      <span className="syncing-label">{slow ? t.slow : t.loading}</span>
    </span>
  )
}

export function WeevilLoading({ inline = false }: { inline?: boolean }) {
  return (
    <div className={`weevil-loading${inline ? ' inline' : ''}`}>
      <span className="weevil-loading-hop" aria-hidden><WeevbossLogo className="weevil-loading-logo" /></span>
      <span className="weevil-loading-shadow" aria-hidden />
      <Syncing className="weevil-loading-sync" />
    </div>
  )
}
