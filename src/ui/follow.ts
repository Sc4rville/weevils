import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// Le regard suit l'action : trois outils partagés par toute l'app.
// - useFollow : un fil qui défile garde sa fin sous les yeux pendant qu'elle s'écrit, sauf si l'utilisateur remonte lire.
// - reveal : un élément hors du champ y est amené d'un défilement court, puis mis en avant un instant.
// - focusBoss : un parcours (branchement) ou une action qui répond dans le fil de weevboss : le fil s'ouvre en haut de
//   l'écran, d'où qu'on vienne (une page par-dessus, le bas du flux), et sa prochaine réponse est mise en avant.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const behavior = (): ScrollBehavior => (reduced() ? 'auto' : 'smooth')

/**
 * Garde la fin d'un fil visible. `open` : le fil est affiché (à l'ouverture, on y est déjà, sans défilement visible).
 * On suit tout ce qui allonge le contenu (nouveau message qui se déplie, réponse qui s'écrit, indicateur de travail),
 * image par image : le mouvement suit l'animation du contenu, sans saut. Seul un geste de l'utilisateur (doigt,
 * molette, clavier) peut décrocher le suivi, quand il remonte à plus de `stick` px du bas ; revenir en bas le raccroche.
 * `grow` : une clé qui change quand le contenu s'allonge (suivi immédiat au rendu, en plus de l'observateur de taille).
 * Renvoie `reading` (vrai pendant qu'il relit plus haut) et `toEnd()` (redescendre en douceur, ex. après un envoi).
 */
export function useFollow(ref: RefObject<HTMLElement | null>, open = true, stick = 80, grow?: unknown) {
  const reading = useRef(false)
  const user = useRef({ touching: false, until: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !open) return
    el.scrollTop = el.scrollHeight
    reading.current = false
  }, [ref, open])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const u = user.current
    const mark = (ms: number) => () => (u.until = Date.now() + ms)
    const down = () => (u.touching = true)
    const up = () => {
      u.touching = false
      u.until = Date.now() + 1200 // l'élan du doigt continue de défiler
    }
    const wheel = mark(400)
    const key = mark(600)
    const onScroll = () => {
      if (!u.touching && Date.now() > u.until) return // notre propre défilement, ou le contenu qui bouge
      reading.current = el.scrollHeight - el.scrollTop - el.clientHeight > stick
    }
    const pin = () => {
      if (!reading.current && el.isConnected && el.clientHeight > 0) el.scrollTop = el.scrollHeight
    }
    // Le contenu grandit (message qui se déplie, texte qui arrive) : on suit, à chaque changement de taille.
    const ro = new ResizeObserver(pin)
    const watch = () => {
      ro.disconnect()
      for (const c of Array.from(el.children)) ro.observe(c)
    }
    watch()
    const mo = new MutationObserver(() => {
      watch()
      pin()
    })
    mo.observe(el, { childList: true })
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: true })
    el.addEventListener('touchcancel', up, { passive: true })
    el.addEventListener('pointerdown', down, { passive: true })
    el.addEventListener('pointerup', up, { passive: true })
    el.addEventListener('wheel', wheel, { passive: true })
    el.addEventListener('keydown', key)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
      el.removeEventListener('touchcancel', up)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('keydown', key)
      el.removeEventListener('scroll', onScroll)
    }
  }, [ref])
  // Ce qui allonge le contenu, connu de l'appelant (dernier message, indicateur de travail) : on suit aussi au rendu,
  // sans attendre l'observateur de taille.
  useEffect(() => {
    const el = ref.current
    if (el && open && !reading.current) el.scrollTop = el.scrollHeight
  }, [ref, open, grow])
  return {
    reading,
    /** Redescendre en douceur et reprendre le suivi (après un envoi : sa réponse arrive en bas). */
    toEnd: () => {
      const el = ref.current
      reading.current = false
      el?.scrollTo({ top: el.scrollHeight, behavior: behavior() })
    },
  }
}

/** L'élément est-il entièrement visible, dans la fenêtre et dans ses conteneurs qui défilent ? */
function inView(el: Element) {
  const r = el.getBoundingClientRect()
  const vh = window.visualViewport?.height ?? window.innerHeight
  if (r.top < 0 || r.bottom > vh) return false
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (!/(auto|scroll|hidden)/.test(s.overflowY)) continue
    const b = p.getBoundingClientRect()
    if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return false
  }
  return true
}

/**
 * Amène un élément sous les yeux (défilement doux, seulement s'il n'y est pas déjà) et le met en avant un instant.
 * `block` : où le poser s'il faut défiler ('nearest' par défaut : le plus petit mouvement possible).
 */
export function reveal(el: Element | null | undefined, opts: { block?: ScrollLogicalPosition; flash?: boolean } = {}) {
  if (!el) return
  if (!inView(el)) el.scrollIntoView({ behavior: behavior(), block: opts.block ?? 'nearest' })
  if (opts.flash !== false) flash(el)
}

/** Une brève mise en avant (la bande s'éclaire puis revient) : « c'est ici ». */
export function flash(el: Element | null | undefined) {
  if (!el || reduced()) return
  el.classList.remove('wv-flash')
  void (el as HTMLElement).offsetWidth // relance l'animation si elle tournait déjà
  el.classList.add('wv-flash')
  window.setTimeout(() => el.classList.remove('wv-flash'), 1100)
}

/** Le fil de weevboss, ouvert en haut de l'écran, d'où qu'on soit (App.tsx l'écoute). `mid` : le message à mettre en
 * avant (sinon, le prochain qui arrive). */
export const FOCUS_BOSS = 'weevils:focus-boss'
export const focusBoss = (mid?: string) => window.dispatchEvent(new CustomEvent<string | undefined>(FOCUS_BOSS, { detail: mid }))

/** Attend qu'une condition soit vraie (image par image), au plus `ms`, puis appelle `then` (même si elle ne l'est pas). */
export function when(ok: () => boolean, then: () => void, ms = 800) {
  const end = Date.now() + ms
  const tick = () => (ok() || Date.now() > end ? then() : requestAnimationFrame(tick))
  tick()
}

/** Dans le fil ouvert de weevboss : met en avant le message `mid`, ou le prochain message qui arrive (6 s au plus). */
export function flashBossMessage(mid?: string) {
  const chat = () => document.querySelector<HTMLElement>('.band.agent .chat')
  const all = () => Array.from(chat()?.querySelectorAll<HTMLElement>('[data-mid]') ?? [])
  const before = new Set(all().map((e) => e.dataset.mid))
  let found: HTMLElement | undefined
  when(
    () => {
      found = mid ? all().find((e) => e.dataset.mid === mid) : all().find((e) => !before.has(e.dataset.mid))
      return !!found
    },
    () => {
      if (!found) return
      // Le message vient de se déplier (Appear) : on le met en avant une fois posé.
      const el = found
      window.setTimeout(() => reveal(el, { block: 'nearest' }), 260)
    },
    6000,
  )
}

/** Fait défiler la fenêtre (le flux des bandes) en douceur jusqu'en haut, où vit weevboss. */
export const toTop = () => window.scrollTo({ top: 0, behavior: behavior() })
