// A project's « > » page in weevils next: its requests, one column (docs/next-interaction.md, « Requests »). One band
// per request, like the automation rows: a short title, a small star while it runs, a small bar for how far it is;
// what runs on top, then the newest first, every state. Its conversations stay in the side bar, under the project.
// Reused from the current app, no copy: Shell (the page, its back swipe) and the request column (ProjectRequests).
import { useApp } from '../../src/ui/app-context.tsx'
import { ProjectRequests } from '../../src/ui/project-screen.tsx'
import { Shell } from '../../src/ui/shell.tsx'

export function NextProjectPage({ projectId }: { projectId: string }) {
  const { snap, colors } = useApp()
  const project = snap.projects.find((p) => p.id === projectId)
  if (!project) return <Shell slot="agent" kicker="weevils" title="…"><div /></Shell>
  return (
    <Shell slot={colors[projectId] ?? 'agent'} kicker="weevils" title={project.name}>
      <ProjectRequests project={project} fill />
    </Shell>
  )
}
