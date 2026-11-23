// Real wins (shared/api.ts Win): decided from runtime state only, never from what a message says. The app celebrates
// each one once (src/ui/celebrate.ts).
import type { Win } from './api.ts'
import type { Ask } from './ledger.ts'

/** A request verified done: closed done, with a commit that landed for it as evidence. */
export function askWin(a: Pick<Ask, 'id' | 'status' | 'closedAt' | 'dispatches'>): Win | undefined {
  if (a.status !== 'done' || !a.closedAt || !a.dispatches.some((d) => !!d.evidence)) return undefined
  return { id: `done:${a.id}`, kind: 'done', at: a.closedAt }
}
