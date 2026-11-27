// What a weevboss turn used to fetch with a tool call before it could act, now handed to it at the start of the turn:
// the date and time (the stable prompt leaves them out so its prefix stays cached), the machines, and the sessions with
// their state. Measured on 30 turns (2026-11-24): a model round trip costs ~3.5 s, the `weevils sessions | grep` check
// before a send or a `date` call was one of them in half the turns. Plus the fast path: small talk runs at low effort.

import type { Snapshot } from '../shared/api.ts'

/** Rows kept: every session not finished, plus the ones finished in the last hours, newest first. */
const RECENT_DONE_MS = 6 * 3600_000
const MAX_ROWS = 24

const ago = (ms: number) => (ms < 90_000 ? 'just now' : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min ago` : ms < 36 * 3600_000 ? `${Math.round(ms / 3600_000)} h ago` : `${Math.round(ms / 86400_000)} d ago`) // i18n-ignore: model context, never shown

/** « Tuesday, 24 November 2026, 18:05 (Europe/Paris) », in the machine's own time zone. */
export function nowLine(now: number, tz = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const d = new Date(now)
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
  return `${date}, ${time} (${tz})`
}

/**
 * The live part of a turn's hidden block. `skip` drops weevboss's own turns, scratch folders and test sessions.
 * Same columns as `weevils sessions`, so the ids work with every weevils command.
 */
export function liveDigest(snap: Pick<Snapshot, 'sessions' | 'projects' | 'machines' | 'pageBand'>, now: number, skip: (s: Snapshot['sessions'][number]) => boolean = () => false, tz?: string, links: Map<string, { url: string; label?: string }> = new Map()): string {
  // Where each session's result lives: its newest post's link, else the page it builds. Named in a reply, the thing
  // links to that address; the session link only when the session itself is the point.
  const where = new Map(links)
  for (const p of snap.pageBand ?? []) if (p.session && !where.has(p.session)) where.set(p.session, { url: p.path, label: p.title })
  const names = new Map(snap.projects.map((p) => [p.id, p.name]))
  const here = snap.machines[0]?.id
  const machines = snap.machines.map((m) => `${m.name || m.id}${m.id === here ? ' (this one)' : m.off ? ' (off)' : m.online === false ? ' (offline)' : ''}`).join(', ') // i18n-ignore: model context
  const rows = snap.sessions
    .filter((s) => !s.archived && !skip(s) && (s.status !== 'done' || s.background || now - s.lastActivityAt < RECENT_DONE_MS))
    .sort((a, b) => Number(b.status === 'interrupted') - Number(a.status === 'interrupted') || b.lastActivityAt - a.lastActivityAt)
  const lines = rows.slice(0, MAX_ROWS).map((s) => {
    const bits = [`${s.id.slice(0, 8)} ${names.get(s.projectId) ?? s.projectId} · ${s.tool} @${s.machineId} · ${s.status}`, s.title]
    if (s.now) bits.push(s.now)
    if (s.background) bits.push(`${s.background} in background`) // i18n-ignore: model context
    if (s.interrupted) bits.push(`cut (${s.interrupted.reason})`) // i18n-ignore: model context
    const at = where.get(s.id)
    if (at) bits.push(`its result lives at [${(at.label || at.url).replace(/[[\]]/g, '')}](${at.url})`) // i18n-ignore: model context
    bits.push(ago(now - s.lastActivityAt))
    return `- ${bits.join(' · ')}`
  })
  const more = rows.length > MAX_ROWS ? `\n(${rows.length - MAX_ROWS} more: weevils sessions all)` : ''
  return [
    `right now (read at the start of this turn, so you need no tool call for it): ${nowLine(now, tz)}`,
    machines ? `machines: ${machines}` : '',
    lines.length ? `sessions (state, newest first; done = idle, its pane may be closed):\n${lines.join('\n')}${more}` : 'sessions: none running', // i18n-ignore: model context
  ].filter(Boolean).join('\n')
}

/** Words that carry no task on their own: greetings, thanks, yes/no, go-aheads (English and French). */
const IDLE_WORDS = new Set([
  'yo', 'hi', 'hey', 'hello', 'salut', 'coucou', 'bonjour', 'bonsoir', 'ok', 'okay', 'oki', 'dac', 'daccord', 'accord', 'merci', 'thanks', 'thank', 'you', 'thx', 'ty', // i18n-ignore
  'cool', 'top', 'parfait', 'perfect', 'nice', 'great', 'super', 'génial', 'genial', 'bien', 'good', 'oui', 'ouais', 'yes', 'yep', 'yeah', 'non', 'no', 'nope', // i18n-ignore
  'go', 'vas', 'y', 'vasy', 'allez', 'cest', 'ça', 'ca', 'marche', 'bravo', 'bon', 'bonne', 'nuit', 'journée', 'journee', 'night', 'morning', 'see', 'later', // i18n-ignore
  'à', 'plus', 'tard', 'lol', 'haha', // i18n-ignore
])

/**
 * Small talk and one-word answers (« yo », « ok », « merci », « on est quel jour ») need no deliberation: the turn
 * runs at low effort, same model, same tools and context. Only greetings, thanks, yes/no and go-aheads, or asking the
 * date or time; a short question about the work (« what now? », « on en est où ») keeps the chosen effort.
 */
export function isSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t || t.length > 40 || t.startsWith('/')) return false
  if (/https?:|www\.|[/\\@#`]|\d/.test(t)) return false
  if (/^(on est quel jour|quel jour (on est|sommes-nous|est-on)|quelle (heure|date)( est-il| il est)?|what (day|time|date) is it( today)?|what'?s the (date|time)( today)?)\s*\??$/.test(t.replace(/[?!.]+$/, '').trim())) return true
  const words = t.replace(/[’']/g, '').split(/[^\p{L}+]+/u).filter(Boolean)
  return words.length > 0 && words.length <= 5 && words.every((w) => IDLE_WORDS.has(w))
}
