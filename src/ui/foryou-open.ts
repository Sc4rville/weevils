// Where a tap in For you leads (a post's « Look », an action's result). One rule for the classic app and next: a
// target either resolves to something that is really there, or the post offers no button for it. Never a dead tap.
import { useCallback, useRef } from 'react'
import type { Snapshot } from '../../shared/api.ts'
import type { ForYouOpen } from '../../shared/foryou'
import { useApp, type Page } from './app-context'
import { focusBoss } from './follow'

/** page: one of the app's own pages · boss: weevboss's thread · autos: the list of what runs on its own. */
export type OpenStep = { to: 'page'; page: Page } | { to: 'boss'; mid?: string } | { to: 'autos' }

/**
 * What a target leads to on this snapshot. An automation opens on its own page (where its facts and its talk are);
 * one that no longer exists, or a target that names none, opens the list of automations. null: a target this app does not know (a newer server): the post then shows no button for it.
 */
export function resolveOpen(target: ForYouOpen | undefined, snap: Pick<Snapshot, 'optimizers' | 'h24'>, projectId?: string): OpenStep | null {
  if (!target) return null
  switch (target.page) {
    case 'session': return target.id ? { to: 'page', page: { kind: 'session', id: target.id } } : null
    case 'boss': return { to: 'boss', ...(target.mid ? { mid: target.mid } : {}) }
    case 'auto': {
      const id = target.id
      const there = !!id && ((snap.optimizers ?? []).some((o) => o.id === id && o.state !== 'refused') || (snap.h24 ?? []).some((a) => a.id === id))
      return there ? { to: 'page', page: { kind: 'auto', id: id! } } : { to: 'autos' }
    }
    case 'usage': return { to: 'page', page: { kind: 'usage' } }
    case 'machine': return { to: 'page', page: { kind: 'machine', projectId: projectId ?? '' } }
    // A destination added to ForYouOpen without a rule above does not compile; one a newer server sends is nowhere.
    default: return nowhere(target)
  }
}
const nowhere = (_unknown: never): null => null

/** What the host app does for each step: every one is required, none may be a stand-in that does nothing. */
export interface OpenHandlers {
  page: (page: Page) => void
  boss: (mid?: string) => void
  autos: () => void
}
export function runOpen(step: OpenStep, h: OpenHandlers) {
  if (step.to === 'page') h.page(step.page)
  else if (step.to === 'boss') h.boss(step.mid)
  else h.autos()
}

/** Navigate to a server-confirmed existing destination; never create or dispatch work. False: nowhere to go. */
export function useForYouOpen() {
  const { push, home, setH24Open, snap } = useApp()
  // The snapshot of the moment of the tap, without a new callback at each snapshot.
  const now = useRef(snap)
  now.current = snap
  return useCallback((target: ForYouOpen, projectId?: string): boolean => {
    const step = resolveOpen(target, now.current, projectId)
    if (!step) return false
    runOpen(step, {
      page: push,
      boss: (mid) => focusBoss({ mid, flash: !!mid }),
      // The classic app's drawer; next opens its side bar on the same call (next/src/main.tsx).
      autos: () => { home(); setH24Open(true) },
    })
    return true
  }, [push, home, setH24Open])
}
