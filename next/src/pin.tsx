import { useEffect, useState } from 'react'
import { Icon } from '../../src/ui/icons.tsx'
import { useT } from '../../src/i18n'
import SR from '../../src/i18n/side-rows.ts'

/** The small thin pin of a drawer pinned in the side bar, between its icon and its name (never on weevils, Your
 *  factory or settings, always there). Unpinning takes two taps, never one stray one: the first asks (« unpin? »
 *  beside the pin, a few seconds), the second takes the drawer out of the side bar at once (it stays in Your factory,
 *  one switch away). It sits inside the row's own button, so it is a span that takes its tap and keeps it from the row. */
export function PinMark({ onUnpin, name }: { onUnpin?: () => void; name?: string }) {
  const t = useT(SR)
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const off = () => setAsking(false)
    const timer = setTimeout(off, 4000)
    // A tap anywhere else is a no.
    const away = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.nx-pin-asking')) off() }
    document.addEventListener('pointerdown', away, true)
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', away, true) }
  }, [asking])
  if (!onUnpin) return <span className="nx-pin" aria-label="pinned"><Icon name="pin" /></span>
  const tap = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation()
    e.preventDefault()
    navigator.vibrate?.(6)
    if (!asking) return setAsking(true)
    setAsking(false)
    onUnpin()
  }
  return (
    <span className={`nx-pin nx-pin-tap ${asking ? 'nx-pin-asking' : ''}`} role="button" tabIndex={0} aria-label={`${asking ? t.unpinSure : t.unpin} ${name ?? ''}`.trim()}
      onClick={tap} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') tap(e) }}>
      <Icon name="pin" />
      {asking && <span className="nx-pin-ask">{t.unpinAsk}</span>}
    </span>
  )
}
