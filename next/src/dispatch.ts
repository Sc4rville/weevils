// weevboss handing work to a session, seen on its screen: a short flat line of the session's project colour runs from
// its little weevil (the working mark at the foot of the thread) to the menu (the three bars), which takes that colour
// for a moment, then settles back. docs/next-interaction.md « weevboss hands work over ».
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

const FLIGHT = 560
const EASE = 'cubic-bezier(.5,0,.2,1)'
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

/** The trail itself, in the app's own flat style: one short line of the project's colour with the hard ink shadow of
 *  the app's marks (no glow, no sparkle), runs from the weevil to the menu, and the menu takes its colour. */
export function playTrail(menu: HTMLElement, root: HTMLElement | null, slot: string) {
  const end = onTop(menu)
  if (!end) return
  const color = vivid(menu, slot)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const weevil = root?.querySelector<HTMLElement>('.nx-working .working-logo')
  const start = !reduced && weevil ? onTop(weevil) : null
  if (!start) return void pulse(menu, color, 0)

  // The path: from the weevil to the menu, gently bowed into the screen (to the right of the line between them).
  const sx = start.left + start.width / 2
  const sy = start.top + start.height * 0.35
  const ex = end.left + end.width / 2
  const ey = end.top + end.height / 2
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  const bow = Math.min(len * 0.3, innerWidth * 0.35)
  const nx = (-dy / len) * bow
  const ny = (dx / len) * bow
  const d = `M${sx},${sy} C${sx + dx * 0.15 + nx},${sy + dy * 0.15 + ny} ${sx + dx * 0.75 + nx * 0.7},${sy + dy * 0.75 + ny * 0.7} ${ex},${ey}`

  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'nx-trail')
  svg.setAttribute('aria-hidden', 'true')
  // One segment of the curve travels along it, square-ended, over its ink shadow offset 2px (the app's flat shadow).
  const dash = 0.22
  const reach = 1 + dash
  let run: Animation | undefined
  for (const [c, shift] of [['var(--ink)', 2], [color, 0]] as const) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', d)
    p.setAttribute('pathLength', '1')
    if (shift) p.setAttribute('transform', `translate(${shift} ${shift})`)
    p.style.cssText = `fill:none;stroke:${c};stroke-width:3;stroke-linecap:butt;stroke-linejoin:miter;stroke-dasharray:${dash} 3;stroke-dashoffset:${dash}`
    svg.appendChild(p)
    run = p.animate([{ strokeDashoffset: dash }, { strokeDashoffset: dash - reach }], { duration: FLIGHT, easing: EASE, fill: 'forwards' })
  }
  document.body.appendChild(svg)
  run?.finished.catch(() => {}).finally(() => svg.remove())
  // The menu takes the colour as the line reaches it.
  pulse(menu, color, FLIGHT * 0.8)
}

/** The menu takes the colour for a moment, then settles: colour only, nothing pops. */
function pulse(menu: HTMLElement, color: string, delay: number) {
  const ink = getComputedStyle(menu).color
  const lit = resolved(menu, color)
  menu.animate([
    { color: ink },
    { color: lit, offset: 0.1 },
    { color: lit, offset: 0.6 },
    { color: ink },
  ], { duration: 1200, delay, easing: 'ease-out' })
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
