// What the side bar shows is what is pinned (2026-11-26): a repo, or a conversation started with no repo (its own
// band). So that it is never empty and follows what the person uses, a repo or a loose conversation is pinned once,
// the first time it shows up in use (active in the last 3 days, a conversation not finished); unpinned after that, it stays out. On the first run
// of this rule an install where the person already pinned repos keeps its choice for repos: nothing more is pinned
// for what was already there.
import type { Project, Session } from '../shared/api.ts'

export const RECENT = 3 * 24 * 3600_000

export type Met = { repos: string[]; sessions: string[]; firstRun: boolean }
export type Pins = { repos: string[]; sessions: string[] }

/** What to pin now, and what is now met. projects: those of the side bar (never weevils' own, never the reserved). */
export function autoPins(projects: Project[], loose: Session[], met: Met, pinned: Pins, now: number): { pinRepos: string[]; pinSessions: string[]; met: Met } {
  const lastOf = (p: Project) => p.lastActivityAt ?? 0
  const repoMet = new Set(met.repos)
  const sessionMet = new Set(met.sessions)
  const keepChoice = met.firstRun && pinned.repos.length > 0
  const pinRepos: string[] = []
  const pinSessions: string[] = []
  for (const p of projects) {
    if (repoMet.has(p.id)) continue
    repoMet.add(p.id)
    const pinnedAlready = p.repos.some((r) => pinned.repos.includes(r)) || pinned.repos.includes(p.id)
    if (!keepChoice && !pinnedAlready && now - lastOf(p) < RECENT) pinRepos.push(p.repos[0] ?? p.id)
  }
  for (const s of loose) {
    if (sessionMet.has(s.id) || s.archived) continue
    sessionMet.add(s.id)
    // A finished one (a quick test, a one-off answer) is met but not pinned: it stays in Your factory's Sessions.
    if (!pinned.sessions.includes(s.id) && s.status !== 'done' && now - s.lastActivityAt < RECENT) pinSessions.push(s.id)
  }
  return { pinRepos, pinSessions, met: { repos: [...repoMet].slice(-2000), sessions: [...sessionMet].slice(-2000), firstRun: false } }
}
