// The guided tour's stops (next/src/tour.tsx, docs/onboarding.md): where each one is, on which screen, and how it moves
// on. Pure, tested (tour-stops.test.ts). A stop whose place is not on this install (no automation yet, no For you) is
// left out, so a newcomer's tour stays short.

export type Screen = 'boss' | 'side'
export interface Stop {
  id: 'menu' | 'projects' | 'autonomous' | 'factory' | 'foryou' | 'composer' | 'camera'
  /** The screen it needs: weevboss's, or the side bar open over it. */
  screen: Screen
  /** What the halo goes around (a selector in next's own markup). */
  target: string
  /** tap: the person taps the real thing (it does what it always does); next: a tap-through. */
  advance: 'tap' | 'next'
  /** The line's key (src/i18n/tour.ts). */
  line: 'menu' | 'projects' | 'projectsNone' | 'autonomous' | 'factory' | 'foryou' | 'composer' | 'camera'
}

/** What this install has, for the stops that depend on it. */
export interface TourFacts {
  projects: number
  automations: number
  foryou: boolean
}

const PROJECT = '.nx-side .nx-project:not(.nx-autos):not(.nx-factory):not(.nx-pages):not(.recursive-identity)'

export function tourStops(f: TourFacts): Stop[] {
  const stops: (Stop | false)[] = [
    { id: 'menu', screen: 'boss', target: '.nx-menu', advance: 'tap', line: 'menu' },
    f.projects > 0
      ? { id: 'projects', screen: 'side', target: PROJECT, advance: 'next', line: 'projects' }
      : { id: 'projects', screen: 'side', target: '.nx-side .nx-boss-row', advance: 'next', line: 'projectsNone' },
    f.automations > 0 && { id: 'autonomous', screen: 'side', target: '.nx-side .nx-autos:not(.nx-pages)', advance: 'next', line: 'autonomous' },
    { id: 'factory', screen: 'side', target: '.nx-side .nx-factory', advance: 'next', line: 'factory' },
    f.foryou && { id: 'foryou', screen: 'boss', target: '.nx-words', advance: 'next', line: 'foryou' },
    { id: 'composer', screen: 'boss', target: '.nx-boss .nx-composer', advance: 'next', line: 'composer' },
    { id: 'camera', screen: 'boss', target: '.cam-mark', advance: 'next', line: 'camera' },
  ]
  return stops.filter((s): s is Stop => !!s)
}

/** Where the line sits: under the place when there is room for it, else above it. */
export function captionAt(rect: { top: number; bottom: number }, viewport: number, height: number, gap = 14): { top: number } {
  const below = rect.bottom + gap
  if (below + height <= viewport - 8) return { top: below }
  return { top: Math.max(8, rect.top - gap - height) }
}
