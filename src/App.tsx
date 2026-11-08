import { AnimatePresence, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, useLive } from './api'
import { Ctx, colorSlots, type AppCtx, type Page, type Theme } from './ui/app-context'
import { AgentBand, FootBand, ProjectBand } from './ui/bands'
import { spring } from './ui/bits'
import { H24Rail } from './ui/h24'
import { Login } from './ui/login'
import { PageView } from './ui/pages'

const THEME_COLOR = { light: '#B39BFF', dark: '#5522B5' }
const THEME_KEY = 'weevils-theme'

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* stockage indisponible */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const live = useLive()
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [h24Open, setH24Open] = useState(false)
  const [stack, setStack] = useState<Page[]>([])
  const stackRef = useRef<Page[]>([])
  const openers = useRef<(HTMLElement | null)[]>([])

  // Horloge commune à toutes les durées affichées.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (live.snap) setNow(Date.now())
  }, [live.snap])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      /* ignoré */
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  }, [theme])

  // Hauteur visible réelle (clavier iPhone ouvert) pour que la saisie reste au-dessus du clavier.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      root.style.setProperty('--vvh', `${vv.height}px`)
      root.style.setProperty('--vvt', `${vv.offsetTop}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // ---- Navigation par pages, branchée sur l'historique (bouton retour du navigateur).
  const setPages = useCallback((next: Page[]) => {
    stackRef.current = next
    setStack(next)
    document.body.style.overflow = next.length ? 'hidden' : ''
  }, [])

  const push = useCallback(
    (p: Page) => {
      openers.current[stackRef.current.length] = document.activeElement as HTMLElement | null
      const next = [...stackRef.current, p]
      setPages(next)
      history.pushState({ w: next.length }, '')
    },
    [setPages],
  )

  const replace = useCallback(
    (p: Page) => {
      const next = [...stackRef.current.slice(0, -1), p]
      setPages(next)
      history.replaceState({ w: next.length }, '')
    },
    [setPages],
  )

  const back = useCallback(() => {
    if (stackRef.current.length) history.back()
  }, [])

  useEffect(() => {
    history.replaceState({ w: 0 }, '')
    const onPop = (e: PopStateEvent) => {
      const w = (e.state as { w?: number } | null)?.w ?? 0
      if (w >= stackRef.current.length) return
      const opener = openers.current[w]
      setPages(stackRef.current.slice(0, w))
      setTimeout(() => opener?.focus?.({ preventScroll: true }), 60)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [setPages])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (stackRef.current.length) back()
      else if (h24Open) setH24Open(false)
      else setExpanded(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, h24Open])

  // Notification touchée : « /#s=<id> » au lancement, ou message du service worker si l'app est déjà ouverte.
  const ready = !!live.snap
  useEffect(() => {
    if (!ready) return
    const open = (url: string) => {
      const m = /#s=([^&]+)/.exec(url)
      if (m) {
        history.replaceState(history.state, '', location.pathname)
        push({ kind: 'session', id: decodeURIComponent(m[1]) })
      }
    }
    open(location.hash)
    const onMsg = (e: MessageEvent) => e.data?.type === 'open' && open(String(e.data.url))
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [ready, push])

  const logout = useCallback(() => {
    void api.logout().finally(() => live.setAuthed(false))
  }, [live])

  const projectIds = live.snap?.projects.map((p) => p.id).join('|') ?? ''
  const colors = useMemo(() => colorSlots(projectIds ? projectIds.split('|') : []), [projectIds])

  if (live.authed === false) return <Login onDone={() => live.setAuthed(true)} />
  if (!live.snap) {
    return (
      <main className="stack">
        <section className="band agent" style={{ ['--c' as string]: 'var(--agent)', flex: 1 }}>
          <div className="in head">
            <span className="name">weevils</span>
          </div>
          <div className="in meta summary">{live.offline ? 'VPS injoignable, nouvelle tentative…' : 'connexion au VPS…'}</div>
        </section>
      </main>
    )
  }

  const ctx: AppCtx = {
    snap: live.snap,
    now,
    offline: live.offline,
    colors,
    push,
    replace,
    back,
    expanded,
    setExpanded,
    h24Open,
    setH24Open,
    theme,
    setTheme,
    refresh: live.refresh,
    logout,
  }

  return (
    <Ctx.Provider value={ctx}>
      <MotionConfig reducedMotion="user" transition={spring}>
        <main className="stack" aria-hidden={stack.length > 0 || undefined} inert={stack.length > 0}>
          <AgentBand />
          {live.snap.projects.map((p) => (
            <ProjectBand key={p.id} project={p} />
          ))}
          <FootBand />
        </main>
        <div inert={stack.length > 0}>
          <H24Rail />
        </div>
        <AnimatePresence>
          {stack.map((p, i) => (
            <PageView key={`${i}:${p.kind}:${p.kind === 'files' ? `${p.repo}/${p.dir}` : ''}`} page={p} />
          ))}
        </AnimatePresence>
      </MotionConfig>
    </Ctx.Provider>
  )
}
