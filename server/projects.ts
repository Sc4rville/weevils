import fs from 'node:fs'
import { automationSourceRoot } from './automation-workspaces.ts'
// Où range-t-on une session ? Étage déterministe du classement : dossier → repo → famille de repos.

import path from 'node:path'
import { tr } from './i18n.ts'
import M from './i18n/projects.ts'

export interface Placement {
  projectId: string
  projectName: string
  kind: 'repo' | 'invented'
  repo: string | null
}

/** Projet des sessions hors de tout repo : id stable, nom affiché selon la langue (projectLabel). */
export const MISC = 'divers' // i18n-ignore : identifiant, jamais affiché tel quel

/** Nom affiché d'un projet : les ids réservés (divers, general) ont un libellé dans la langue de l'utilisateur, les autres sont leur nom. */
export const projectLabel = (id: string) => (id === MISC ? tr(M).misc : id === 'general' ? tr(M).general : id)

/** shop-api, shop-web → shop ; blog → blog. */
export function familyOf(repo: string): string {
  return (repo.split(/[-_.]/)[0] || repo).toLowerCase()
}

/** roots : dossiers de projets de la machine (~/projects, ~/Documents/projects…). */
export function place(cwd: string, roots: string[]): Placement {
  if (cwd) {
    for(const root of roots){
      const source=automationSourceRoot(root)
      if(!source)continue
      const rel=path.relative(source,cwd)
      if(rel.startsWith('..')||path.isAbsolute(rel))continue
      const repo=rel.split(path.sep)[0]
      if(!repo)continue
      try{
        const m=JSON.parse(fs.readFileSync(path.join(source,repo,'automation.json'),'utf8'))
        if(m.kind==='automation'&&repo===`auto-${m.id}`)return {projectId:repo,projectName:repo,kind:'repo',repo}
      }catch{}
    }
    for (const root of roots) {
      const rel = path.relative(root, cwd)
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue
      // On saute les dossiers cachés (.archive/shop → shop).
      const repo = rel.split(path.sep).find((seg) => seg && !seg.startsWith('.'))
      if (repo) {
        const fam = familyOf(repo)
        return { projectId: fam, projectName: fam, kind: 'repo', repo }
      }
      return { projectId: MISC, projectName: projectLabel(MISC), kind: 'invented', repo: null }
    }
  }
  return { projectId: MISC, projectName: projectLabel(MISC), kind: 'invented', repo: null }
}

/** A folder an automation works in (auto-<its id>): it belongs to autonomous, never to Projects. */
export const isAutomationFolder = (name: string) => /^auto-[0-9a-f]{10}$/.test(name)

/** The GitHub (or other) repo a git folder pushes to, « owner/name », from its origin; a worktree reads its main
 *  repo's config. undefined: not a git folder; '' a git folder with no origin. */
export function originOf(dir: string): string | undefined {
  let git = path.join(dir, '.git')
  try {
    if (fs.statSync(git).isFile()) {
      const to = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(git, 'utf8'))?.[1]?.trim()
      if (!to) return undefined
      git = path.resolve(dir, to)
      try { git = path.resolve(git, fs.readFileSync(path.join(git, 'commondir'), 'utf8').trim()) } catch { /* a plain gitdir link */ }
    }
    const config = fs.readFileSync(path.join(git, 'config'), 'utf8')
    const url = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(config)?.[1] ?? ''
    return url.replace(/\.git$/, '').replace(/\/+$/, '').split(/[/:]/).slice(-2).join('/').toLowerCase()
  } catch {
    return undefined
  }
}

export interface MotherRepo { id: string; name: string; repos: string[] }

/** factory's Projects (2026-11-23): one band per product, its mother repo, never one per folder. A folder counts
 *  only if it is a git repo; its worktrees and clones (the same origin) and its parts (« <product>-<part> », as the
 *  side bar already groups them, familyOf) fold into it; an automation's folders never count. */
export function motherRepos(folders: { name: string; dir: string }[]): MotherRepo[] {
  const byFamily = new Map<string, MotherRepo>()
  for (const f of folders) {
    if (isAutomationFolder(f.name)) continue
    const origin = originOf(f.dir)
    if (origin === undefined) continue
    const id = familyOf(origin ? origin.split('/').pop()! : f.name)
    const m = byFamily.get(id) ?? { id, name: id, repos: [] }
    m.repos.push(f.name)
    byFamily.set(id, m)
  }
  for (const m of byFamily.values()) m.repos.sort((a, b) => Number(b === m.id) - Number(a === m.id) || a.length - b.length || a.localeCompare(b))
  return [...byFamily.values()].sort((a, b) => a.name.localeCompare(b.name))
}
