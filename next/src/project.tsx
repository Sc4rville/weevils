// A project's « > » page in weevils next: « Requests for <repo> », its requests grouped under their sessions
// (docs/next-interaction.md, « Requests »): the most recently active session first, its requests just under it, a
// small star on what runs, a small bar for how far it is; « needs you » on the session. The Tempo icon at the top sets
// the repo's pace (docs/product/tempo.md). Reused from the current app, no copy: Shell, ProjectRequests, TempoIcon.
import { useApp } from '../../src/ui/app-context.tsx'
import { ProjectRequests } from '../../src/ui/project-screen.tsx'
import { Shell } from '../../src/ui/shell.tsx'
import { TempoIcon } from '../../src/ui/tempo.tsx'
import { useT } from '../../src/i18n/index.ts'
import M from '../../src/i18n/project-screen.ts'

export function NextProjectPage({ projectId }: { projectId: string }) {
  const t = useT(M)
  const { snap, colors } = useApp()
  // A product weevils has no conversation for yet (factory > Projects, its « > »): its page all the same, empty
  // until something is asked there.
  const project = snap.projects.find((p) => p.id === projectId) ?? { id: projectId, name: projectId, kind: 'repo' as const, repos: [], where: {}, lastActivityAt: 0 }
  return (
    <Shell slot={colors[projectId] ?? 'agent'} kicker="weevils" title={t.requestsFor(project.name)} actions={<TempoIcon repo={project.id} />}>
      <ProjectRequests project={project} fill />
    </Shell>
  )
}
