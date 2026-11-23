// An automation in weevils next (docs/next-interaction.md, « Automations »). Once accepted, it opens on its overview:
// its name in the middle, what it does in one line, a big living link to what it produced, then when it runs, how it
// runs and how its last run went. A small « Conversation » in the header flips to the conversation it runs in (the
// app's own session page, exactly as every session's, to read or to take over), and its icon flips back, with the app's own swap (a fade).
// Not accepted yet (a draft, a proposal) or not a task (a timer, a job): the app's own automation page, its talk.
// Reused from the current app: Shell, the automation model and its words, LivingLink, AutoPage, PageView, swapPage.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AutoDetail, AutoRunDetail } from '../../shared/api.ts'
import { pageLink } from '../../shared/pages.ts'
import { api } from '../../src/api.ts'
import { useApp } from '../../src/ui/app-context.tsx'
import { AutoPage } from '../../src/ui/auto-page.tsx'
import { PromotionLine, useSeen } from '../../src/ui/factory.tsx'
import { FactoryPage } from '../../src/ui/factory-page.tsx'
import { autoCondition } from '../../src/ui/auto-condition.ts'
import { at, fromOptimizer, projectOfRepo, short, slotOf, triggerText } from '../../src/ui/auto-model.ts'
import { durLong, plain } from '../../src/ui/format.ts'
import { AutoMark, Icon } from '../../src/ui/icons.tsx'
import { LivingLink } from '../../src/ui/living-link.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { Shell, swapPage } from '../../src/ui/shell.tsx'

/** GET /api/auto/:id and the newest run's detail (its pages, its report), again when a run starts or ends. */
function useRuns(id: string, key: string): { detail: AutoDetail | null; newest: AutoRunDetail | null } {
  const [detail, setDetail] = useState<AutoDetail | null>(null)
  const [newest, setNewest] = useState<AutoRunDetail | null>(null)
  useEffect(() => {
    let off = false
    api.auto(id).then((d) => {
      if (off) return
      setDetail(d)
      const r = d.runs[0]
      if (r) void api.autoRun(id, r.at).then((n) => !off && setNewest(n)).catch(() => undefined)
    }).catch(() => undefined)
    return () => { off = true }
  }, [id, key])
  return { detail, newest }
}

/** The small flip, no box: « Conversation » at the bottom right of the overview's head band; on the conversation,
 *  the automation's own icon alone, the last item of the session's head row (its label says « Overview »). */
function Flip({ host, children, onClick, label }: { host: HTMLElement | null; children: ReactNode; onClick: () => void; label: string }) {
  if (!host) return null
  return createPortal(<button className="nx-flip" onClick={onClick} aria-label={label}>{children}</button>, host)
}

export function NextAutoPage({ id }: { id: string }) {
  const { snap } = useApp()
  const o = snap.optimizers?.find((x) => x.id === id)
  const [view, setView] = useState<'overview' | 'talk'>('overview')
  const box = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState<HTMLElement | null>(null)
  // Where the flip sits, found again after each flip: on a conversation, one more item at the end of the session's own
  // one-row head (the same head as every session's, never drawn over its title or model); elsewhere, the head band.
  useLayoutEffect(() => {
    const b = box.current
    setHead(b?.querySelector<HTMLElement>('.session-header-row')?.parentElement ?? b?.querySelector<HTMLElement>('.page-head') ?? null)
  }, [view, !!o])
  // Not accepted yet, or not a task: the app's own page (where an automation is talked into shape).
  if (!o || o.state === 'proposed' || o.state === 'refused' || o.draft) return <AutoPage id={id} />
  const session = o.sessionId && snap.sessions.some((s) => s.id === o.sessionId) ? o.sessionId : null
  const talk = !!session || !!o.talk?.length
  const flip = () => { swapPage(); setView((v) => (v === 'overview' ? 'talk' : 'overview')) }
  return (
    <div ref={box} className={`nx-autoview nx-auto-${view}`}>
      {/* A factory opens on its own page (the panels its manifest declares, drawn by the app's FactoryPage); an
          automation on its overview. Either way the small flip goes to its conversation and back. */}
      {view === 'overview' ? (o.factory ? <FactoryPage id={id} heroName headAction={false} kicker="Autonomous" onConversation={talk ? flip : undefined} /> : <Overview id={id} />) : session ? <PageView page={{ kind: 'session', id: session }} /> : <AutoPage id={id} standard />}
      {talk && (
        <Flip host={head} onClick={flip} label={view === 'overview' ? `Conversation of ${o.title}` : `Overview of ${o.title}`}>
          {view === 'overview' ? <><Icon name="bubble" /><span>Conversation</span></> : <Icon name={o.factory ? 'factory' : 'cycle'} />}
        </Flip>
      )}
    </div>
  )
}

function Overview({ id }: { id: string }) {
  const { snap, now, push } = useApp()
  const o = snap.optimizers!.find((x) => x.id === id)!
  const x = fromOptimizer(o, projectOfRepo(snap.projects, o.repo), now)
  const { detail, newest } = useRuns(id, `${o.state}:${o.runCount}:${o.runs?.[0]?.at}`)
  // An open of its page counts as the person's (one of the measured signals toward a factory).
  useSeen(id, 'page')
  if (!x) return null
  const runs = detail?.runs?.length ? detail.runs : x.runs
  const last = runs[0]
  const running = x.state === 'running'
  // What it produced: the page its newest run published (a living link, opened in place), else that run's own page.
  const page = newest?.links.map((l) => { try { return pageLink(l, [new URL(l).host]) } catch { return undefined } }).find(Boolean)
  const head = newest?.report ? plain(newest.report).split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() : undefined
  const outcome = head || last?.note
  const where = (x.projectId ? snap.projects.find((p) => p.id === x.projectId)?.name : null) ?? x.repo ?? null

  const next = running && x.startedAt ? `Running for ${durLong(now - x.startedAt)}`
    : x.state === 'paused' || o.paused ? 'Paused'
    : x.nextAt && x.nextAt > now && x.nextReason !== 'retry' ? `${at(x.nextAt, now)} · in ${durLong(x.nextAt - now)}`
    : autoCondition(x)
  const facts: [string, ReactNode, (() => void)?][] = [
    ['Next run', next],
    ['Schedule', triggerText(x.trigger, now)],
    ...(last ? [['Last run', <><span>{last.ok ? <Icon name="check" /> : <span className="alert"><Icon name="close" /></span>} {short(now - last.at, true)} ago{last.ok ? '' : ', failed'}</span>{outcome && <span className="nx-auto-note">{outcome}</span>}</>, () => push({ kind: 'autorun', id, at: last.at })] as [string, ReactNode, () => void]] : []),
    ...(x.runCount ? [['So far', `${x.runCount} run${x.runCount > 1 ? 's' : ''}`] as [string, ReactNode]] : []),
    ...(where ? [['Works in', where] as [string, ReactNode]] : []),
  ]
  return (
    <Shell slot={slotOf(id)} kicker="Autonomous" title={x.title}>
      <div className="nx-auto-hero">
        <span className="nx-auto-icon">{running ? <AutoMark /> : <Icon name="cycle" />}</span>
        <div className="nx-auto-name">{x.title}</div>
        {(o.scope || x.why) && <p className="nx-auto-what">{o.scope || x.why}</p>}
        {page ? (
          <div className="nx-auto-result"><LivingLink href={page.path} /></div>
        ) : last ? (
          <div className="nx-auto-result">
            <a className="living lk-report" href="#" onClick={(e) => { e.preventDefault(); push({ kind: 'autorun', id, at: last.at }) }}>Last results</a>
          </div>
        ) : null}
      </div>
      <dl className="nx-auto-facts">
        {facts.map(([k, v, go]) => (
          <div key={k} className={go ? 'nx-auto-fact go' : 'nx-auto-fact'} onClick={go} role={go ? 'button' : undefined} tabIndex={go ? 0 : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {/* The quiet line of an automation that earned it: it unfolds onto the unlock (docs/automations/PROTOCOL.md). */}
      {o.promotion && <PromotionLine o={o} />}
    </Shell>
  )
}
