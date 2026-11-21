// A brief signed by weevboss or another agent, as a session's thread treats it (server/brief-says.ts, src/ui/brief.tsx).

/** The brief without weevils' hidden context block (« ⟦weevils — … ⟧ »), spaces collapsed. */
export const briefKeyText = (text: string) => text.replace(/\s*⟦weevils\b[^⟧]*(?:⟧|$)/g, '').replace(/\s+/g, ' ').trim()

/** Long enough that the thread shows one spoken line in its place: a phone-screen paragraph or more. */
export const isLongBrief = (text: string) => briefKeyText(text).length > 160

/** Without a spoken line yet: the brief's first sentence, cut to one phone line. */
export function firstSentence(text: string, max = 110): string {
  const flat = text.replace(/\s*⟦weevils\b[^⟧]*(?:⟧|$)/g, '').trim()
  const first = (flat.split(/(?<=[.!?])\s|\n/)[0] ?? flat).replace(/\s+/g, ' ').trim() || flat.replace(/\s+/g, ' ')
  if (first.length <= max) return first
  const cut = first.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:·–-]+$/, '')}…`
}
