// The requests band of the side bar (main.tsx SideBar): the person's open requests, one tap away. It sits right under
// weevboss's head, above its sessions, so it is seen without scrolling however long that list is (where weevils' own
// repo is a project, weevboss's band takes it as its `under`); on any other install, right after the lone weevboss
// button. Always before the other projects. Until 2026-11-26 the only way in was a line at the bottom of the settings
// band, folded, below theme and language (four taps and two scrolls); that line stays, this is a second way in. In a
// file of its own because main.tsx mounts the app when it is imported: here the band can be drawn alone
// (requests-band.test.tsx).
import type { CSSProperties } from 'react'
import type { Snapshot } from '../../shared/api.ts'
import { useT } from '../../src/i18n/index.ts'
import M from '../../src/i18n/requests.ts'
import type { Page } from '../../src/ui/app-context.tsx'
import { G } from '../../src/ui/icons.tsx'
import { drawerOn, drawerPinned } from './factory.tsx'
import { PinMark } from './pin.tsx'

/**
 * Laid out like the other band heads: its mark in the logo's column (the « ! » the settings line wears for requests,
 * in the band's ink), its name under the « w » of weevils, the open count in bold then the « > » of a project's head.
 * The whole band is one tap target: there is nothing to fold, it opens the requests page.
 * color: the slot the requests page itself wears (colors.__foot), so the band and the page it opens are one colour.
 * Shown while there is an open request, or pinned in Your factory (shared/drawers.ts); never where the server keeps
 * no ledger. « N need you » only when the server counts them (Snapshot.asksWaiting; an older server says nothing).
 * A band, never a `.nx-project`: the tour's « your projects » stop points at the first one (tour-stops.ts), and this
 * band sits above every repo's.
 */
export function RequestsBand({ snap, color, page }: { snap: Snapshot; color: string; page: (p: Page) => void }) {
  const t = useT(M)
  if (!drawerOn(snap, 'requests')) return null
  const open = snap.asksOpen ?? 0
  const waiting = snap.asksWaiting ?? 0
  return (
    <section className="nx-requests band" style={{ '--c': `var(--${color})` } as CSSProperties}>
      <button className="nx-project-line nx-requests-line" onClick={() => page({ kind: 'requests' })} aria-label={t.bandLabel(open, waiting)}>
        <span className="nx-row nx-project-head nx-repo-row">
          <span className="nx-repo-mark" aria-hidden><G c="!" />{drawerPinned(snap, 'requests') && <PinMark />}</span>
          <span className="nx-row-text">
            <span className="nx-row-title nx-project-name">{t.menu}</span>
            {waiting > 0 && <span className="nx-row-sub">{t.needYou(waiting)}</span>}
          </span>
        </span>
        <span className="chars" aria-hidden>
          {/* Pinned with nothing open, it keeps its place and shows no number, as the settings line does. */}
          {open > 0 && <span className="nx-requests-count">{open}</span>}
          <span className="ch"><G c=">" /></span>
        </span>
      </button>
    </section>
  )
}
