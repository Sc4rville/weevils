// Your factory, in weevils next's side bar (docs/next-interaction.md, « Your factory »): one band under Autonomous that
// unfolds, like every band of the side bar, into Machines, Intelligence, Projects and the global Tempo. Each level
// unfolds again into one band per thing, the same height, the same staircase (one small tone step per band), no line,
// no box. What it shows is weevils' own: GET /api/factory (server/your-factory.ts), the snapshot, Tempo's own view.
// Reused from the app: Collapse, Icon, ToolIcon (the providers' monochrome logos), Composer, PageView, Shell, the
// setup flows (askSetup, openKey: a key is only ever typed in the masked field), Tempo (useTempo, TempoBand).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Project, Snapshot } from '../../shared/api.ts'
import { KEYS, type Brand, type FactoryIntel, type FactoryMachine, type FactoryOnDemand, type FactoryView } from '../../shared/your-factory.ts'
import { TEMPO_MODES, type TempoMode } from '../../shared/tempo.ts'
import { useT } from '../../src/i18n/index.ts'
import TM from '../../src/i18n/tempo.ts'
import { useApp, type Page } from '../../src/ui/app-context.tsx'
import { selfProject } from '../../src/ui/recursive-identity.ts'
import { Collapse, Composer, ToolIcon } from '../../src/ui/bits.tsx'
import { focusBoss } from '../../src/ui/follow.ts'
import { G, Icon, Mark, type MarkName } from '../../src/ui/icons.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { seedPending } from '../../src/ui/pending.ts'
import { askSetup, openKey } from '../../src/ui/setup.tsx'
import { Shell } from '../../src/ui/shell.tsx'
import { TempoBand, useTempo } from '../../src/ui/tempo.tsx'
import { call } from './data.ts'
import { foldPrefs, saveFold } from './fold.ts'

// ---------------------------------------------------------------- data

let shared: FactoryView | null = null
const subs = new Set<(v: FactoryView) => void>()
const publish = (v: FactoryView) => {
  shared = v
  for (const f of subs) f(v)
}
const load = () => call<FactoryView>('GET', '/api/factory').then(publish).catch(() => undefined)

/** The factory's view, shared by the side bar and a machine's page; read again every 15 s while one of them shows. */
export function useFactory(live: boolean): [FactoryView | null, (fn: (v: FactoryView) => FactoryView) => void] {
  const [v, setV] = useState(shared)
  useEffect(() => {
    subs.add(setV)
    return () => void subs.delete(setV)
  }, [])
  useEffect(() => {
    if (!live) return
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [live])
  return [v, (fn) => shared && publish(fn(shared))]
}

/** Your factory's bands start folded: open is remembered (false = unfolded in the app's key). */
const isOpen = (key: string) => foldPrefs()[key] === false
function useFold(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => isOpen(key))
  return [open, () => setOpen((v) => (saveFold(key, v), !v))]
}

/** A repo with no project yet keeps a colour of its own, the same every time (the app's 16 slots). */
const slotOf = (id: string) => `p${[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 16}`

/** Reserved project ids (server/projects.ts): automations' own folder, and Misc. */
const HIDDEN_IDS = new Set(['auto', 'divers'])
/** An automation's own folder (server/projects.ts isAutomationFolder): autonomous's, never a project. */
const AUTOMATION_FOLDER = /^auto-[0-9a-f]{10}$/

type Mother = { id: string; name: string; repos: string[] }
/** An older machine answers with its folders only: grouped here the way the server does it, by product name. */
export function mothersOf(folders: string[]): Mother[] {
  const by = new Map<string, Mother>()
  for (const f of folders) {
    if (AUTOMATION_FOLDER.test(f) || f === 'automations') continue
    const id = (f.split(/[-_.]/)[0] || f).toLowerCase()
    const m = by.get(id) ?? { id, name: id, repos: [] }
    m.repos.push(f)
    by.set(id, m)
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A project is in the side bar: never once switched off (whatever its conversations do: off means off at once);
 *  else pinned (the app's pin), or with conversations. One rule, used by the side bar and by its switch here. */
export function inSideBar(snap: Snapshot, p: Project): boolean {
  if (snap.hiddenProjects?.includes(p.id)) return false
  if (p.repos.some((r) => snap.pinnedRepos.includes(r)) || snap.pinnedRepos.includes(p.id)) return true
  return snap.sessions.some((s) => s.projectId === p.id && !s.archived)
}

/** A switch just flipped, shown at once by the switch and by the side bar until the server's snapshot says the same
 *  (then forgotten): never undone by an unrelated snapshot arriving meanwhile. */
const flipped = new Map<string, boolean>()
const flipSubs = new Set<() => void>()
const flipEmit = () => flipSubs.forEach((f) => f())
export function flipProject(id: string, on: boolean | null) {
  if (on === null) flipped.delete(id)
  else flipped.set(id, on)
  flipEmit()
}
/** Whether a project shows in the side bar now: a switch just flipped, else the rule. */
export function shownNow(snap: Snapshot, p: Project): boolean {
  return flipped.get(p.id) ?? inSideBar(snap, p)
}
/** Re-renders on a flip, and forgets the flips the snapshot now agrees with. */
export function useFlips(snap: Snapshot) {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    flipSubs.add(f)
    return () => void flipSubs.delete(f)
  }, [])
  useEffect(() => {
    let changed = false
    for (const [id, on] of flipped) if (!!snap.hiddenProjects?.includes(id) === !on) { flipped.delete(id); changed = true }
    if (changed) flipEmit()
  }, [snap])
}

type Row = { id: string; name: string; repos: string[]; project: Project | null }
/** Your factory's Projects, in a fixed order (a switch never moves its band): every project weevils knows but its own
 *  block at the top, and those switched off whose project left with their last pin, so they can be switched back on. */
export function factoryProjects(snap: Snapshot): Row[] {
  const projects = snap.projects.filter((p) => !HIDDEN_IDS.has(p.id) && p.kind !== 'installation' && !selfProject(p))
  const gone = (snap.hiddenProjects ?? []).filter((id) => !HIDDEN_IDS.has(id) && !AUTOMATION_FOLDER.test(id) && !snap.projects.some((p) => p.id === id || p.repos.includes(id)))
  return [
    ...projects.map((p): Row => ({ id: p.id, name: p.name, repos: p.repos, project: p })),
    ...gone.map((id): Row => ({ id, name: id, repos: [id], project: null })),
  ].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- small parts

/** The switch: a plain rectangle and its square knob, in the band's own ink. */
function Switch({ on, label, onChange, small = false }: { on: boolean; label: string; onChange: (on: boolean) => void; small?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`nx-switch ${small ? 'small' : ''} ${on ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); navigator.vibrate?.(6); onChange(!on) }}>
      <i />
    </button>
  )
}

/** A thin bar: a machine's health (how full it is) or what is left of a subscription (its power). */
function Bar({ pct, level, power = false }: { pct: number; level: 'ok' | 'warn' | 'crit'; power?: boolean }) {
  return (
    <span className={`nx-fx-bar nx-lv-${level} ${power ? 'power' : ''}`} aria-hidden>
      <i style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} />
    </span>
  )
}

const powerLevel = (left: number) => (left <= 10 ? 'crit' : left <= 25 ? 'warn' : 'ok')

/** A provider's logo, monochrome (the app's ToolIcon: Claude, OpenAI); the others, their initial in a small square. */
const INITIAL: Partial<Record<Brand, string>> = { gemini: 'G', mistral: 'M', xai: 'x', openrouter: 'R' }
function Logo({ brand }: { brand: Brand }) {
  if (brand === 'claude' || brand === 'openai') return <ToolIcon tool={brand === 'claude' ? 'claude' : 'codex'} size={18} />
  return <span className="nx-fx-initial" aria-hidden>{INITIAL[brand] ?? brand.slice(0, 1).toUpperCase()}</span>
}

/** One band of a level: the same height as the side bar's, one tone step down from the one above. */
function Band({ step, depth, className = '', children, style }: { step: number; depth: number; className?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`nx-row nx-sub nx-fx-band nx-fx-d${depth} ${className}`} style={{ '--step': step, ...style } as CSSProperties}>
      {children}
    </div>
  )
}

/** A level's own band (Machines, Intelligence, Projects): its solid mark, its name, which folds what is under it. */
function LevelHead({ step, name, mark, open, onFold, sign }: { step: number; name: string; mark: MarkName; open: boolean; onFold: () => void; sign?: ReactNode }) {
  return (
    <Band step={step} depth={1}>
      <button className="nx-fx-main" onClick={onFold} aria-expanded={open}>
        <span className="nx-mark nx-fx-logo"><Mark name={mark} size={20} /></span>
        <span className="nx-row-title nx-fx-level">{name}</span>
        {sign}
      </button>
    </Band>
  )
}

/** The last band of a level: « + ». */
function PlusBand({ step, label, onClick, open }: { step: number; label: string; onClick: () => void; open?: boolean }) {
  return (
    <Band step={step} depth={2}>
      <button className="nx-fx-main" onClick={onClick} aria-label={label} aria-expanded={open}>
        <span className="nx-mark"><Icon name="plus" /></span>
      </button>
    </Band>
  )
}

// ---------------------------------------------------------------- machines

function MachineBand({ m, step, busy, onOpen, onPatch }: { m: FactoryMachine; step: number; busy: number; onOpen: () => void; onPatch: (p: Partial<FactoryMachine>) => void }) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [name, setName] = useState(m.name)
  const hold = useRef<number | null>(null)
  const held = useRef(false)
  useEffect(() => { if (!editing) setName(m.name) }, [m.name, editing])
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 6000)
    return () => clearTimeout(t)
  }, [confirm])
  const save = () => {
    setEditing(false)
    const v = name.replace(/\s+/g, ' ').trim()
    if (v === m.name) return
    onPatch({ name: v || m.name })
    void call('POST', '/api/factory/machine', { id: m.id, name: v }).then(load, load)
  }
  const turn = (on: boolean) => {
    // Off with agents at work there: one short line first.
    if (!on && busy > 0 && !confirm) return setConfirm(true)
    setConfirm(false)
    onPatch({ off: !on })
    void call('POST', '/api/factory/machine', { id: m.id, off: !on }).then(load, load)
  }
  const press = {
    onPointerDown: () => {
      held.current = false
      hold.current = window.setTimeout(() => { held.current = true; navigator.vibrate?.(10); setEditing(true) }, 520)
    },
    onPointerUp: () => void (hold.current && clearTimeout(hold.current)),
    onPointerLeave: () => void (hold.current && clearTimeout(hold.current)),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => { if (held.current) return void (held.current = false); onOpen() },
  }
  const dim = m.off || !m.online
  return (
    <>
      <Band step={step} depth={2} className={`${dim ? 'nx-fx-dim' : ''} ${busy ? 'nx-active' : ''}`}>
        {editing ? (
          <form className="nx-fx-main" onSubmit={(e) => { e.preventDefault(); save() }}>
            <span className="nx-mark"><Icon name={m.kind === 'server' ? 'server' : 'machine'} /></span>
            <input className="nx-fx-name" value={name} autoFocus maxLength={40} aria-label="Machine name" onChange={(e) => setName(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Escape') { setName(m.name); setEditing(false) } }} />
          </form>
        ) : (
          <button className="nx-fx-main" aria-label={`${m.name}, hold to rename`} {...press}>
            <span className={`nx-mark nx-fx-icon ${busy && !m.off ? 'nx-fx-busy' : ''}`}><Icon name={m.kind === 'server' ? 'server' : 'machine'} /></span>
            <span className="nx-row-text nx-fx-text">
              <span className="nx-row-title">{m.name}</span>
              {m.load != null && m.online && <Bar pct={m.load} level={m.level} />}
            </span>
          </button>
        )}
        <Switch on={!m.off} label={`${m.name} on`} onChange={turn} />
      </Band>
      <Collapse open={confirm}>
        <Band step={step} depth={2} className="nx-fx-confirm">
          <span className="nx-fx-ask">{busy === 1 ? '1 agent is working here: it stops.' : `${busy} agents are working here: they stop.`}</span>
          <button className="nx-fx-word strong" onClick={() => turn(false)}>Turn off</button>
          <button className="nx-fx-word" onClick={() => setConfirm(false)}>Keep</button>
        </Band>
      </Collapse>
    </>
  )
}

/** One line under the machines, with two or more: a busy machine's tests and builds run on an idle one. */
function ShareBand({ share, step, onPatch }: { share: NonNullable<FactoryView['share']>; step: number; onPatch: (on: boolean) => void }) {
  const turn = (on: boolean) => {
    onPatch(on)
    void call('POST', '/api/factory/share', { on }).then(load, load)
  }
  const away = share.on ? share.away.map((a) => `${a.n} on ${a.name}`).join(', ') : ''
  return (
    <Band step={step} depth={2} className={`${share.on ? '' : 'nx-fx-dim'} ${away ? 'nx-active' : ''}`}>
      <span className="nx-fx-main">
        <span className="nx-row-text nx-fx-text"><span className="nx-row-title">{away ? `Tests and builds: ${away}` : 'Tests and builds go to an idle machine'}</span></span>
      </span>
      <Switch on={share.on} label="Tests and builds go to an idle machine" onChange={turn} />
    </Band>
  )
}

// ---------------------------------------------------------------- intelligence

function IntelBand({ x, step, onOpen, onPatch }: { x: FactoryIntel; step: number; onOpen?: () => void; onPatch: (p: Partial<FactoryIntel>) => void }) {
  const turn = (on: boolean) => {
    onPatch({ off: !on })
    void call('POST', '/api/factory/intelligence', { id: x.id, off: !on }).then(load, load)
  }
  return (
    <Band step={step} depth={2} className={x.off ? 'nx-fx-dim' : ''}>
      <button className="nx-fx-main" onClick={onOpen} disabled={!onOpen} aria-label={x.plan ? `${x.name} ${x.plan}` : x.name}>
        <span className="nx-mark nx-fx-logo"><Logo brand={x.brand} /></span>
        <span className="nx-row-text nx-fx-text">
          <span className="nx-row-title">{x.name}{x.plan && <span className="nx-fx-plan"> {planName(x.plan)}</span>}</span>
          {x.left != null && !x.off && <Bar pct={x.left} level={powerLevel(x.left)} power />}
        </span>
      </button>
      {x.toggle && <Switch on={!x.off} label={`${x.name} on`} onChange={turn} />}
    </Band>
  )
}

/** A plan as its product names it (the app's infra.tsx planName, kept short here). */
function planName(plan: string) {
  if (/[A-Z\s]/.test(plan)) return plan
  return ({ prolite: 'Pro Lite', plus: 'Plus', pro: 'Pro', team: 'Team', max: 'Max', free: 'Free' } as Record<string, string>)[plan] ?? plan.replace(/^\w/, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------- tempo

/** The global Tempo: six cells, Standby to Swarm, filled up to the mode in use, each one denser than the last: the
 *  colour alone says the mode (no glyph, no caption). A tap on a cell sets that mode; a tap on the mode in use pauses
 *  (nothing filled). A locked cell changes nothing and says, for a moment, what opens it. Every mode but Pause keeps
 *  taking requests (docs/product/tempo.md). */
export function TempoCells({ step }: { step: number }) {
  const t = useT(TM)
  const [v, set] = useTempo()
  const [locked, setLocked] = useState<TempoMode | null>(null)
  const [band, setBand] = useState<TempoMode | null>(null)
  const timer = useRef<number | null>(null)
  const hint = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (hint.current) clearTimeout(hint.current)
  }, [])
  if (!v) return null
  const cells = TEMPO_MODES.slice(1)
  const open = (m: TempoMode) => v.modes.find((x) => x.id === m)?.unlocked ?? false
  const lit = cells.indexOf(v.global)
  const tap = (m: TempoMode) => {
    navigator.vibrate?.(6)
    if (!open(m)) {
      setLocked(m)
      if (hint.current) clearTimeout(hint.current)
      hint.current = window.setTimeout(() => setLocked(null), 4000)
      return
    }
    setLocked(null)
    const next = m === v.global ? 'pause' : m
    void set(next, null).then(() => {
      setBand(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setBand(null), 5200)
    }).catch(() => undefined)
  }
  const lockedView = locked ? v.modes.find((x) => x.id === locked) : undefined
  const u = lockedView?.unlock
  const opens = u ? [u.subscriptions ? t.subs(u.subscriptions) : '', u.cores ? t.vps(u.cores, u.ramGb ?? 0) : '', u.hostPlan ? t.hostPlan(u.hostPlan, u.hostPrice) : ''].filter(Boolean).join(' · ') : ''
  return (
    <>
      <Band step={step} depth={1} className="nx-fx-tempo">
        <span className="nx-fx-tempo-name">
          <span className="nx-mark nx-fx-logo"><Mark name="bolt" size={20} /></span>
          <span className="nx-row-title nx-fx-level">{t.title}</span>
        </span>
        <div className="nx-fx-cells" role="radiogroup" aria-label={t.globalAria(t.name(v.global))}>
          {cells.map((m, i) => (
            <button key={m} type="button" role="radio" aria-checked={m === v.global} aria-disabled={!open(m)} aria-label={t.name(m)}
              className={['nx-fx-cell', i <= lit && 'on', !open(m) && 'locked'].filter(Boolean).join(' ')} style={{ '--i': i } as CSSProperties}
              onClick={(e) => { e.stopPropagation(); tap(m) }} />
          ))}
        </div>
        {locked && opens && <span className="nx-fx-hint">{t.opensWith} {opens}</span>}
      </Band>
      <TempoBand v={v} mode={band} repo={null} onOpen={() => setBand(null)} />
    </>
  )
}

// ---------------------------------------------------------------- on demand

/** Dollars as a provider bills them: « $6.70 ». */
const usd = (x: number) => `$${x.toFixed(2)}`

/** One on-demand provider: its initial, its name, then one figure from its own meter (per hour while something runs
 *  there, else the credit left), its place in the fallback order when there is more than one, and its switch. No key yet: dimmed, a
 *  tap brings weevboss's screen with the masked field for its key. */
function OnDemandBand({ p, step, ranked, onKey, onTurn, onFirst }: { p: FactoryOnDemand; step: number; ranked: number; onKey: () => void; onTurn: (on: boolean) => void; onFirst: () => void }) {
  // One figure, the one that matters now: what runs there costs per hour, else the credit left.
  const value = !p.connected || p.rank == null ? '' : p.refused ? 'key refused' : p.perHour ? `${usd(p.perHour)}/h` : p.credit != null ? usd(p.credit) : ''
  const said = [p.credit != null ? `${usd(p.credit)} left` : '', p.perHour ? `${usd(p.perHour)} an hour now` : ''].filter(Boolean).join(', ')
  return (
    <Band step={step} depth={3} className={`nx-fx-od ${p.connected && p.rank != null ? '' : 'nx-fx-dim'}`}>
      {p.connected ? (
        <a className="nx-fx-main" href={p.console} target="_blank" rel="noreferrer" aria-label={`${p.name}${p.refused ? ', key refused' : said ? `, ${said}` : ''}`}>
          <span className="nx-mark nx-fx-logo"><span className="nx-fx-initial" aria-hidden>{p.name.slice(0, 1)}</span></span>
          <span className="nx-row-title">{p.name}</span>
          {value && <span className={`nx-fx-val ${p.refused ? 'warn' : ''}`}>{value}</span>}
        </a>
      ) : (
        <button className="nx-fx-main" onClick={onKey} aria-label={`Connect ${p.name}`}>
          <span className="nx-mark nx-fx-logo"><span className="nx-fx-initial" aria-hidden>{p.name.slice(0, 1)}</span></span>
          <span className="nx-row-title">{p.name}</span>
        </button>
      )}
      {ranked > 1 && p.rank != null && (
        <button type="button" className="nx-fx-rank" aria-label={p.rank === 1 ? `${p.name} is tried first` : `Try ${p.name} first`} disabled={p.rank === 1} onClick={onFirst}>{p.rank}</button>
      )}
      {p.connected && <Switch on={p.rank != null} label={`${p.name} on`} onChange={onTurn} />}
    </Band>
  )
}

/** The on-demand list with one provider moved: switched on (last of the order), off, or first. Ranks renumbered, the
 *  list in the server's order (ranked, then off, then no key): what the side bar shows before the server answers. */
export function reorder(list: FactoryOnDemand[], id: string, to: 'on' | 'off' | 'first'): FactoryOnDemand[] {
  const order: string[] = list.filter((x) => x.rank != null && x.id !== id).sort((a, b) => a.rank! - b.rank!).map((x) => x.id)
  if (to === 'first') order.unshift(id)
  if (to === 'on') order.push(id)
  const ranked = list.map((x) => ({ ...x, rank: order.includes(x.id) ? order.indexOf(x.id) + 1 : null }))
  const place = (x: FactoryOnDemand) => x.rank ?? (x.connected ? 100 : 200)
  return ranked.sort((a, b) => place(a) - place(b))
}

// ---------------------------------------------------------------- the band

export function FactorySection({ snap, colors, page, toBoss }: {
  snap: Snapshot
  colors: Record<string, string>
  page: (p: Page) => void
  /** Closes the side bar onto weevboss's screen (for a « + » that weevboss takes over). */
  toBoss: () => void
}) {
  const [open, fold] = useFold('__factory')
  const [mOpen, mFold] = useFold('__factory_machines')
  const [iOpen, iFold] = useFold('__factory_intel')
  const [pOpen, pFold] = useFold('__factory_projects')
  const [oOpen, oFold] = useFold('__factory_ondemand')
  const [adding, setAdding] = useState(false)
  const [more, setMore] = useState(false)
  const [v, patch] = useFactory(open)
  const [mothers, setMothers] = useState<Mother[] | null>(null)
  const here = snap.machines[0]?.id
  useEffect(() => {
    if (!more || !here) return
    void call<{ repos: string[]; mothers?: Mother[] }>('GET', `/api/repos?machine=${encodeURIComponent(here)}`).then((r) => setMothers(r.mothers ?? mothersOf(r.repos)), () => setMothers([]))
  }, [more, here])

  const busyOn = (id: string) => snap.sessions.filter((s) => !s.archived && s.status === 'working' && (s.machineId ?? here) === id).length
  const machines = v?.machines ?? snap.machines.map((m): FactoryMachine => ({ id: m.id, name: m.name, kind: null, online: m.online !== false, off: !!m.off, here: m.id === here, load: null, level: 'ok' }))
  const intel = v?.intelligence ?? []
  const onDemand = v?.onDemand ?? []
  const ranked = onDemand.filter((x) => x.rank != null).length
  const moveOnDemand = (id: string, to: 'on' | 'off' | 'first') => {
    patch((x) => ({ ...x, onDemand: reorder(x.onDemand ?? [], id, to) }))
    void call('POST', '/api/factory/on-demand', to === 'first' ? { id, first: true } : { id, off: to === 'off' }).then(load, load)
  }
  const has = new Set(intel.map((x) => x.id))
  const addable = [
    ...(snap.relay?.accounts ? [{ id: 'account', name: 'Another Claude account', brand: 'claude' as Brand }] : []),
    ...(!has.has('codex') ? [{ id: 'codex', name: 'Codex', brand: 'openai' as Brand }] : []),
    ...KEYS.filter((k) => !has.has(`key:${k.name}`)).map((k) => ({ id: `key:${k.name}`, name: k.label, brand: k.brand })),
  ]
  const add = (id: string) => {
    toBoss()
    if (id.startsWith('key:')) { focusBoss({ flash: false }); openKey(id.slice(4)) }
    else askSetup(id === 'account' ? 'account' : 'codex')
  }
  useFlips(snap)
  const rows = factoryProjects(snap)
  // Already there: every row, and every project weevils knows (its own block at the top included).
  const known = new Set([...rows, ...snap.projects].flatMap((r) => [r.id, ...r.repos]))
  // What can be added: one band per product (its mother repo, server/projects.ts motherRepos), never one per folder.
  const others: Row[] = (mothers ?? []).filter((m) => !known.has(m.id) && !m.repos.some((r) => known.has(r))).map((m) => ({ id: m.id, name: m.name, repos: m.repos, project: null }))
  const showProject = (r: Row, on: boolean) => {
    flipProject(r.id, on)
    void call('POST', '/api/factory/project', { id: r.id, repos: r.repos, shown: on }).catch(() => flipProject(r.id, null))
  }

  // The staircase: every band one small step from the one above it, counting only what is unfolded (as Autonomous).
  let s = 0
  const step = (shown = true) => (shown ? (s += 0.5) : s)
  return (
    <section className="nx-project nx-factory band" style={{ '--c': 'var(--calm)' } as CSSProperties}>
      <div className="nx-project-line">
        <button className="nx-row nx-project-head nx-repo-row" onClick={fold} aria-expanded={open}>
          {/* Its icon in the weevils logo's column, its name under the « w », like every band of the side bar. */}
          <span className="nx-repo-mark" aria-hidden><Icon name="factory" /></span>
          <span className="nx-row-title nx-project-name">your factory</span>
        </button>
      </div>
      <Collapse open={open}>
        <LevelHead step={step()} name="Machines" mark="gpu" open={mOpen} onFold={mFold} />
        <Collapse open={mOpen}>
          {machines.map((m) => (
            <MachineBand key={m.id} m={m} step={step(mOpen)} busy={busyOn(m.id)}
              onOpen={() => page({ kind: 'machine', projectId: '', machine: m.id })}
              onPatch={(p) => patch((x) => ({ ...x, machines: x.machines.map((y) => (y.id === m.id ? { ...y, ...p } : y)) }))} />
          ))}
          {v?.share && <ShareBand share={v.share} step={step(mOpen)} onPatch={(on) => patch((x) => ({ ...x, share: x.share && { ...x.share, on } }))} />}
          {/* On demand: compute paid by the hour, one band per provider under its own fold, in the fallback order. */}
          {onDemand.length > 0 && (
            <>
              <Band step={step(mOpen)} depth={2}>
                <button className="nx-fx-main" onClick={oFold} aria-expanded={oOpen}>
                  <span className="nx-mark"><Icon name="clock" /></span>
                  <span className="nx-row-title">on demand</span>
                </button>
              </Band>
              <Collapse open={oOpen}>
                {onDemand.map((p) => (
                  <OnDemandBand key={p.id} p={p} step={step(mOpen && oOpen)} ranked={ranked}
                    onKey={() => { toBoss(); focusBoss({ flash: false }); openKey(p.key) }}
                    onTurn={(on) => moveOnDemand(p.id, on ? 'on' : 'off')} onFirst={() => moveOnDemand(p.id, 'first')} />
                ))}
              </Collapse>
            </>
          )}
          <PlusBand step={step(mOpen)} label="Add a machine" onClick={() => { toBoss(); askSetup('machine') }} />
        </Collapse>
        <LevelHead step={step()} name="Intelligence" mark="brain" open={iOpen} onFold={iFold} />
        <Collapse open={iOpen}>
          {intel.map((x) => (
            <IntelBand key={x.id} x={x} step={step(iOpen)} onOpen={x.kind === 'subscription' ? () => page({ kind: 'usage' }) : undefined}
              onPatch={(p) => patch((y) => ({ ...y, intelligence: y.intelligence.map((z) => (z.id === x.id ? { ...z, ...p } : z)) }))} />
          ))}
          {addable.length > 0 && <PlusBand step={step(iOpen)} label="Add intelligence" open={adding} onClick={() => setAdding((a) => !a)} />}
          <Collapse open={adding}>
            {addable.map((a) => (
              <Band key={a.id} step={step(iOpen && adding)} depth={3}>
                <button className="nx-fx-main" onClick={() => add(a.id)}>
                  <span className="nx-mark nx-fx-logo"><Logo brand={a.brand} /></span>
                  <span className="nx-row-title">{a.name}</span>
                </button>
              </Band>
            ))}
          </Collapse>
        </Collapse>
        <LevelHead step={step()} name="Projects" mark="github" open={pOpen} onFold={pFold} />
        <Collapse open={pOpen}>
          {rows.map((r) => projectBand(r, step(pOpen), 2))}
          <PlusBand step={step(pOpen)} label="Add a project" open={more} onClick={() => setMore((m) => !m)} />
          <Collapse open={more}>
            {others.map((r) => projectBand(r, step(pOpen && more), 3))}
          </Collapse>
        </Collapse>
        <TempoCells step={step()} />
      </Collapse>
    </section>
  )

  /** A project's band: its repo colour and mark, a tap to its page, its switch for the side bar. */
  function projectBand(r: Row, at: number, depth: number) {
    const on = flipped.get(r.id) ?? (r.project ? inSideBar(snap, r.project) : snap.pinnedRepos.includes(r.id) && !snap.hiddenProjects?.includes(r.id))
    const openPage = () => page({ kind: 'project', projectId: r.id })
    return (
      <Band key={r.id} step={at} depth={depth} className={`nx-fx-project ${on ? '' : 'nx-fx-dim'}`} style={{ '--c': `var(--${colors[r.id] ?? slotOf(r.id)})` } as CSSProperties}>
        <button className="nx-fx-main" onClick={openPage}>
          <span className="nx-mark"><Icon name="repo" /></span>
          <span className="nx-row-title">{r.name}</span>
        </button>
        {/* A small switch, then the side bar's own « / » (its files) and « > » (its page), in the same places. */}
        <Switch small on={on} label={`${r.name} in the side bar`} onChange={(v2) => showProject(r, v2)} />
        <div className="chars">
          <button className="ch" aria-label={`Files of ${r.name}`} onClick={() => page({ kind: 'files', projectId: r.id, ...(r.project ? {} : { repo: r.repos[0] ?? r.id }) })}>
            <Icon name="slash" />
          </button>
          <button className="ch" aria-label={`Open ${r.name}`} onClick={openPage}>
            <G c=">" />
          </button>
        </div>
      </Band>
    )
  }
}

// ---------------------------------------------------------------- a machine's page

/** Its health in plain figures, and for a server, its host's own dashboard: at the top of its conversation. */
function MachineStrip({ m }: { m: FactoryMachine | undefined }) {
  if (!m) return null
  const figs = [m.cpu != null && `CPU ${m.cpu}%`, m.mem != null && `Memory ${m.mem}%`, m.disk != null && `Disk ${m.disk}%`].filter(Boolean).join(' · ')
  return (
    <div className="nx-mx-strip">
      {m.load != null && m.online ? <Bar pct={m.load} level={m.level} /> : null}
      <span className="nx-mx-figs">{!m.online ? 'Offline' : m.off ? `Off${figs ? ` · ${figs}` : ''}` : figs}</span>
      {m.panel && (
        <a className="living nx-mx-panel" href={m.panel} target="_blank" rel="noreferrer">
          {m.provider ?? 'Host'} <Icon name="external" />
        </a>
      )}
    </div>
  )
}

/** A machine's own conversation (Your factory, a machine's band): its health and its host's link on top. Before the
 *  first message, the page is the field to write it in; then it is the app's own session page. */
export function NextMachinePage({ id }: { id: string }) {
  const { snap } = useApp()
  const [v] = useFactory(true)
  const m = v?.machines.find((x) => x.id === id)
  const name = m?.name ?? snap.machines.find((x) => x.id === id)?.name ?? id
  const [started, setStarted] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const talk = started ?? m?.talk ?? null
  const session = talk && snap.sessions.some((s) => s.id === talk) ? talk : null
  const box = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => setHead(box.current?.querySelector<HTMLElement>('.page-head') ?? null), [session])
  if (session) {
    return (
      <div ref={box} className="nx-machine">
        <PageView page={{ kind: 'session', id: session }} />
        {head && createPortal(<MachineStrip m={m} />, head)}
      </div>
    )
  }
  const send = async (text: string) => {
    setErr(null)
    try {
      const r = await call<{ id: string }>('POST', '/api/factory/talk', { machine: id, text })
      seedPending(r.id, text)
      setStarted(r.id)
    } catch (e) {
      setErr((e as Error).message)
      throw e
    }
  }
  return (
    <div ref={box} className="nx-machine">
      <Shell slot="calm" kicker="your factory" title={name}
        foot={talk ? undefined : <Composer placeholder={`Talk to ${name}…`} label={`Message to ${name}`} onSend={send} sayErrors />}>
        <MachineStrip m={m} />
        {err && <p className="in meta" role="alert">{err}</p>}
        {talk && <p className="nx-empty"><span className="spin fluo"><Icon name="star" /></span></p>}
      </Shell>
    </div>
  )
}
