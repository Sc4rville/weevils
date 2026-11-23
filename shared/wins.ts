// Real wins (shared/api.ts Win): decided from runtime state only, never from what a message says. The app celebrates
// each one once (src/ui/celebrate.ts).
import type { Win } from './api.ts'
import type { Ask } from './ledger.ts'

/** A request verified done: closed done, with a commit that landed for it as evidence. */
export function askWin(a: Pick<Ask, 'id' | 'status' | 'closedAt' | 'dispatches'>): Win | undefined {
  if (a.status !== 'done' || !a.closedAt || !a.dispatches.some((d) => !!d.evidence)) return undefined
  return { id: `done:${a.id}`, kind: 'done', at: a.closedAt }
}

/** weevboss marks a result it verified: `[[win]]**the phrase**`. The app colours that bold phrase and celebrates the
 *  message once; everywhere else (voice, notifications, copies, For you) the marker is dropped and the bold stays. */
export const WIN_MARK = /\[\[win\]\][ \t]?/g
const SAID = /\[\[win\]\][ \t]?\*\*(?=\S)[^\n]+?\*\*/
export const saysWin = (text: string): boolean => SAID.test(text)
export const withoutWinMarks = (text: string): string => (text.includes('[[win]]') ? text.replace(WIN_MARK, '') : text)

/** Wins close together are one moment (a move's own line and weevboss saying it, a ✅ and its announcement): within
 *  this window they share the first one's id, so the app celebrates once. */
export const WIN_GROUP_MS = 3 * 60_000

/**
 * weevboss's thread: its replies that mark a verified result get their win (said), then the wins of one moment are
 * grouped. Ids stay stable as later messages arrive (a win only ever takes the id of an earlier one).
 */
export function threadWins<T extends { id: string; role: string; text: string; at: number; devil?: boolean; win?: Win }>(msgs: T[]): T[] {
  let first: Win | undefined
  return msgs.map((m) => {
    const said = !m.win && m.role === 'assistant' && !m.devil && saysWin(m.text) ? { id: `said:${m.id}`, kind: 'said' as const, at: m.at } : undefined
    const win = m.win ?? said
    if (!win) return m
    if (first && win.at - first.at >= 0 && win.at - first.at < WIN_GROUP_MS) return { ...m, win: { ...win, id: first.id } }
    first = win
    return said ? { ...m, win } : m
  })
}
