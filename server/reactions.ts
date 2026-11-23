// Reactions (docs/AGENT_CONVENTIONS.md « Reactions »): a small emoji on the corner of a message the person wrote, saying
// what is being done with it, like a WhatsApp reaction. Read from real state only, never from what a model wrote: the
// request ledger (the asks a message became, and the sessions they were sent to), weevboss's turn (received, working),
// and, where none of these speaks, a reaction an agent set explicitly (`weevils react`).
import fs from 'node:fs'
import path from 'node:path'
import type { Message, SessionStatus } from '../shared/api.ts'
import type { Ask } from '../shared/ledger.ts'

/** The whole vocabulary: small and obvious. */
export const REACTIONS = {
  seen: '👀',
  sent: '📤',
  working: '🛠️',
  done: '✅',
  waiting: '❓',
  answered: '💬',
  ignored: '🤷',
} as const
export type Reaction = (typeof REACTIONS)[keyof typeof REACTIONS]

/** Progress order for a message holding several asks: it shows the step all of them have reached. */
const STEP: Record<string, number> = { [REACTIONS.seen]: 0, [REACTIONS.sent]: 1, [REACTIONS.working]: 2, [REACTIONS.done]: 3, [REACTIONS.answered]: 3 }

/** One ask's reaction, from its status and the state of the session it was last sent to. */
export function askReaction(a: Pick<Ask, 'status' | 'kind' | 'dispatches'>, sessionStatus: (id: string) => SessionStatus | undefined): Reaction {
  if (a.status === 'dropped') return REACTIONS.ignored
  if (a.status === 'done') return a.kind === 'question' ? REACTIONS.answered : REACTIONS.done
  const d = a.dispatches.at(-1)
  if (!d) return REACTIONS.seen
  const s = sessionStatus(d.session)
  if (s === 'needs_user') return REACTIONS.waiting
  if (s === 'working') return REACTIONS.working
  return REACTIONS.sent
}

/** A message's reaction from the asks it became: a question to you wins (it waits on you), then all dropped is 🤷,
 *  else the step every live ask has reached (dropped ones aside). */
export function messageReaction(asks: Pick<Ask, 'status' | 'kind' | 'dispatches'>[], sessionStatus: (id: string) => SessionStatus | undefined): Reaction | undefined {
  if (!asks.length) return undefined
  const all = asks.map((a) => askReaction(a, sessionStatus))
  if (all.includes(REACTIONS.waiting)) return REACTIONS.waiting
  const live = all.filter((r) => r !== REACTIONS.ignored)
  if (!live.length) return REACTIONS.ignored
  const min = Math.min(...live.map((r) => STEP[r]))
  const at = live.filter((r) => STEP[r] === min)
  // All done: ✅ when any of them was work, 💬 when they were all questions.
  if (min === 3) return at.includes(REACTIONS.done) ? REACTIONS.done : REACTIONS.answered
  return at[0]
}

/** Does this message carry that ledger source (a transcript entry's uuid; a message cut in parts adds « -t » or « -n »)? */
const fromSrc = (id: string, src: string) => !!src && (id === src || id.startsWith(`${src}-`))

/** Reactions explicitly set by an agent, by message id (kept on disk; the newest per message). */
export class ExplicitReactions {
  private map: Record<string, { emoji: string; at: number; by?: string }> = {}
  private file: string
  constructor(file: string) {
    this.file = file
    try { this.map = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { this.map = {} }
  }
  get(id: string) { return this.map[id]?.emoji }
  /** emoji empty: the explicit reaction is removed (the state-driven one shows again). */
  set(id: string, emoji: string, by?: string, at = Date.now()) {
    if (emoji) this.map[id] = { emoji, at, ...(by ? { by } : {}) }
    else delete this.map[id]
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.map), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}

/** One emoji, at most a few code points (flags, skin tones, ZWJ sequences): never text. */
export function isEmoji(s: string): boolean {
  const t = s.trim()
  const rest = t.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\uFE0F|\u200D|[#*0-9]\uFE0F?\u20E3/gu, '')
  return !!t && [...t].length <= 10 && rest === ''
}

/**
 * weevboss's thread: each of the person's messages with its reaction. An explicit one wins; else the asks the ledger
 * made of it; else, for the latest message while weevboss works on it (or it waits in the ledger's inbox), 👀.
 */
export function withBossReactions(msgs: Message[], o: { asks: Ask[]; sessionStatus: (id: string) => SessionStatus | undefined; working: boolean; pendingSince?: number; explicit?: ExplicitReactions }): Message[] {
  const lastUser = msgs.findLastIndex((m) => m.role === 'user')
  return msgs.map((m, i) => {
    if (m.role !== 'user') return m
    const explicit = o.explicit?.get(m.id)
    // Received and not read into the ledger yet (its turn runs, or the ledger has it waiting): 👀.
    const seen = (i === lastUser && o.working) || (o.pendingSince !== undefined && m.at >= o.pendingSince - 5_000)
    const asks = o.asks.filter((a) => fromSrc(m.id, a.src))
    const r = explicit ?? messageReaction(asks, o.sessionStatus) ?? (seen ? REACTIONS.seen : undefined)
    // Waiting on the person: which session asks, so the thread can say it and open it in one tap.
    const waitingOn = r === REACTIONS.waiting ? asks.map((a) => a.dispatches.at(-1)?.session).find((id) => !!id && o.sessionStatus(id) === 'needs_user') : undefined
    return r ? { ...m, reaction: r, ...(waitingOn ? { waitingOn } : {}) } : m
  })
}

/**
 * A session's thread: the person's (or another author's) latest message says what the session does with it: 🛠️ while
 * it works, ❓ when it asks you. Older ones carry only an explicit reaction.
 */
export function withSessionReactions(msgs: Message[], o: { status: SessionStatus | undefined; explicit?: ExplicitReactions }): Message[] {
  const asked = (m: Message) => m.role === 'user' || m.role === 'orchestrator'
  const last = msgs.findLastIndex(asked)
  return msgs.map((m, i) => {
    if (!asked(m)) return m
    const live = i === last ? (o.status === 'working' ? REACTIONS.working : o.status === 'needs_user' ? REACTIONS.waiting : undefined) : undefined
    const r = o.explicit?.get(m.id) ?? live
    return r ? { ...m, reaction: r } : m
  })
}
