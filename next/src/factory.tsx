// Your factory, in weevils next's side bar (docs/next-interaction.md, « Your factory »): one band under Autonomous that
// unfolds, like every band of the side bar, into Machines, Intelligence, Projects and the global Tempo. Each level
// unfolds again into one band per thing, the same height, the same staircase (one small tone step per band), no line,
// no box. What it shows is weevils' own: GET /api/factory (server/your-factory.ts), the snapshot, Tempo's own view.
// Reused from the app: Collapse, Icon, ToolIcon (the providers' monochrome logos), Composer, PageView, Shell, the
// setup flows (askSetup, openKey: a key found on the machine or signed in by a link is never typed; else the masked field), Tempo (useTempo, TempoBand).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AgentsChoice, Project, Session, Snapshot } from '../../shared/api.ts'
import { DRAWERS, drawerShown, type Drawer } from '../../shared/drawers.ts'
import { KEYS, type Brand, type FactoryIntel, type FactoryMachine, type FactoryOnDemand, type FactoryView } from '../../shared/your-factory.ts'
import { TEMPO_MODES, type TempoMode } from '../../shared/tempo.ts'
import { useT } from '../../src/i18n/index.ts'
import TM from '../../src/i18n/tempo.ts'
import AM from '../../src/i18n/agents.ts'
import { useApp, type Page } from '../../src/ui/app-context.tsx'
import { selfProject } from '../../src/ui/recursive-identity.ts'
import { Collapse, Composer, ToolIcon } from '../../src/ui/bits.tsx'
import { focusBoss } from '../../src/ui/follow.ts'
import { G, Icon, Mark, type IconName, type MarkName } from '../../src/ui/icons.tsx'
import { PageView } from '../../src/ui/pages.tsx'
import { seedPending } from '../../src/ui/pending.ts'
import { askSetup, openKey } from '../../src/ui/setup.tsx'
import { Shell } from '../../src/ui/shell.tsx'
import { AwayLine } from '../../src/ui/away.tsx'
import { AppLink } from '../../src/ui/living-link.tsx'
import { TempoBand, useTempo } from '../../src/ui/tempo.tsx'
import { call } from './data.ts'
import { foldPrefs, saveFold } from './fold.ts'
import { PAGES_SLOT } from './pages.tsx'

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

/** A repo with no project yet, or a loose conversation, keeps a colour of its own, the same every time (the app's 16
 *  slots). */
export const slotOf = (id: string) => `p${[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 16}`

/** Reserved project ids (server/projects.ts): automations' own folder, and the loose conversations' (« side quests »). */
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

/** A repo is in the side bar only while it is pinned (2026-11-26: a repo not pinned leaves it, whatever its
 *  conversations do; it stays in Your factory's Projects, one switch away). weevils itself is always there, never
 *  pinned. One rule, used by the side bar and by its switch here. */
export function inSideBar(snap: Snapshot, p: Project): boolean {
  if (selfProject(p)) return true
  if (snap.hiddenProjects?.includes(p.id)) return false
  return p.repos.some((r) => snap.pinnedRepos.includes(r)) || snap.pinnedRepos.includes(p.id)
}

/** A project carries its pin in the side bar: one of its repos (or itself) pinned, and not switched off. */
export function pinnedProject(snap: Snapshot, p: Project): boolean {
  if (snap.hiddenProjects?.includes(p.id) || flipped.get(p.id) === false) return false
  return flipped.get(p.id) === true || p.repos.some((r) => snap.pinnedRepos.includes(r)) || snap.pinnedRepos.includes(p.id)
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
/** A repo pinned in the side bar or taken out of it, shown at once (the side bar's pin, Your factory's switch). */
export function showProject(r: { id: string; repos: string[] }, on: boolean) {
  flipProject(r.id, on)
  void call('POST', '/api/factory/project', { id: r.id, repos: r.repos, shown: on }).catch(() => flipProject(r.id, null))
}
/** A drawer (autonomous, pages) pinned or taken out, shown at once. */
export function showDrawer(id: Drawer, on: boolean) {
  flipProject(`drawer:${id}`, on)
  void call('POST', '/api/factory/drawer', { id, shown: on }).catch(() => flipProject(`drawer:${id}`, null))
}

/** A drawer's choice now: a switch just flipped, else the one kept (true pinned, false out, undefined its own rule). */
export function drawerChoice(snap: Snapshot, id: Drawer): boolean | undefined {
  return flipped.get(`drawer:${id}`) ?? snap.sideDrawers?.[id]
}
/** What the drawers hold now (shared/drawers.ts DrawerFacts). */
export function drawerFacts(snap: Snapshot) {
  return { autonomous: (snap.optimizers ?? []).some((o) => o.state !== 'proposed' && o.state !== 'refused') }
}
/** The conversations started with no repo (the reserved « divers » id, never shown as such): each its own band in the
 *  side bar while pinned. A page's conversation (pages band) or a machine's (its page) is not one of them. */
export function looseSessions(snap: Snapshot): Session[] {
  const pages = new Set((snap.pageBand ?? []).flatMap((p) => (p.session ? [p.session] : [])))
  return snap.sessions.filter((s) => s.projectId === 'divers' && !s.archived && !pages.has(s.id))
}
/** How long a conversation started with no repo stays in the side bar's strip after it was last touched: then it is
 *  only in Your factory's Sessions. */
export const LOOSE_FRESH = 24 * 3600_000
/** A test run (a temporary folder) or an automation's run: never the person's own conversation. */
const THROWAWAY = /^(\/tmp|\/var\/tmp|\/private\/tmp|\/var\/folders|\/private\/var\/folders)(\/|$)/
/** The side bar's strip of conversations started with no repo (2026-11-27): only those the person really started, with
 *  something in them, and recent or still open (working, or waiting for them). Never a band, never among the projects. */
export function looseShown(s: Session, now: number): boolean {
  if (THROWAWAY.test(s.cwd ?? '') || s.origin === 'automation-run' || s.messageCount < 2) return false
  return s.live || s.status === 'working' || s.status === 'needs_user' || now - s.lastActivityAt < LOOSE_FRESH
}
/** Whether a drawer is in the side bar now, and whether it wears its pin. */
export function drawerOn(snap: Snapshot, id: Drawer): boolean {
  return drawerShown(drawerChoice(snap, id), id, drawerFacts(snap))
}
export const drawerPinned = (snap: Snapshot, id: Drawer) => drawerChoice(snap, id) === true

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
    for (const [id, on] of flipped) {
      const agrees = id.startsWith('drawer:') ? snap.sideDrawers?.[id.slice(7)] === on
        : id.startsWith('session:') ? !!snap.pinnedSessions?.includes(id.slice(8)) === on
        : !!snap.hiddenProjects?.includes(id) === !on
      if (agrees) { flipped.delete(id); changed = true }
    }
    if (changed) flipEmit()
  }, [snap])
}

type Row = { id: string; name: string; repos: string[]; project: Project | null }
/** How many products Projects lists before « + ». */
const PRODUCTS_SHOWN = 12
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

/** A product as Your factory's Projects lists it: its mother (the repo named after it, else its first one), the other
 *  repos of the same product folded inside it (« shop-api », « shop-web » under « shop »), and when it was last active. */
export type ProductRow = Row & { parts: string[]; at: number; self: boolean }
const familyOf = (name: string) => (name.split(/[-_.]/)[0] || name).toLowerCase()
/** weevils' own storage on GitHub (the weevbook vault and its raw copies): never a project of the person's. */
export const storageRepo = (r: { name: string; description?: string }) => /^weevbook-/.test(r.name) || r.description === 'Encrypted copy kept by weevils'
/** One row per product, the most recently active first: what weevils knows (projects, those switched off) and the
 *  person's GitHub repos, grouped by their product name, never weevils' own storage. */
export function productGroups(snap: Snapshot, rows: Row[], github: { name: string; pushedAt: number; description?: string }[]): ProductRow[] {
  const by = new Map<string, ProductRow>()
  const add = (fam: string, base: Omit<ProductRow, 'parts' | 'at' | 'self'> | null, repos: string[], at: number, self = false) => {
    const g = by.get(fam) ?? { id: fam, name: fam, repos: [], project: null, parts: [], at: 0, self: false }
    if (base) Object.assign(g, { id: base.id, name: base.name, project: base.project ?? g.project })
    for (const r of repos) if (!g.repos.includes(r) && !storageRepo({ name: r })) g.repos.push(r)
    g.at = Math.max(g.at, at)
    g.self ||= self
    by.set(fam, g)
  }
  const self = snap.projects.find((p) => selfProject(p))
  if (self) add(familyOf(self.repos[0] ?? self.id), { id: self.id, name: self.name, repos: [], project: self }, self.repos, self.lastActivityAt ?? 0, true)
  for (const r of rows) add(familyOf(r.id), r, r.repos, r.project?.lastActivityAt ?? 0)
  for (const g of github) if (!storageRepo(g)) add(familyOf(g.name), null, [g.name], g.pushedAt)
  return [...by.values()].filter((g) => g.repos.length || g.project).map((g) => {
    // The mother first (the repo named after the product), so a switch pins it; the others are its parts.
    const mother = g.repos.find((r) => r.toLowerCase() === familyOf(r) && familyOf(r) === g.id) ?? g.repos[0]
    const repos = mother ? [mother, ...g.repos.filter((r) => r !== mother)] : g.repos
    const pre = new RegExp(`^${g.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[-_.]`, 'i')
    // A product of one repo reads as that repo (« cash-tempo », « site.com »), never cut into a name and a part.
    if (repos.length === 1 && !g.project) return { ...g, repos, name: repos[0], parts: [] }
    return { ...g, repos, parts: repos.filter((r) => r.toLowerCase() !== g.id.toLowerCase()).map((r) => r.replace(pre, '')) }
  }).sort((a, b) => b.at - a.at || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------- small parts

/** The switch: a plain rectangle and its square knob, in the band's own ink. */
export function Switch({ on, label, onChange, small = false }: { on: boolean; label: string; onChange: (on: boolean) => void; small?: boolean }) {
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

/** A factory machine with the snapshot's live state: online, and why not. */
function liveMachine(m: FactoryMachine, live: Snapshot['machines']): FactoryMachine {
  const l = live.find((x) => x.id === m.id)
  if (!l) return m
  const { away: _gone, ...rest } = m
  return { ...rest, online: l.online !== false, ...(l.online === false && l.away ? { away: l.away } : {}), ...(l.claude ? { claude: l.claude } : {}) }
}

/** Just switched: « connecting… » until it is online (or « switching off… » until it is not), 30 s at most. */
const switching = new Map<string, { on: boolean; at: number }>()
const isSwitching = (m: FactoryMachine) => {
  const s = switching.get(m.id)
  if (!s || Date.now() - s.at > 30_000 || s.on === m.online) return null
  return s.on ? 'connecting' : 'disconnecting'
}

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
    if (!m.here) switching.set(m.id, { on, at: Date.now() })
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
              {!m.here && <MachineState m={m} />}
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

/** Another machine's state in a word, on its band: connected, connecting…, installing…, off, offline. */
function MachineState({ m }: { m: FactoryMachine }) {
  const sw = isSwitching(m)
  const word = sw === 'connecting' ? 'connecting…' : sw === 'disconnecting' ? 'switching off…' : m.online ? 'connected' : m.off ? 'off' : m.away?.why === 'joining' ? 'installing…' : 'offline'
  return <span className={`nx-fx-state ${m.online && !sw ? 'on' : ''}`}>{word}</span>
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

/** How agents work on every machine: on their own (the default) or asking first. Two words, the one in use underlined;
 *  one line under it only while they ask (or when root locks it to asking: why). Applied to their next turns. */
export function AgentsBand({ agents, step }: { agents: AgentsChoice; step: number }) {
  const t = useT(AM)
  const [picked, setPicked] = useState<boolean | null>(null)
  // The snapshot says it now: the tap's own state is forgotten.
  useEffect(() => { if (picked === agents.ask) setPicked(null) }, [agents.ask, picked])
  const ask = picked ?? agents.ask
  const locked = agents.locked === 'root'
  const pick = (v: boolean) => {
    if (locked || v === ask) return
    navigator.vibrate?.(6)
    setPicked(v)
    void call('POST', '/api/factory/agents', { ask: v }).catch(() => setPicked(null))
  }
  const word = (v: boolean) => (
    <button type="button" role="radio" aria-checked={ask === v} aria-label={v ? t.askAria : t.autoAria} disabled={locked}
      className={`nx-fx-word ${ask === v ? 'strong' : ''}`} onClick={(e) => { e.stopPropagation(); pick(v) }}>{v ? t.ask : t.auto}</button>
  )
  return (
    <Band step={step} depth={2} className="nx-fx-agents">
      <span className="nx-fx-main">
        <span className="nx-mark"><Icon name="agents" /></span>
        <span className="nx-row-title">{t.title}</span>
      </span>
      <div className="nx-fx-choice" role="radiogroup" aria-label={t.title}>{word(false)}{word(true)}</div>
      {(locked || ask) && <span className="nx-fx-hint">{locked ? t.rootLine : t.askLine}</span>}
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

// ---------------------------------------------------------------- sessions

const SESSIONS_PAGE = 40
const DRAWER_ICON: Record<Drawer, IconName> = { autonomous: 'cycle', pages: 'page' }
const STATE_ICON: Partial<Record<Session['status'], IconName>> = { needs_user: 'waits', interrupted: 'pause', done: 'check' }
const STATE_WORD: Partial<Record<Session['status'], string>> = { working: 'working', needs_user: 'needs you', interrupted: 'paused', done: 'done', idle: 'idle' }

/** Every session, the most recent first, each with its place in its run: how many bands of the same repo come
 *  right before it (0 for the first of a run), the tone step of its band. */
export function sessionRuns(list: Session[]): { s: Session; run: number }[] {
  const sorted = [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  let run = 0
  return sorted.map((s, i) => {
    run = i > 0 && sorted[i - 1].projectId === s.projectId ? run + 1 : 0
    return { s, run }
  })
}

/** A band's tone step in its run: up three steps, then back down, and again, so every band of a long run still
 *  differs from the one above it. */
export const runTone = (run: number) => { const t = run % 6; return t <= 3 ? t : 6 - t }

// ---------------------------------------------------------------- the band

export function FactorySection({ snap, colors, page, toBoss, openSession }: {
  snap: Snapshot
  colors: Record<string, string>
  page: (p: Page) => void
  /** Opens a session's conversation (its band in Sessions). */
  openSession: (id: string) => void
  /** Closes the side bar onto weevboss's screen (for a « + » that weevboss takes over). */
  toBoss: () => void
}) {
  const [open, fold] = useFold('__factory')
  const [mOpen, mFold] = useFold('__factory_machines')
  const [iOpen, iFold] = useFold('__factory_intel')
  const [pOpen, pFold] = useFold('__factory_projects')
  const [oOpen, oFold] = useFold('__factory_ondemand')
  const [sOpen, sFold] = useFold('__factory_sessions')
  const [sessionsShown, setSessionsShown] = useState(SESSIONS_PAGE)
  const [adding, setAdding] = useState(false)
  const [more, setMore] = useState(false)
  const [v, patch] = useFactory(open)
  const [mothers, setMothers] = useState<Mother[] | null>(null)
  const here = snap.machines[0]?.id
  // The person's GitHub repos, the most recently pushed first: their real projects, listed even before a session ran
  // in them (never weevils' own storage).
  const [github, setGithub] = useState<{ name: string; pushedAt: number; description?: string }[] | null>(null)
  useEffect(() => {
    if (!pOpen) return
    void call<{ repos: { name: string; pushedAt: number; description?: string }[] }>('GET', '/api/github/repos').then((r) => setGithub(r.repos), () => setGithub([]))
  }, [pOpen])
  useEffect(() => {
    if (!more || !here) return
    void call<{ repos: string[]; mothers?: Mother[] }>('GET', `/api/repos?machine=${encodeURIComponent(here)}`).then((r) => setMothers(r.mothers ?? mothersOf(r.repos)), () => setMothers([]))
  }, [more, here])

  const busyOn = (id: string) => snap.sessions.filter((s) => !s.archived && s.status === 'working' && (s.machineId ?? here) === id).length
  // Online and why not come from the live snapshot (pushed as they change): a machine switched on shows « connected »
  // within seconds, not at the factory's next read.
  const machines = (v?.machines ?? snap.machines.map((m): FactoryMachine => ({ id: m.id, name: m.name, kind: null, online: m.online !== false, off: !!m.off, here: m.id === here, load: null, level: 'ok' })))
    .map((m) => liveMachine(m, snap.machines))
  // Machines plugged in since the factory was read: listed at once.
  for (const m of snap.machines) if (!machines.some((x) => x.id === m.id)) machines.push(liveMachine({ id: m.id, name: m.name, kind: null, online: false, off: !!m.off, here: false, load: null, level: 'ok' }, snap.machines))
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
    if (id.startsWith('key:')) { focusBoss({ flash: false }); void openKey(id.slice(4)) }
    else askSetup(id === 'account' ? 'account' : 'codex')
  }
  useFlips(snap)
  const rows = factoryProjects(snap)
  // Already there: every row, and every project weevils knows (its own block at the top included).
  const known = new Set([...rows, ...snap.projects].flatMap((r) => [r.id, ...r.repos]))
  // One row per product, the most recently active first: what weevils knows and the person's GitHub repos, each
  // product's other repos folded inside it. The first ones listed, the rest behind « + » with this machine's folders.
  const groups = productGroups(snap, rows, github ?? [])
  for (const g of groups) for (const r of g.repos) known.add(r)
  const others: ProductRow[] = [...groups.slice(PRODUCTS_SHOWN), ...(mothers ?? []).filter((m) => !known.has(m.id) && !m.repos.some((r) => known.has(r)) && !storageRepo({ name: m.id })).map((m) => ({ id: m.id, name: m.name, repos: m.repos, project: null, parts: m.repos.filter((r) => r !== m.id), at: 0, self: false }))]
  const sessions = sOpen ? sessionRuns(snap.sessions) : []

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
                    onKey={() => { toBoss(); focusBoss({ flash: false }); void openKey(p.key) }}
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
          {snap.agents && <AgentsBand agents={snap.agents} step={step(iOpen)} />}
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
          {groups.slice(0, PRODUCTS_SHOWN).map((r) => projectBand(r, step(pOpen), 2))}
          <PlusBand step={step(pOpen)} label="Add a project" open={more} onClick={() => setMore((m) => !m)} />
          <Collapse open={more}>
            {others.map((r) => projectBand(r, step(pOpen && more), 3))}
          </Collapse>
          {/* The side bar's other drawers, each with the same switch: the person chooses all that is in it (2026-11-26). */}
          {DRAWERS.map((id) => drawerBand(id, step(pOpen)))}
        </Collapse>
        <LevelHead step={step()} name="Sessions" mark="chat" open={sOpen} onFold={sFold} />
        <Collapse open={sOpen}>
          {/* Every session, the most recent first, each in its repo's colour; a run of the same repo steps its tone,
              band after band (the Autonomous staircase), never a line between them. */}
          {sessions.slice(0, sessionsShown).map(({ s: x, run }) => (
            <Band key={x.id} step={0} depth={2} className="nx-fx-session" style={{ '--c': `var(--${x.projectId === 'divers' ? slotOf(x.id) : (colors[x.projectId] ?? slotOf(x.projectId))})`, '--run': runTone(run) } as CSSProperties}>
              <button className="nx-fx-main" onClick={() => openSession(x.id)}>
                <span className="nx-mark">{x.status === 'working' ? <span className="spin fluo"><Icon name="star" /></span> : <Icon name={STATE_ICON[x.status] ?? 'idle'} />}</span>
                <span className="nx-row-title">{x.title || 'Untitled'}</span>
                <span className="nx-fx-val">{STATE_WORD[x.status] ?? ''}</span>
              </button>
            </Band>
          ))}
          {sessions.length > sessionsShown && (
            <Band step={step(sOpen)} depth={2}>
              <button className="nx-fx-main" onClick={() => setSessionsShown((n) => n + SESSIONS_PAGE)}>
                <span className="nx-mark" />
                <span className="nx-row-title nx-fx-plan">{sessions.length - sessionsShown} more</span>
              </button>
            </Band>
          )}
        </Collapse>
        <TempoCells step={step()} />
      </Collapse>
    </section>
  )

  /** A drawer's band (autonomous, pages; never settings, always in the side bar): its side bar colour and icon, its switch: on pins it there. */
  function drawerBand(id: Drawer, at: number) {
    const on = drawerOn(snap, id)
    const c = id === 'autonomous' ? 'h24' : PAGES_SLOT
    return (
      <Band key={id} step={at} depth={2} className={`nx-fx-project ${on ? '' : 'nx-fx-dim'}`} style={{ '--c': `var(--${c})` } as CSSProperties}>
        <span className="nx-fx-main">
          <span className="nx-mark"><Icon name={DRAWER_ICON[id]} /></span>
          <span className="nx-row-title">{id}</span>
        </span>
        <Switch small on={on} label={`${id} in the side bar`} onChange={(v2) => showDrawer(id, v2)} />
        {/* The room of a project's « / » and « > », so every switch stands in one column. */}
        <div className="chars nx-fx-room" aria-hidden><span className="ch"><Icon name="slash" /></span><span className="ch"><G c=">" /></span></div>
      </Band>
    )
  }

  /** A product's row, compact: a small square of its colour, its name, its other repos after it in a quieter line, its
   *  switch for the side bar (weevils itself is always there: none), then « / » and « > ». */
  function projectBand(r: ProductRow, at: number, depth: number) {
    const on = r.self || (flipped.get(r.id) ?? (r.project ? inSideBar(snap, r.project) : r.repos.some((x) => snap.pinnedRepos.includes(x)) && !snap.hiddenProjects?.includes(r.id)))
    const openPage = () => page({ kind: 'project', projectId: r.id })
    return (
      <Band key={r.id} step={at} depth={depth} className={`nx-fx-project ${on ? '' : 'nx-fx-dim'}`} style={{ '--c': `var(--${colors[r.id] ?? slotOf(r.id)})` } as CSSProperties}>
        <button className="nx-fx-main" onClick={openPage}>
          <span className="nx-mark"><i className="nx-fx-swatch" /></span>
          <span className="nx-fx-product">
            <span className="nx-row-title">{r.name}</span>
            {r.parts.length > 0 && <span className="nx-fx-parts">{r.parts.join(' · ')}</span>}
          </span>
        </button>
        {r.self ? <span className="nx-fx-room-switch" aria-hidden /> : <Switch small on={on} label={`${r.name} in the side bar`} onChange={(v2) => showProject(r, v2)} />}
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
  // Never a bare « Offline »: off, connecting, or why and since when, with the line that brings it back (src/ui/away.tsx).
  if (!m.online && !m.here) {
    return (
      <div className="nx-mx-strip nx-mx-away">
        <AwayLine name={m.name} away={m.away} off={m.off} connecting={isSwitching(m) === 'connecting'}
          line={() => call<{ line: string }>('POST', '/api/factory/rejoin', { machine: m.id }).then((r) => r.line)} />
      </div>
    )
  }
  const figs = [m.cpu != null && `CPU ${m.cpu}%`, m.mem != null && `Memory ${m.mem}%`, m.disk != null && `Disk ${m.disk}%`].filter(Boolean).join(' · ')
  return (
    <div className="nx-mx-strip">
      {m.load != null && m.online ? <Bar pct={m.load} level={m.level} /> : null}
      <span className="nx-mx-figs">{!m.online ? 'Offline' : m.off ? `Off${figs ? ` · ${figs}` : ''}` : figs}</span>
      {/* Claude not signed in there: a link in the sentence, the sign-in goes on in weevboss's thread (server/machine-claude.ts). */}
      {m.online && !m.here && m.claude && !m.claude.logged && (
        <span className="nx-mx-figs">
          {m.claude.installed ? 'Claude isn’t signed in here: ' : 'Claude Code isn’t here yet: '}
          <AppLink href={`/#do=claude.${m.id}`} label={m.claude.installed ? 'sign it in' : 'install and sign it in'} />
        </span>
      )}
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
  const found = v?.machines.find((x) => x.id === id)
  const m = found && liveMachine(found, snap.machines)
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
        foot={talk || m?.online === false ? undefined : <Composer placeholder={`Talk to ${name}…`} label={`Message to ${name}`} onSend={send} sayErrors />}>
        <MachineStrip m={m} />
        {err && <p className="in meta" role="alert">{err}</p>}
        {talk && <p className="nx-empty"><span className="spin fluo"><Icon name="star" /></span></p>}
      </Shell>
    </div>
  )
}
