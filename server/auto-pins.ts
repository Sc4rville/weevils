// What the side bar shows is what is pinned (2026-11-26): the person's repos, weevils always. So that it is never empty
// and follows what the person uses, a repo is pinned once, the first time it shows up in use (active in the last 3
// days); unpinned after that, it stays out. On the first run of this rule an install where the person already pinned
// repos keeps its choice: nothing more is pinned for what was already there. A conversation started with no repo is
// never pinned: it shows in the side bar's own strip while recent (next/src/factory.tsx looseShown), then in Sessions.
//
// A fresh install with nothing pinned and nothing switched off yet pins the person's most recently active GitHub repos
// once (firstGithubPins), so a new user's side bar shows their real projects from the start.
import type { Project } from '../shared/api.ts'
import { familyOf } from './projects.ts'

export const RECENT = 3 * 24 * 3600_000
/** A GitHub repo pushed within this is one the person works on now. */
export const GITHUB_RECENT = 30 * 24 * 3600_000
export const GITHUB_PINS = 3

export type Met = { repos: string[]; firstRun: boolean }

/** What to pin now, and what is now met. projects: those of the side bar (never weevils' own, never the reserved). */
export function autoPins(projects: Project[], met: Met, pinned: string[], now: number): { pinRepos: string[]; met: Met } {
  const lastOf = (p: Project) => p.lastActivityAt ?? 0
  const repoMet = new Set(met.repos)
  const keepChoice = met.firstRun && pinned.length > 0
  const pinRepos: string[] = []
  for (const p of projects) {
    if (repoMet.has(p.id)) continue
    repoMet.add(p.id)
    const pinnedAlready = p.repos.some((r) => pinned.includes(r)) || pinned.includes(p.id)
    if (!keepChoice && !pinnedAlready && now - lastOf(p) < RECENT) pinRepos.push(p.repos[0] ?? p.id)
  }
  return { pinRepos, met: { repos: [...repoMet].slice(-2000), firstRun: false } }
}

/** weevils' own storage on GitHub (the weevbook vault and its raw copies): never a project of the person's. */
export const storageRepo = (r: { name: string; description?: string }) => /^weevbook-/.test(r.name) || r.description === 'Encrypted copy kept by weevils'

/** The person's most recently pushed GitHub repos (newest first), one per product, never weevils' own family nor its
 *  storage nor one switched off: what a fresh install pins. `self`: weevils' own repo here, when it has one. */
export function firstGithubPins(repos: { name: string; pushedAt: number; description?: string }[], hidden: string[], self: string | undefined, now: number): string[] {
  const seen = new Set<string>(self ? [familyOf(self)] : [])
  const out: string[] = []
  for (const r of [...repos].sort((a, b) => b.pushedAt - a.pushedAt)) {
    if (out.length >= GITHUB_PINS || now - r.pushedAt > GITHUB_RECENT) break
    const fam = familyOf(r.name)
    if (storageRepo(r) || seen.has(fam) || hidden.includes(r.name) || hidden.includes(fam)) continue
    seen.add(fam)
    out.push(r.name)
  }
  return out
}
