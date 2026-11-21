// TEMPORARY (2026-11-21): a shortcut to the new interface while it is being tried, the mirror of the « Classic weevils »
// row the new one has in its settings. Shown only when the server names its address (WEEVILS_NEXT_URL). To remove:
// delete this file, its one line in FootBand (src/ui/bands.tsx), `nextUrl` in the snapshot config and its i18n key.
import { Line } from './bits'
import { Icon } from './icons'
import { useApp } from './app-context'
import { useT } from '../i18n'
import M from '../i18n/bands'

export function NextShortcut() {
  const t = useT(M)
  const { snap } = useApp()
  const url = snap.config.nextUrl
  if (!url) return null
  return (
    <Line ch={<Icon name="external" />} go={null} onClick={() => { window.location.href = url }}>
      {t.nextShortcut}
    </Line>
  )
}
