// A real win (a conversation moved to another machine with its history, a machine joining for the first time, a request
// verified done, work landed on main, the vault in sync): a short colour sweep across the line that says it, and a
// handful of confetti from it, in the theme's own colours. Under 1.5 s, never blocking (no pointer events, nothing
// in the layout), no sound. « Reduce motion »: a soft glow of the same colours instead, no confetti.
//
// Fires once per win: an id seen on this device is never celebrated again (reload, another screen, the same line
// shown twice), and only a win that just happened (WIN_FRESH_MS) celebrates, so opening the app on another device
// replays nothing. Several wins at once (a batch landing together) make one celebration, on the last of them.
import type { Win } from '../../shared/api.ts'

/** A thread line celebrates when its win is this recent; a For you card (read later, seen-flag shared by devices) longer. */
export const WIN_FRESH_MS = 20 * 60_000
const SEEN_KEY = 'weevils-wins-seen'
const KEEP = 300
/** A celebration lasts ~1.3 s; anything arriving meanwhile joins it instead of starting another one. */
const BUSY_MS = 1600
const LAND_MS = 180

let seen: string[] | null = null
const load = (): string[] => {
  if (seen) return seen
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    seen = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    seen = []
  }
  return seen
}
const remember = (ids: string[]) => {
  const list = load()
  for (const id of ids) if (!list.includes(id)) list.push(id)
  if (list.length > KEEP) list.splice(0, list.length - KEEP)
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list))
  } catch { /* private mode: once per page instead */ }
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

let queue: { id: string; el: HTMLElement }[] = []
let flushing = false
let busyUntil = 0

/** What tests and the clip tool look at: how many celebrations ran, and which way. */
export const celebrations: { id: string; mode: 'confetti' | 'glow'; at: number }[] = []

/** Asks for the celebration of a win shown in el. Returns false when it will not run (seen, stale). */
export function celebrateWin(win: Win | undefined, el: HTMLElement | null, now = Date.now(), fresh = WIN_FRESH_MS): boolean {
  if (!win || !el) return false
  const list = load()
  if (list.includes(win.id) || queue.some((q) => q.id === win.id)) return false
  if (!(now - win.at < fresh && win.at - now < 60_000)) {
    remember([win.id])
    return false
  }
  queue.push({ id: win.id, el })
  if (!flushing) {
    flushing = true
    // Wins arriving in the same refresh land in one batch: one celebration, on the last one shown.
    const run = () => {
      flushing = false
      const batch = queue
      queue = []
      remember(batch.map((q) => q.id))
      if (Date.now() < busyUntil) return
      const live = batch.filter((q) => q.el.isConnected)
      const host = live.at(-1)
      if (!host) return
      busyUntil = Date.now() + BUSY_MS
      // The line lands first (it opens in place), then celebrates.
      setTimeout(() => host.el.isConnected && play(host.el, host.id), LAND_MS)
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(run, 0))
    else setTimeout(run, 0)
  }
  return true
}

/** Forget what was celebrated (tests). */
export function resetWins() {
  seen = []
  queue = []
  busyUntil = 0
  celebrations.length = 0
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch { /* nothing */ }
}

/** The theme's lively colours, then the line's own colour: never a generic rainbow. */
function palette(el: HTMLElement): string[] {
  const root = getComputedStyle(document.documentElement)
  const own = getComputedStyle(el).getPropertyValue('--c').trim()
  const vars = ['--fluo', '--auto-fluo', '--agent', '--p3', '--p8', '--p12', '--p0']
  const out = vars.map((v) => root.getPropertyValue(v).trim()).filter(Boolean)
  if (own) out.push(own, own)
  return out.length ? out : ['#39ff14', '#ff3df2', '#b39bff']
}

function overlay(el: HTMLElement): HTMLElement {
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  const o = document.createElement('span')
  o.className = 'win-layer'
  o.setAttribute('aria-hidden', 'true')
  el.appendChild(o)
  return o
}

function play(el: HTMLElement, id: string) {
  const colours = palette(el)
  const [a, b, c] = [colours[0], colours[1] ?? colours[0], colours.at(-1) ?? colours[0]]
  const reduce = reducedMotion()
  celebrations.push({ id, mode: reduce ? 'glow' : 'confetti', at: Date.now() })
  const layer = overlay(el)
  const done = () => layer.remove()
  if (typeof layer.animate !== 'function') return void setTimeout(done, 1200)
  if (reduce) {
    // A soft glow of the same colours, no movement.
    layer.style.background = `linear-gradient(90deg, color-mix(in oklab, ${a} 55%, transparent), color-mix(in oklab, ${c} 55%, transparent))`
    layer.animate([{ opacity: 0 }, { opacity: 0.55, offset: 0.3 }, { opacity: 0 }], { duration: 1400, easing: 'ease-in-out' }).onfinish = done
    return
  }
  navigator.vibrate?.([10, 60, 14])
  // The sweep: a band of the theme's colours crosses the line, left to right.
  const sweep = document.createElement('span')
  sweep.className = 'win-sweep'
  sweep.style.background = `linear-gradient(100deg, transparent 0%, color-mix(in oklab, ${a} 38%, transparent) 28%, color-mix(in oklab, ${b} 34%, transparent) 52%, color-mix(in oklab, ${c} 30%, transparent) 74%, transparent 100%)`
  layer.appendChild(sweep)
  sweep.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }], { duration: 1050, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' })
  // A small lift of the line itself, as it is touched by the sweep.
  el.animate([{ transform: 'none' }, { transform: 'scale(1.012)', offset: 0.35 }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.3,.7,.3,1)' })
  // The confetti: from the line's top edge, up and out a little, then down, in a fixed layer that follows the line
  // (the thread clips its rows; the confetti must not be cut).
  const burst = document.createElement('div')
  burst.className = 'win-burst'
  burst.setAttribute('aria-hidden', 'true')
  document.body.appendChild(burst)
  const r0 = el.getBoundingClientRect()
  const place = () => {
    const r = el.isConnected ? el.getBoundingClientRect() : r0
    burst.style.transform = `translate(${r.left}px, ${r.top}px)`
    burst.style.width = `${r.width}px`
  }
  place()
  let raf = requestAnimationFrame(function follow() {
    place()
    raf = requestAnimationFrame(follow)
  })
  const n = Math.max(22, Math.min(36, Math.round(r0.width / 11)))
  const anims: Animation[] = []
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i')
    const w = 6 + Math.random() * 5
    p.style.width = `${w}px`
    p.style.height = `${Math.random() < 0.35 ? w : w * 1.7}px`
    p.style.background = colours[i % colours.length]
    p.style.left = `${(0.15 + 0.7 * Math.random()) * 100}%`
    burst.appendChild(p)
    const dx = (Math.random() - 0.5) * 220
    const up = 60 + Math.random() * 80
    const fall = 40 + Math.random() * 70
    const spin = (Math.random() - 0.5) * 900
    const t = 1000 + Math.random() * 250
    anims.push(p.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(.6)', opacity: 0 },
      { transform: `translate(${dx * 0.55}px,${-up}px) rotate(${spin * 0.4}deg) scale(1)`, opacity: 1, offset: 0.32 },
      { transform: `translate(${dx * 0.85}px,${-up * 0.7}px) rotate(${spin * 0.7}deg) scale(1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx}px,${fall - up * 0.2}px) rotate(${spin}deg) scale(.9)`, opacity: 0 },
    ], { duration: t, delay: Math.random() * 90, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }))
  }
  let over = false
  const end = () => {
    if (over) return
    over = true
    cancelAnimationFrame(raf)
    burst.remove()
    done()
  }
  Promise.all(anims.map((x) => x.finished)).catch(() => undefined).finally(end)
  setTimeout(end, 2500) // a tab put away mid-flight pauses animations: never leave the layer behind

}

/** A ref for a row that may announce a win: celebrated once, when it is on screen. */
export const winRef = (win: Win | undefined) => (el: HTMLElement | null) => {
  if (el && win) celebrateWin(win, el)
}
