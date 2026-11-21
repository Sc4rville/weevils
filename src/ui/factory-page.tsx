// The page of a factory (docs/automations/PROTOCOL.md, section 11). A factory declares its panels in its manifest, as
// data; weevils draws them here with its own components and colours. Nothing a factory ships is ever run or styled by
// it: an unknown panel was already dropped by the server (shared/factory.ts parsePanels). The same page in the classic
// app and in next. Its talk, its schedule and its delete stay on the standard automation page, one tap away.
import { useEffect, useState, type ReactNode } from 'react'
import type { AutoDetail, AutoRun, AutoRunDetail, Optimizer } from '../../shared/api.ts'
import { defaultPanels, labelText, type ActionDo, type FactItem, type FactoryPanel, type Label, type MetricRef, type PanelAction } from '../../shared/factory.ts'
import { api } from '../api'
import { getLang, useT } from '../i18n'
import M from '../i18n/h24'
import { useApp } from './app-context'
import { autoCondition } from './auto-condition'
import { at, fromOptimizer, projectOfRepo, short, slotOf, triggerText } from './auto-model'
import { Line, Prose } from './bits'
import { AutoIcon, MomentIcon, MomentLine, UnlockMoment, countSeen, useJustUnlocked, useSeen } from './factory'
import { durLong, plain } from './format'
import { Icon } from './icons'
import { LivingLink } from './living-link'
import { Shell } from './shell'
import './factory.css'
import './h24.css'

const REPORT_HEAD = 600
const BARS = 30

/** GET /api/auto/:id and the newest run's detail, again when a run starts or ends. */
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

/** A button that sends a brief to weevboss, as opposed to one of the built-in actions. */
const isAsk = (a: PanelAction): a is Extract<PanelAction, { ask: string }> => typeof (a as { ask?: unknown }).ask === 'string'

const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1))

/** A number weevils knows by itself, or one the runs reported: its newest value and the one before. */
export function metricValues(key: string, o: Pick<Optimizer, 'runCount' | 'tokens'>, runs: AutoRun[]): { now?: number; before?: number } {
  const last = runs.slice(0, 10)
  switch (key) {
    case 'runs.total': return { now: o.runCount ?? runs.length }
    case 'runs.ok': return { now: last.filter((r) => r.ok).length }
    case 'runs.streak': { const bad = runs.findIndex((r) => !r.ok); return { now: bad < 0 ? runs.length : bad } }
    case 'tokens.total': return { now: o.tokens ?? 0 }
    default: {
      const seen = runs.filter((r) => typeof r.metrics?.[key] === 'number')
      return { now: seen[0]?.metrics?.[key], before: seen[1]?.metrics?.[key] }
    }
  }
}

export function FactoryPage({ id, onConversation, heroName = false, headAction = true, kicker }: { id: string; /** Its talk, schedule and settings: the standard page (classic), the conversation (next). */ onConversation?: () => void; /** next: the name sits in the hero. */ heroName?: boolean; /** classic: a head button opens the standard page. */ headAction?: boolean; /** The section's name above the title (the app's own by default). */ kicker?: string }) {
  const t = useT(M)
  const { snap, now, push, refresh } = useApp()
  const o = snap.optimizers?.find((x) => x.id === id)
  const x = o ? fromOptimizer(o, projectOfRepo(snap.projects, o.repo), now) : null
  const { detail, newest } = useRuns(id, `${o?.state}:${o?.runCount}:${o?.runs?.[0]?.at}`)
  const moment = useJustUnlocked(id)
  const [note, setNote] = useState<string | null>(null)
  useSeen(o?.factory ? id : undefined, 'page')
  if (!o || !x || !o.factory) return null
  const f = o.factory
  const runs = detail?.runs?.length ? detail.runs : x.runs
  const last = runs[0]
  const running = x.state === 'running'
  const paused = x.state === 'paused' || !!o.paused
  const lang = getLang()
  const words = (l: Label | undefined) => labelText(l, lang)
  const page = o.resultsPage ? `/p/${o.resultsPage}` : undefined
  const where = (x.projectId ? snap.projects.find((p) => p.id === x.projectId)?.name : null) ?? x.repo ?? null
  const panels = f.panels?.length ? f.panels : defaultPanels({ resultsPage: !!page })
  const metricLabel = (m: MetricRef) => words(m.label) ?? words(f.metrics?.find((d) => d.key === m.key)?.label) ?? (t as unknown as Record<string, string>)[`metric_${m.key.replace(/\./g, '_')}`] ?? m.key
  const openRun = (r: AutoRun) => push({ kind: 'autorun', id, at: r.at })
  const act = (p: Promise<unknown>) => void p.then(refresh).catch((e) => setNote((e as Error).message))

  const next = running && x.startedAt ? t.runningFor(durLong(now - x.startedAt)) : paused ? t.paused : x.nextAt && x.nextAt > now && x.nextReason !== 'retry' ? `${at(x.nextAt, now)} · ${t.inTime(durLong(x.nextAt - now))}` : autoCondition(x)
  const facts: Record<FactItem, [string, ReactNode, (() => void)?] | null> = {
    next: [t.fact_next, next],
    schedule: [t.fact_schedule, triggerText(x.trigger, now)],
    last: last ? [t.fact_last, <>{last.ok ? <Icon name="check" /> : <span className="alert"><Icon name="close" /></span>} {t.endedAgo(short(now - last.at, true))}{last.ok ? '' : `, ${t.failedShort}`}</>, () => openRun(last)] : null,
    runs: x.runCount ? [t.fact_runs, t.runsN(x.runCount)] : null,
    owner: where ? [t.fact_owner, where] : null,
    repository: f.repository ? [t.fact_repository, f.repository] : null,
  }

  // What a button does, its icon, and whether it leads somewhere (an arrow) or acts in place (none).
  const doAction = (d: ActionDo): { label: string; ch: ReactNode; go?: () => void; leads?: boolean } | null => {
    switch (d) {
      case 'run': return running || paused || o.runRequested || o.state !== 'queued' ? null : { label: t.do_run, ch: <Icon name="arrow" dir="right" />, go: () => act(api.runOptimizer(id)) }
      case 'pause': return o.state !== 'queued' && o.state !== 'running' ? null : { label: paused ? t.do_resume : t.do_pause, ch: <Icon name={paused ? 'play' : 'pause'} />, go: () => act(api.pauseOptimizer(id, !paused)) }
      case 'results': return page ? { label: t.do_results, ch: <Icon name="file" />, leads: true, go: () => { countSeen(id, 'results'); push({ kind: 'webpage', path: page, title: x.title, pageKind: o.resultsPage!.split('/')[0] as never }) } } : last ? { label: t.do_results, ch: <Icon name="file" />, leads: true, go: () => openRun(last) } : null
      case 'conversation': return onConversation ? { label: t.do_conversation, ch: <Icon name="bubble" />, leads: true, go: onConversation } : null
      case 'repository': return f.repository ? { label: `${t.do_repository} · ${f.repository}`, ch: <Icon name="external" />, leads: true, go: () => void window.open(`https://github.com/${f.repository}`, '_blank', 'noopener') } : null
    }
  }
  const ask = (a: Extract<PanelAction, { ask: string }>) => void api.main(a.ask).then(() => setNote(t.askSent)).catch((e: unknown) => setNote((e as Error).message))

  const draw = (p: FactoryPanel, i: number): ReactNode => {
    switch (p.type) {
      case 'hero':
        return (
          <div key={i} className="factory-hero">
            <span className="factory-hero-icon">{moment ? <MomentIcon /> : <AutoIcon factory running={running} />}</span>
            {heroName && <div className="factory-hero-name">{x.title}</div>}
            {moment && <MomentLine title={x.title} />}
            {(o.scope || x.why) && <p className="factory-hero-what">{o.scope || x.why}</p>}
            {page && <div className="factory-hero-result" onClickCapture={() => countSeen(id, 'results')}><LivingLink href={page} /></div>}
          </div>
        )
      case 'facts': {
        const cells = (p.items ?? (['next', 'schedule', 'last', 'runs', 'owner', 'repository'] as FactItem[])).map((k) => facts[k]).filter((c): c is [string, ReactNode, (() => void)?] => !!c)
        return (
          <dl key={i} className="in factory-facts">
            {cells.map(([k, v, go]) => (
              <div key={k} className={go ? 'factory-fact go' : 'factory-fact'} onClick={go} role={go ? 'button' : undefined} tabIndex={go ? 0 : undefined}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )
      }
      case 'metrics':
        return (
          <div key={i} className="in factory-metrics">
            {p.items.map((m) => {
              const v = metricValues(m.key, o, runs)
              if (v.now === undefined) return null
              const d = v.before === undefined ? 0 : v.now - v.before
              return (
                <div key={m.key} className="factory-metric">
                  <div><span className="n">{compact(v.now)}</span>{d !== 0 && <span className="d">{d > 0 ? '+' : '−'}{compact(Math.abs(d))}</span>}</div>
                  <div className="k">{metricLabel(m)}</div>
                </div>
              )
            })}
          </div>
        )
      case 'chart': {
        const series = runs.slice(0, p.runs ?? BARS).reverse().map((r) => ({ r, v: r.metrics?.[p.metric] }))
        if (!series.some((s) => typeof s.v === 'number')) return null
        const max = Math.max(1, ...series.map((s) => s.v ?? 0))
        const name = words(p.label) ?? metricLabel({ key: p.metric })
        return (
          <div key={i}>
            <div className="in label">{name}</div>
            <div className="in factory-bars" role="img" aria-label={t.chartLabel(name, series.length)}>
              {series.map(({ r, v }) => <span key={r.at} className={typeof v === 'number' ? (r.ok ? undefined : 'bad') : 'none'} style={{ height: `${Math.max(6, ((v ?? 0) / max) * 100)}%` }} />)}
            </div>
          </div>
        )
      }
      case 'results': {
        const list = runs.slice(0, p.limit ?? 5)
        if (!list.length) return null
        return (
          <div key={i} className="factory-outcomes">
            <div className="in label">{t.lastResults}</div>
            {list.map((r) => (
              <Line key={r.at} ch={r.ok ? '✓' : '×'} onClick={() => openRun(r)} meta={t.endedAgo(short(now - r.at, true))}>
                {r.summary || r.note || (r.ok ? t.state_done : t.state_failed)}
              </Line>
            ))}
          </div>
        )
      }
      case 'gallery': {
        const shots = (newest?.images ?? []).slice(0, p.limit ?? 6)
        if (!shots.length || !last) return null
        return (
          <div key={i} className="in factory-gallery">
            {shots.map((img) => <img key={img} src={`/api/auto/${encodeURIComponent(id)}/blob?path=${encodeURIComponent(img)}`} alt={t.screenshot(img.split('/').pop() ?? img)} loading="lazy" onClick={() => openRun(last)} />)}
          </div>
        )
      }
      case 'report': {
        const text = newest?.report ? plain(newest.report).slice(0, REPORT_HEAD) : last?.summary || last?.note
        if (!text || !last) return null
        return (
          <div key={i}>
            <div className="in label">{t.fact_last}</div>
            <div className="in"><Prose text={text} /></div>
            <Line ch="·" onClick={() => openRun(last)}>{t.wholeReport}</Line>
          </div>
        )
      }
      case 'runs': {
        const ticks = runs.slice(0, BARS).reverse()
        if (!ticks.length) return null
        const longest = Math.max(1, ...ticks.map((r) => r.at - r.startedAt))
        return (
          <div key={i}>
            <div className="in label">{t.runsN(x.runCount || runs.length)}</div>
            <div className="in factory-bars">
              {ticks.map((r) => <button key={r.at} className={r.ok ? undefined : 'bad'} style={{ height: `${Math.max(10, ((r.at - r.startedAt) / longest) * 100)}%` }} onClick={() => openRun(r)} aria-label={t.runLabel(short(now - r.at, true), r.ok)} />)}
            </div>
          </div>
        )
      }
      case 'actions':
        return (
          <div key={i}>
            {p.items.map((a, n) => {
              if (isAsk(a)) return <Line key={n} ch="*" go={null} onClick={() => ask(a)}>{words(a.label)}</Line>
              const d = doAction(a.do)
              return d ? <Line key={n} ch={d.ch} go={d.leads ? '→' : null} onClick={d.go}>{words(a.label) ?? d.label}</Line> : null
            })}
          </div>
        )
      case 'text':
        return (
          <div key={i} className="in factory-text">
            {p.title && <div className="t">{words(p.title)}</div>}
            <div>{words(p.body)}</div>
          </div>
        )
    }
  }

  const waiting = f.remote === 'pending' && f.note
    ? f.note === 'secret' ? t.repoWaiting_secret(f.detail ?? '') : f.note === 'taken' ? t.repoWaiting_taken(f.detail ?? f.name) : t[`repoWaiting_${f.note}`]
    : null
  return (
    <Shell
      slot={slotOf(id)}
      kicker={kicker ?? t.title}
      title={x.title}
      actions={headAction && onConversation ? [<button key="standard" className="ch" onClick={onConversation} aria-label={t.toStandard}><Icon name="bubble" /></button>] : undefined}
    >
      <div className="factory-page" data-factory={id}>
        {moment && !panels.some((p) => p.type === 'hero') && <UnlockMoment title={x.title} />}
        {panels.map(draw)}
        {waiting && (
          <div className="in meta factory-note" role="status">
            {waiting}
            {(f.note === 'github' || f.note === 'failed') && <button onClick={() => act(api.unlockFactory(id))}>{t.repoRetry}</button>}
          </div>
        )}
        {note && <div className="in meta factory-note" role="status">{note}</div>}
      </div>
    </Shell>
  )
}
