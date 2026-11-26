// weevils next — weevboss full screen, a side bar for the rest, and a session that weevboss covers again from the top.
// Built from weevils' own identity: its themes (src/styles.css tokens), icons and logo, its message renderer (Prose),
// the green working star, the magenta automation loop, bold for what is active. Data: the same /api, nothing faked.
import '../../src/styles.css'
import '../../src/ui/living-link.css'
import '../../src/ui/foryou.css'
import './next.css'
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useTransform, type PanInfo } from 'motion/react'
import type { Optimizer, Project, Session, Snapshot } from '../../shared/api.ts'
import { autoOfSession } from '../../src/ui/auto-model.ts'
import { screenHeight, trackFullHeight } from '../../src/ui/viewport.ts'
import { improvingProject, mainProjectRank, selfProject } from '../../src/ui/recursive-identity.ts'
import { Ctx, THEME_COLOR, colorSlots, isTheme, type AppCtx, type Page, type Theme } from '../../src/ui/app-context.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { FootBand } from '../../src/ui/bands.tsx'
import { Collapse, WorkingMark, composerLook, spring, threadLook } from '../../src/ui/bits.tsx'

// Every box to write in next is the roomy one weevboss has (docs/next-interaction.md).
composerLook.multiline = true
// …and every conversation reads like weevboss's: each message under its author's name.
threadLook.authorsInSessions = true
import { useT } from '../../src/i18n/index.ts'
import BM from '../../src/i18n/bands.ts'
import { AutoMark, G, Icon } from '../../src/ui/icons.tsx'
import { WeevbossLogo } from '../../src/ui/logo.tsx'
import { api } from '../../src/api.ts'
import { call, useAuth, useSnapshot } from './data.ts'
import { Sky } from './sky.tsx'
import { Chat } from './chat.tsx'
import { slide } from './moves.ts'
import { foldPrefs, saveFold } from './fold.ts'
import { closesSideBar } from './keys.ts'
import { registerWorker, useWorker } from './worker.ts'
import { keepFresh } from './fresh.ts'
import { pageLink } from '../../shared/pages.ts'
import { toAutos, toBoss, type Reach } from './reach.ts'
import { FOCUS_BOSS } from '../../src/ui/follow.ts'
import { NextProjectPage } from './project.tsx'
import { NextAutoPage } from './auto.tsx'
import { drawerOn, drawerPinned, FactorySection, NextMachinePage, pinnedProject, shownNow, useFlips } from './factory.tsx'
import { PinMark } from './pin.tsx'
import { TalkCtx, useTalk, useTalks } from '../../src/ui/auto-talk.ts'
import { useApp } from '../../src/ui/app-context.tsx'
import { TopWords, useTop } from '../../src/ui/foryou-top.tsx'
import { ForYouPage } from '../../src/ui/foryou.tsx'
import { Camera, type Spot } from './camera.tsx'
import { NewPage, PageStudio, PagesSection, type NxPage } from './pages.tsx'
import { TourLayer, useTour } from './tour.tsx'

const THEME_KEY = 'weevils-theme'
/** One motion for every move in next (docs/next-interaction.md): the app's own page spring (bits.tsx spring), the
 *  one its pages slide in with. */
const SLIDE = spring
const PANEL = spring
const STRIP = 46
/** How far a page was dragged to the right by its back swipe (0 when it was not). */
function draggedRight(el: Element | null | undefined): number {
  const page = el?.querySelector('.page') ?? null
  if (!page) return 0
  const m = new DOMMatrix(getComputedStyle(page).transform)
  return m.m41 > 20 ? m.m41 : 0
}
/** The star band: as thin as the menu button, the rows of stars packed into it, the rest for the conversation. */
const SKY = 52

/** The theme: one for every device and address of this weevils (POST /api/theme, carried back by the snapshot), the
 *  same as the classic app's; kept on the device too, for the first paint. A pick holds for 4 s against an older
 *  snapshot still on its way. */
function useTheme(shared: string | undefined): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      if (isTheme(t)) return t
    } catch { /* no storage */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const pickedAt = useRef(0)
  useEffect(() => {
    if (isTheme(shared) && Date.now() - pickedAt.current > 4000) setTheme(shared)
  }, [shared])
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* no storage */ }
  }, [theme])
  const pick = useCallback((t: Theme) => {
    pickedAt.current = Date.now()
    setTheme(t)
    void call('POST', '/api/theme', { theme: t }).catch(() => undefined)
  }, [])
  return [theme, pick]
}

/** The real height of the screen and of the status bar (the strip sits under it). */
function useScreen() {
  // The stage's own height (src/ui/viewport.ts screenHeight): installed on an iPhone it can be a status bar taller than
  // innerHeight, and weevboss's strip, placed from it, would then sit that much too low over the session's head.
  const [h, setH] = useState(() => screenHeight())
  const [safeT, setSafeT] = useState(0)
  useLayoutEffect(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top);visibility:hidden'
    document.body.appendChild(probe)
    const read = () => { setH(screenHeight()); setSafeT(probe.getBoundingClientRect().height) }
    read()
    addEventListener('resize', read)
    return () => { removeEventListener('resize', read); probe.remove() }
  }, [])
  return { h, safeT }
}

const working = (s: Session) => s.status === 'working'
const live = (s: Session) => s.status === 'working' || s.status === 'needs_user'

function StatusMark({ s }: { s: Session }) {
  if (s.status === 'working') return <span className="spin fluo"><Icon name="star" /></span>
  if (s.status === 'needs_user') return <Icon name="waits" />
  if (s.status === 'interrupted') return <span className="alert"><Icon name="bang" /></span>
  if (s.status === 'done') return <Icon name="check" />
  return <Icon name="idle" />
}

/** What a working session shows: the automation loop (AutoMark) only when an automation carries it, as in the app's
 *  StatusChar; any other working session, background tasks included, has the green star. */
function Sign({ snap, s }: { snap: Snapshot; s: Session }) {
  if (s.status === 'working' && autoOfSession(snap, s.id)) return <AutoMark />
  return <StatusMark s={s} />
}
const alone = (snap: Snapshot, s: Session) => s.status === 'working' && !!autoOfSession(snap, s.id)

/** One project as on the original home: its band in its colour (weevils itself in the recursive signature), its name
 *  bold while something of it works, and its sessions under it. Done sessions stay folded behind the name. */
/** boss: this is weevils' own repo, one block with weevboss (they are the same thing: weevils improving itself). Its
 *  head is weevboss's logo and « weevils », and a tap opens weevboss's conversation; « / » and « > » stay the repo's. */
/** Reserved project ids (server/projects.ts): automations' own folder, and Misc. */
const AUTO_DIR = 'auto'
const MISC = 'divers'

function ProjectGroup({ snap, project, color, current, open, page, boss, pinned = false }: { snap: Snapshot; project: Project; color: string; current: string | null; open: (id: string | null) => void; page: (p: Page) => void; boss?: boolean; pinned?: boolean }) {
  const sessions = snap.sessions.filter((s) => !s.archived && s.projectId === project.id)
  const rank = (s: Session) => (s.status === 'needs_user' ? 0 : s.status === 'working' ? 1 : s.status === 'interrupted' ? 2 : 3)
  const active = sessions.filter((s) => s.status !== 'done').sort((a, b) => rank(a) - rank(b) || b.openedAt - a.openedAt)
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 8)
  const [more, setMore] = useState(false)
  // A tap on its name folds its sessions away or brings them back, as on the app's home (bands.tsx: same key, so the
  // choice is kept from one visit to the next).
  const [folded, setFolded] = useState(() => !!foldPrefs()[project.id])
  const fold = () => setFolded((v) => (saveFold(project.id, !v), !v))
  const busy = active.some(working)
  const recursive = selfProject(project)
  const improving = improvingProject(project, sessions)
  return (
    <section className={`nx-project band ${recursive ? 'recursive-identity' : ''} ${improving ? 'recursive-active' : ''}`} style={{ '--c': `var(--${color})` } as React.CSSProperties}>
      <div className="nx-project-line">
        {boss ? (
          <div className={`nx-row nx-project-head nx-boss-row ${current === null ? 'nx-active' : ''}`}>
            {/* Its logo opens weevboss's conversation; its name folds its sessions, like every project's name. */}
            <button className="nx-boss-logo" onClick={() => open(null)} aria-label="Open weevboss"><WeevbossLogo className="nx-logo" /></button>
            <button className="nx-fold" onClick={fold} aria-expanded={!folded}>
              <span className="nx-row-title nx-project-name">weevils</span>
              {active.some((s) => working(s) && !alone(snap, s)) && <span className="spin fluo"><Icon name="star" /></span>}
            </button>
          </div>
        ) : (
        <button className={`nx-row nx-project-head nx-repo-row ${busy ? 'nx-active' : ''}`} onClick={fold} aria-expanded={!folded}>
          {/* In the weevils logo's column, its name under the « w » of weevils. */}
          <span className="nx-repo-mark" aria-hidden><Icon name="repo" />{pinned && <PinMark />}</span>
          <span className="nx-row-title nx-project-name">{project.name}</span>
          {active.some((s) => working(s) && !alone(snap, s)) && <span className="spin fluo"><Icon name="star" /></span>}
        </button>
        )}
        {/* As on the original home band: « / » its files, « > » its page (what runs, its requests, its sessions). */}
        <div className="chars">
          {project.repos.length > 0 && (
            <button className="ch" aria-label={`Files of ${project.name}`} onClick={() => page({ kind: 'files', projectId: project.id })}>
              <Icon name="slash" />
            </button>
          )}
          <button className="ch" aria-label={`Open ${project.name}`} onClick={() => page({ kind: 'project', projectId: project.id })}>
            <G c=">" />
          </button>
        </div>
      </div>
      <Collapse open={!folded}>
      {[...active, ...(more ? done : [])].map((s) => (
        <button key={s.id} className={`nx-row nx-sub ${s.status === 'needs_user' ? 'tone' : ''} ${live(s) ? 'nx-active' : ''} ${current === s.id ? 'nx-current' : ''}`} onClick={() => open(s.id)}>
          <span className="nx-mark"><Sign snap={snap} s={s} /></span>
          <span className="nx-row-text">
            <span className="nx-row-title">{s.title || 'Untitled'}</span>
            {(s.status === 'needs_user' ? s.attention : s.status === 'working' ? s.now : undefined) && (
              <span className="nx-row-sub">{s.status === 'needs_user' ? s.attention : s.now}</span>
            )}
          </span>
        </button>
      ))}
      {/* Finished sessions wait under their own line. */}
      {done.length > 0 && (
        <button className="nx-row nx-sub nx-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <span className="nx-mark" />
          <span className="nx-row-text"><span className="nx-row-sub">{more ? 'Hide done' : `${done.length} done`}</span></span>
        </button>
      )}
      </Collapse>
    </section>
  )
}

/** still: shown again in place (no slide), as the page that covered it leaves. */
function SideBar({ snap: all, colors, current, open, close, page, openPages, still = false }: {
  still?: boolean
  page: (p: NxPage) => void
  /** The pages of the pages band open right now (bold in it). */
  openPages: Set<string>
  snap: Snapshot
  colors: Record<string, string>
  current: string | null
  open: (id: string | null) => void
  close: () => void
}) {
  // A page's conversation lives in the pages band, never under a project (pages.tsx).
  const building = new Set((all.pageBand ?? []).flatMap((p) => (p.session ? [p.session] : [])))
  const snap = building.size ? { ...all, sessions: all.sessions.filter((s) => !building.has(s.id)) } : all
  // Projects as on the original home: weevils itself first, then what works, then the most recent.
  const last = (p: Project) => Math.max(0, ...snap.sessions.filter((s) => s.projectId === p.id && !s.archived).map((s) => s.lastActivityAt))
  const busy = (p: Project) => snap.sessions.some((s) => s.projectId === p.id && !s.archived && live(s))
  // « auto » is where automations without a repo run: backend, never a project of yours (an automation shows on its
  // own row below). « Misc » shows only when one of its conversations needs you.
  // Your factory decides which projects are here (factory.tsx inSideBar): never one switched off there, pinned ones
  // always, the others while they have conversations; a switch just flipped shows here at once (shownNow).
  useFlips(snap)
  // Misc follows its drawer's choice (shared/drawers.ts): pinned, out, or shown while one of its conversations needs you.
  const projects = snap.projects
    .filter((p) => p.id !== AUTO_DIR && (p.id === MISC ? drawerOn(snap, 'misc') : shownNow(snap, p)))
    .sort((a, b) => mainProjectRank(a, busy(a) ? 0 : 1) - mainProjectRank(b, busy(b) ? 0 : 1) || last(b) - last(a))
  const self = snap.projects.find((p) => selfProject(p))
  const [autosFolded, setAutosFolded] = useState(() => !!foldPrefs().__automations)
  const foldAutos = () => setAutosFolded((v) => (saveFold('__automations', !v), !v))
  const autos = (snap.optimizers ?? []).filter((o) => o.state !== 'proposed' && o.state !== 'refused')
  const autosOn = drawerOn(snap, 'autonomous')
  const autoRank = (o: Optimizer) => (o.state === 'running' ? 0 : o.state === 'queued' ? 1 : 2)
  autos.sort((a, b) => autoRank(a) - autoRank(b))
  // « + » as in the app's automations drawer (h24.tsx): a new automation, opened at once on its talk.
  const talks = useTalk()
  const [creating, setCreating] = useState(false)
  const create = () => {
    if (creating) return
    setCreating(true)
    talks.create().then((o) => page({ kind: 'auto', id: o.id })).catch(() => undefined).finally(() => setCreating(false))
  }
  const x = useMotionValue(0)
  // Closing takes a clear, sideways drag: past 38 % of the bar (never under the app's 110 px back swipe), or a real
  // fling (the app's 600 px/s, plus 40 px of travel so a flick while scrolling does not count). Less snaps back open.
  const nav = useRef<HTMLElement>(null)
  const onEnd = (_: unknown, i: PanInfo) => {
    const width = nav.current?.offsetWidth ?? 340
    const far = i.offset.x < -Math.max(110, width * 0.38)
    const fling = i.velocity.x < -600 && i.offset.x < -40
    if (far || fling) close()
    else void animate(x, 0, PANEL)
  }
  // Escape on a computer's keyboard closes it, as a tap outside it does.
  const closeNow = useRef(close)
  closeNow.current = close
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (closesSideBar(e)) closeNow.current() }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [])
  // A drag that ends over a row is not a tap on it.
  const dragged = useRef(false)
  const noTapAfterDrag = (e: React.MouseEvent) => { if (dragged.current) { e.preventDefault(); e.stopPropagation() } }
  return (
    <>
      <motion.div className="nx-scrim" initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
      <motion.nav className="nx-side" style={{ x }} initial={still ? false : { x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={PANEL}
        ref={nav} onPointerDownCapture={() => { dragged.current = false }} onDragStart={() => { dragged.current = true }} onClickCapture={noTapAfterDrag} drag="x" dragDirectionLock dragConstraints={{ left: -400, right: 0 }} dragElastic={{ left: 0.2, right: 0 }} dragMomentum={false} onDragEnd={onEnd}>
        <div className="nx-side-scroll" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
          {/* weevboss and weevils' own repo are one block at the top (weevils improving itself). Where weevboss has no
              repo of its own (anyone else's install), the block is its logo and « weevils » alone. */}
          {self ? (
            <ProjectGroup snap={snap} project={self} color={colors[self.id] ?? 'p0'} current={current} open={open} page={page} boss />
          ) : (
            <button className={`nx-row nx-boss-row band recursive-identity recursive-active ${current === null ? 'nx-active' : ''}`} onClick={() => open(null)} aria-label="weevboss">
              <WeevbossLogo className="nx-logo" />
              <span className="nx-row-title">weevils</span>
            </button>
          )}
          {projects.filter((p) => p !== self).map((p) => (
            <ProjectGroup key={p.id} snap={snap} project={p} color={colors[p.id] ?? 'p0'} current={current} open={open} page={page}
              pinned={p.id === MISC ? drawerPinned(snap, 'misc') : pinnedProject(snap, p)} />
          ))}
          {autosOn && (
            <section className="nx-project nx-autos band" style={{ '--c': 'var(--h24)' } as React.CSSProperties}>
              {/* A tap on its name folds it, like a project's (same motion, kept from one visit to the next). */}
              <div className="nx-project-line">
                {/* Laid out like weevils and the repos: its icon in the logo's column, its name under the « w ». No star:
                    while anything here runs, that icon itself lights up and turns (the app's AutoMark); else it rests. */}
                <button className="nx-row nx-project-head nx-repo-row" onClick={foldAutos} aria-expanded={!autosFolded}>
                  <span className="nx-repo-mark nx-autos-mark" aria-hidden>{autos.some((o) => o.state === 'running') ? <AutoMark /> : <Icon name="cycle" />}{drawerPinned(snap, 'autonomous') && <PinMark />}</span>
                  <span className="nx-row-title nx-project-name">autonomous</span>
                </button>
                <div className="chars">
                  <button className="ch" aria-label="New automation" disabled={creating} onClick={create}>
                    {creating ? <AutoMark /> : <Icon name="plus" />}
                  </button>
                </div>
              </div>
              <Collapse open={!autosFolded}>
              {autos.map((o, i) => (
                <button key={o.id} className={`nx-row nx-sub ${o.state === 'running' ? 'nx-active' : ''}`} style={{ '--step': Math.min(i, 8) } as React.CSSProperties}
                  onClick={() => page({ kind: 'auto', id: o.id })}>
                  <span className="nx-mark">{o.state === 'running' ? <AutoMark /> : <Icon name="cycle" />}</span>
                  <span className="nx-row-text"><span className="nx-row-title">{o.title}</span></span>
                </button>
              ))}
              </Collapse>
            </section>
          )}
          {/* Pages: the person's own pages, each built in a conversation (pages.tsx). */}
          {drawerOn(snap, 'pages') && <PagesSection snap={all} page={page} openSlugs={openPages} pinned={drawerPinned(snap, 'pages')} />}
          {/* Your factory: machines, intelligence, projects and the global Tempo (factory.tsx). */}
          <FactorySection snap={snap} colors={colors} page={page} toBoss={close} openSession={(id) => open(id)} />
          {/* Settings: the app's own band (bands.tsx FootBand), every other line of it, so whatever the app adds there
              shows here too; machines, subscriptions and Tempo live in Your factory; no line to the classic app (an address away). */}
          {drawerOn(snap, 'settings') && <div className="nx-settings"><FootBand toNext={false} factory mark={<span className="nx-repo-mark" aria-hidden><Icon name="settings" />{drawerPinned(snap, 'settings') && <PinMark />}</span>} /></div>}
        </div>
      </motion.nav>
    </>
  )
}

// ---------------------------------------------------------------- screens

/** weevboss's screen: the band (menu, the app's « weevboss · for you » words in the middle, the star rows), then
 *  weevboss's thread or For you. For you is the app's own page (foryou.tsx ForYouPage: its feed, its cards, its fresh
 *  notice), set in place under the band; its swipe back, or a tap on « weevboss », comes back to the thread. */
function BossInner({ snap, stars, theme, safeT, openSide, ctx, placeholder, label, reach }: {
  snap: Snapshot; stars: string[]; theme: Theme; safeT: number; openSide: () => void; ctx: AppCtx; placeholder: string; label: string
  /** What next does for the app's « open weevboss's thread » (everything but showing the thread, done here). */
  reach: Omit<Reach, 'showThread'>
}) {
  const [top, setTop] = useTop()
  // « Open weevboss's thread » (a For you post's step, an action answered there): the app says it with this event
  // (src/ui/follow.ts focusBoss); in next it brings weevboss's screen, on its thread.
  const reachRef = useRef(reach)
  reachRef.current = reach
  useEffect(() => {
    const on = () => toBoss({ ...reachRef.current, showThread: () => setTop('boss') })
    addEventListener(FOCUS_BOSS, on)
    return () => removeEventListener(FOCUS_BOSS, on)
  }, [setTop])
  const dir = top === 'foryou' ? 1 : -1
  // A sideways swipe on the thread switches, like a tap on the other word (mostly horizontal, 70 px or more).
  const swipe = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('textarea, input, button, a, .nx-composer')) return
    const x0 = e.clientX
    const y0 = e.clientY
    const up = (ev: PointerEvent) => {
      removeEventListener('pointerup', up)
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) setTop(dx < 0 ? 'foryou' : 'boss')
    }
    addEventListener('pointerup', up)
  }
  return (
    <>
      <div className="nx-top" style={{ height: SKY + safeT, paddingTop: safeT }}>
        <Sky ids={stars} theme={theme} onTap={openSide} reserve={snap.foryou ? 92 : 0} />
        <button className="nx-menu" style={{ top: safeT + 4 }} aria-label="Open the side bar" onClick={openSide}>
          <Icon name="agents" />
        </button>
        {snap.foryou && <div className="nx-words" style={{ top: safeT }}><TopWords active={top} onPick={setTop} /></div>}
      </div>
      <div className="nx-panes" onPointerDown={swipe}>
        <AnimatePresence initial={false} custom={dir}>
          {top === 'foryou' && snap.foryou ? (
            <motion.div key="fy" className="nx-pane nx-fy" custom={dir} variants={PANE} initial="enter" animate="shown" exit="leave" transition={PANEL}>
              <Ctx.Provider value={{ ...ctx, back: () => setTop('boss') }}>
                <ForYouPage />
              </Ctx.Provider>
            </motion.div>
          ) : (
            <motion.div key="boss" className="nx-pane" custom={dir} variants={PANE} initial="enter" animate="shown" exit="leave" transition={PANEL}>
              <Chat id={null} messages={snap.main} working={snap.mainWorking} author="weevboss" placeholder={placeholder} label={label}
                send={(text, files) => (files?.length ? api.mainAttach(text, files) : api.main(text))} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
/** The two screens slide side by side, the way the words read: For you comes from the right, weevboss from the left. */
const PANE = {
  enter: (d: number) => ({ x: `${d * 100}%`, opacity: 0.6 }),
  shown: { x: 0, opacity: 1 },
  leave: (d: number) => ({ x: `${-d * 100}%`, opacity: 0.6 }),
}

function App() {
  const [auth, login, logout] = useAuth()
  const { snap } = useSnapshot(auth === 'in')
  const [theme, setTheme] = useTheme((snap as (Snapshot & { theme?: string }) | null)?.theme)
  const { h, safeT } = useScreen()
  const [side, setSideRaw] = useState(false)
  const setSide = useCallback((v: boolean) => { setSideRaw(v); if (!v) setSideStill(false) }, [])
  const bt = useT(BM)
  const hostRef = useRef<HTMLDivElement>(null)
  // The app's own pages (files, a file, a project's page…), drawn by its PageView on top of everything, as a stack.
  const [pages, setPages] = useState<{ p: NxPage; side: boolean }[]>([])
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  // The side bar: `side` open, `sideStill` shown again in place (no slide) as a page leaves to uncover it.
  const [sideStill, setSideStill] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Installed on an iPhone, every screen reaches the bottom edge (src/ui/viewport.ts).
  useEffect(trackFullHeight, [])
  const [session, setSession] = useState<string | null>(() => /#s=([^&]+)/.exec(location.hash)?.[1] ?? null)
  const collapsedY = -(h - STRIP - safeT)
  const y = useMotionValue(session ? collapsedY : 0)
  // 0: weevboss fills the screen; 1: weevboss is the strip at the top.
  const p = useTransform(y, (v) => Math.min(1, Math.max(0, v / (collapsedY || -1))))
  const wash = useTransform(p, (v) => Math.sin(Math.PI * v))
  const peek = useTransform(p, [0.7, 1], [0, 1])
  const under = useTransform(p, (v) => 0.92 + 0.08 * v)
  const underFade = useTransform(p, (v) => 0.4 + 0.6 * v)
  const [down, setDown] = useState(!session)

  useEffect(() => {
    if (session) history.replaceState(null, '', `#s=${session}`)
    else if (location.hash.startsWith('#s=')) history.replaceState(null, '', location.pathname)
  }, [session])
  useEffect(() => { if (session && y.get() !== 0) y.set(collapsedY) }, [collapsedY]) // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(() => colorSlots(snap ? [...new Set(snap.projects.map((x) => x.id))] : []), [snap?.projects.map((x) => x.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  // One navigation model (docs/next-interaction.md, moves.ts): whatever you open comes in from the right edge and goes
  // back out to the right (or on from where the finger left it), uncovering what was under it, the side bar included.
  // weevboss alone lives at the top: it comes down and goes up, with the colour wash.
  const sx = useMotionValue(0)
  const [underTop, setUnderTop] = useState(false)
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  const hgo = () => (reduced() ? { duration: 0 } : spring)
  /** The side bar was open under this session: going back shows it again, as it was. */
  const sideUnder = useRef(false)
  const open = useCallback((id: string | null, fromSide = false) => {
    if (id === null) {
      setSide(false)
      setDown(true)
      void animate(y, 0, reduced() ? { duration: 0 } : SLIDE).then(() => setSession(null))
      return
    }
    navigator.vibrate?.(8)
    sideUnder.current = fromSide
    setSession(id)
    setDown(false)
    setUnderTop(true)
    // Pushed like a page: in from the right edge, over whatever was there (the side bar too); once it has landed,
    // weevboss is the strip above it and the side bar closes behind it, unseen.
    void slide(sx, 'push', innerWidth, hgo()).then(() => {
      y.jump(collapsedY)
      setUnderTop(false)
      setSide(false)
    })
  }, [y, sx, collapsedY]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The session's own back (its chevron, or its swipe): it leaves where it came in from, or with the finger. */
  const leave = useCallback(() => {
    // Popped like a page: out to the right edge (from where the finger left it), uncovering what was under it: the
    // side bar when it was opened from there, else weevboss.
    const dragged = draggedRight(hostRef.current)
    y.jump(0)
    setDown(true)
    setUnderTop(true)
    if (sideUnder.current) { setSideStill(true); setSideRaw(true) }
    void slide(sx, 'pop', innerWidth, hgo(), dragged).then(() => {
      setSession(null)
      sx.jump(0)
      setUnderTop(false)
    })
  }, [y, sx]) // eslint-disable-line react-hooks/exhaustive-deps

  // The strip pulls weevboss down with the finger; let go past a third (or with a flick) and it comes all the way.
  // Same rule for the strip: it follows the finger only on a mostly vertical drag, and weevboss comes down past 30 % of
  // the screen (never under the app's 140 px) or on a real fling (the app's 700 px/s, with 40 px of travel).
  // A session asked for from weevboss's screen or the side bar opens in the session layer (weevboss's strip above
  // it); asked for from a page, it is one more page on that page, so back comes back to the page.
  const push = useCallback((p: NxPage, fromSide = false) => {
    if (p.kind === 'calm') return
    if (p.kind === 'session' && (fromSide || !pagesRef.current.length)) { open(p.id, fromSide); return }
    setPages((s) => [...s, { p, side: fromSide }])
  }, [open])
  // A photo you sent shows as a small thumbnail in your message (next.css .user-photo); a tap opens it whole in the
  // app's own viewer (foryou.tsx MediaPage: on the page's colour, back with the chevron or a swipe right) rather
  // than in a new browser tab.
  const openPhoto = useCallback((e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.user-photo')
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    // Sent with others (one row, bits.tsx UserPhotos): the viewer gets them all, a swipe from one to the next.
    const all = [...(a.closest('.user-photos.row')?.querySelectorAll<HTMLAnchorElement>('a.user-photo') ?? [])]
      .map((x) => ({ url: x.getAttribute('href')!, name: x.querySelector('img')?.alt || 'Photo' }))
    push({ kind: 'media', url: a.getAttribute('href')!, type: 'image', name: a.querySelector('img')?.alt || 'Photo', ...(all.length > 1 ? { set: all } : {}) })
  }, [push])
  const back = useCallback(() => setPages((s) => s.slice(0, -1)), [])

  // Plain pointer tracking (one gesture, tap or pull): a tap brings weevboss; a pull follows the finger once it is
  // clearly vertical (10 px, more down than sideways) and decides on release.
  const pull = (e: React.PointerEvent) => {
    const x0 = e.clientX
    const y0 = e.clientY
    const t0 = performance.now()
    let pulling = false
    let last = { y: y0, t: t0 }
    let speed = 0
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (!pulling && dy > 10 && dy > Math.abs(dx)) pulling = true
      if (!pulling) return
      const t = performance.now()
      speed = ((ev.clientY - last.y) / Math.max(1, t - last.t)) * 1000
      last = { y: ev.clientY, t }
      y.set(Math.min(0, collapsedY + Math.max(0, dy)))
    }
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      const dy = ev.clientY - y0
      if (!pulling) return void (Math.abs(dy) < 10 && Math.abs(ev.clientX - x0) < 10 && open(null))
      const far = dy > Math.max(140, h * 0.3)
      const fling = speed > 700 && dy > 40
      if (far || fling) open(null)
      else void animate(y, collapsedY, SLIDE)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
  }

  // Edge swipe from the left opens the side bar, on weevboss's screen only: over a session or a page, the same swipe
  // is their back (the app's swipe right), never both.
  const onBoss = useRef(true)
  onBoss.current = !session && !pages.length
  useEffect(() => {
    let x0 = -1
    let y0 = 0
    const start = (e: TouchEvent) => { const t = e.touches[0]; x0 = t.clientX < 24 && onBoss.current ? t.clientX : -1; y0 = t.clientY }
    const move = (e: TouchEvent) => {
      if (x0 < 0) return
      const t = e.touches[0]
      if (t.clientX - x0 > 50 && Math.abs(t.clientY - y0) < 40) { x0 = -1; setSide(true) }
    }
    addEventListener('touchstart', start, { passive: true })
    addEventListener('touchmove', move, { passive: true })
    return () => { removeEventListener('touchstart', start); removeEventListener('touchmove', move) }
  }, [])

  // A page link opened outside the app (/p/<kind>/<slug>, signed in only now): the page, in the app (as App.tsx does).
  useEffect(() => {
    if (auth !== 'in') return
    const page = pageLink(location.pathname)
    if (!page) return
    history.replaceState(history.state, '', '/')
    push({ kind: 'webpage', path: page.path, title: page.slug.replace(/-/g, ' '), pageKind: page.kind })
  }, [auth]) // eslint-disable-line react-hooks/exhaustive-deps
  // Notifications, from the app's own service worker: a tap opens its session, or weevboss.
  useWorker(auth === 'in', snap ?? null, useCallback((to: { session: string } | 'boss') => open(to === 'boss' ? null : to.session), [open]))

  // The guided tour (tour.tsx), started from weevboss's thread: each stop brings its screen, the side bar or weevboss's.
  const snapRef = useRef(snap)
  snapRef.current = snap
  const tour = useTour(
    () => {
      const sn = snapRef.current
      return {
        projects: sn?.projects.filter((x) => x.id !== AUTO_DIR && x.id !== MISC && !selfProject(x) && shownNow(sn, x)).length ?? 0,
        automations: (sn?.optimizers ?? []).filter((o) => o.state !== 'proposed' && o.state !== 'refused').length,
        foryou: !!sn?.foryou,
      }
    },
    (screen) => {
      setPages([])
      if (screen === 'side') return setSide(true)
      setSide(false)
      if (session) open(null)
    },
  )

  // What the camera records with a capture (camera.tsx): the screen on top, its conversation or page, theme, size.
  const spotRef = useRef<() => Spot>(() => ({ context: {} }))
  spotRef.current = () => {
    const top = pages.at(-1)?.p
    const sid = top ? (top.kind === 'session' ? top.id : undefined) : session ?? undefined
    const s = sid ? snap?.sessions.find((x) => x.id === sid) : undefined
    const proj = s ? snap?.projects.find((x) => x.id === s.projectId) : top && 'projectId' in top ? snap?.projects.find((x) => x.id === top.projectId) : undefined
    const screen = top ? top.kind : session ? 'session' : side ? 'side bar' : document.querySelector('.nx-fy') ? 'for you' : 'weevboss'
    const page = top && top.kind !== 'session' ? pageFacts(top as Page) : undefined
    return {
      context: {
        ui: 'next', screen, theme, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
        ...(s ? { sessionId: s.id, sessionTitle: s.title } : {}),
        ...(proj ? { projectId: proj.id, project: proj.name } : {}),
        ...(page ? { page } : {}),
      },
    }
  }
  const spot = useCallback(() => spotRef.current(), [])

  if (auth === 'checking') return <main className="nx-center" />
  if (auth === 'out') return <SignIn login={login} />
  if (!snap) return <main className="nx-center"><span className="spin fluo"><Icon name="star" /></span></main>

  const stars = snap.sessions.filter((s) => !s.archived && working(s))
    // In the order they started, so a new agent's star takes the next slot and the others stay put.
    .sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id)).map((s) => s.id)
  // Preview only: ?sky=200 adds stand-in stars to see how the sky holds many agents (never on by default).
  const demo = Number(new URLSearchParams(location.search).get('sky')) || 0
  for (let i = stars.length; i < demo; i++) stars.push(`demo-${i}`)
  const sProject = session ? snap.projects.find((x) => x.id === snap.sessions.find((s) => s.id === session)?.projectId) : undefined
  // The session's colour behind it and in weevboss's wash: its repo's, and for weevils' own repo the base of its
  // gradient (the page itself wears the gradient: shell.tsx identity).
  // The band's pages open right now: bold in the pages band.
  const openPages = new Set(pages.flatMap(({ p }) => (p.kind === 'page-studio' ? [p.slug] : p.kind === 'webpage' ? [p.path.split('/').pop() ?? ''] : [])))
  const sColor = sProject && selfProject(sProject) ? 'color-mix(in oklch, var(--fy-g1), var(--fy-g2) 30%)' : `var(--${(sProject && colors[sProject.id]) ?? 'p0'})`

  /** Where the two For you destinations that are not pages lead (reach.ts). */
  const reach: Omit<Reach, 'showThread'> = {
    closePages: () => setPages([]),
    setSide,
    bossDown: () => { if (session) open(null) },
    unfoldAutos: () => saveFold('__automations', false),
  }
  const ctx: AppCtx = {
    snap, now, offline: false, colors, push, back,
    replace: (p) => setPages((s) => [...s.slice(0, -1), { p, side: s.at(-1)?.side ?? false }]),
    home: () => setPages([]),
    // The app's « open the automations » (its drawer): in next, the side bar on its Autonomous section.
    expanded: null, setExpanded: () => {}, h24Open: false, setH24Open: (v) => { if (v) toAutos({ ...reach, showThread: () => {} }) },
    theme, setTheme, refresh: () => {}, logout,
  }

  return (
    <Ctx.Provider value={ctx}>
    <TalkHost>
    <div className="nx-stage" style={{ '--sc': sColor } as React.CSSProperties} onClickCapture={openPhoto}>
      {session && (
        <motion.div className="nx-under" style={{ x: sx, scale: underTop ? 1 : under, opacity: underTop ? 1 : underFade, zIndex: underTop ? 20 : 1, '--strip': `${STRIP + safeT}px` } as unknown as React.CSSProperties}>
          {/* The app's own session page (pages.tsx SessionPage: header, thread, question, errors, composer), every
              display rule in one place; here, its back brings weevboss down. */}
          <Ctx.Provider value={{ ...ctx, back: leave, home: leave,
            replace: (p) => (p.kind === 'session' ? setSession(p.id) : ctx.replace(p)) }}>
            {/* While it slides in or out, the layer carries weevboss's strip with it (the same strip, drawn here): one
                solid screen moving as one, never a hole at the top showing what is under it. */}
            {underTop && <div className="nx-peek nx-peek-carried" aria-hidden style={{ height: STRIP + safeT, paddingTop: safeT }}><StripInner working={snap.mainWorking} /></div>}
            <div className="nx-session-host" ref={hostRef}>
              {/* Its own entrance (a slide from the right) is skipped here, the layer around it moves instead; inside,
                  every motion of the app's thread stays on (a new message opens in place at the bottom, as in the app). */}
              <AnimatePresence initial={false}><PageView key={session} page={{ kind: 'session', id: session }} /></AnimatePresence>
            </div>
          </Ctx.Provider>
        </motion.div>
      )}
      <motion.section className="nx-boss" style={{ y }}>
        <motion.div className="nx-wash" style={{ opacity: wash }} />
        <BossInner snap={snap} stars={stars} theme={theme} safeT={safeT} openSide={() => setSide(true)} ctx={ctx}
          placeholder={bt.agentPlaceholder} label={bt.agentLabel} reach={reach} />
        <motion.div className="nx-peek" style={{ opacity: peek, height: STRIP + safeT, paddingTop: safeT, pointerEvents: down ? 'none' : 'auto' }}
          onPointerDown={pull}>
          <StripInner working={snap.mainWorking} />
        </motion.div>
      </motion.section>
      <AnimatePresence>
        {side && <SideBar still={sideStill} openPages={openPages} snap={snap} colors={colors} current={session} open={(id) => (id === null ? open(null) : open(id, true))} close={() => setSide(false)} page={(p) => push(p, true)} />}
      </AnimatePresence>
      <div className="nx-pages">
        {/* Every page, wherever it was asked from, is the app's own page and its own move: in from the right edge,
            back out to the right (its chevron, or its swipe following the finger), uncovering what was under it. */}
        <AnimatePresence>
          {pages.map(({ p }, i) => {
            const key = `${i}:${p.kind}:${p.kind === 'files' ? `${p.repo}/${p.dir}` : p.kind === 'file' ? p.path : p.kind === 'project' ? p.projectId : p.kind === 'session' || p.kind === 'auto' ? p.id : p.kind === 'page-studio' ? p.slug : p.kind === 'webpage' ? p.path : ''}`
            if (p.kind === 'pages-new') return <NewPage key={key} />
            if (p.kind === 'page-studio') return <PageStudio key={key} slug={p.slug} />
            return p.kind === 'project' ? <NextProjectPage key={key} projectId={p.projectId} /> : p.kind === 'auto' ? <NextAutoPage key={key} id={p.id} /> : p.kind === 'machine' && p.machine ? <NextMachinePage key={key} id={p.machine} /> : <PageView key={key} page={p} />
          })}
        </AnimatePresence>
      </div>
      <Camera spot={spot} />
      <TourLayer {...tour} />
    </div>
    </TalkHost>
    </Ctx.Provider>
  )
}

/** A page as the camera names it: its kind, what identifies it, its title when it has one. */
function pageFacts(p: Page): { kind: string; id?: string; title?: string } {
  const r = p as Record<string, unknown>
  const id = ['id', 'projectId', 'path', 'url'].map((k) => r[k]).find((v) => typeof v === 'string') as string | undefined
  const title = typeof r.title === 'string' ? r.title : typeof r.name === 'string' ? r.name : undefined
  return { kind: p.kind, ...(id ? { id } : {}), ...(title ? { title } : {}) }
}

/** weevboss's strip over a session: its logo (wiggling with the three dots while it works, bits.tsx WorkingMark), its
 *  name, the arrow down. */
function StripInner({ working }: { working: boolean }) {
  return (
    <>
      {working ? <WorkingMark author="weevboss" /> : <WeevbossLogo className="nx-logo" />}
      <span className="nx-row-title">weevboss</span>
      <span className="nx-right nx-chev"><Icon name="chevron" dir="down" /></span>
    </>
  )
}

/** One shared state for automation talks, as the app's App holds it: a « + » made in the side bar is found at once by
 *  the page it opens, before the next snapshot. */
function TalkHost({ children }: { children: React.ReactNode }) {
  const { snap } = useApp()
  return <TalkCtx.Provider value={useTalks(snap.optimizers)}>{children}</TalkCtx.Provider>
}

function SignIn({ login }: { login: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  return (
    <main className="nx-signin band" style={{ '--c': 'var(--agent)' } as React.CSSProperties}>
      <WeevbossLogo className="nx-logo-big" />
      <p>Open your weevils login link with this address, or type your access code.</p>
      <form onSubmit={(e) => { e.preventDefault(); login(code).catch((err) => setError((err as Error).message)) }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" autoComplete="current-password" type="password" />
        <button className="nx-send" aria-label="Sign in" disabled={!code.trim()}><Icon name="arrow" dir="right" /></button>
      </form>
      {error && <p className="nx-error">{error}</p>}
    </main>
  )
}

registerWorker()
keepFresh()
createRoot(document.getElementById('root')!).render(<StrictMode><MotionConfig reducedMotion="user"><App /></MotionConfig></StrictMode>)
