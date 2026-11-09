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

const SLOTS = 8
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Couleur stable par projet ; tant qu'il y a au plus 8 projets, toutes différentes (donc jamais deux bandes voisines pareilles, quel que soit l'ordre). */
export function colorSlots(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<number>()
  let last = -1
  for (const id of ids) {
    let slot = hash(id) % SLOTS
    if (taken.size < SLOTS) while (taken.has(slot)) slot = (slot + 1) % SLOTS
    else if (slot === last) slot = (slot + 1) % SLOTS
    taken.add(slot)
    out[id] = `p${slot}`
    last = slot
  }
  out.__foot = `p${(last + 3) % SLOTS}`
  return out
}
