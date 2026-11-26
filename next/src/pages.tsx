// The « pages » band of next's side bar (docs/LINKS.md, « The pages band »): the person's own pages, anything they ask
// for. A new page starts on a nearly blank screen, a couple of ideas drawn from their own weevils (their automations,
// their projects) softly taking turns in the middle; a tap on one, or their own words, starts it. Then the page is
// built in a conversation: the app's own session page, the page itself sitting with the thread and reloading each time
// its files change. A page published elsewhere (a report) can sit in the band too: it opens as any living link does.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BandPage, Snapshot } from '../../shared/api.ts'
import { useApp, type Page } from '../../src/ui/app-context.tsx'
import { Collapse, Composer } from '../../src/ui/bits.tsx'
import { Icon } from '../../src/ui/icons.tsx'
import { PageView, SessionSide } from '../../src/ui/pages.tsx'
import { seedPending } from '../../src/ui/pending.ts'
import { selfProject } from '../../src/ui/recursive-identity.ts'
import { Shell } from '../../src/ui/shell.tsx'
import { call } from './data.ts'
import { foldPrefs, saveFold } from './fold.ts'
import { PinMark } from './pin.tsx'

/** The band's colour, and its pages' (a new page, a page being built). */
export const PAGES_SLOT = 'p10'

/** next's own pages, beside the app's. */
export type PagesPage = { kind: 'pages-new' } | { kind: 'page-studio'; slug: string }
export type NxPage = Page | PagesPage

/** Opens a page of the band: one made here, in its studio; one published elsewhere, as a living link. */
export function pageOf(p: BandPage): NxPage {
  return p.session ? { kind: 'page-studio', slug: p.slug } : { kind: 'webpage', path: p.path, title: p.title, pageKind: p.kind }
}

// ---------------------------------------------------------------- the band

export function PagesSection({ snap, page, openSlugs, pinned = false }: { snap: Snapshot; page: (p: NxPage) => void; openSlugs: Set<string>; pinned?: boolean }) {
  const list = snap.pageBand ?? []
  const [folded, setFolded] = useState(() => !!foldPrefs().__pages)
  // Its name folds its pages, like every band's; with no page yet there is nothing to fold: it starts the first one.
  const head = () => (list.length ? setFolded((v) => (saveFold('__pages', !v), !v)) : page({ kind: 'pages-new' }))
  const working = (p: BandPage) => !!p.session && snap.sessions.some((s) => s.id === p.session && s.status === 'working')
  return (
    <section className="nx-project nx-autos nx-pages band" style={{ '--c': `var(--${PAGES_SLOT})` } as CSSProperties}>
      <div className="nx-project-line">
        <button className="nx-row nx-project-head nx-repo-row" onClick={head} aria-expanded={list.length ? !folded : undefined}>
          <span className="nx-repo-mark" aria-hidden><Icon name="page" />{pinned && <PinMark />}</span>
          <span className="nx-row-title nx-project-name">pages</span>
        </button>
        <div className="chars">
          <button className="ch" aria-label="New page" onClick={() => page({ kind: 'pages-new' })}><Icon name="plus" /></button>
        </div>
      </div>
      <Collapse open={!folded}>
        {list.map((p, i) => (
          <button key={p.slug} className={`nx-row nx-sub ${openSlugs.has(p.slug) ? 'nx-active' : ''}`} style={{ '--step': Math.min(i, 8) } as CSSProperties}
            onClick={() => page(pageOf(p))}>
            <span className="nx-mark">{working(p) ? <span className="spin fluo"><Icon name="star" /></span> : <Icon name="page" />}</span>
            <span className="nx-row-text"><span className="nx-row-title">{p.title}</span></span>
          </button>
        ))}
      </Collapse>
    </section>
  )
}

// ---------------------------------------------------------------- a new page

/** A few ideas from the person's own weevils: a visualizer for an automation of theirs, a studio for a project of
 *  theirs, and two that fit anyone's. Taken in turns, the most alive first. */
export function ideasFor(snap: Snapshot): string[] {
  const autos = (snap.optimizers ?? [])
    .filter((o) => o.state !== 'proposed' && o.state !== 'refused' && !o.draft)
    .sort((a, b) => (b.runCount ?? 0) - (a.runCount ?? 0))
    .map((o) => o.title.trim())
    .filter(Boolean)
  const projects = snap.projects
    .filter((p) => p.kind === 'repo' && p.id !== 'auto' && p.id !== 'divers' && !selfProject(p))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((p) => p.name)
  const forAuto = [(t: string) => `A visualizer for ${t}`, (t: string) => `A live board of every run of ${t}`]
  const forProject = [(n: string) => `A studio for ${n}`, (n: string) => `A map of everything happening in ${n}`]
  const anyone = ['A live map of what my agents are doing right now', 'My week of requests, as a timeline']
  const out: string[] = []
  for (let i = 0; i < 4; i++) {
    if (autos[i]) out.push(forAuto[i % 2](autos[i]))
    if (projects[i]) out.push(forProject[i % 2](projects[i]))
    if (anyone[i]) out.push(anyone[i])
  }
  return [...new Set(out)]
}

/** Two lines in the middle, each taking its turn: one idea fades out as the next fades in, the second line half a
 *  beat after the first. */
function useTurns(count: number, every = 5200): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (count < 3) return
    const t = setInterval(() => setN((x) => x + 1), every / 2)
    return () => clearInterval(t)
  }, [count, every])
  return n
}

export function NewPage() {
  const { snap, replace } = useApp()
  const ideas = useMemo(() => ideasFor(snap), [snap.optimizers, snap.projects]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = useTurns(ideas.length)
  // Line one shows the even ideas, line two the odd ones; each moves on every other beat, so only one changes at a time.
  const pick = (line: 0 | 1) => {
    if (ideas.length < 2) return ideas[line]
    const pairs = Math.ceil(ideas.length / 2)
    const turn = Math.floor((n + (line ? 0 : 1)) / 2) % pairs
    return ideas[(turn * 2 + line) % ideas.length]
  }
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const start = async (idea: string) => {
    if (busy) return
    setBusy(idea)
    setErr(null)
    try {
      const r = await call<{ slug: string; session: string }>('POST', '/api/pages/band', { idea })
      // Its first message (the idea) shows at once in its conversation, as for any session launched from the app.
      seedPending(r.session, idea)
      replace({ kind: 'page-studio', slug: r.slug } as unknown as Page)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(null)
    }
  }
  const shown = busy ? [busy] : [pick(0), pick(1)].filter((x): x is string => !!x)
  return (
    <Shell slot={PAGES_SLOT} kicker="pages" title="" scrollHeading
      foot={
        <>
          {err && <div className="in meta" role="status">{err}</div>}
          <Composer draftKey="pages:new" placeholder="A page for…" label="A new page" onSend={start} voice disabled={!!busy} />
        </>
      }>
      <div className="nx-ideas">
        {shown.map((idea, line) => (
          <div key={line} className="nx-idea">
            <AnimatePresence initial={false}>
              <motion.button key={idea} className={`nx-idea-text living lk-preview ${busy ? 'busy' : ''}`} onClick={() => void start(idea)} disabled={!!busy}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4, ease: 'easeInOut' }}>
                {idea}
              </motion.button>
            </AnimatePresence>
          </div>
        ))}
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------- building a page

/** A page being built: the app's own session page, the page itself sitting with the thread. */
export function PageStudio({ slug }: { slug: string }) {
  const { snap } = useApp()
  const p = snap.pageBand?.find((x) => x.slug === slug)
  const session = p?.session
  const side = useMemo(() => (p ? <LivePage slug={p.slug} path={p.path} title={p.title} /> : null), [p?.slug, p?.path, p?.title]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || !session) return null
  return (
    <div className="nx-studio">
      <SessionSide.Provider value={{ side, kicker: 'pages', slot: PAGES_SLOT }}>
        <PageView page={{ kind: 'session', id: session }} />
      </SessionSide.Provider>
    </div>
  )
}

/** The page, live: when its files change it loads again underneath, then fades in over the old one (never a blank
 *  flash). Asked every 1.5 s while it is on screen. */
function LivePage({ slug, path, title }: { slug: string; path: string; title: string }) {
  const [frames, setFrames] = useState<{ v: number; ready: boolean }[]>([{ v: 0, ready: false }])
  const last = useRef(0)
  useEffect(() => {
    let off = false
    const ask = () => {
      if (document.hidden) return
      void call<{ stamp: number }>('GET', `/api/pages/band/${slug}/stamp`).then(({ stamp }) => {
        if (off || !stamp) return
        if (!last.current) last.current = stamp
        else if (stamp !== last.current) {
          last.current = stamp
          setFrames((f) => [...f.filter((x) => x.ready).slice(-1), { v: stamp, ready: false }])
        }
      }, () => undefined)
    }
    ask()
    const t = setInterval(ask, 1500)
    return () => { off = true; clearInterval(t) }
  }, [slug])
  const loaded = (v: number) => {
    setFrames((f) => f.map((x) => (x.v === v ? { ...x, ready: true } : x)))
    // Once the new one shows, the older ones go (after its fade).
    setTimeout(() => setFrames((f) => f.filter((x) => x.v >= v)), 450)
  }
  return (
    <div className="nx-live">
      {frames.map((f) => (
        <iframe key={f.v} src={f.v ? `${path}?v=${f.v}` : path} title={title} className={f.ready ? 'ready' : ''} onLoad={() => loaded(f.v)}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          allow="clipboard-write; fullscreen; autoplay" referrerPolicy="no-referrer" />
      ))}
    </div>
  )
}
