// A project's page (the « > » beside its « / »): its requests, one column (requests.tsx RequestColumn: one band per
// request, what runs on top, then the newest first, every state), then its sessions. No headings, no counters.
//
// The requests come from weevboss's request ledger (GET /api/boss/ledger). A request belongs to a project through the
// session it was last sent to (that session's project; a session gone from the snapshot is matched by the project
// name its dispatch label starts with), or, never sent, when its words name the project.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../../shared/api.ts'
import type { LedgerView } from '../../shared/ledger.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/project-screen'
import { useApp } from './app-context'
import { SessionRow } from './bits'
import { Shell } from './shell'
import { RequestColumn } from './requests'
import './project-screen.css'
import { WeevbookLine } from './threads'

type Row = LedgerView['asks'][number]

const OLDER_AFTER = 6

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Does this request belong to this project? See the header. Exported for tests. */
export function inProject(a: Row, project: { id: string; name: string }, byId: Map<string, Session>): boolean {
  const d = a.dispatches.at(-1)
  if (d) {
    const s = byId.get(d.session)
    if (s) return s.projectId === project.id
    return (d.label ?? '').split(' · ')[0].trim().toLowerCase() === project.name.toLowerCase()
  }
  if (project.name.length < 3) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(project.name)}($|[^\\p{L}\\p{N}])`, 'iu').test(`${a.text} ${a.quote}`)
}

/** Every request of a project, whatever its state. Exported for tests. */
export function requestsOf(asks: Row[], project: { id: string; name: string }, sessions: Session[]): Row[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  return asks.filter((a) => inProject(a, project, byId))
}

/** The ledger, read while the project is open: again when a request opens or closes, at most every 30 s otherwise. */
export function useLedger(): { ledger: LedgerView | null; reload: () => void } {
  const { snap } = useApp()
  const [v, setV] = useState<LedgerView | null>(null)
  const last = useRef(0)
  const load = () => {
    last.current = Date.now()
    api.ledger().then(setV).catch(() => undefined)
  }
  useEffect(load, [snap.asksOpen])
  useEffect(() => {
    if (Date.now() - last.current > 30_000) load()
  }, [snap.version])
  return { ledger: v, reload: load }
}

/** A project's requests as the one column, for any page that shows a project (the classic page, next's). */
export function ProjectRequests({ project }: { project: { id: string; name: string } }) {
  const { snap } = useApp()
  const { ledger, reload } = useLedger()
  const asks = useMemo(() => (ledger ? requestsOf(ledger.asks, project, snap.sessions) : []), [ledger, project.id, project.name, snap.sessions])
  return <RequestColumn asks={asks} onChanged={reload} />
}

/** A project's own page: its requests, then every session, the open ones first, then the finished ones newest first,
 *  a few, the rest one tap away. */
export function ProjectPage({ projectId }: { projectId: string }) {
  const t = useT(M)
  const { snap, colors } = useApp()
  const [all, setAll] = useState(false)
  const project = snap.projects.find((p) => p.id === projectId)
  const sessions = snap.sessions.filter((s) => !s.archived && s.projectId === projectId)
  const rank = (s: Session) => (s.status === 'working' ? 0 : s.status === 'needs_user' || s.status === 'interrupted' ? 1 : 2)
  const open = sessions.filter((s) => s.status !== 'done').sort((a, b) => rank(a) - rank(b) || b.openedAt - a.openedAt)
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const shown = all ? done : done.slice(0, OLDER_AFTER)
  return (
    <Shell slot={colors[projectId] ?? 'agent'} kicker="weevils" title={project?.name ?? '…'}>
      <div className="pj-page">
        {project && <ProjectRequests project={project} />}
        <div className="pj-sessions">
          {[...open, ...shown].map((s) => <SessionRow key={s.id} session={s} />)}
        </div>
        {done.length > shown.length && (
          <div className="in pj-older">
            <button type="button" className="pj-line rest" onClick={() => setAll(true)}>{t.older(done.length - shown.length)}</button>
          </div>
        )}
        {project && <WeevbookLine projectId={project.id} name={project.name} />}
        <div style={{ height: 96 }} />
      </div>
    </Shell>
  )
}
