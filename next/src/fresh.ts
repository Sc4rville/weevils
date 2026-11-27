// weevils next stays up to date by itself. An app installed on an iPhone is kept in memory for hours and woken up
// without being loaded again, and the service worker never reloads next (public/sw.js): an iPhone kept running the
// camera of the morning after its fix was live (2026-11-23). So each time the app comes back to the screen, and every
// few minutes while it is on it, it asks the server which build it serves now; another one, and nothing under way
// (a word being written, a capture, a send, a recording), the page loads again. The held capture survives it.
import { updateIsBusy } from '../../src/update-guard.ts'

const EVERY = 5 * 60_000
const ONCE = 'weevils-next-fresh'

/** This page's own bundle (« /assets/index-….js »), or null out of a build (the dev server). */
export function ownBuild(url: string = import.meta.url): string | null {
  const p = new URL(url).pathname
  return /^\/assets\/index-[\w-]+\.js$/.test(p) ? p : null
}

/** The bundle a page of the app loads now, read from its HTML. */
export function servedBuild(html: string): string | null {
  return /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1] ?? null
}

/** Something under way the reload would lose or interrupt. */
export function busy(): boolean {
  if (updateIsBusy()) return true
  if (document.querySelector('.cam-freeze, [aria-busy="true"]')) return true
  const a = document.activeElement as HTMLElement | null
  if (a?.closest?.('textarea, input, [contenteditable="true"]')) return true
  return [...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"], input:not([type])')].some((el) => el.value.trim() !== '')
}

/** Asks now, without waiting for the next return to the screen: something just showed this page is older than the
 *  server's build (a theme it does not know, src/ui/theme-try.tsx). Nothing out of a build. */
export const freshNow = (): void => void checkNow?.()
let checkNow: (() => Promise<void>) | null = null

export function keepFresh(): void {
  const mine = ownBuild()
  if (!mine) return
  let checking = false
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return
    checking = true
    try {
      const r = await fetch('/', { cache: 'no-store', credentials: 'same-origin' })
      if (!r.ok) return
      const now = servedBuild(await r.text())
      if (!now || now === mine || !/^\/assets\/index-/.test(now)) return
      // Loaded once already for this build and still not on it: never a page that reloads in a loop.
      try { if (sessionStorage.getItem(ONCE) === now) return } catch { /* no storage */ }
      if (busy()) return // next time it comes back, or in a few minutes
      try { sessionStorage.setItem(ONCE, now) } catch { /* no storage */ }
      location.reload()
    } catch {
      /* offline: next time */
    } finally {
      checking = false
    }
  }
  checkNow = check
  document.addEventListener('visibilitychange', () => { void check() })
  addEventListener('pageshow', (e) => { if (e.persisted) void check() })
  setInterval(() => { void check() }, EVERY)
}
