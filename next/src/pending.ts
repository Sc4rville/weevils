// Your message's stand-in in weevils next: shown the moment you send, until the server's own copy is in the thread.
// The server's copy is never the typed text as is: a photo or a file adds « (photo: /path) » or « (fichier : /path) »,
// weevils adds its ⟦weevils…⟧ context, and the snapshot keeps only the last messages. So a stand-in is not matched on
// its text alone or on a count: it ends when a user message the thread did not have when you sent arrives with the
// same words, or when as many new user messages as stand-ins up to this one have arrived (queued sends, a delayed
// outbox, a reload all keep that order). The server's copy then sits in its true place, its reply under it.
import type { Message } from '../../shared/api.ts'
import { userCaption } from '../../src/ui/format.ts'

export type Pending = { key: string; text: string; photos: string[]; known: Set<string> }

/** The words of a message you wrote, without what was attached or added to it. */
export const words = (text: string) =>
  userCaption(text).replace(/\((?:photo|fichier|file)\s*:\s*\/[^)\n]+\)/g, '').replace(/\s+/g, ' ').trim()

export function stillPending(pending: Pending[], messages: Message[]): Pending[] {
  const mine = messages.filter((m) => m.role === 'user')
  const taken = new Set<string>()
  return pending.filter((p, i) => {
    const fresh = mine.filter((m) => !p.known.has(m.id))
    const same = fresh.find((m) => !taken.has(m.id) && words(m.text) === words(p.text))
    if (same) { taken.add(same.id); return false }
    return fresh.length < i + 1
  })
}
