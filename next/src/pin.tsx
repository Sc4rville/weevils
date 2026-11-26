import { Icon } from '../../src/ui/icons.tsx'

/** The small thin pin of a drawer pinned in the side bar, between its icon and its name (never on weevils or Your
 *  factory, always there). A tap on it unpins: the drawer leaves the side bar at once (it stays in Your factory, one
 *  switch away). It sits inside the row's own button, so it is a span that takes its tap and keeps it from the row. */
export function PinMark({ onUnpin, name }: { onUnpin?: () => void; name?: string }) {
  if (!onUnpin) return <span className="nx-pin" aria-label="pinned"><Icon name="pin" /></span>
  const unpin = (e: { stopPropagation: () => void; preventDefault: () => void }) => { e.stopPropagation(); e.preventDefault(); navigator.vibrate?.(6); onUnpin() }
  return (
    <span className="nx-pin nx-pin-tap" role="button" tabIndex={0} aria-label={`Unpin ${name ?? ''}`.trim()}
      onClick={unpin} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') unpin(e) }}>
      <Icon name="pin" />
    </span>
  )
}
