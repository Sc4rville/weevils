// TEMPORARY (2026-11-21): a one-tap shortcut to the new interface while it is being tried, in weevboss's top bar beside
// the sleep button. Shown only when the server names its address (WEEVILS_NEXT_URL). To remove: delete this file, its
// one line in src/ui/bands.tsx, `nextUrl` in the snapshot config (server/core.ts, shared/api.ts, shared/setup.ts) and
// its i18n key.
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
    <a className="next-shortcut" href={url} aria-label={t.nextShortcut} title={t.nextShortcut} onClick={(e) => e.stopPropagation()}>
      <Icon name="external" />
    </a>
  )
}
