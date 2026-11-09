import { createContext, useContext } from 'react'
import type { Snapshot } from '../../shared/api.ts'

export type Theme = 'light' | 'dark'

export type Page =
  | { kind: 'session'; id: string }
  | { kind: 'files'; projectId: string; repo?: string; dir?: string }
  | { kind: 'file'; projectId: string; repo: string; path: string }
  | { kind: 'machine'; projectId: string }
  | { kind: 'new'; projectId: string }
  | { kind: 'conversations'; projectId?: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'import' }
  | { kind: 'repos' }

export interface AppCtx {
  snap: Snapshot
  now: number
  offline: boolean
  /** Emplacement de palette par projet (variable CSS --p0…--p7). */
  colors: Record<string, string>
  push: (page: Page) => void
  replace: (page: Page) => void
  back: () => void
  expanded: string | null
  setExpanded: (id: string | null) => void
  h24Open: boolean
  setH24Open: (open: boolean) => void
  theme: Theme
  setTheme: (t: Theme) => void
  refresh: () => void
  logout: () => void
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp hors du fournisseur')
  return v
}

/** Les 16 teintes --p0…--p15 sont rangées par teinte : deux emplacements voisins se ressemblent, deux emplacements à ≥ 2 d'écart non. */
const SLOTS = 16
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/**
 * Couleur stable par projet (tirée de son id, sur la liste triée : l'ordre d'affichage ne change rien).
 * Jusqu'à 8 projets, les emplacements utilisés sont espacés d'au moins 2 (45° de teinte, 90° jusqu'à 4 projets) : deux projets
 * quelconques, donc deux bandes voisines quel que soit l'ordre, n'ont jamais la même teinte ni une teinte proche. Au-delà, toutes
 * différentes tant qu'il y en a au plus 16.
 */
export function colorSlots(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const sorted = [...ids].sort()
  // Le plus grand pas (jusqu'à 4 emplacements = 90° de teinte) qui laisse assez d'emplacements pour tous les projets.
  let stride = 4
  while (stride > 1 && Math.floor(SLOTS / stride) < sorted.length) stride--
  const n = Math.floor(SLOTS / stride)
  const taken = new Set<number>()
  let last = -1
  for (const id of sorted) {
    let k = hash(id) % n
    if (taken.size < n) while (taken.has(k)) k = (k + 1) % n
    taken.add(k)
    last = k * stride
    out[id] = `p${last}`
  }
  out.__foot = `p${(last + 5) % SLOTS}`
  return out
}
