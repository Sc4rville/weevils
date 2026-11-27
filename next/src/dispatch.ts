// weevboss handing work to a session, seen on its screen: its little weevil (the working mark at the foot of the thread)
// turns around and sends a short glowing streak along a curve to the menu (the three bars), which takes the colour of
// the session's project for a moment, then settles back. docs/next-interaction.md « weevboss hands work over ».
//
// The signal is real state, never wording: the request ledger's reaction on your message (server/reactions.ts) moves
// from nothing or 👀 to 📤, 🛠️ or ❓, which it only does once the ask has been sent to a session. Seen live only: the
// first snapshot, a return to the screen (the app was hidden) and an older message never fire.
import { useEffect, useRef, type RefObject } from 'react'
import type { Message, Project, Session, Snapshot } from '../../shared/api.ts'
import { selfProject } from '../../src/ui/recursive-identity.ts'

/** Reactions that mean the ask reached a session (sent, working on it, waiting on you). */
const SENT = new Set(['📤', '🛠️', '❓'])
/** Reactions it comes from: none yet, or seen. */
const BEFORE = new Set([undefined, '👀'])
/** A message older than this is history, never a dispatch seen live. */
const RECENT = 30 * 60_000

/** Your messages whose ask was just handed to a session, between two snapshots of weevboss's thread. */
export function dispatched(prev: readonly Message[], next: readonly Message[], now: number, fired: ReadonlySet<string> = new Set()): string[] {
  const before = new Map(prev.map((m) => [m.id, m.reaction]))
  return next
    .filter((m) => m.role === 'user' && !fired.has(m.id) && now - m.at < RECENT && SENT.has(m.reaction ?? '') && BEFORE.has(before.get(m.id)))
    .map((m) => m.id)
}

/** Sessions that just moved (new, or a message more): when each was last seen moving. */
export function stirred(prev: readonly Session[], next: readonly Session[], at: number, into: Map<string, number>) {
  const was = new Map(prev.map((s) => [s.id, s]))
  for (const s of next) {
    const p = was.get(s.id)
    if (!p || s.messageCount > p.messageCount || (s.status === 'working' && p.status !== 'working')) into.set(s.id, at)
  }
  for (const [id, t] of into) if (at - t > 60_000) into.delete(id)
}

/** The session the work most likely went to: the one that moved last, within the last minute. */
export function target(moved: ReadonlyMap<string, number>, sessions: readonly Session[]): Session | undefined {
  let best: Session | undefined
  let when = -1
  for (const s of sessions) {
    const t = moved.get(s.id)
    if (t === undefined) continue
    if (t > when || (t === when && best && s.lastActivityAt > best.lastActivityAt)) { best = s; when = t }
  }
  return best
}

/** A project's colour as the app paints it: its slot, weevils' own repo the base of its gradient. */
export function projectColor(p: Project | undefined, colors: Record<string, string>): string {
  if (p && selfProject(p)) return 'color-mix(in oklch, var(--fy-g1), var(--fy-g2) 30%)'
  return `var(--${(p && colors[p.id]) ?? 'p0'})`
}

/** Watches weevboss's thread and plays the trail once per real dispatch. */
export function useDispatchTrail(snap: Snapshot, colors: Record<string, string>, menu: RefObject<HTMLElement | null>, from: RefObject<HTMLElement | null>) {
  const prev = useRef<{ snap: Snapshot; at: number } | null>(null)
  const fired = useRef(new Set<string>())
  const moved = useRef(new Map<string, number>())
  const shownAt = useRef(0)
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') shownAt.current = Date.now() }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  useEffect(() => {
    const at = Date.now()
    const last = prev.current
    prev.current = { snap, at }
    if (!last || last.snap === snap) return
    stirred(last.snap.sessions, snap.sessions, at, moved.current)
    const ids = dispatched(last.snap.main, snap.main, snap.now ?? at, fired.current)
    for (const id of ids) fired.current.add(id)
    // Away from the screen in between (or now): what changed meanwhile is not shown as if it just happened.
    if (!ids.length || document.visibilityState !== 'visible' || shownAt.current > last.at) return
    const s = target(moved.current, snap.sessions)
    const color = projectColor(s ? snap.projects.find((p) => p.id === s.projectId) : undefined, colors)
    if (menu.current) playTrail(menu.current, from.current, color)
  }, [snap]) // eslint-disable-line react-hooks/exhaustive-deps
}

const FLIGHT = 640
const TURN = 170
const EASE = 'cubic-bezier(.55,0,.2,1)'
const SVG = 'http://www.w3.org/2000/svg'

/** Is this element on the screen, and the topmost thing at its centre (no page, side bar or session over it)? */
function onTop(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null
  const hit = document.elementFromPoint(x, y)
  return hit && (hit === el || el.contains(hit) || hit.contains(el)) ? r : null
}

/** The trail itself: the weevil turns, a short glowing streak flies from it to the menu, the menu takes its colour. */
export function playTrail(menu: HTMLElement, root: HTMLElement | null, slot: string) {
  const end = onTop(menu)
  if (!end) return
  const color = vivid(menu, slot)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const weevil = root?.querySelector<HTMLElement>('.nx-working .working-logo')
  const start = !reduced && weevil ? onTop(weevil) : null
  if (!start || !weevil) return void pulse(menu, color, 0, reduced)

  // The weevil turns around (a small hop as it does), holds while the streak flies, and turns back.
  const total = TURN + FLIGHT + 180
  weevil.animate([
    { transform: 'scaleX(1)' },
    { transform: 'scaleX(-1) translateY(-10%)', offset: TURN / total / 2 },
    { transform: 'scaleX(-1)', offset: TURN / total },
    { transform: 'scaleX(-1)', offset: (TURN + FLIGHT) / total },
    { transform: 'scaleX(1)' },
  ], { duration: total, easing: 'ease-in-out' })

  // The path: from the weevil to the menu, bowed into the screen (to the right of the line between them).
  const sx = start.left + start.width / 2
  const sy = start.top + start.height * 0.35
  const ex = end.left + end.width / 2
  const ey = end.top + end.height / 2
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(len * 0.5, innerWidth * 0.55)
  const nx = (-dy / len) * bow
  const ny = (dx / len) * bow
  const d = `M${sx},${sy} C${sx + dx * 0.1 + nx},${sy + dy * 0.1 + ny} ${sx + dx * 0.7 + nx * 0.8},${sy + dy * 0.7 + ny * 0.8} ${ex},${ey}`

  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'nx-trail')
  svg.setAttribute('aria-hidden', 'true')
  // Three strokes of one curve make the streak, their heads moving together: a wide soft glow, the body, a bright head.
  const layers: [number, number, number, string][] = [
    [9, 0.24, 0.34, color],
    [3.2, 1, 0.2, color],
    [2.4, 1, 0.07, `color-mix(in oklch, ${color}, white 70%)`],
  ]
  const reach = 1 + layers[0][2]
  for (const [w, o, dash, c] of layers) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', d)
    p.setAttribute('pathLength', '1')
    p.style.cssText = `fill:none;stroke:${c};stroke-width:${w};stroke-opacity:${o};stroke-linecap:round;stroke-dasharray:${dash} 3;stroke-dashoffset:${dash}`
    svg.appendChild(p)
    p.animate([{ strokeDashoffset: dash }, { strokeDashoffset: dash - reach }], { duration: FLIGHT, delay: TURN * 0.8, easing: EASE, fill: 'forwards' })
  }
  document.body.appendChild(svg)
  svg.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: FLIGHT, delay: TURN * 0.8, fill: 'both' })
    .finished.catch(() => {}).finally(() => svg.remove())
  // The tail is still coming in as the head lands: the menu lights up as the head reaches it.
  pulse(menu, color, TURN * 0.8 + FLIGHT * 0.78, false)
}

/** The menu takes the colour for a moment (with a small pop and a ring, unless motion is reduced), then settles. */
function pulse(menu: HTMLElement, color: string, delay: number, reduced: boolean) {
  const ink = getComputedStyle(menu).color
  const lit = resolved(menu, color)
  menu.animate([
    { color: ink },
    { color: lit, offset: 0.12 },
    { color: lit, offset: 0.6 },
    { color: ink },
  ], { duration: reduced ? 1400 : 1200, delay, easing: 'ease-out' })
  if (reduced) return
  menu.querySelector('svg')?.animate([
    { transform: 'scale(1)' },
    { transform: 'scale(1.22)', offset: 0.35 },
    { transform: 'scale(1)' },
  ], { duration: 420, delay, easing: 'cubic-bezier(.3,1.4,.5,1)' })
  const ring = document.createElement('span')
  ring.className = 'nx-trail-ring'
  ring.style.setProperty('--c', color)
  menu.appendChild(ring)
  ring.animate([
    { transform: 'scale(.45)', opacity: 0.7 },
    { transform: 'scale(1.35)', opacity: 0 },
  ], { duration: 520, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.catch(() => {}).finally(() => ring.remove())
}

/** The project's colour made to read as a line: its slots are pale backgrounds (lightness 0.8), so on a light theme
 *  (dark ink) the same hue, deeper and richer; on a dark theme as it is. */
function vivid(at: HTMLElement, color: string): string {
  const ink = /\d+(\.\d+)?/g
  const [r, g, b] = (getComputedStyle(at).color.match(ink) ?? ['0', '0', '0']).map(Number)
  const base = resolved(at, color)
  if (0.2126 * r + 0.7152 * g + 0.0722 * b > 128) return base
  const deep = `oklch(from ${base} 0.56 calc(c * 1.5) h)`
  return CSS.supports('color', deep) ? deep : `color-mix(in oklch, ${base}, black 30%)`
}

/** A colour as the browser computes it there (a theme variable, a mix), so every browser can animate to it. */
function resolved(at: HTMLElement, color: string): string {
  const probe = document.createElement('span')
  probe.style.color = color
  probe.style.display = 'none'
  at.appendChild(probe)
  const c = getComputedStyle(probe).color
  probe.remove()
  return c || color
}
