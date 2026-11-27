// An automation in weevils next (docs/next-interaction.md, « Automations »). Once accepted, it opens on its page, in
// the side bar's own colour and rows: its name with its switch (on, or paused), one line saying what that means for
// its next run, what it does in one sentence, then two rows: when it runs, and what its last run made (a tap opens
// the result). Its earlier runs wait in a quiet fold; « Delete this automation » at the bottom asks once. Nothing
// else: no prompt, no ids, no counters. A small « Conversation » in the header flips to the conversation it runs in
// (the app's own session page), and its icon flips back, with the app's own swap (a fade).
// Not accepted yet (a draft, a proposal) or not a task (a timer, a job): the app's own automation page, its talk.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AutoDetail, AutoRun, AutoRunDetail } from '../../shared/api.ts'
import { clip } from '../../shared/asks.ts'
import { pageLink } from '../../shared/pages.ts'
import { runLine } from '../../shared/run-line.ts'
import { api } from '../../src/api.ts'
import M from '../../src/i18n/auto-overview.ts'
import { useT } from '../../src/i18n/index.ts'
import { useApp } from '../../src/ui/app-context.tsx'
import { AutoPage } from '../../src/ui/auto-page.tsx'
import { autoCondition } from '../../src/ui/auto-condition.ts'
import { at, fromOptimizer, longAt, projectOfRepo, short, triggerText } from '../../src/ui/auto-model.ts'
import { durLong, plain } from '../../src/ui/format.ts'
import { Collapse } from '../../src/ui/bits.tsx'
import { AutoMark, Icon } from '../../src/ui/icons.tsx'
import { LivingLink } from '../../src/ui/living-link.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { Shell, swapPage } from '../../src/ui/shell.tsx'
import { doesLine, dropAuto, droppedNow, flipAuto, onOffNow, recurring, switchable, useAutoFlips } from './auto-state.ts'
import { Switch } from './factory.tsx'

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
  // Just deleted: nothing while the page leaves.
  if (droppedNow(id)) return null
  // Not accepted yet, or not a task: the app's own page (where an automation is talked into shape).
  if (!o || o.state === 'proposed' || o.state === 'refused' || o.draft) return <AutoPage id={id} />
  const session = o.sessionId && snap.sessions.some((s) => s.id === o.sessionId) ? o.sessionId : null
  const talk = !!session || !!o.talk?.length
  const flip = () => { swapPage(); setView((v) => (v === 'overview' ? 'talk' : 'overview')) }
  return (
    <div ref={box} className={`nx-autoview nx-auto-${view}`}>
      {view === 'overview' ? <Overview id={id} /> : session ? <PageView page={{ kind: 'session', id: session }} /> : <AutoPage id={id} />}
      {talk && (
        <Flip host={head} onClick={flip} label={view === 'overview' ? `Conversation of ${o.title}` : `Overview of ${o.title}`}>
          {view === 'overview' ? <><Icon name="bubble" /><span>Conversation</span></> : <Icon name="cycle" />}
        </Flip>
      )}
    </div>
  )
}

/** The longest sentence the « Last run » fact shows: whole in practice, a longer one stops on a whole word. */
const SAID_MAX = 220

/**
 * How a run went, as read under its check: the first whole sentence of what the run told the person, in plain words
 * (no stars, no folded list, never half a word). Its full message once the run's detail is loaded, else its stored
 * note (the same message on one line, cut short). The first line of its technical report is a heading of ids and
 * dates, written for the next run and not for the person: only when the run said nothing at all.
 */
function outcomeOf(run: AutoRun, detail: AutoRunDetail | null): string {
  // The detail of another run (a new one just ended, its own detail still on its way) says nothing about this one.
  const mine = detail?.run.at === run.at ? detail : null
  // A run that did not go well: its note is the reason the server gave (« no progress for 52 min »), and that is the
  // news; the session's last words come first only for a run that went well.
  const told = mine?.message?.trim()
  const said = runLine((run.ok ? told : '') || run.note || told || '', run.ok)
  const head = mine?.report ? plain(mine.report).split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() : undefined
  return clip(said || head || '', SAID_MAX)
}

function Overview({ id }: { id: string }) {
  const t = useT(M)
  const { snap, now, push, back, refresh } = useApp()
  useAutoFlips(snap)
  const o = snap.optimizers!.find((x) => x.id === id)!
  const x = fromOptimizer(o, projectOfRepo(snap.projects, o.repo), now)
  const { detail, newest } = useRuns(id, `${o.state}:${o.runCount}:${o.runs?.[0]?.at}`)
  const [pastOpen, setPastOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  if (!x) return null
  const runs = detail?.runs?.length ? detail.runs : x.runs
  const last = runs[0]
  const state = onOffNow(o)
  const running = o.state === 'running'
  // What it produced: the page its newest run published (opened in place), else that run itself.
  const page = newest?.run.at === last?.at ? newest?.links.map((l) => { try { return pageLink(l, [new URL(l).host]) } catch { return undefined } }).find(Boolean) : undefined
  const outcome = last ? outcomeOf(last, newest) : ''
  const openLast = () => last && push({ kind: 'autorun', id, at: last.at })

  const status = running && x.startedAt ? t.running(durLong(now - x.startedAt))
    : state === 'paused' ? t.paused
    : state === 'stopped' ? t.stopped
    : state === 'over' ? (last ? t.over(short(now - last.at, true)) : t.overNever)
    : x.nextAt && x.nextAt > now && x.nextReason !== 'retry' ? t.nextAt(at(x.nextAt, now), durLong(x.nextAt - now))
    : o.waiting === 'sleep' ? t.nextSleep
    : t.onWhen(autoCondition(x))

  const flip = (on: boolean) => {
    setFailed(null)
    flipAuto(id, on)
    api.pauseOptimizer(id, !on).then((r) => { if (!r.ok) throw new Error() ; refresh() }).catch(() => { flipAuto(id, null); setFailed(t.switchFailed) })
  }
  const remove = () => {
    setFailed(null)
    dropAuto(id, true)
    api.deleteAutomation(id).then(() => { refresh(); back() }).catch(() => { dropAuto(id, false); setAsking(false); setFailed(t.deleteFailed) })
  }
  return (
    <Shell slot="h24" kicker="autonomous" title={x.title}>
      <div className={`nx-ao nx-ao-${running ? 'running' : state}`}>
        <div className="nx-ao-top">
          <div className="nx-ao-name">{x.title}</div>
          {switchable(state) && <Switch on={state === 'on'} label={state === 'on' ? t.switchOff(x.title) : t.switchOn(x.title)} onChange={flip} />}
        </div>
        <p className="nx-ao-state">{running && <AutoMark />}{status}</p>
        {doesLine(o) && <p className="nx-ao-what">{doesLine(o)}</p>}
        {failed && <p className="nx-ao-failed" role="status">{failed}</p>}
      </div>
      <div className="nx-ao-rows">
        {recurring(o) && (
          <div className="nx-row nx-sub nx-ao-row" style={{ '--step': 0 } as React.CSSProperties}>
            <span className="nx-mark"><Icon name={o.onSleep ? 'sleep' : 'clock'} /></span>
            <span className="nx-row-text"><span className="nx-row-title">{cap(triggerText(x.trigger, now))}</span></span>
          </div>
        )}
        {last && (
          <div className="nx-row nx-sub nx-ao-row go" style={{ '--step': 1 } as React.CSSProperties} role="button" tabIndex={0} onClick={openLast} aria-label={t.lastRun}>
            <span className="nx-mark">{last.ok ? <Icon name="check" /> : <Icon name="pause" />}</span>
            <span className="nx-row-text">
              {outcome ? <span className="nx-row-title nx-ao-said">{outcome}</span> : <span className="nx-row-title nx-ao-ago">{t.when(short(now - last.at, true), last.ok)}</span>}
              <span className="nx-row-sub">
                {outcome && <span className="nx-ao-ago">{t.when(short(now - last.at, true), last.ok)}</span>}
                {page && <span className="nx-ao-made"><LivingLink href={page.path} /></span>}
              </span>
            </span>
          </div>
        )}
        {runs.length > 1 && (
          <>
            <button className="nx-row nx-sub nx-ao-row nx-ao-more" style={{ '--step': 2 } as React.CSSProperties} aria-expanded={pastOpen} onClick={() => setPastOpen((v) => !v)}>
              <span className="nx-mark"><Icon name="chevron" dir={pastOpen ? 'down' : 'right'} /></span>
              <span className="nx-row-text"><span className="nx-row-title">{t.pastRuns}</span></span>
            </button>
            <Collapse open={pastOpen}>
              {runs.slice(1).map((r) => (
                <button key={r.at} className="nx-row nx-sub nx-run nx-ao-run" onClick={() => push({ kind: 'autorun', id, at: r.at })}>
                  <span className="nx-row-text">
                    <span className="nx-row-title">{runLine(r.note ?? '', r.ok) || t.when(short(now - r.at, true), r.ok)}</span>
                    <span className="nx-row-sub">{longAt(r.at)}</span>
                  </span>
                </button>
              ))}
            </Collapse>
          </>
        )}
      </div>
      <div className="nx-ao-foot">
        {asking ? (
          <p className="nx-ao-ask">
            <span>{t.deleteAsk(x.title)}</span>{' '}
            <button className="nx-ao-link strong" onClick={remove}>{t.deleteYes}</button>
            <button className="nx-ao-link" onClick={() => setAsking(false)}>{t.deleteNo}</button>
          </p>
        ) : (
          <button className="nx-ao-link" onClick={() => setAsking(true)}>{t.delete}</button>
        )}
      </div>
    </Shell>
  )
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1)
