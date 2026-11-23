import type { ReactNode } from 'react'

/**
 * Le jeu d'icônes de weevils : une grille 24 × 24, un seul trait (2,5), des bouts et des angles droits
 * (linecap square, linejoin miter), une seule taille (.ic). Aucun arrondi, aucun caractère Unicode.
 * Les directions (flèche, chevron) sont un seul tracé, tourné.
 */

export type Dir = 'up' | 'right' | 'down' | 'left'
const TURN: Record<Dir, number> = { up: 0, right: 90, down: 180, left: 270 }

/** La boucle de « cycle » et sa pointe, à part : AutoMark les anime séparément. */
const CYCLE_LOOP = 'M4 14v6h16V4H4v6'
const CYCLE_HEAD = 'M1 7l3 3 3-3'
/** factory (le volet de la barre latérale de next) : un toit en dents de scie et une cheminée. */
const FACTORY = 'M4 20V10l5.5 4v-4l5.5 4V4h5v16z'

const PATHS = {
  // Tracés de base, orientés vers le haut quand ils ont un sens.
  arrow: 'M12 20V5M5 12l7-7 7 7',
  chevron: 'M5 15l7-7 7 7',
  check: 'M4 12.5l5 5L20 6.5',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  close: 'M5 5l14 14M19 5L5 19',
  star: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
  idle: 'M5 19h14',
  bang: 'M12 4v10M12 18.5v1.5',
  // A session waits for the user: a question mark at right angles, gentler than « ! » (kept for errors).
  waits: 'M7 8V4h10v7h-5v4M12 19v1.5',
  slash: 'M16 3L8 21',
  quote: 'M8.5 5v6M15.5 5v6',
  // Bulle de parole : un rectangle, sa pointe en bas à gauche.
  bubble: 'M3 4h18v12H11l-5 4v-4H3z',
  machine: 'M3 4h18v12H3zM8 20h8',
  // A server at a host: two stacked units, each with its light (Your factory, next to « machine », a computer).
  server: 'M3 3h18v7H3zM3 14h18v7H3zM7 6.5h3M7 17.5h3',
  more: 'M5 12h1M11.5 12h1M18 12h1',
  mic: 'M9 3h6v10H9zM5 10v6h14v-6M12 16v5M8 21h8',
  enter: 'M19 5v8H6M10 9l-4 4 4 4',
  compact: 'M12 3v11M6 9l6 6 6-6M4 20h16',
  // The app's camera (next/src/camera.tsx): a body, its raised top, a square lens.
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM9 10.5h6v6H9z',
  /** The camera's hint (next/src/camera.tsx): a finger raised to tap, the hand under it. */
  tap: 'M9 14V3h3v7h3v1.5h3V13h2v5l-2 4h-8l-5-6.5 1.8-1.5L9 14z',
  /** Save to the device (camera roll, downloads). */
  save: 'M12 3v11M6 9l6 6 6-6M4 20h16',
  theme: 'M4 4h16v16H4zM12 4v16',
  // Subscriptions: three rising levels, open and light next to the old heavy « % ».
  usage: 'M5 20v-4M12 20v-9M19 20V5',
  // Language: a capital A.
  language: 'M5 21l7-17 7 17M8 14h8',
  logout: 'M10 4H4v16h6M15 8l4 4-4 4M19 12H9',
  agents: 'M4 6h16M4 12h16M4 18h16',
  terminal: 'M4 7l5 5-5 5M12 18h8',
  hash: 'M9 3L7 21M17 3l-2 18M4 9h17M3 15h17',
  reload: 'M20 13v7H4V4h12M13 1l3 3-3 3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l12 8-12 8z',
  grip: 'M7 9h10M7 15h10',
  file: 'M6 3h8l4 4v14H6z',
  // A page of next's « pages » band: a window, its bar across the top.
  page: 'M3 4h18v16H3zM3 9h18',
  // A repository: a square folder, its tab square too.
  repo: 'M3 5h7v3h11v12H3zM3 8h7',
  // Settings: three thin rails, each with a square knob set at its own place.
  settings: 'M3 6h10M17 6h4M13 4h4v4h-4zM3 12h3M10 12h11M6 10h4v4H6zM3 18h8M15 18h6M11 16h4v4h-4z',
  copy: 'M9 9h11v11H9zM15 5V4H4v11h1',
  // Ce qui revient tout seul : la touche « répéter », à angles droits — une boucle ouverte à gauche, sa pointe en bas.
  cycle: `${CYCLE_LOOP}${CYCLE_HEAD}`,
  // factory, in next's side bar: a saw-tooth roof and a chimney.
  factory: FACTORY,
  // By the hour (Your factory's « on demand »): a square clock, its two hands at right angles.
  clock: 'M3 3h18v18H3zM12 7v5h4',
  // Sleep mode: three « z », staggered up to the right, the last one smaller.
  sleep: 'M2 14h7l-7 7h7M11 7h7l-7 7h7M18 2h4l-4 4h4',
} as const

export type IconName = keyof typeof PATHS

/** Icônes pleines (aplat, angles vifs) : pixel art sur la même grille 24. */
const FILLED = {
  // Diablotin : un carré, deux cornes, deux yeux évidés.
  devil: 'M4 9h16v12H4zM4 3h4v6H4zM16 3h4v6h-4zM8 13v3h3v-3zM13 13v3h3v-3z',
  // Fantôme : un dôme en marches, trois pans en bas, deux yeux évidés (un agent qui travaille pendant ton sommeil).
  ghost: 'M8 2h8v2h2v2h2v16h-3v-2h-2v2h-2v-2h-2v2h-2v-2H7v2H4V6h2V4h2zM8 9v4h3V9zM13 9v4h3V9z',
} as const
export type FilledName = keyof typeof FILLED

export function FilledIcon({ name, label, className = '' }: { name: FilledName; label?: string; className?: string }) {
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" shapeRendering="crispEdges" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path d={FILLED[name]} />
    </svg>
  )
}

/**
 * Marks: solid, rounded where the thing is, the weight of the providers' logos (Claude, Codex: ToolIcon) rather than
 * the line set above. Your factory's levels wear them: a graphics card (Machines), a brain (Intelligence), GitHub's
 * mark (Projects), a lightning bolt (Tempo). One colour, the ink's; holes cut with evenodd.
 */
const MARKS = {
  // A graphics card seen from the side: its bracket, one big fan and its hub, three cooling fins, the connector.
  gpu: 'M1 3h2.2v18H1zM4.2 4.5h19.3v13H4.2zM10.2 6.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 1 0 0-9.6zM10.2 9.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM16.4 7h1.3v8h-1.3zM18.8 7h1.3v8h-1.3zM21.2 7h1.3v8h-1.3zM6.5 17.5h13V20h-13z',
  // A brain from above: one hemisphere with its folds, drawn twice (mirrored), a gap between them.
  brain: 'M11.2 3.6C10.3 2.6 8.6 2.4 7.6 3.3C5.9 3 4.4 4.2 4.4 5.9C2.9 6.5 2.1 8.2 2.7 9.7C1.6 10.9 1.6 12.9 2.8 14C2.3 15.8 3.2 17.6 5 18C5.6 19.8 7.5 20.8 9.2 20.2C9.9 20.9 10.6 21 11.2 20.8ZM5.2 9.4c1.4-.25 2.7.3 3.4 1.4l-1.2.8c-.5-.7-1.3-1-2.2-.9zM7.9 5.7c.25 1.2-.1 2.3-1 3.1l.95 1c1.2-1.1 1.6-2.6 1.4-4.2zM4.7 14.4c1.3.45 2.6.15 3.5-.75l.95 1c-1.3 1.15-2.9 1.55-4.8 1zM8.8 15.6c.65 1 .75 2.1.35 3.2l1.3.45c.55-1.45.4-2.95-.45-4.25z',
  // GitHub's own mark.
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  // A small lightning bolt (Tempo).
  bolt: 'M14 1.5L4.5 13.5H11L9.5 22.5L19.5 10H13z',
} as const
export type MarkName = keyof typeof MARKS
/** Drawn twice, the second mirrored: a symmetric mark kept to one half. */
const MIRRORED = new Set<MarkName>(['brain'])

export function Mark({ name, size = 18, label }: { name: MarkName; size?: number; label?: string }) {
  return (
    <svg className={`mark mark-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path fillRule="evenodd" d={MARKS[name]} />
      {MIRRORED.has(name) && <path fillRule="evenodd" d={MARKS[name]} transform="matrix(-1 0 0 1 24 0)" />}
    </svg>
  )
}

/**
 * Icônes qui peuvent recevoir un contour fin (l'étoile verte « travaille », sur fond clair) : le même tracé, plus large, dessous.
 * Un tracé fait d'un seul trait n'a pas de remplissage, donc paint-order ne suffit pas : le contour est ce trait dessous.
 */
const HALO = new Set<IconName>(['star'])

export function Icon({ name, dir = 'up', label, className = '' }: { name: IconName; dir?: Dir; label?: string; className?: string }) {
  const turn = TURN[dir]
  const transform = turn ? `rotate(${turn} 12 12)` : undefined
  return (
    <svg className={`ic ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={10} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      {HALO.has(name) && <path className="ic-halo" d={PATHS[name]} transform={transform} />}
      <path d={PATHS[name]} transform={transform} />
    </svg>
  )
}

/**
 * Le signe de ce qui tourne tout seul (une automatisation au travail) : la boucle « cycle », en magenta (--auto-fluo),
 * où un segment plein fait le tour comme un tapis roulant ; la boucle entière reste lisible (piste à mi-teinte, contour
 * d'encre en thème clair), la pointe soudée à son bout ouvert. Ni rotation (l'étoile verte), ni clignotement (.fluo) : c'est sa
 * forme et son mouvement qui le distinguent. Animé même en « réduire les animations », comme l'étoile : seul signe de vie.
 */
export function AutoMark({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <svg className={`ic auto-mark ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square" strokeLinejoin="miter" strokeMiterlimit={10} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path className="halo" d={`${CYCLE_LOOP}${CYCLE_HEAD}`} />
      <path className="track" d={CYCLE_LOOP} />
      <path className="run" d={CYCLE_LOOP} pathLength={100} />
      <path d={CYCLE_HEAD} />
    </svg>
  )
}

/** Les anciens caractères-icônes, traduits en icônes du jeu. */
const GLYPHS: Record<string, [IconName, Dir?]> = {
  '→': ['arrow', 'right'],
  '←': ['arrow', 'left'],
  '↑': ['arrow', 'up'],
  '↓': ['arrow', 'down'],
  '+': ['plus'],
  '−': ['minus'],
  '✓': ['check'],
  '×': ['close'],
  '*': ['star'],
  '_': ['idle'],
  '!': ['bang'],
  '?': ['waits'],
  '/': ['slash'],
  '"': ['quote'],
  '@': ['machine'],
  '~': ['theme'],
  '%': ['usage'],
  A: ['language'],
  x: ['logout'],
  '&': ['agents'],
  '>': ['chevron', 'right'],
  '<': ['chevron', 'left'],
  '⇣': ['compact'],
  '⏎': ['enter'],
  '#': ['hash'],
  '||': ['pause'],
  '·': ['file'],
  '↻': ['cycle'],
}

/** Une icône à la place d'un caractère ; tout le reste passe tel quel (texte, nœuds React). */
export function G({ c }: { c: ReactNode }) {
  if (typeof c !== 'string') return <>{c}</>
  const g = GLYPHS[c]
  return g ? <Icon name={g[0]} dir={g[1]} /> : <>{c}</>
}
