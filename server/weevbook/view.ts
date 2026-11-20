// A thread as the app shows it (step 4, behind WEEVILS_THREADS): its messages in the app's own shape and one of three
// states. Legs, engines, rungs and handoffs stay in the journal: the person reads one conversation.

import type { Message } from '../../shared/api.ts'
import type { ThreadHold, ThreadState } from '../../shared/threads.ts'
import { parseEngine, type JournalEvent } from './journal.ts'
import { safeTurns } from './hub.ts'
import { filedByWeevils } from './live.ts'
import { WAITS_FOR_YOU, type Turn } from './turn.ts'

/**
 * The state the app shows. A turn the dispatcher retries (failed, then assigned again) is still working: the person
 * sees nothing of it. Paused only when a turn is held, that is when the person must act; a turn held for a reason
 * only the person lifts (attempts, expired) stops pausing the thread once a later turn was asked.
 *
 * A turn the dispatcher will never place is not the person's to act on: one weevils did not file (typed in the
 * provider's own session, or older than threads) that its session left waiting, or one closed as `stopped`. The thread
 * is then the person's move (`waiting`), with one line saying it stopped (`hold.reason: stopped`, 06-dispatch.md).
 */
export function visibleState(events: readonly JournalEvent[]): { state: ThreadState; hold?: ThreadHold } {
  const turns = safeTurns(events)
  const last = turns.at(-1)
  const theirs = (t: Turn) => (t.state === 'accepted' || t.state === 'failed' || t.state === 'held') && !filedByWeevils(events, t)
  const stopped = (t: Turn) => (t.state === 'held' && t.held?.reason === 'stopped') || theirs(t)
  const pending = turns.filter((t) => t.state !== 'done' && !stopped(t) && !(t.state === 'held' && WAITS_FOR_YOU.includes(t.held?.reason ?? '') && t !== last))
  const held = pending.find((t) => t.state === 'held')
  if (held) return { state: 'paused', hold: holdOf(events, held) }
  if (pending.length) return { state: 'working' }
  return last && stopped(last) ? { state: 'waiting', hold: { reason: 'stopped' } } : { state: 'waiting' } // i18n-ignore: a reason, not a text
}

/** The facts the sentence of a held turn needs (06-dispatch.md): the machine and provider of the last leg, or the
 *  request to give again. */
function holdOf(events: readonly JournalEvent[], t: Turn): ThreadHold {
  const reason = t.held?.reason ?? 'no-machine'
  const last = events.findLast((e) => e.type === 'leg.start')
  const engine = last && last.type === 'leg.start' ? parseEngine(last.engine) : null
  const asked = t.message ? events.find((e) => e.id === t.message) : undefined
  return {
    reason,
    ...(engine && (reason === 'only-there' || reason === 'not-signed-in') ? { machine: engine.machine } : {}),
    ...(engine && reason === 'not-signed-in' ? { provider: engine.provider } : {}),
    ...((reason === 'attempts' || reason === 'expired') && asked?.type === 'message' ? { request: asked.text } : {}),
  }
}

/** The thread's messages, as the app's conversation view reads them: requests, answers, steps and attachments. */
export function threadMessages(events: readonly JournalEvent[]): Message[] {
  const out: Message[] = []
  for (const e of events) {
    const at = Date.parse(e.at)
    if (e.type === 'message') {
      if (e.role === 'orchestrator') out.push({ id: e.id, role: 'orchestrator', author: e.author ?? 'weevboss', text: e.text, at })
      else out.push({ id: e.id, role: e.role, text: e.text, at })
    } else if (e.type === 'tool') out.push({ id: e.id, role: 'event', text: e.summary, at })
    else if (e.type === 'attachment' && e.name !== 'message.txt') out.push({ id: e.id, role: 'event', text: e.name, at })
  }
  return out
}

/** The thread's title: the last one written, else its first request cut short. */
export function titleOf(events: readonly JournalEvent[]): string {
  const t = events.findLast((e) => e.type === 'meta' && !!e.title)
  if (t && t.type === 'meta' && t.title) return t.title
  const first = events.find((e) => e.type === 'message' && e.role === 'user')
  const line = first && first.type === 'message' ? first.text.replace(/\s+/g, ' ').trim() : ''
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/** The provider session of the thread's open leg, if it runs on this machine. */
export function openSession(events: readonly JournalEvent[], machine: string): string | undefined {
  let open: { session: string; machine: string } | null = null
  for (const e of events) {
    if (e.type === 'leg.start') open = { session: e.session, machine: parseEngine(e.engine)?.machine ?? '' }
    else if (e.type === 'leg.end') open = null
  }
  return open && open.machine === machine ? open.session : undefined
}
