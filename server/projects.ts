// Où range-t-on une session ? Étage déterministe du classement : dossier → repo → famille de repos.

import path from 'node:path'

export interface Placement {
  projectId: string
  projectName: string
  kind: 'repo' | 'invented'
  repo: string | null
}

/** lws-demo, lws-oss → lws ; mygame-trailer → mygame ; pli → pli. */
export function familyOf(repo: string): string {
  return (repo.split(/[-_.]/)[0] || repo).toLowerCase()
}

/** roots : dossiers de projets de la machine (~/projects, ~/Documents/projects…). */
export function place(cwd: string, roots: string[]): Placement {
  if (cwd) {
    for (const root of roots) {
      const rel = path.relative(root, cwd)
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue
      // On saute les dossiers cachés (.night/lws → lws).
      const repo = rel.split(path.sep).find((seg) => seg && !seg.startsWith('.'))
      if (repo) {
        const fam = familyOf(repo)
        return { projectId: fam, projectName: fam, kind: 'repo', repo }
      }
      return { projectId: 'general', projectName: 'général', kind: 'invented', repo: null }
    }
  }
  return { projectId: 'divers', projectName: 'divers', kind: 'invented', repo: null }
}
