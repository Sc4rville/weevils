// The Tempo mode icons, in one place: placeholders from weevils' own set until custom ones replace them
// (Yann draws his own: swap a name here, or point a mode at a new path in icons.tsx; nothing else changes).
import type { TempoMode } from '../../shared/tempo.ts'
import type { IconName } from './icons'

export const TEMPO_ICONS: Record<TempoMode, IconName> = {
  pause: 'pause',
  standby: 'sleep',
  cruise: 'play',
  turbo: 'chevron',
  max: 'arrow',
  fleet: 'agents',
  swarm: 'usage',
}
