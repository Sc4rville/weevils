#!/usr/bin/env node
// The proactive length guard: a Claude Code Stop hook on weevboss's event-only turns (server/boss-turns.ts). A message
// weevboss writes on its own reaches the phone as a notification: one bold key word, a line, at most a second one, the
// link to the thing, never a list, never a session id. Too long or shaped wrong → the stop is refused once with the
// reason, and the turn rewrites its message shorter (stop_hook_active stops a second refusal: no loop).
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PROACTIVE_MAX_CHARS = 280
export const PROACTIVE_MAX_LINES = 2
const SILENT = '[[weevils:silent]]'

/** What is wrong with a proactive message, in one line for the model; '' when it is fine. */
export function proactiveProblem(text) {
  const t = String(text ?? '').trim()
  if (!t || t.split('\n').at(-1).trim() === SILENT) return ''
  // Links count by their label: the coloured link is the point, its address is not reading.
  const shown = t.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'link')
  const lines = shown.split('\n').map((l) => l.trim()).filter(Boolean)
  const out = []
  if (shown.length > PROACTIVE_MAX_CHARS) out.push(`${shown.length} characters (max ${PROACTIVE_MAX_CHARS})`)
  if (lines.length > PROACTIVE_MAX_LINES) out.push(`${lines.length} lines (max ${PROACTIVE_MAX_LINES})`)
  if (lines.some((l) => /^([-*•]|\d+[.)])\s/.test(l))) out.push('a list')
  if (/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/.test(shown)) out.push('a bare session id (link the session instead: [its title](/#s=<id>))')
  if (!/\*\*[^*\n]+\*\*/.test(t)) out.push('no **bold** key word')
  return out.join(', ')
}

export function stopVerdict(input) {
  if (!input || input.stop_hook_active) return null
  const problem = proactiveProblem(input.last_assistant_message)
  if (!problem) return null
  return `Your message to the user is too long or shaped wrong: ${problem}. Write it again as your whole final reply, `
    + `nothing before or after: one bold key word, one short line, at most a second line, the living link to the thing `
    + `([title](url) of the page, [its title](/#s=<session id>) of a session, or [For you](/#foryou) with the button's name). `
    + `Keep only what they must see or decide; drop history, reasoning and the rest. Nothing worth a line: reply exactly ${SILENT}.`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = null
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')) } catch { process.exit(0) }
  const reason = stopVerdict(input)
  if (reason) { process.stderr.write(reason); process.exit(2) }
}
