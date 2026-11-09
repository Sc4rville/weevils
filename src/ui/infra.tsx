import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import type { FsListing, InfraDetail, InfraPoint, Level, MachineBrief, QuotaInfo, QuotaWindow, UsageInfo, UsageRow } from '../../shared/infra.ts'
import { api, type FileContent } from '../api'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/infra'
import { useApp } from './app-context'
import { Line, SessionRow } from './bits'
import { CodeFile } from './codeview'
import { durLong } from './format'
import { Icon } from './icons'
import { Shell } from './shell'
import './infra.css'

/**
 * Le coin infrastructure, en haut à droite du fil : les machines (une icône chacune, empilées, avec CPU et mémoire),
 * « / » (le système de fichiers de chaque machine) et le cerveau (ce qu'il reste d'abonnement Claude et Codex).
 */

// ---------------------------------------------------------------- données partagées, rafraîchies tant que l'app est visible

function usePoll<T>(load: () => Promise<T>, every: number): T | null {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let off = false
    const tick = () =>
      document.visibilityState === 'visible' &&
      load()
        .then((x) => !off && setV(x))
        .catch(() => undefined)
    tick()
    const t = setInterval(tick, every)
    document.addEventListener('visibilitychange', tick)
    return () => {
      off = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [every])
  return v
}

const quotaLevel = (p: number): Level => (p >= 90 ? 'crit' : p >= 75 ? 'warn' : 'ok')
const worst = (q?: QuotaInfo | null) => Math.max(0, ...(q?.windows ?? []).filter((w) => w.kind !== 'model').map((w) => w.percent))

/** « 16:00 », ou « jeu. 16:00 » au-delà de 20 h. */
function when(t: number | null, now: number) {
  if (!t) return ''
  const d = new Date(t)
  const time = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
  return t - now > 20 * 3600_000 ? `${d.toLocaleDateString(intlLocale(), { weekday: 'short' })} ${time}` : time
}

// ---------------------------------------------------------------- icônes : un seul aplat chacune, l'état se lit à la couleur

/** Une machine : l'écran, le pied et la base d'un seul tenant. */
const MACHINE = 'M2 3h20v14h-8v2h3v2H7v-2h3v-2H2z'
/** Le cerveau vu de dessus, d'un seul tenant : lobes bosselés, la fente entaillée par le haut. */
const BRAIN = 'M7 4h4v6h2V4h4v2h3v3h2v6h-2v3h-3v2H7v-2H4v-3H2V9h2V6h3z'

function Solid({ d }: { d: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  )
}

/** Le cerveau se remplit par le bas comme une jauge : la part utilisée de l'abonnement, le reste en transparence. */
function BrainFill({ pct }: { pct: number }) {
  const id = useId()
  const top = 4 + (1 - Math.min(100, Math.max(0, pct)) / 100) * 16
  return (
    <svg className="ic" viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden focusable="false">
      <clipPath id={id}>
        <rect x="0" y={top} width="24" height={24 - top} />
      </clipPath>
      <path d={BRAIN} fill="currentColor" opacity={0.32} />
      <path d={BRAIN} fill="currentColor" clipPath={`url(#${id})`} />
    </svg>
  )
}

const levelOf1 = (v: number, k: 'cpu' | 'mem'): Level => (k === 'cpu' ? (v >= 90 ? 'crit' : v >= 70 ? 'warn' : 'ok') : v >= 92 ? 'crit' : v >= 80 ? 'warn' : 'ok')

/** Une jauge (pages machine et abonnement) : remplie de la couleur de l'encre, orange puis rouge près de la limite. */
function Gauge({ pct, level, className = '' }: { pct: number; level: Level; className?: string }) {
  return (
    <span className={`gauge ${className}`} aria-hidden>
      <span className={`lv-${level}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

// ---------------------------------------------------------------- le coin, flottant en haut à droite du fil

export function InfraCorner({ hidden }: { hidden?: boolean }) {
  const { snap, push } = useApp()
  const t = useT(M)
  const brief = usePoll(() => api.infraBrief().then((r) => r.machines), 15_000)
  const usage = usePoll(() => api.usage(), 120_000)
  // Avant la première mesure : les machines connues du fil.
  const machines: MachineBrief[] = brief ?? snap.machines.map((m) => ({ id: m.id, name: m.name, online: m.online !== false, cpu: 0, mem: 0, level: 'ok' as Level, weevboss: false }))
  const c = usage?.claude
  const top = worst(c)
  const parts = (c?.windows ?? []).filter((w) => w.kind !== 'model').map((w) => `${w.kind === 'session' ? t.session5h : t.week} ${w.percent} %`).join(', ')
  return (
    <div className="infra-float" hidden={hidden}>
      <div className={`mx-row ${machines.length > 3 ? 'many' : ''}`}>
        {machines.map((m, i) => (
          <button
            key={m.id}
            className={`mx lv-text-${m.online ? m.level : 'off'} ${i ? 'behind' : ''}`}
            style={{ zIndex: machines.length - i, transform: i ? `translateY(${-Math.min(i, 3) * 3}px)` : undefined } as CSSProperties}
            onClick={() => push({ kind: 'infra', machine: m.id })}
            aria-label={t.machineAria(m.name, m.cpu, m.mem, m.online)}
          >
            <Solid d={MACHINE} />
          </button>
        ))}
      </div>
      <button className="ix" onClick={() => push({ kind: 'fs', machine: machines[0]?.id ?? '', path: '/' })} aria-label={t.filesAria}>
        <Icon name="slash" />
      </button>
      <button className={`ix lv-text-${c?.ok ? quotaLevel(top) : 'off'}`} onClick={() => push({ kind: 'usage' })} aria-label={t.quotaAria(parts || t.unavailable)}>
        <BrainFill pct={c?.ok ? top : 0} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- page machine (fusionnée avec l'ancienne page « @ »)

function Stat({ label, pct, level, text }: { label: string; pct: number | null; level: Level; text: string }) {
  return (
    <div className="in stat">
      <div className="stat-h">
        <span className="strong">{label}</span>
        <span className="meta">{text}</span>
      </div>
      {pct != null && <Gauge pct={pct} level={level} className="big" />}
    </div>
  )
}

/** La journée : la mémoire en aplat, le CPU en trait, les saturations en blocs rouges en bas, le pic marqué. */
function DayChart({ points, episodes }: { points: InfraPoint[]; episodes: InfraDetail['episodes'] }) {
  const t = useT(M)
  const W = 288
  const H = 64
  const d0 = new Date()
  d0.setHours(0, 0, 0, 0)
  const start = d0.getTime()
  const x = (at: number) => ((at - start) / 86400_000) * W
  const y = (v: number) => H - (Math.min(100, v) / 100) * (H - 4)
  if (!points.length) return <div className="in meta empty">{t.noMeasure}</div>
  const mem = `M${x(points[0].at)} ${H}` + points.map((p) => `L${x(p.at).toFixed(1)} ${y(p.mem).toFixed(1)}`).join('') + `L${x(points[points.length - 1].at + 300_000)} ${H}Z`
  const cpu = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)} ${y(p.cpuMax).toFixed(1)}`).join('')
  const peak = points.reduce((a, b) => (b.cpuMax > a.cpuMax ? b : a))
  return (
    <div className="in chart">
      <svg viewBox={`0 0 ${W} ${H + 12}`} preserveAspectRatio="none" aria-hidden>
        <path d={mem} className="c-mem" />
        <path d={cpu} className="c-cpu" vectorEffect="non-scaling-stroke" />
        {episodes.map((e) => (
          <rect key={e.from} x={x(e.from)} y={H + 2} width={Math.max(2, x(e.to) - x(e.from))} height={6} className="lv-crit" />
        ))}
        <rect x={x(peak.at) - 2} y={y(peak.cpuMax) - 2} width={4} height={4} className="c-peak" />
      </svg>
      <div className="chart-h meta" aria-hidden>
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  )
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })

export function InfraPage({ machine, projectId }: { machine?: string; projectId?: string }) {
  const { snap, push } = useApp()
  const t = useT(M)
  const fromProject = projectId ? snap.sessions.find((s) => s.projectId === projectId)?.machineId : undefined
  const [id, setId] = useState(machine ?? fromProject ?? snap.machines[0]?.id ?? '')
  const [d, setD] = useState<InfraDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    setErr(null)
    const load = () =>
      api
        .infra(id)
        .then((x) => !off && (setD(x), setErr(null)))
        .catch((e) => !off && setErr((e as Error).message))
    void load()
    const tm = setInterval(load, 20_000)
    return () => {
      off = true
      clearInterval(tm)
    }
  }, [id])
  const m = snap.machines.find((x) => x.id === id)
  const shown = d?.id === id ? d : null
  const sessions = snap.sessions.filter((s) => s.machineId === id && s.status !== 'done')
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  return (
    <Shell
      slot="agent"
      kicker="weevils"
      title={m?.name ?? id}
      meta={
        shown ? (
          <>
            {t.cores(shown.cores)} · {t.size(shown.memTotal)} · {shown.os}
            <br />
            {t.load(...shown.load)} · {t.up(durLong(shown.uptime))}
            {shown.weevboss && (
              <>
                <br />
                <span className="strong">{t.weevbossHere}</span>
              </>
            )}
          </>
        ) : m?.online === false ? (
          t.offline
        ) : (
          '…'
        )
      }
    >
      <div className="ipage">
        {snap.machines.length > 1 && (
          <div className="in mx-tabs">
            {snap.machines.map((x) => (
              <button key={x.id} className={`mx-tab ${x.id === id ? 'on' : ''} ${x.online === false ? 'off' : ''}`} onClick={() => setId(x.id)} aria-pressed={x.id === id}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        {err && (
          <div className="band invert" role="alert">
            <div className="in meta" style={{ paddingBlock: 12 }}>
              ! {err}
            </div>
          </div>
        )}
        {shown && (
          <>
            <Stat label={t.cpu} pct={shown.cpu} level={levelOf1(shown.cpu, 'cpu')} text={`${shown.cpu} %`} />
            <Stat label={t.mem} pct={pct(shown.memUsed, shown.memTotal)} level={levelOf1(pct(shown.memUsed, shown.memTotal), 'mem')} text={t.of(t.size(shown.memUsed), t.size(shown.memTotal))} />
            <Stat
              label={t.swap}
              pct={shown.swapTotal ? pct(shown.swapUsed, shown.swapTotal) : null}
              level={pct(shown.swapUsed, shown.swapTotal) > 50 ? 'warn' : 'ok'}
              text={shown.swapTotal ? t.of(t.size(shown.swapUsed), t.size(shown.swapTotal)) : t.noSwap}
            />
            <Stat
              label={t.disk}
              pct={pct(shown.diskUsed, shown.diskTotal)}
              level={pct(shown.diskUsed, shown.diskTotal) >= 92 ? 'crit' : pct(shown.diskUsed, shown.diskTotal) >= 85 ? 'warn' : 'ok'}
              text={t.of(t.size(shown.diskUsed), t.size(shown.diskTotal))}
            />

            <div className="in label">{t.today}</div>
            <DayChart points={shown.day} episodes={shown.episodes} />
            {shown.episodes.length > 0 && <div className="in label">{t.peaks}</div>}
            {shown.episodes.map((e) => (
              <div key={e.from} className="in row-static">
                <span className="st lv-text-crit" aria-hidden>
                  <Icon name="bang" />
                </span>
                <span className="stack-text">
                  <span className="strong">
                    {hhmm(e.from)}–{hhmm(e.to)}
                    {e.culprit ? ` · ${e.culprit}` : ''}
                  </span>
                  <span className="meta">{t.episode(e.cpu, e.mem)}</span>
                </span>
              </div>
            ))}

            {shown.advice.length > 0 && <div className="in label">{t.advice}</div>}
            {shown.advice.map((a) => (
              <div key={a} className="in advice">
                {a}
              </div>
            ))}
          </>
        )}

        <div className="in label">{t.sessions}</div>
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
        {!sessions.length && <div className="in meta empty">{t.nothing}</div>}

        {shown && shown.servers.length > 0 && <div className="in label">{t.servers}</div>}
        {shown?.servers.map((s) =>
          s.url ? (
            <Line key={s.port} ch="#" meta={s.url.replace(/^https:\/\//, '')} onClick={() => window.open(s.url, '_blank', 'noopener')} go="↑">
              <span className="strong">{s.port}</span> {s.name} {s.dir}
            </Line>
          ) : (
            <Line key={s.port} ch="#" go={null} onClick={s.dir ? () => push({ kind: 'fs', machine: id, path: s.dir! }) : undefined}>
              <span className="strong">{s.port}</span> {s.name} {s.dir}
            </Line>
          ),
        )}
        <div style={{ height: 12 }} aria-hidden />
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------- tout le système de fichiers d'une machine

const parentOf = (p: string) => (p === '/' ? null : p.replace(/\/[^/]+\/?$/, '') || '/')
const join = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

export function FsPage({ machine, path }: { machine: string; path: string }) {
  const { snap, push } = useApp()
  const t = useT(M)
  const [l, setL] = useState<FsListing | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    api
      .fs(machine, path)
      .then((x) => !off && setL(x))
      .catch((e) => !off && setErr((e as Error).message))
    return () => {
      off = true
    }
  }, [machine, path])
  const here = l?.path ?? path
  const parent = parentOf(here)
  const name = snap.machines.find((m) => m.id === machine)?.name ?? machine
  return (
    <Shell slot="agent" kicker={parent ? `${name}:${parent}` : name} title={here === '/' ? '/' : `/${here.split('/').pop()}`} meta={l ? `${name} · ${t.entries(l.entries.length)}` : t.reading}>
      <div className="ipage">
        {snap.machines.length > 1 && here === '/' && (
          <div className="in mx-tabs">
            {snap.machines.map((x) => (
              <button
                key={x.id}
                className={`mx-tab ${x.id === machine ? 'on' : ''} ${x.online === false ? 'off' : ''}`}
                onClick={() => x.id !== machine && push({ kind: 'fs', machine: x.id, path: '/' })}
                aria-pressed={x.id === machine}
              >
                {x.name}
              </button>
            ))}
          </div>
        )}
        {(err || l?.error) && (
          <div className="band invert" role="alert">
            <div className="in meta" style={{ paddingBlock: 12 }}>
              ! {err ?? l?.error}
            </div>
          </div>
        )}
        {l && here === '/' && (
          <Line ch="/" meta={l.home} onClick={() => push({ kind: 'fs', machine, path: l.home })}>
            <span className="strong">~</span>
          </Line>
        )}
        {l?.entries.map((e) =>
          e.dir ? (
            <Line key={e.name} ch="/" onClick={() => push({ kind: 'fs', machine, path: join(here, e.name) })}>
              <span className="strong">{e.name}/</span>
            </Line>
          ) : (
            <Line key={e.name} ch="·" meta={t.size(e.size)} onClick={() => push({ kind: 'fsfile', machine, path: join(here, e.name) })}>
              {e.name}
            </Line>
          ),
        )}
      </div>
    </Shell>
  )
}

/** Un fichier n'importe où : la vue fichier avec ses explications au tap. Dans un repo, il est ouvert comme un fichier du repo. */
export function FsFilePage({ machine, path }: { machine: string; path: string }) {
  const { snap } = useApp()
  const [file, setFile] = useState<FileContent | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    api
      .fsFile(machine, path)
      .then((f) => !off && setFile(f))
      .catch((e) => !off && setErr((e as Error).message))
    return () => {
      off = true
    }
  }, [machine, path])
  const inRepo = /\/projects\/([\w.@+-]+)\/(.+)$/.exec(path)
  const project = inRepo ? snap.projects.find((p) => p.repos.includes(inRepo[1])) : undefined
  const dir = path.split('/').slice(0, -1).join('/') || '/'
  const name = snap.machines.find((m) => m.id === machine)?.name ?? machine
  return inRepo ? (
    <CodeFile projectId={project?.id ?? ''} repo={inRepo[1]} path={inRepo[2]} machine={machine} file={file} err={err} kicker={`${name}:${dir}`} />
  ) : (
    <CodeFile projectId="" repo="" path={path} machine={machine} file={file} err={err} kicker={`${name}:${dir}`} />
  )
}

// ---------------------------------------------------------------- abonnement

function Quota({ name, q }: { name: string; q: QuotaInfo | undefined }) {
  const t = useT(M)
  const { now } = useApp()
  const label = (w: QuotaWindow) => (w.kind === 'session' ? t.session5h : w.kind === 'week' ? t.week : t.weekOf(w.label ?? ''))
  return (
    <>
      <div className="in label">
        {name}
        {q?.plan ? ` · ${q.plan}` : ''}
      </div>
      {!q && <div className="in meta empty">…</div>}
      {q && !q.ok && <div className="in meta empty">! {q.error ?? t.unavailable}</div>}
      {q?.windows.map((w) => (
        <div key={`${w.kind}${w.label ?? ''}`} className={`in stat ${w.kind === 'model' ? 'minor' : ''}`}>
          <div className="stat-h">
            <span className="strong">
              {label(w)} <span className={`lv-text-${quotaLevel(w.percent)}`}>{w.percent} %</span>
            </span>
            <span className="meta">{w.resetsAt ? t.resets(when(w.resetsAt, now)) : ''}</span>
          </div>
          <Gauge pct={w.percent} level={quotaLevel(w.percent)} className="big" />
        </div>
      ))}
    </>
  )
}

export function UsagePage() {
  const { snap, push, colors } = useApp()
  const t = useT(M)
  const [u, setU] = useState<UsageInfo | null>(null)
  const [rows, setRows] = useState<UsageRow[] | null>(null)
  useEffect(() => {
    void api
      .usage()
      .then(setU)
      .catch(() => undefined)
    void api
      .usageToday()
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]))
  }, [])
  const total = rows?.reduce((s, r) => s + r.weight, 0) ?? 0
  const byProject = useMemo(() => {
    const m = new Map<string, { weight: number; tokens: number }>()
    for (const r of rows ?? []) {
      const p = m.get(r.projectId) ?? { weight: 0, tokens: 0 }
      p.weight += r.weight
      p.tokens += r.tokens
      m.set(r.projectId, p)
    }
    return [...m].sort((a, b) => b[1].weight - a[1].weight)
  }, [rows])
  const share = (w: number) => (total ? Math.round((w / total) * 100) : 0)
  const projectName = (id: string) => snap.projects.find((p) => p.id === id)?.name ?? id
  const known = new Set(snap.sessions.map((s) => s.id))
  return (
    <Shell slot="agent" kicker="weevils" title={t.usageTitle}>
      <div className="ipage">
        <Quota name="Claude" q={u?.claude} />
        <Quota name="Codex" q={u?.codex} />

        <div className="in label">{t.byProject}</div>
        {!rows && <div className="in meta empty">{t.reading}</div>}
        {rows && !rows.length && <div className="in meta empty">{t.nobody}</div>}
        {byProject.map(([id, p]) => (
          <div key={id} className="in stat share" style={{ ['--bar' as string]: colors[id] ? `var(--${colors[id]})` : undefined }}>
            <div className="stat-h">
              <span className="strong">{projectName(id)}</span>
              <span className="meta">{t.share(share(p.weight), p.tokens)}</span>
            </div>
            <Gauge pct={share(p.weight)} level="ok" className="big" />
          </div>
        ))}

        {rows && rows.length > 0 && <div className="in label">{t.bySession}</div>}
        {rows?.slice(0, 40).map((r) => (
          <Line
            key={`${r.machine}:${r.id}`}
            ch={r.tool === 'codex' ? '>_' : '*'}
            meta={`${projectName(r.projectId)} · ${r.tool} · ${r.machine} · ${t.share(share(r.weight), r.tokens)}`}
            go={known.has(r.id) ? '→' : null}
            onClick={known.has(r.id) ? () => push({ kind: 'session', id: r.id }) : undefined}
          >
            {snap.sessions.find((s) => s.id === r.id)?.title ?? r.title}
          </Line>
        ))}
      </div>
    </Shell>
  )
}
