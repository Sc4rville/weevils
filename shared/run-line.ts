// What a finished turn said, in one line. Agents end their work on the report shape they are asked for
// (server/i18n/readable-replies.ts): a bold headline (« **Done:** prices are in the table »), a few short lines,
// then « **Needs you:** … » only when something truly waits for the person. Three readers share these rules: an
// automation's page (how its last run went), the side bar (one row per automation, with what came out), and a
// finished session whose last word still asks something. Pure, tested in run-line.test.ts.

/** Markdown marks away (bold, code, links, headings, list dashes), the words kept, line breaks kept. */
function unmark(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]\n[]{1,300})\]\((?:https?:\/\/|\/)[^)\s]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|[\s(«“"])\*(\S[^*\n]*?\S|\S)\*(?=[\s.,;:!?)»”"]|$)/g, '$1$2')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gm, '')
    .replace(/[ \t]+/g, ' ')
}

/** A dot after one of these is not the end of a sentence (« e.g. Shoes », « vs. Hats »). */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|ex|no|nos|p|pp|mr|mrs|ms|dr|st|m|mme|mlle)\.$/i

/** Where the first sentence of one line ends (the index after its closing mark), or -1 when it never does. */
function sentenceEnd(line: string): number {
  const re = /[.!?…]+["”»')\]]*/g
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const end = m.index + m[0].length
    const after = line.slice(end)
    // The end of the line, or a gap then a new start (a capital, a digit, a quote): never « v2. then », « 3.5 ».
    if (after && !/^\s+[^\s\p{Ll}]/u.test(after)) continue
    if (m[0].startsWith('.') && ABBREVIATION.test(line.slice(0, m.index + 1))) continue
    return end
  }
  return -1
}

/**
 * The first whole sentence of a text, as plain words. A text given on one line (a run's stored note: the message with
 * its line breaks folded, so its list reads « … spent. - **Why:** … ») is read the same way. When the text was cut
 * before its first sentence ended (it ends with « … »), the whole words that are there, then « … »: never half a word.
 */
export function firstSentence(text: string): string {
  // Runs of blanks folded first: nothing below then looks twice at a long one.
  let src = text.replace(/[ \t]+/g, ' ').trim()
  // One line holding a folded list: each « - **Label** … » or « - Capital… » was a line of its own.
  if (!src.includes('\n')) src = src.replace(/\s+[-•]\s+(?=\*\*|__|\p{Lu})/gu, '\n')
  const cut = /(?:…|\.{3})\s*$/.test(src)
  // Cut inside a link: its words stay, its half address goes.
  if (cut) src = src.replace(/\[([^\]\n]*)\]\([^)\s]*$/, '$1…').replace(/\[([^\]\n]*)$/, '$1')
  const lines = unmark(src).split('\n').map((l) => l.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  if (!first) return ''
  const body = cut && lines.length === 1 ? first.replace(/(?:…|\.{3})\s*$/, '') : first
  const end = sentenceEnd(body)
  if (end >= 0) return body.slice(0, end).trim()
  // No closing mark. A line of its own is whole (a headline, a list item); a cut text keeps its whole words only.
  if (!(cut && lines.length === 1)) return body.replace(/\s*[:;,–-]+$/, '').trim()
  const words = body.replace(/\s*\S*$/, '').replace(/[\s,;:–-]+$/, '')
  return words ? `${words}…` : ''
}

/** The label a report's headline opens with when all went well: the check beside it already says so. */
const DONE_LABEL = /^(?:done|all done|finished|fait|c['’]est fait|terminé|fini)\s*:\s*/iu

/**
 * How a run went, in one sentence: the first whole sentence of its last message, without the formatting marks, and
 * without the « Done: » label when the run went well (`ok`, the default). Any other label stays, as plain words
 * (« Stopped: … », « Skipped: … »): it is the news.
 */
export function runLine(text: string, ok = true): string {
  const sentence = firstSentence(text.replace(/^\s*\[harness[^\]]*\]\s*/i, ''))
  if (!ok) return sentence
  const bare = sentence.replace(DONE_LABEL, '')
  return bare === sentence || !bare ? sentence : bare.charAt(0).toLocaleUpperCase() + bare.slice(1)
}

const B = String.raw`(?:\*\*|__)`
const W = String.raw`(?:needs you|[àa] toi)` // i18n-ignore: words read in an agent's message, never shown
/** Blanks inside a label: French puts a (narrow) no-break space before its colon. */
const G = String.raw`[ \t  ]*`
// At the start of a line (after a heading or a list mark): the label with its colon, bold or not; or the bold label
// closed by a dash or alone on its line; or a heading that is the label alone. Never « Needs your … », « À toi de … ».
const NEEDS_LABEL = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:(?:#{1,6}[ \t]+)?(?:[-*•][ \t]+)?(?:${B}${G}${W}${G}(?::${G}${B}|${B}${G}:|${B}${G}[—–-](?=\s)|${B}(?=[ \t]*(?:\n|$)))|${W}${G}:)|#{1,6}[ \t]+${W}(?=[ \t]*(?:\n|$)))[ \t]*([^\n]*)`,
  'giu',
)
// Anywhere in a line (a sentence before it, or a note with its line breaks folded): only the bold label with its colon.
const NEEDS_INLINE = new RegExp(String.raw`${B}${G}${W}${G}(?::${G}${B}|${B}${G}:)[ \t]*([^\n]*)`, 'giu')
/** « Needs you: nothing. », « À toi : rien pour l’instant. »: the line is there, and it asks nothing. */
const NOTHING_TAIL = String.raw`(?:right now|for now|now|today|tonight|yet|else|more|new|at (?:the moment|this time)|this (?:run|time|round|week)|(?:is |are )?(?:needed|required)|from you|on your (?:side|end)|to \p{L}+(?:\s[^.!?]*)?|pour l['’]instant|pour le moment|du tout|cette fois|de ton côté|d['’]autre|de plus|à \p{L}+(?:\s[^.!?]*)?|requise?|nécessaire)` // i18n-ignore: words read in an agent's message, never shown
const NOTHING = new RegExp( // i18n-ignore: words read in an agent's message, never shown
  String.raw`^(?:(?:nothing|none|nope|n\/a|na|rien|aucune?(?: action)?|no(?: actions?| decisions?)?|non|ras|all good|pas besoin de toi)(?![-\p{L}])((?:\s+${NOTHING_TAIL})*)\s*([.!,;:—–-]|$)\s*|[^\p{L}\p{N}]*$)`,
  'iu',
)
/** « Nothing for now, but … », « Rien à valider, sauf … »: something is asked after all. */
const BUT = /\b(?:but|except|unless|however|though|mais|sauf|cependant|par contre|en revanche)\b/iu

/**
 * What a message's « Needs you: » line asks, as one plain sentence; null when the message has no such line, or when
 * the line says nothing is needed. The last one in the message counts. Read on the whole message, or on a note with
 * its line breaks folded (then the label is found by its bold marks).
 */
export function needsLine(text: string): string | null {
  const body = text.replace(/```[\s\S]*?```/g, ' ')
  const hit = [...body.matchAll(NEEDS_LABEL), ...body.matchAll(NEEDS_INLINE)].sort((a, b) => a.index - b.index).at(-1)
  if (!hit) return null
  // The label alone on its line: what it asks is the next line that says something (the first item of its list).
  const rest = hit[1].trim() ? hit[1] : (body.slice(hit.index + hit[0].length).split('\n').find((l) => l.trim()) ?? '')
  const said = unmark(rest).replace(/\s+/g, ' ').trim()
  if (!said) return null
  const none = NOTHING.exec(said)
  if (none) {
    const after = said.slice(none[0].length)
    const turns = /[,;:—–-]/.test(none[2] ?? '') && BUT.test(after.split(/\s+/).slice(0, 2).join(' '))
    if (!turns && !BUT.test(none[1] ?? '')) return null
  }
  const sentence = firstSentence(said) || said
  return sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1)
}
