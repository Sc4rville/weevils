// Your factory, in weevils next's side bar (docs/next-interaction.md, « Your factory »): one band under Autonomous that
// unfolds, like every band of the side bar, into Machines, Intelligence, Projects and the global Tempo. Each level
// unfolds again into one band per thing, the same height, the same staircase (one small tone step per band), no line,
// no box. What it shows is weevils' own: GET /api/factory (server/your-factory.ts), the snapshot, Tempo's own view.
// Reused from the app: Collapse, Icon, ToolIcon (the providers' monochrome logos), Composer, PageView, Shell, the
// setup flows (askSetup, openKey: a key is only ever typed in the masked field), Tempo (useTempo, TempoBand).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Project, Snapshot } from '../../shared/api.ts'
import { KEYS, type Brand, type FactoryIntel, type FactoryMachine, type FactoryView } from '../../shared/your-factory.ts'
import { TEMPO_MODES, type TempoMode } from '../../shared/tempo.ts'
import { useT } from '../../src/i18n/index.ts'
import TM from '../../src/i18n/tempo.ts'
import { useApp, type Page } from '../../src/ui/app-context.tsx'
import { selfProject } from '../../src/ui/recursive-identity.ts'
import { Collapse, Composer, ToolIcon } from '../../src/ui/bits.tsx'
import { focusBoss } from '../../src/ui/follow.ts'
import { Icon } from '../../src/ui/icons.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { seedPending } from '../../src/ui/pending.ts'
import { askSetup, openKey } from '../../src/ui/setup.tsx'
import { Shell } from '../../src/ui/shell.tsx'
import { TEMPO_ICONS } from '../../src/ui/tempo-icons.ts'
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
  const gone = (snap.hiddenProjects ?? []).filter((id) => !snap.projects.some((p) => p.id === id || p.repos.includes(id)))
  return [
    ...projects.map((p): Row => ({ id: p.id, name: p.name, repos: p.repos, project: p })),
    ...gone.map((id): Row => ({ id, name: id, repos: [id], project: null })),
  ].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- small parts

/** The switch: a plain rectangle and its square knob, in the band's own ink. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`nx-switch ${on ? 'on' : ''}`}
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

/** A level's own band (Machines, Intelligence, Projects): its name folds what is under it. */
function LevelHead({ step, name, open, onFold, sign }: { step: number; name: string; open: boolean; onFold: () => void; sign?: ReactNode }) {
  return (
    <Band step={step} depth={1}>
      <button className="nx-fx-main" onClick={onFold} aria-expanded={open}>
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

/** The global Tempo: six cells, Standby to Swarm, filled up to the mode in use; a finger dragged across them moves
 *  it (no tap: a tap changes nothing). Past the left edge: Pause. Locked modes stay out of reach and say what opens
 *  them while the finger is on them. Every mode but Pause keeps taking requests (docs/product/tempo.md). */
function TempoCells({ step }: { step: number }) {
  const t = useT(TM)
  const [v, set] = useTempo()
  const [drag, setDrag] = useState<TempoMode | null>(null)
  const [locked, setLocked] = useState<TempoMode | null>(null)
  const [band, setBand] = useState<TempoMode | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  // The finger on the cells is theirs alone: caught on the cells themselves, before the side bar's own swipe (which
  // closes it) can see it — React's handlers run only after the side bar's.
  const onDown = useRef<(e: PointerEvent) => void>(() => undefined)
  useEffect(() => {
    const el = track.current
    if (!el) return
    const h = (e: PointerEvent) => { e.stopPropagation(); onDown.current(e) }
    el.addEventListener('pointerdown', h)
    return () => el.removeEventListener('pointerdown', h)
  }, [!!v])
  if (!v) return null
  const cells = TEMPO_MODES.slice(1)
  const open = (m: TempoMode) => v.modes.find((x) => x.id === m)?.unlocked ?? false
  const chosen = drag ?? v.global
  const lit = cells.indexOf(chosen)
  const at = (x: number): { mode: TempoMode; wanted: TempoMode } => {
    const r = track.current!.getBoundingClientRect()
    const pos = ((x - r.left) / r.width) * cells.length
    if (pos < 0.28) return { mode: 'pause', wanted: 'pause' }
    let i = Math.max(0, Math.min(cells.length - 1, Math.floor(pos)))
    const wanted = cells[i]
    while (i > 0 && !open(cells[i])) i--
    return { mode: cells[i], wanted }
  }
  onDown.current = (e: PointerEvent) => {
    const x0 = e.clientX
    let moved = false
    let last: TempoMode | null = null
    const el = track.current!
    el.setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 6) return
      moved = true
      const { mode, wanted } = at(ev.clientX)
      if (mode !== last) navigator.vibrate?.(4)
      last = mode
      setDrag(mode)
      setLocked(wanted !== mode && !open(wanted) ? wanted : null)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setDrag(null)
      setLocked(null)
      if (!moved || !last || last === v.global) return
      const m = last
      void set(m, null).then(() => {
        setBand(m)
        if (timer.current) clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setBand(null), 5200)
      }).catch(() => undefined)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const lockedView = locked ? v.modes.find((x) => x.id === locked) : undefined
  const u = lockedView?.unlock
  const opens = u ? [u.subscriptions ? t.subs(u.subscriptions) : '', u.cores ? t.vps(u.cores, u.ramGb ?? 0) : '', u.hostPlan ? t.hostPlan(u.hostPlan, u.hostPrice) : ''].filter(Boolean).join(' · ') : ''
  return (
    <>
      <Band step={step} depth={1} className="nx-fx-tempo">
        <span className="nx-fx-tempo-name">
          <span className="nx-row-title nx-fx-level">{t.title}</span>
          <span className="nx-fx-mode">{t.name(locked ?? chosen)}</span>
        </span>
        <div ref={track} className={`nx-fx-cells ${drag ? 'dragging' : ''}`} role="slider" aria-label={t.globalAria(t.name(chosen))}
          aria-valuemin={0} aria-valuemax={cells.length} aria-valuenow={lit + 1} aria-valuetext={t.name(chosen)} tabIndex={0}
          onKeyDown={(e) => {
            const i = TEMPO_MODES.indexOf(v.global) + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
            const m = TEMPO_MODES[i]
            if (m && m !== v.global && (m === 'pause' || open(m))) void set(m, null)
          }}>
          {cells.map((m, i) => (
            <span key={m} className={['nx-fx-cell', i <= lit && 'on', i === lit && 'at', !open(m) && 'locked'].filter(Boolean).join(' ')} style={{ '--i': i } as CSSProperties}>
              <Icon name={TEMPO_ICONS[m]} />
            </span>
          ))}
        </div>
        {locked && opens && <span className="nx-fx-hint">{t.opensWith} {opens}</span>}
      </Band>
      <TempoBand v={v} mode={band} repo={null} onOpen={() => setBand(null)} />
    </>
  )
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
  const [adding, setAdding] = useState(false)
  const [more, setMore] = useState(false)
  const [v, patch] = useFactory(open)
  const [repos, setRepos] = useState<string[] | null>(null)
  const here = snap.machines[0]?.id
  useEffect(() => {
    if (!more || !here) return
    void call<{ repos: string[] }>('GET', `/api/repos?machine=${encodeURIComponent(here)}`).then((r) => setRepos(r.repos), () => setRepos([]))
  }, [more, here])

  const busyOn = (id: string) => snap.sessions.filter((s) => !s.archived && s.status === 'working' && (s.machineId ?? here) === id).length
  const machines = v?.machines ?? snap.machines.map((m): FactoryMachine => ({ id: m.id, name: m.name, kind: null, online: m.online !== false, off: !!m.off, here: m.id === here, load: null, level: 'ok' }))
  const intel = v?.intelligence ?? []
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
  const known = new Set(rows.flatMap((r) => [r.id, ...r.repos]))
  const others: Row[] = (repos ?? []).filter((r) => !known.has(r)).map((r) => ({ id: r, name: r, repos: [r], project: null }))
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
          <span className="nx-row-title nx-project-name">Your factory</span>
        </button>
      </div>
      <Collapse open={open}>
        <LevelHead step={step()} name="Machines" open={mOpen} onFold={mFold} />
        <Collapse open={mOpen}>
          {machines.map((m) => (
            <MachineBand key={m.id} m={m} step={step(mOpen)} busy={busyOn(m.id)}
              onOpen={() => page({ kind: 'machine', projectId: '', machine: m.id })}
              onPatch={(p) => patch((x) => ({ ...x, machines: x.machines.map((y) => (y.id === m.id ? { ...y, ...p } : y)) }))} />
          ))}
          <PlusBand step={step(mOpen)} label="Add a machine" onClick={() => { toBoss(); askSetup('machine') }} />
        </Collapse>
        <LevelHead step={step()} name="Intelligence" open={iOpen} onFold={iFold} />
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
        <LevelHead step={step()} name="Projects" open={pOpen} onFold={pFold} />
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
    return (
      <Band key={r.id} step={at} depth={depth} className={`nx-fx-project ${on ? '' : 'nx-fx-dim'}`} style={{ '--c': `var(--${colors[r.id] ?? slotOf(r.id)})` } as CSSProperties}>
        <button className="nx-fx-main" onClick={r.project ? () => page({ kind: 'project', projectId: r.id }) : undefined} disabled={!r.project}>
          <span className="nx-mark"><Icon name="repo" /></span>
          <span className="nx-row-title">{r.name}</span>
        </button>
        <Switch on={on} label={`${r.name} in the side bar`} onChange={(v2) => showProject(r, v2)} />
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
      <Shell slot="calm" kicker="Your factory" title={name}
        foot={talk ? undefined : <Composer placeholder={`Talk to ${name}…`} label={`Message to ${name}`} onSend={send} sayErrors />}>
        <MachineStrip m={m} />
        {err && <p className="in meta" role="alert">{err}</p>}
        {talk && <p className="nx-empty"><span className="spin fluo"><Icon name="star" /></span></p>}
      </Shell>
    </div>
  )
}
