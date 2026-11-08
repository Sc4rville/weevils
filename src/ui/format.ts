import type { SessionStatus } from '../../shared/api.ts'

/** Durée compacte, façon croquis : 12m, 1h36, 14h01, 2j. */
export function dur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}j`
}

/** Durée lisible pour les phrases : « 12 min », « 14 h 01 », « 2 jours ». */
export function durLong(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 1) return 'moins d’une minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`
  const d = Math.floor(h / 24)
  return `${d} jour${d > 1 ? 's' : ''}`
}

export function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'à l’instant'
  return `il y a ${durLong(ms)}`
}

export const status: Record<SessionStatus, { ch: string; label: string }> = {
  working: { ch: '*', label: 'travaille' },
  needs_user: { ch: '!', label: 'à toi' },
  idle: { ch: '_', label: 'disponible' },
  done: { ch: '✓', label: 'terminée' },
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
