// Which repo a request belongs to, one rule for the app's Requests page and the server's Tempo (server/tempo-service.ts).
// Through the session it was last sent to (that session's project; a session gone from the snapshot is matched by
// the project name its dispatch label starts with), or, never sent, when its words name the project.

import type { Ask } from './ledger.ts'

type Sess = { projectId: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function inProject(a: Pick<Ask, 'dispatches' | 'text' | 'quote'>, project: { id: string; name: string }, byId: Map<string, Sess>): boolean {
  const d = a.dispatches.at(-1)
  if (d) {
    const s = byId.get(d.session)
    if (s) return s.projectId === project.id
    return (d.label ?? '').split(' · ')[0].trim().toLowerCase() === project.name.toLowerCase()
  }
  if (project.name.length < 3) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(project.name)}($|[^\\p{L}\\p{N}])`, 'iu').test(`${a.text} ${a.quote}`)
}

/** The repo of a request: the first project it belongs to (longest names first, so « weevils-next » beats « weevils »). */
export function projectOfAsk(a: Pick<Ask, 'dispatches' | 'text' | 'quote'>, projects: readonly { id: string; name: string }[], byId: Map<string, Sess>): string | null {
  const sorted = [...projects].sort((x, y) => y.name.length - x.name.length)
  return sorted.find((p) => inProject(a, p, byId))?.id ?? null
}
