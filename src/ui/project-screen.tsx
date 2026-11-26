// A project's page (the « > » beside its « / »): its sessions, each with its requests just under it (requests.tsx
// RequestGroups): the most recently active session on top, then the others by recency, the requests never sent at
// the bottom. « needs you » sits on the session. Then the finished sessions that had no request, a few. No counters.
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
import RM from '../i18n/requests'
import { useApp } from './app-context'
import { SessionRow } from './bits'
import { Shell } from './shell'
import { groupsOf, isModelSwitch, RequestGroups } from './requests'
import { TempoIcon } from './tempo'
import './project-screen.css'
import { WeevbookLine } from './threads'
import { inProject } from '../../shared/ask-project.ts'
import { WeevilLoading } from './loading'

type Row = LedgerView['asks'][number]

const OLDER_AFTER = 6

export { inProject }

/** Every request of a project, whatever its state. Exported for tests. */
export function requestsOf(asks: Row[], project: { id: string; name: string }, sessions: Session[]): Row[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  return asks.filter((a) => inProject(a, project, byId))
}

/** The ledger, read while the project is open: again when a request opens or closes, at most every 30 s otherwise. */
// The last list read, kept for the next page that shows requests: it opens on it at once and refreshes behind.
let lastLedger: LedgerView | null = null
export function useLedger(): { ledger: LedgerView | null; reload: () => void } {
  const { snap } = useApp()
  const [v, setV] = useState<LedgerView | null>(lastLedger)
  const last = useRef(0)
  const load = () => {
    last.current = Date.now()
    api.ledger().then((x) => { lastLedger = x; setV(x) }).catch(() => undefined)
  }
  useEffect(load, [snap.asksOpen, snap.asksWaiting])
  useEffect(() => {
    if (Date.now() - last.current > 30_000) load()
  }, [snap.version])
  return { ledger: v, reload: load }
}

/** The open sessions of a project (not archived, not finished): each is a group, with or without requests. */
export const openSessionsOf = (sessions: Session[], projectId: string) => sessions.filter((s) => !s.archived && s.projectId === projectId && s.status !== 'done')

/**
 * A project's requests grouped under their sessions, for any page that shows a project (the classic page, next's).
 * Requests that only switch a model are left out. `withSessions`: open sessions with no request yet get their group
 * too (the classic page, where this is the list of sessions; next keeps its sessions in the side bar).
 */
export function ProjectRequests({ project, fill, withSessions }: { project: { id: string; name: string }; fill?: boolean; withSessions?: boolean }) {
  const { snap } = useApp()
  const { ledger, reload } = useLedger()
  const groups = useMemo(() => {
    const asks = ledger ? requestsOf(ledger.asks, project, snap.sessions).filter((a) => !isModelSwitch(a)) : []
    return groupsOf(asks, snap.sessions, withSessions ? openSessionsOf(snap.sessions, project.id) : [])
  }, [ledger, project.id, project.name, snap.sessions, withSessions])
  // A project with nothing asked yet says so, in the words of the page of all requests, rather than a blank page.
  // On its way: the weevil, from the first frame (the list of every request can take a moment on a phone network).
  if (!ledger && !groups.length) return <WeevilLoading />
  if (ledger && !groups.length) return <EmptyRequests />
  return <RequestGroups groups={groups} onChanged={reload} fill={fill} />
}

function EmptyRequests() {
  const t = useT(RM)
  return <div className="in meta req-empty">{t.nothingOpen}</div>
}

/** A project's own page: its sessions with their requests, then the finished sessions that had no request, newest
 *  first, a few, the rest one tap away. */
export function ProjectPage({ projectId }: { projectId: string }) {
  const t = useT(M)
  const { snap, colors } = useApp()
  const { ledger } = useLedger()
  const [all, setAll] = useState(false)
  const project = snap.projects.find((p) => p.id === projectId)
  // A finished session that had requests is already a group above; the others are listed once, here.
  const sent = new Set((ledger?.asks ?? []).map((a) => a.dispatches.at(-1)?.session).filter(Boolean))
  const done = snap.sessions.filter((s) => !s.archived && s.projectId === projectId && s.status === 'done' && !sent.has(s.id)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  const shown = all ? done : done.slice(0, OLDER_AFTER)
  return (
    <Shell slot={colors[projectId] ?? 'agent'} kicker="weevils" title={project ? t.requestsFor(project.name) : '…'} actions={project ? <TempoIcon repo={project.id} /> : undefined}>
      <div className="pj-page">
        {project && <ProjectRequests project={project} withSessions />}
        <div className="pj-sessions">
          {shown.map((s) => <SessionRow key={s.id} session={s} />)}
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
