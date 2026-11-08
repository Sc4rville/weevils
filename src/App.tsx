import { AnimatePresence, MotionConfig } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { loadState, reducer, routeCommand, saveState, uid, type Target } from './state/store'
import { Ctx, type AppCtx, type Page } from './ui/app-context'
import { AgentBand, DemoBand, ProjectBand } from './ui/bands'
import { spring } from './ui/bits'
import { H24Rail } from './ui/h24'
import { PageView } from './ui/pages'

const REPLY_DELAY = 900
const THEME_COLOR = { light: '#B39BFF', dark: '#5522B5' }

const pageKey = (p: Page, i: number) => `${i}:${p.kind}:${'id' in p ? p.id : p.projectId}:${'path' in p ? p.path : ''}`

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState(Date.now()))
  const stateRef = useRef(state)
  stateRef.current = state
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

  useEffect(() => saveState(state), [state])

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[state.theme])
  }, [state.theme])

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

  // ---- Actions de démo (réponses simulées, jamais d'appel réseau).
  const act = useMemo<AppCtx['act']>(() => {
    const replyLater = (target: Target, sourceId: string) =>
      setTimeout(() => dispatch({ type: 'reply', target, msgId: `${sourceId}-r`, at: Date.now() }), REPLY_DELAY)
    return {
      sendToSession(id, text) {
        const msgId = uid('m')
        const target: Target = { kind: 'session', id }
        dispatch({ type: 'send', target, msgId, text, at: Date.now() })
        replyLater(target, msgId)
      },
      sendToConversation(id, text) {
        const msgId = uid('m')
        const target: Target = { kind: 'conversation', id }
        dispatch({ type: 'send', target, msgId, text, at: Date.now() })
        replyLater(target, msgId)
      },
      sendMain(text) {
        const route = routeCommand(stateRef.current, text)
        const msgId = uid('w')
        dispatch({ type: 'main/send', msgId, text, route, at: Date.now() })
        setExpanded('agent')
        if (route.kind === 'forward') replyLater({ kind: 'session', id: route.sessionId }, `${msgId}-f`)
        if (route.kind === 'open') setTimeout(() => push({ kind: 'session', id: route.sessionId }), 450)
      },
      chooseMain(mainMsgId, sessionId) {
        dispatch({ type: 'main/choose', mainMsgId, sessionId, at: Date.now() })
        replyLater({ kind: 'session', id: sessionId }, `${mainMsgId}-f`)
      },
      createSession(projectId, tool, title, text) {
        const id = uid('s')
        dispatch({ type: 'session/create', id, projectId, tool, title, text, at: Date.now() })
        if (text.trim()) replyLater({ kind: 'session', id }, `${id}-m1`)
        return id
      },
      fireTerminal() {
        dispatch({ type: 'event/terminal', at: Date.now() })
        setExpanded(null)
        setTimeout(() => {
          const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
          document.querySelector('[data-project="lws"]')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
        }, 80)
      },
      reset() {
        dispatch({ type: 'reset', at: Date.now() })
        setExpanded(null)
        setH24Open(false)
        window.scrollTo({ top: 0 })
      },
    }
  }, [push])

  const ctx: AppCtx = { state, dispatch, now, push, replace, back, expanded, setExpanded, h24Open, setH24Open, act }
  const projects = state.projects

  return (
    <Ctx.Provider value={ctx}>
      <MotionConfig reducedMotion="user" transition={spring}>
        <main className="stack" aria-hidden={stack.length > 0 || undefined} inert={stack.length > 0}>
          <AgentBand />
          {projects.map((p) => (
            <ProjectBand key={p.id} project={p} />
          ))}
          <DemoBand />
        </main>
        <div inert={stack.length > 0}>
          <H24Rail />
        </div>
        <AnimatePresence>
          {stack.map((p, i) => (
            <PageView key={pageKey(p, i)} page={p} />
          ))}
        </AnimatePresence>
      </MotionConfig>
    </Ctx.Provider>
  )
}
