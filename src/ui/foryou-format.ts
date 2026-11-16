// « For you » in five layouts. The names are internal and never shown: the stream is one single stream, no kind, no
// speaker, no section. Each stored item (whatever its legacy kind) maps to one of them, or is hidden (never deleted:
// the server keeps its history, only the stream leaves it out).
//   action:   something waiting for the user, one big tap (approve, look, answer)
//   progress: something shipped, a number that moved (big number type)
//   learn:    one concrete sentence worth knowing
//   think:    one short thought to chew on
//   visual:   full-bleed media (saveable to Photos)
import type { ForYouItem } from '../../shared/foryou.ts'

export type ForYouFormat = 'action' | 'progress' | 'learn' | 'think' | 'visual'

/** At most this many items in the stream at once: the page stays light. The server sends at most as many. */
export const STREAM_CAP = 60
/** The longest line a card shows (about two short lines on a phone); the rest stays in the place it opens. */
export const LINE_MAX = 120

const hasVisual = (i: ForYouItem) => !!i.media?.length || !!i.composition || !!i.resultGroup?.final

/** The layout an item takes in the stream, or null when it is hidden (legacy chatter, raw bookkeeping). */
export function formatOf(item: ForYouItem): ForYouFormat | null {
  if (item.work) {
    // Work the user already launched: only its outcome is news; the status chatter in between is not.
    if (item.work.status !== 'completed') return null
    return hasVisual(item) ? 'visual' : 'progress'
  }
  const id = item.id
  switch (item.kind) {
    case 'media':
      if (hasVisual(item)) return 'visual'
      return item.visualProposal ? 'action' : item.text || item.title ? 'progress' : null
    case 'alert':
      return 'action'
    case 'proposals':
      return item.cards?.length ? 'action' : null
    case 'mail':
      return 'action'
    case 'session':
      if (item.tone === 'question' || item.tone === 'alert') return 'action'
      if (item.tone === 'result') return hasVisual(item) ? 'visual' : 'progress'
      return null
    case 'boss':
      if (id.startsWith('auto:go:')) return null
      if (id.startsWith('auto:done:')) return 'progress'
      if (id.startsWith('auto:proposed:') || item.actions?.length) return 'action'
      if (hasVisual(item)) return 'visual'
      return item.text ? 'think' : null
    case 'improve':
      if (item.actions?.length) return 'action'
      return item.text ? 'think' : null
    case 'insight':
      // The token audit is a page of bars, not a sentence to learn from.
      if (id.startsWith('cost:')) return null
      return item.text ? 'learn' : null
    case 'milestone':
      return 'progress'
    case 'stat':
      if (item.recap) return item.recap.lines.length ? 'progress' : null
      // Repeated « saved this week » lines and plain usage bars: not a number that moved.
      if (id.startsWith('cost:')) return null
      return bigNumber(item) ? 'progress' : null
    default:
      return null
  }
}

/** Plain words of a card: no markdown marks, no code spans, one line. */
export function plainLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|~~)/g, '')
    // File paths never reach a card: « ~/x/y.ts », « src/ui/a.tsx », « ./run.sh ».
    .replace(/(?<=^|\s)(?:(?:~|\.{1,2})?\/(?:[\w.-]+\/?)+|(?:[\w.-]+\/)+[\w-]+\.[a-z]{1,5})(?=[\s,;:)]|$)/g, ' ')
    .replace(/^\s*(?:#{1,6}|[-*•>]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One short line: the first sentence when it fits, else cut on a word with an ellipsis. */
export function shortLine(text: string | undefined, max = LINE_MAX): string {
  const line = plainLine(text ?? '')
  if (!line) return ''
  const first = /^[\s\S]*?[.!?…](?=\s|$)/.exec(line)?.[0] ?? line
  const pick = first.length >= 12 && first.length <= max ? first : line
  if (pick.length <= max) return pick
  const cut = pick.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`
}

/** The figure a progress card shows big, and the words that go with it (« 100 » · « turns this week »). */
export function bigNumber(item: ForYouItem): { n: string; rest: string } | null {
  if (item.recap) {
    const done = item.recap.lines.filter((l) => l.state === 'done').length
    return done ? { n: String(done), rest: '' } : null
  }
  const text = plainLine(item.text)
  const m = /(?:^|\s)([+−-]?\d[\d\s.,]*(?:\s?(?:%|k|K|M|×|x))?)(?=\s|$|[.,!])/.exec(text)
  if (!m || !/\d/.test(m[1])) return null
  const n = m[1].trim().replace(/[.,]$/, '')
  const rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/^[\s:·,-]+|[\s:·,]+$/g, '').trim()
  return { n, rest }
}

/** The one line a card says: its title when it has one that says it, else its words. */
export function cardLine(item: ForYouItem): string {
  if (item.kind === 'proposals') return shortLine(item.cards?.[0]?.title)
  if (item.kind === 'session' && item.tone === 'question') return shortLine(item.lead || item.text)
  if (item.kind === 'mail' || item.kind === 'media' || item.kind === 'session') return shortLine(item.title || item.text)
  return shortLine(item.text || item.title)
}

/** The stream as shown: only items with a layout, at most STREAM_CAP. */
export function streamOf(items: ForYouItem[], cap = STREAM_CAP): ForYouItem[] {
  const out: ForYouItem[] = []
  for (const i of items) {
    if (out.length >= cap) break
    if (formatOf(i)) out.push(i)
  }
  return out
}
