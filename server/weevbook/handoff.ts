// handoff.md (docs/spec/04-resume.md, « The handoff »): what another engine needs to continue a thread, kept current
// after every finished turn (decision D3) and given, with the latest exchanges, as the first request of a new provider
// session (rung 3). This generalises what the Codex relay did for one case (server/relay.ts, server/return-relay.ts):
// the first request, then the last 24 messages word for word, cut at 20,000 characters.
//
// The small model that rewrites it runs isolated (server/quiet-calls.ts): no hooks, no MCP, no memory, no project
// instructions. Without a model, the handoff is written from the journal alone (`by: journal`).

import crypto from 'node:crypto'
import type { EventDraft, JournalEvent, MessageEvent } from './journal.ts'
import { redactText } from './redact.ts'
import { prefaceSign } from './turn.ts'

export const HANDOFF_MAX = 12_000
/** The seven headings, in this order (RESUME-7). */
export const HEADINGS = ['Goal', 'State', 'Decisions', 'Files', 'Run and test', 'Not carried', 'Open questions'] as const
/** A thread is kept current while it was active this recently. */
export const ACTIVE_FOR = 24 * 3600_000
/** The last exchanges a new provider session reads word for word. */
export const LAST_MESSAGES = 24
export const LAST_CHARS = 20_000

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const bullets = (xs: readonly string[], none: string) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : `- ${none}`)

function front(thread: string, upTo: number, at: number, by: string) {
  return `---\nthread: ${thread}\nupTo: ${upTo}\nat: ${iso(at)}\nby: ${by}\n---\n`
}

/** The handoff written from the journal alone: no model, nothing invented (`by: journal`). */
export function journalHandoff(thread: string, events: readonly JournalEvent[], now: number): string {
  const upTo = events.at(-1)?.seq ?? 0
  const title = events.findLast((e) => e.type === 'meta' && !!e.title)
  const said = events.filter((e): e is MessageEvent => e.type === 'message')
  const asks = said.filter((m) => m.role === 'user')
  const answers = said.filter((m) => m.role === 'assistant')
  const tools = events.filter((e) => e.type === 'tool').map((e) => (e.type === 'tool' ? e.summary : ''))
  // The turn not done yet, if any: its request and the steps since it was accepted.
  const lastTurn = events.findLast((e) => e.type === 'turn')
  const open = lastTurn && lastTurn.type === 'turn' && lastTurn.state !== 'done' ? lastTurn.turn : null
  const accepted = open !== null ? events.findIndex((e) => e.type === 'turn' && e.turn === open && e.state === 'accepted') : -1
  const asked = accepted >= 0 ? events.find((e) => e.id === (events[accepted] as { message?: string | null }).message) : undefined
  const progress = accepted >= 0 ? events.slice(accepted).filter((e) => e.type === 'tool').map((e) => (e.type === 'tool' ? e.summary : '')) : []
  const files = [...new Set(tools.map((s) => /^(?:Edit|Write|MultiEdit|Read|apply_patch|NotebookEdit) · (.+)$/.exec(s)?.[1]).filter((x): x is string => !!x))].slice(-30)
  const runs = tools.filter((s) => /^(?:Bash|shell|exec_command|local_shell)\b/.test(s)).slice(-10)
  const lastAnswer = answers.at(-1)?.text.trim() ?? ''
  const body = [
    `# Handoff: ${title && title.type === 'meta' && title.title ? title.title : oneLine(asks[0]?.text ?? 'Untitled', 80)}`,
    '',
    '## Goal',
    asks.length ? oneLine(asks[0].text, 1500) : '- (no request yet)',
    '',
    '## State',
    '### Done',
    bullets(answers.slice(-8).map((m) => oneLine(m.text, 240)), 'nothing finished yet'),
    '### In progress',
    open !== null ? [asked && asked.type === 'message' ? oneLine(asked.text, 600) : `Turn ${open}.`, bullets(progress.slice(-15), 'no step recorded')].join('\n') : '- nothing',
    '### Next',
    open !== null ? '- Finish the request in progress.' : '- Wait for the next request.',
    '',
    '## Decisions',
    '- (the journal records none; read the exchanges below)',
    '',
    '## Files',
    bullets(files, 'none recorded'),
    '',
    '## Run and test',
    bullets(runs, 'none recorded'),
    '',
    '## Not carried',
    "- The previous agent's own session: its tool outputs and memory. Secrets and environment values (names only).",
    '',
    '## Open questions',
    lastAnswer.endsWith('?') ? `- ${oneLine(lastAnswer, 400)}` : '- none',
  ].join('\n')
  return cap(`${front(thread, upTo, now, 'journal')}${redactText(body)}\n`)
}

const cap = (text: string) => (text.length <= HANDOFF_MAX ? text : `${text.slice(0, HANDOFF_MAX - 2).trimEnd()}\n`)

/** A handoff that keeps its shape: front matter for this thread, the seven headings in order, at most 12,000 chars. */
export function checkHandoff(text: string, thread: string): { upTo: number; by: string } | null {
  if (text.length > HANDOFF_MAX) return null
  const m = /^---\nthread: (\S+)\nupTo: (\d+)\nat: (\S+)\nby: (\S+)\n---\n/.exec(text)
  if (!m || m[1] !== thread) return null
  let from = 0
  for (const h of HEADINGS) {
    const i = text.indexOf(`\n## ${h}\n`, from)
    if (i < 0) return null
    from = i + 1
  }
  for (const h of ['### Done', '### In progress', '### Next']) if (!text.includes(`\n${h}\n`)) return null
  return { upTo: Number(m[2]), by: m[4] }
}

/** The events after `upTo`, as thread.md renders them: who said what, and the steps. */
export function renderSince(events: readonly JournalEvent[], upTo: number): string {
  const lines: string[] = []
  for (const e of events) {
    if (e.seq <= upTo) continue
    if (e.type === 'tool') lines.push(`- ${oneLine(e.summary, 200)}`)
    else if (e.type === 'message') lines.push('', `**${e.role === 'user' ? 'You' : e.role === 'assistant' ? 'Agent' : (e.author ?? 'weevboss')}** · ${e.at.slice(0, 16).replace('T', ' ')}`, e.text.trim()) // i18n-ignore: the labels of thread.md
    else if (e.type === 'attachment') lines.push(`Attachment: ${e.name}`) // i18n-ignore: the labels of thread.md
  }
  return lines.join('\n').trim()
}

/** The prompt of the small model that keeps the handoff current: the previous one and what happened since. */
export function rewritePrompt(previous: string, events: readonly JournalEvent[], upTo: number): string {
  return [
    'You keep handoff.md current for a coding conversation: what another agent needs to continue the work without rereading everything.',
    'Rewrite the handoff below with what happened since it was written (the events after it). Keep exactly its shape: the same front matter,',
    'then "# Handoff: <title>", then these headings in this order: ## Goal, ## State (with ### Done, ### In progress, ### Next), ## Decisions,',
    '## Files, ## Run and test, ## Not carried, ## Open questions. Plain facts, short bullets. Names of variables, never their values.',
    'At most 10,000 characters. Answer with the whole file and nothing else.',
    '',
    '<handoff>',
    previous.trim(),
    '</handoff>',
    '',
    '<events>',
    renderSince(events, upTo).slice(-30_000),
    '</events>',
  ].join('\n')
}

/**
 * The new handoff after a finished turn: the model's rewrite when it keeps the shape, otherwise the journal's. The
 * front matter is always set here (thread, upTo, at, by), whatever the model wrote there.
 */
export async function nextHandoff(o: { thread: string; events: readonly JournalEvent[]; previous: string | null; now: number; by: string; write?: (prompt: string) => Promise<string> }): Promise<{ text: string; upTo: number; by: string }> {
  const upTo = o.events.at(-1)?.seq ?? 0
  // No handoff yet (or one that lost its shape): the model writes the first from the journal's, over every event.
  const kept = o.previous && checkHandoff(o.previous, o.thread) ? o.previous : null
  const base = kept ?? journalHandoff(o.thread, o.events, o.now)
  const before = kept ? checkHandoff(kept, o.thread)!.upTo : 0
  if (o.write && before < upTo) {
    try {
      const answer = (await o.write(rewritePrompt(base, o.events, before))).replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1').trim()
      const body = answer.replace(/^---\n[\s\S]*?\n---\n/, '')
      const text = cap(`${front(o.thread, upTo, o.now, o.by)}${redactText(body.trim())}\n`)
      if (checkHandoff(text, o.thread)) return { text, upTo, by: o.by }
    } catch {
      /* the model did not answer: the journal's below */
    }
  }
  return { text: journalHandoff(o.thread, o.events, o.now), upTo, by: 'journal' }
}

/** The `handoff` event of a handoff.md (THREAD-15: its upTo is behind it). */
export function handoffEvent(text: string, upTo: number, by: string, now: number, id: string): EventDraft {
  return { id, at: new Date(now).toISOString(), leg: null, type: 'handoff', upTo, by, sha256: crypto.createHash('sha256').update(text).digest('hex') } as EventDraft
}

/**
 * The first request of a new provider session for a thread (rung 3, and a chat's first engine): the signed preface,
 * the whole handoff, the events after its upTo, the last 24 messages word for word cut at 20,000 characters, then the
 * request of the turn itself (the user's message, or the preface of a resumed turn).
 */
export function firstRequest(thread: string, events: readonly JournalEvent[], handoff: string | null, request: string): string {
  const upTo = handoff ? (checkHandoff(handoff, thread)?.upTo ?? 0) : 0
  const said = events.filter((e): e is MessageEvent => e.type === 'message')
  const recent: string[] = []
  let size = 0
  for (const m of said.slice(-LAST_MESSAGES).reverse()) {
    const line = `**${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Agent' : (m.author ?? 'weevboss')}**: ${m.text.trim()}` // i18n-ignore: the labels of thread.md
    if (size + line.length > LAST_CHARS) {
      if (!recent.length) recent.push(line.slice(0, LAST_CHARS))
      break
    }
    recent.unshift(line)
    size += line.length
  }
  const since = handoff ? renderSince(events, upTo) : ''
  return [
    `${prefaceSign(thread)} You are continuing a conversation that another agent carried until now. Everything it knew is below: read it, then answer the request at the end as if you had been here all along. Do not mention the change.`,
    '',
    ...(handoff ? ['<handoff>', handoff.trim(), '</handoff>', ''] : []),
    ...(since ? ['<since-the-handoff>', since, '</since-the-handoff>', ''] : []),
    ...(recent.length ? ['<last-messages>', recent.join('\n\n'), '</last-messages>', ''] : []),
    '<request>',
    request.trim(),
    '</request>',
  ].join('\n')
}

/** Whether a thread is kept current: a finished turn in the last 24 hours. */
export function activeRecently(events: readonly JournalEvent[], now: number): boolean {
  const done = events.findLast((e) => e.type === 'turn' && e.state === 'done')
  return !!done && now - Date.parse(done.at) < ACTIVE_FOR
}
