// What a page shows while its content is on its way (2026-11-23): never a blank coloured screen. The weevil itself,
// big, in the middle, doing little jumps, from the very first frame; gone the moment the content is there. Its planes
// are the logo's (WeevbossLogo: solid faces in the theme's colours); its shadow is a flat block that shrinks while it is
// in the air. With reduced motion it only breathes. Shared by weevils next and the classic app.
import { WeevbossLogo } from './logo'
import { useT } from '../i18n'
import M from '../i18n/loading'

export function WeevilLoading({ inline = false }: { inline?: boolean }) {
  const t = useT(M)
  return (
    <div className={`weevil-loading${inline ? ' inline' : ''}`} role="status" aria-live="polite">
      <span className="weevil-loading-hop" aria-hidden><WeevbossLogo className="weevil-loading-logo" /></span>
      <span className="weevil-loading-shadow" aria-hidden />
      <span className="weevil-loading-label">{t.loading}</span>
    </div>
  )
}
