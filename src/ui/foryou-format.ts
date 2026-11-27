// « For you » as a feed of posts. One post = one colour block, clearly apart from the next: who it comes from (small,
// on top), its title in bold, a short text, the media inside the same block, what to tap at the bottom. Read like a
// social feed, in weevils' own look. The formats are internal and never shown; each stored item (whatever its legacy
// kind) maps to one of them, or is hidden (never deleted: the server keeps its history, only the stream leaves it out).
//   action: something waiting for the user (a real question, a cut session, a word weevboss asked about)
//   visual: a result to look at (image, clip), the media inside the post
//   note:   a short result or word, title and a line or two
//   piece:  a long authored text (the night's piece): title, a few lines, the rest unfolds in place
// What never makes a post: figures alone (milestones, counters, stats), automated proposals and « ideas », generated
// trivia, automation bookkeeping, routine runs that did nothing, and work still in progress.
import type { ForYouItem } from '../../shared/foryou.ts'

export type ForYouFormat = 'action' | 'visual' | 'note' | 'piece'

/** At most this many posts in the stream at once: the page stays light. The server sends at most as many. */
export const STREAM_CAP = 60
/** The longest line a card shows (about two short lines on a phone); the rest stays in the place it opens. */
export const LINE_MAX = 120
/** The longest title of a post. */
export const TITLE_MAX = 90
/** A post older than this is history, not news: the stream leaves it out (questions and alerts live on their own). */
export const STALE_MS = 4 * 86_400_000
/** A post's text: about four lines on a phone, whole sentences. */
export const TEXT_MAX = 170
/** An authored text this long is a piece (read in place), not a note. */
export const PIECE_MIN = 420

const hasVisual = (i: ForYouItem) => !!i.media?.length || !!i.composition || !!i.resultGroup?.final

/** A run that did nothing worth a look (« skipped this run », « nothing new », « still paused »): routine, not news. */
export function routine(item: ForYouItem): boolean {
  if (hasVisual(item) || item.actions?.length) return false
  const head = /^[\s\S]*?(?:[.!?](?=\s|$)|$)/.exec(plainLine(`${item.title ?? ''} ${item.text}`))?.[0] ?? ''
  return /\b(?:skipp?(?:ed|ing)?|nothing (?:new|to (?:do|report))|no (?:new|change|batch|update)s?\b|still (?:paused|stopped|waiting)|run skipped)\b/i.test(head)
}

/** The layout an item takes in the stream, or null when it is hidden. */
export function formatOf(item: ForYouItem): ForYouFormat | null {
  // The person's own choices: something to do while one is open (never stale), a short record once all are answered.
  if (item.decisions?.length) return item.decisions.some((d) => !d.answer) ? 'action' : 'note'
  if (item.work) {
    // Work the user already launched: only its outcome is news; the status chatter in between is not.
    if (item.work.status !== 'completed') return null
    return hasVisual(item) ? 'visual' : 'note'
  }
  const id = item.id
  switch (item.kind) {
    case 'media':
      if (hasVisual(item)) return 'visual'
      return item.visualProposal ? 'action' : item.text || item.title ? 'note' : null
    case 'alert':
      return 'action'
    case 'mail':
      // weevboss's own relay mail (« [weevboss] ACTION — … ») is an internal handoff, not news for the user.
      return /^\s*\[weevboss\]/i.test(item.title ?? '') ? null : 'note'
    case 'session':
      if (item.tone === 'question' || item.tone === 'alert') return 'action'
      if (item.tone === 'result') return hasVisual(item) ? 'visual' : 'note'
      return null
    case 'boss':
      // Automation lifecycle and proposals (started, wrapped up, « I have an idea »): bookkeeping, never a post.
      if (/^auto:/.test(id) && !hasVisual(item)) return null
      if (hasVisual(item)) return 'visual'
      // A model digest may summarise; it never asks for a tap (only weevboss's own posts carry buttons).
      if (item.actions?.length && id.startsWith('b:')) return 'action'
      if (!item.text) return null
      return item.title && plainLine(item.text).length >= PIECE_MIN ? 'piece' : 'note'
    // Automated proposals, generated « ideas » and trivia, figures alone: never a post.
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

/** A mail subject or title as a person would say it: no « [tag] », no shouted « ACTION — » prefix, no trailing « … ». */
export function cleanSubject(text: string): string {
  let s = text.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim()
  // Shouted prefixes: « ACTION — », « FYI: », « URGENT - ».
  s = s.replace(/^(?:[A-Z][A-Z0-9]{1,15}\s*){1,3}[—–:-]\s+/, '')
  // A line still all in capitals reads as shouting: sentence case (keeps short acronyms intact in mixed lines).
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (letters.length > 8 && letters.replace(/\p{Lu}/gu, "").length < letters.length * 0.3) s = s.charAt(0) + s.slice(1).toLowerCase()
  return s.replace(/\s*(?:…|\.{3})\s*$/, '').replace(/\s+[—–-]\s*$/, '').trim()
}

/** Automation bookkeeping worded as a sentence (« The automation "X" is wrapped up », « … is running »). */
export function lifecycleLine(text: string): boolean {
  return /^(?:the )?automation\s+["“«']?[^"”»']{0,80}["”»']?\s+(?:is|has|was|just)\s+(?:wrapped|running|started|starting|finished|done|over|complete|stopped|paused|scheduled|launched|back)/i.test(plainLine(text))
}

const TAIL_WORDS = /\s+(?:a|an|the|and|or|but|of|to|in|on|for|with|at|by|from|is|are|was|its|their|your|my|that|which|so|as|into|than)$/i

/** An outcome, not a diary: « I built the menu » → « Built the menu », « I couldn't run X » → « Couldn't run X ». */
export function outcomeWords(text: string): string {
  const s = text.replace(/^\s*(?:I|We)(?:'ve| have| just)?\s+(?=\S)/, '')
  return s === text ? text : s.charAt(0).toUpperCase() + s.slice(1)
}

/** One short line that never ends on « … »: the first sentence when it fits, else cut at a clause, else on a word
 * (never on a dangling « the »/« and »). Empty when nothing sensible fits. */
export function shortLine(text: string | undefined, max = LINE_MAX): string {
  const line = outcomeWords(cleanSubject(plainLine(text ?? '')))
  if (!line) return ''
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line
  const pick = first.length >= 12 && first.length <= max ? first : line
  if (pick.length <= max) return pick
  const cut = pick.slice(0, max)
  const clause = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' — '), cut.lastIndexOf(': '))
  let out = clause > max * 0.45 ? cut.slice(0, clause) : cut.slice(0, Math.max(cut.lastIndexOf(' '), 0))
  for (let i = 0; i < 4 && TAIL_WORDS.test(out); i++) out = out.replace(TAIL_WORDS, '')
  out = out.replace(/[\s,;:–—-]+$/, '').replace(/\s*[(\["“«]$/, '')
  return out.length >= 12 ? out : ''
}

/** The one line a card says: its title when it has one that says it, else its words. */
export function cardLine(item: ForYouItem): string {
  if (item.kind === 'proposals') return shortLine(item.cards?.[0]?.title)
  if (item.kind === 'session' && item.tone === 'question') return shortLine(item.lead || item.text)
  // A session's outcome is in its words; its title alone (« content ideas index ») says nothing.
  if (item.kind === 'session') return shortLine(item.text) || shortLine(item.title)
  if (item.kind === 'mail' || item.kind === 'media') return shortLine(item.title) || shortLine(item.text)
  return shortLine(item.text) || shortLine(item.title)
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** How much an item brings: media, then something to do, then words. Duplicates keep the richest. */
export function richness(item: ForYouItem): number {
  return (hasVisual(item) ? 1000 : 0) + (item.cards?.length || item.actions?.length ? 500 : 0) + Math.min(plainLine(item.text).length + (item.body?.length ?? 0), 199)
}

/** Shown at all: a layout, words that say something (not a bare 3-word title, not bookkeeping, not a routine run). */
export function worthShowing(item: ForYouItem, strict = true): boolean {
  const f = formatOf(item)
  if (!f) return false
  if (lifecycleLine(item.text) || lifecycleLine(item.title ?? '')) return false
  if (f === 'visual') return true
  if (routine(item)) return false
  if (f === 'action' || !strict) return !!cardLine(item)
  // A title alone (« content ideas index »): no outcome, no action, no insight.
  const p = postParts(item)
  return `${p.title} ${p.text}`.trim().split(/\s+/).length >= 4
}

/** Same thing said twice: one's words inside the other's, or the same subject. */
function sameThing(a: ForYouItem, b: ForYouItem): boolean {
  // A session's sentence and the media it posted are one result: the media wins (it is the thing itself).
  if (a.sessionId && a.sessionId === b.sessionId && (a.kind === 'session' || b.kind === 'session') && (a.kind === 'media' || b.kind === 'media')) return true
  const ta = a.title ? norm(cleanSubject(a.title)) : ''
  const tb = b.title ? norm(cleanSubject(b.title)) : ''
  if (ta && ta === tb && a.kind === b.kind && a.kind !== 'session') return true
  const la = norm(cardLine(a)), lb = norm(cardLine(b))
  if (la.length < 8 || lb.length < 8) return false
  const fa = norm(`${a.title ?? ''} ${plainLine(a.text)}`), fb = norm(`${b.title ?? ''} ${plainLine(b.text)}`)
  return fa.includes(lb) || fb.includes(la)
}

/** The job a result comes from: the same automation or session title run after run (« UI ad factory »). */
const jobOf = (i: ForYouItem) => (i.kind === 'session' && i.tone === 'result' && i.title ? `job:${norm(cleanSubject(i.title))}` : '')

/** The stream as shown: only posts worth a look, nothing stale, duplicates folded into the richest, repeated results
 * of one job folded into its newest (with how many runs it stands for), at most `cap`. Order: the server's (newest first). */
export function streamOf(items: ForYouItem[], cap = STREAM_CAP, strict = true, now = Date.now()): ForYouItem[] {
  const kept: ForYouItem[] = []
  const jobs = new Map<string, number>()
  for (const i of items) {
    if (kept.length >= cap) break
    if (!worthShowing(i, strict)) continue
    if (strict && formatOf(i) !== 'action' && i.at && now - i.at > STALE_MS) continue
    const job = jobOf(i)
    if (job && jobs.has(job)) {
      const at = jobs.get(job)!
      kept[at] = { ...kept[at], runs: (kept[at].runs ?? 1) + 1 }
      continue
    }
    const twin = kept.findIndex((k) => sameThing(k, i))
    if (twin < 0) {
      if (job) jobs.set(job, kept.length)
      kept.push(i)
    } else if (richness(i) > richness(kept[twin])) {
      // The media keeps its place in time and borrows the sentence's words when it has no caption.
      const words = kept[twin]
      kept[twin] = !i.title && !plainLine(i.text) && words.kind === 'session' ? { ...i, title: cardLine(words) } : i
    } else if (!kept[twin].title && !plainLine(kept[twin].text) && i.kind === 'session') kept[twin] = { ...kept[twin], title: cardLine(i) }
  }
  return kept
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** Never a half-open bracket at the end of a title: « opens its overview (name, what it does » → « opens its overview ». */
const balanced = (s: string) => {
  const open = s.lastIndexOf('(')
  return open > 12 && s.indexOf(')', open) < 0 ? s.slice(0, open).replace(/[\s,;:–—-]+$/, '') : s
}

/** The first sentence of a text when it makes a title, and what follows. */
function split(text: string, max = TITLE_MAX): [string, string] {
  const [title, rest] = splitWhole(text, max)
  // Clipped upstream (« … » at the end): the text keeps the mark, so it is cut back to whole words, not shown as whole.
  return [title, rest && /(?:…|\.{3})\s*$/.test(text) ? `${rest}…` : rest]
}
function splitWhole(text: string, max: number): [string, string] {
  const plain = outcomeWords(cleanSubject(plainLine(text)))
  if (!plain) return ['', '']
  const first = /^[\s\S]*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain
  if (first.length >= 12 && first.length <= max) {
    const title = balanced(first.replace(/\.$/, ''))
    // A bracket left out of the title opens the text instead of vanishing.
    return [title, upper(plain.slice(title.length).replace(/^[\s.]+/, '').trim())]
  }
  // Too long for a title: cut at a clause (« X: Y », « X, Y »), the rest becomes the text.
  const cut = plain.slice(0, max + 1)
  const at = Math.max(cut.lastIndexOf(': '), cut.lastIndexOf(' — '), cut.lastIndexOf('; '), cut.lastIndexOf(', '))
  if (at >= 24) return [balanced(plain.slice(0, at)), upper(plain.slice(at + 2).replace(/^[\s—–-]+/, '').trim())]
  const title = balanced(shortLine(plain, max))
  if (!title) return [plain.slice(0, max), '']
  return [title, plain.slice(title.length).replace(/^[\s,;:–—.)-]+/, '').trim()]
}

/** A fragment without its clipped last word, never ending on « the », « and », a comma. */
function clauseCut(s: string): string {
  let out = s.replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '')
  for (let i = 0; i < 4 && TAIL_WORDS.test(out); i++) out = out.replace(TAIL_WORDS, '')
  out = out.replace(/[\s,;:–—(«“-]+$/, '')
  // A bracket opened and never closed is dropped with what it held.
  const open = Math.max(out.lastIndexOf('('), out.lastIndexOf('«'))
  if (open >= 0 && out.indexOf(out[open] === '(' ? ')' : '»', open) < 0) out = out.slice(0, open).replace(/[\s,;:–—-]+$/, '')
  return out.length >= 12 ? out : ''
}

/** A short text: whole sentences up to `max`, never cut on « … » nor on a clipped word. */
export function shortText(text: string, max = TEXT_MAX): string {
  const raw = plainLine(text)
  const clipped = /(?:…|\.{3})$/.test(raw)
  const plain = raw.replace(/\s*(?:…|\.{3})$/, '')
  if (!plain) return ''
  const parts = plain.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? []
  let out = ''
  for (const s of parts) {
    if ((out + s).length > max) break
    out += s
  }
  out = out.trim()
  if (!out) out = plain.slice(0, max)
  // A tail without its end (clipped upstream, or too long): back to whole sentences, else to the last whole clause.
  if ((clipped || out.length < plain.length) && !/[.!?)»”"]$/.test(out)) {
    const whole = out.match(/^[\s\S]*[.!?](?=\s)/)?.[0]
    out = whole && whole.length >= 8 ? whole : clauseCut(out)
  }
  return upper(out)
}

/** What a post says: its bold title on top, then a short text (a piece keeps all of it, unfolded in place). */
export function postParts(item: ForYouItem): { title: string; text: string } {
  const f = formatOf(item)
  if (item.kind === 'session' && item.tone === 'question') {
    if (item.lead) return { title: shortLine(item.lead, TITLE_MAX), text: shortText(item.text) }
    const [t, rest] = split(item.text)
    return { title: t, text: shortText(rest) }
  }
  if (item.kind === 'session' && item.tone === 'alert') return { title: shortLine(cleanSubject(item.title ?? ''), TITLE_MAX) || shortLine(item.text), text: item.title ? shortText(item.text) : '' }
  if (f === 'piece') return { title: shortLine(cleanSubject(item.title ?? ''), TITLE_MAX), text: item.text.trim() }
  if (item.kind === 'session') {
    // The outcome is the title; the report's next words are the text. The session's own title goes on the source line.
    const [t, rest] = split(item.text)
    const more = item.body && plainLine(item.body).length > plainLine(item.text).length ? split(item.body)[1] : rest
    return { title: t, text: shortText(more || rest) }
  }
  if (item.kind === 'media' || hasVisual(item)) {
    const [t, rest] = split(item.title || item.text)
    return { title: t, text: shortText([rest, item.title ? plainLine(item.text) : ''].filter(Boolean).join(' ')) }
  }
  if (item.title) return { title: shortLine(cleanSubject(item.title), TITLE_MAX), text: shortText(item.text) }
  const [t, rest] = split(item.text)
  return { title: t, text: shortText(rest) }
}
