import { AnimatePresence, animate, motion, useDragControls, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Optimizer, Snapshot } from '../../shared/api.ts'
import { api } from '../api'
import { useApp } from './app-context'
import { Collapse, spring } from './bits'
import { Icon, type IconName } from './icons'
import { useT } from '../i18n'
import M from '../i18n/h24'
import B from '../i18n/bits'
import { tapHint } from './hints'
import { DRAWER_SLOT, STATES, autoTree, counts, openByDefault, propColors, short, tasksOf, type AutoCategory, type AutoGroup, type AutoTask, type TaskState } from './h24-tree'
import './h24.css'
import { flash, when } from './follow'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Bande « auto » collée en bas : on la tire vers le haut (ou on la touche) pour voir ce qui tourne tout seul. */
export function H24Rail() {
  const { snap, colors, h24Open: open, setH24Open: setOpen, h24Focus } = useApp()
  const t = useT(M)
  const opts = snap.optimizers ?? []
  const proposed = opts.filter((o) => o.state === 'proposed')
  const tree = autoTree(snap)
  const all = tree.flatMap(tasksOf)
  const c = counts(all)
  // La bande juste sous les propositions : la ligne machine (sur le fond du tiroir), sinon la première catégorie.
  const below = machineShown(snap) || !tree.length ? DRAWER_SLOT : catSlot(tree[0], colors)
  const y = useMotionValue(0)
  const drawer = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const dragged = useRef(false)
  const controls = useDragControls()
  const [closedY, setClosedY] = useState(0)

  const measure = useCallback(() => {
    const h = drawer.current?.offsetHeight ?? 0
    const visible = probe.current?.offsetHeight ?? 56
    setClosedY(Math.max(0, h - visible))
  }, [])

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  // Position initiale sans animation, puis ressort à chaque ouverture/fermeture.
  const first = useRef(true)
  useEffect(() => {
    const target = open ? 0 : closedY
    if (first.current) {
      y.set(target)
      first.current = false
      return
    }
    const ctrl = animate(y, target, spring)
    return () => ctrl.stop()
  }, [open, closedY, y])

  // Ouvert depuis une ligne 24/7 d'une bande projet : le tiroir monté, cette activité est amenée sous les yeux dans la
  // liste (seule la liste défile : le tiroir est fixe) et s'éclaire un instant. Sa catégorie et son groupe se déplient
  // d'office (useFold).
  useEffect(() => {
    if (!open || !h24Focus) return
    let off = false
    when(
      () => off || y.get() < 4,
      () => {
        const body = drawer.current?.querySelector<HTMLElement>('.h24-body')
        const row = body?.querySelector<HTMLElement>(`[data-h24="${CSS.escape(h24Focus)}"]`)
        if (off || !body || !row) return
        const r = row.getBoundingClientRect()
        const b = body.getBoundingClientRect()
        if (r.top < b.top || r.bottom > b.bottom) {
          const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
          body.scrollTo({ top: body.scrollTop + r.top - b.top - 8, behavior: smooth ? 'smooth' : 'auto' })
        }
        flash(row)
      },
      900,
    )
    return () => {
      off = true
    }
  }, [open, h24Focus, y])

  // En-tête : ce qui tourne, ce qui attend un oui, ce qui attend la machine ; sinon l'ancien résumé.
  const parts: [string, string][] = []
  if (c.running) parts.push(['run', t.runningN(c.running)])
  if (proposed.length) parts.push(['ask', t.toValidateN(proposed.length)])
  if (c.waiting + c.queued) parts.push(['wait', t.queuedN(c.waiting + c.queued)])
  const summary = parts.length ? parts.map((p) => p[1]).join(' · ') : all.length ? t.summary(0, all.length) : t.nothing

  return (
    <>
      {open && <div className="catcher" onClick={() => setOpen(false)} aria-hidden />}
      <motion.div
        ref={drawer}
        className="h24 band"
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: closedY }}
        dragElastic={{ top: 0.05, bottom: 0.2 }}
        dragMomentum={false}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, info) => {
          const current = y.get()
          const next = info.velocity.y < -300 ? true : info.velocity.y > 300 ? false : current < closedY / 2
          if (next === open) animate(y, next ? 0 : closedY, spring)
          setOpen(next)
        }}
        role="region"
        aria-label={t.region}
      >
        <div ref={probe} className="h24-probe" />
        <button
          className="h24-head"
          onPointerDown={(e) => {
            dragged.current = false
            controls.start(e)
          }}
          onClick={(e) => {
            if (dragged.current) {
              dragged.current = false
              return
            }
            if (!open && tapHint('h24', e.currentTarget)) return
            setOpen(!open)
          }}
          aria-expanded={open}
          aria-controls="h24-body"
          aria-label={t.head(summary, open)}
        >
          <span className="h24-grip" aria-hidden>
            <Icon name="grip" />
          </span>
          <span className="in" aria-hidden>
            <span className="h2">{t.title}</span>
            <span className="meta auto-sum">
              {c.running > 0 && (
                <span className="spin fluo">
                  <Icon name="star" />
                </span>
              )}
              {parts.length
                ? parts.map(([k, s], i) =>
                    k === 'run' ? (
                      <span key={k} className="strong tab">
                        {c.running}
                      </span>
                    ) : k === 'wait' ? (
                      <span key={k} className="auto-wait">
                        <Icon name="more" />
                        {c.waiting + c.queued}
                      </span>
                    ) : (
                      <span key={k} className="strong">{i > 0 ? `· ${s}` : s}</span>
                    ),
                  )
                : summary}
            </span>
            <span className="h2" style={{ fontWeight: 500 }}>
              <Icon name="arrow" dir={open ? 'down' : 'up'} />
            </span>
          </span>
        </button>

        <div id="h24-body" className="h24-body" inert={!open}>
          <Proposals list={proposed} below={below} />
          <MachineLine />
          {tree.map((cat) => (
            <Category key={cat.id} cat={cat} />
          ))}
          {all.length === 0 && proposed.length === 0 && <div className="in meta empty">{t.empty}</div>}
          <div style={{ height: 14 }} />
        </div>
      </motion.div>
    </>
  )
}

// ---------------------------------------------------------------------------
// En haut : les propositions, en colonnes collées, une couleur chacune. ✓ lance quand la machine est libre, × refuse.
// L'icône d'un genre n'est jamais ✓ ni × : elles se confondraient avec les boutons.

const KIND_ICON: Record<Optimizer['kind'], IconName> = { tests: 'terminal', watch: 'quote', content: 'file', explore: 'slash', other: 'star' }
/** Après un dépliage, ✓ et × attendent ce délai : le doigt qui vient de déplier ne lance ni ne refuse rien. */
export const SETTLE_MS = 450

/**
 * Une colonne touchée se déplie : elle prend presque toute la largeur, titre et raison en entier ; les autres
 * deviennent de fines bandes de couleur (les toucher les déplie à leur tour). Retouchée, elle se replie.
 */
function Proposals({ list, below }: { list: Optimizer[]; below: string }) {
  const t = useT(M)
  const { refresh } = useApp()
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [wide, setWide] = useState<string | null>(null)
  const movedAt = useRef(-Infinity)
  // Une couleur par proposition, gardée tant qu'elle est là : celle qui part n'en fait pas changer les autres.
  const slots = useRef(new Map<string, string>())
  const shown = list.filter((o) => !gone.has(o.id)).slice(0, 3)
  slots.current = propColors(shown.map((o) => o.id), slots.current, below)
  const open = shown.some((o) => o.id === wide) ? wide : null
  const expand = (id: string | null) => {
    movedAt.current = performance.now()
    setWide(id)
  }
  const answer = (o: Optimizer, yes: boolean) => {
    if (performance.now() - movedAt.current < SETTLE_MS) return
    setGone((g) => new Set(g).add(o.id))
    void (yes ? api.acceptOptimizer(o.id) : api.refuseOptimizer(o.id))
      .catch(() =>
        setGone((g) => {
          const n = new Set(g)
          n.delete(o.id)
          return n
        }),
      )
      .finally(refresh)
  }
  if (!shown.length) return null
  return (
    <div className="auto-props" role="list" aria-label={t.proposals}>
      <AnimatePresence initial={false}>
        {shown.map((o) => {
          const slim = open !== null && open !== o.id
          return (
            <motion.div
              key={o.id}
              role="listitem"
              className={`auto-prop${slim ? ' slim' : ''}${open === o.id ? ' open' : ''}`}
              style={color(slots.current.get(o.id) ?? 'p9')}
              initial={{ flexGrow: 0, minWidth: 0, opacity: 0 }}
              animate={{ flexGrow: slim ? 0 : 1, minWidth: 22, opacity: 1 }}
              exit={{ flexGrow: 0, minWidth: 0, opacity: 0 }}
              transition={spring}
            >
              <motion.div className="auto-prop-in" inert={slim} animate={{ opacity: slim ? 0 : 1 }} transition={spring}>
                <button className="auto-prop-body" onClick={() => expand(open === o.id ? null : o.id)} aria-expanded={open === o.id}>
                  <span className="k" aria-hidden>
                    <Icon name={KIND_ICON[o.kind]} />
                    <span>{t[`kind_${o.kind}`]}</span>
                  </span>
                  <span className="t">{o.title}</span>
                  {o.why && <span className="w">{o.why}</span>}
                  <span className="i" aria-hidden>
                    <Intensity priority={o.priority} est={o.est} heavy={o.heavy} />
                  </span>
                </button>
                <div className="acts">
                  <button className="ok" onClick={() => answer(o, true)} aria-label={t.accept(o.title)}>
                    <Icon name="check" />
                  </button>
                  <button className="no" onClick={() => answer(o, false)} aria-label={t.refuse(o.title)}>
                    <Icon name="close" />
                  </button>
                </div>
              </motion.div>
              {slim && <button className="auto-prop-strip" onClick={() => expand(o.id)} aria-expanded={false} aria-label={o.title} />}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// La machine : charge et mémoire libre, et ce qui retient une tâche acceptée.

const machineShown = (snap: Snapshot) => !!snap.autoMachine && (snap.optimizers ?? []).some((o) => o.state !== 'proposed')

function MachineLine() {
  const t = useT(M)
  const { snap } = useApp()
  const m = snap.autoMachine
  const held = (snap.optimizers ?? []).some((o) => o.state === 'queued')
  if (!m || !machineShown(snap)) return null
  const ratio = Math.min(1, m.load / (1.5 * m.cpus))
  return (
    <div className="in auto-machine" role="img" aria-label={t.load(m.load.toFixed(1), m.cpus, m.freeGb.toFixed(1))}>
      <Icon name="machine" />
      <span className="auto-gauge" aria-hidden>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} className={ratio >= 1 ? 'hot' : ''} />
      </span>
      <span className="strong tab" aria-hidden>
        {m.load.toFixed(1)}
        <span className="auto-dim">/{m.cpus}</span>
      </span>
      <span className="strong tab" aria-hidden>
        {t.gb(m.freeGb.toFixed(1))}
      </span>
      {held && m.wait && <span className="auto-tag st-waiting" aria-hidden>{t[`wait_${m.wait}`]}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// En dessous : catégorie (projet ou machine) → groupe (tâches, planifiés, jobs) → tâche. Un niveau qui n'aurait
// qu'un enfant s'efface.

const FOLDS = 'weevils-auto-folds'
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDS) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
function useFold(id: string, tasks: AutoTask[]): [boolean, () => void] {
  const { h24Focus } = useApp()
  const [pref, setPref] = useState<boolean | undefined>(() => readFolds()[id])
  // L'activité touchée dans une bande projet est toujours visible, même dans un niveau replié.
  const focused = !!h24Focus && tasks.some((x) => x.id === h24Focus)
  const open = focused || (pref ?? openByDefault(tasks))
  const toggle = () => {
    setPref(!open)
    try {
      localStorage.setItem(FOLDS, JSON.stringify({ ...readFolds(), [id]: !open }))
    } catch {
      /* stockage indisponible */
    }
  }
  return [open, toggle]
}

function MiniBar({ tasks }: { tasks: AutoTask[] }) {
  const c = counts(tasks)
  return (
    <span className="auto-mini" aria-hidden>
      {STATES.filter((s) => c[s]).map((s) => (
        <span key={s} className={`st-${s}`} style={{ flexGrow: c[s] }} />
      ))}
    </span>
  )
}

/** Résumé d'un niveau : nombre en gras, ce qui tourne, la mini-barre des états. */
function Aggregate({ tasks }: { tasks: AutoTask[] }) {
  const running = tasks.filter((x) => x.state === 'running').length
  return (
    <span className="auto-agg" aria-hidden>
      {running > 0 && (
        <span className="spin fluo">
          <Icon name="star" />
        </span>
      )}
      <span className="strong tab">{tasks.length}</span>
      <MiniBar tasks={tasks} />
    </span>
  )
}

const catSlot = (cat: AutoCategory, colors: Record<string, string>) => (cat.projectId ? (colors[cat.projectId] ?? 'p0') : (colors.__foot ?? 'p3'))

function Category({ cat }: { cat: AutoCategory }) {
  const t = useT(M)
  const { snap, colors } = useApp()
  const tasks = tasksOf(cat)
  const [open, toggle] = useFold(cat.id, tasks)
  const name = cat.projectId ? (snap.projects.find((p) => p.id === cat.projectId)?.name ?? cat.projectId) : t.machine
  const slot = catSlot(cat, colors)
  const running = tasks.filter((x) => x.state === 'running').length
  return (
    <section className="band auto-cat" style={color(slot)}>
      <button className="in auto-cat-head" onClick={toggle} aria-expanded={open} aria-label={t.levelLabel(name, tasks.length, running, open)}>
        <span className="auto-cat-name" aria-hidden>
          {name}
        </span>
        <Aggregate tasks={tasks} />
        <span className="auto-chev" aria-hidden>
          <Icon name="chevron" dir={open ? 'up' : 'down'} />
        </span>
      </button>
      <Collapse open={open}>
        {cat.groups.length === 1 ? <Tasks tasks={cat.groups[0].tasks} /> : cat.groups.map((g) => <Group key={g.id} g={g} />)}
      </Collapse>
    </section>
  )
}

function Group({ g }: { g: AutoGroup }) {
  const t = useT(M)
  const [open, toggle] = useFold(g.id, g.tasks)
  const label = t[`group_${g.kind}`]
  const running = g.tasks.filter((x) => x.state === 'running').length
  return (
    <div className="auto-grp">
      <button className="in auto-grp-head" onClick={toggle} aria-expanded={open} aria-label={t.levelLabel(label, g.tasks.length, running, open)}>
        <span className="auto-grp-name" aria-hidden>
          {label}
        </span>
        <Aggregate tasks={g.tasks} />
        <span className="auto-chev" aria-hidden>
          <Icon name="chevron" dir={open ? 'up' : 'down'} />
        </span>
      </button>
      <Collapse open={open}>
        <Tasks tasks={g.tasks} />
      </Collapse>
    </div>
  )
}

function Tasks({ tasks }: { tasks: AutoTask[] }) {
  return (
    <div className="tone auto-tasks">
      {tasks.map((x) => (
        <TaskRow key={x.id} task={x} />
      ))}
    </div>
  )
}

const STATE_ICON: Record<TaskState, IconName> = { running: 'star', waiting: 'idle', queued: 'more', scheduled: 'arrow', paused: 'pause', done: 'check', failed: 'close' }

/** 1 forte … 3 faible : trois barres montantes, autant de pleines que d'importance. */
function Intensity({ priority, est, heavy }: { priority?: number; est?: number; heavy?: boolean }) {
  if (!priority && !est && !heavy) return null
  const level = priority ? 4 - priority : 0
  return (
    <span className="auto-int" aria-hidden>
      {heavy && <span className="auto-heavy" />}
      {priority ? (
        <span className="auto-prio">
          {[1, 2, 3].map((i) => (
            <span key={i} className={i <= level ? 'on' : ''} style={{ height: 4 + i * 3 }} />
          ))}
        </span>
      ) : null}
      {est ? <span className="tab">~{short(est * 60_000)}</span> : null}
    </span>
  )
}

function TaskRow({ task: x }: { task: AutoTask }) {
  const t = useT(M)
  const tb = useT(B)
  const { now, push, refresh, setH24Open } = useApp()
  const facts: ReactNode[] = []
  const said: string[] = []
  if (x.state === 'running' && x.startedAt) {
    const ran = now - x.startedAt
    facts.push(<b key="ran">{short(ran)}</b>)
    if (x.est) facts.push(<span key="p" className="auto-progress"><span style={{ width: `${Math.min(100, Math.round((ran / (x.est * 60_000)) * 100))}%` }} /></span>)
    said.push(t.runningFor(short(ran)))
  }
  if (x.state === 'waiting' && x.waiting && x.waiting !== 'queue') {
    facts.push(<span key="w" className="auto-tag st-waiting">{t[`wait_${x.waiting}`]}</span>)
    said.push(t[`wait_${x.waiting}`])
  }
  if (x.state === 'queued' && x.place) {
    facts.push(<b key="q">#{x.place}</b>)
    said.push(t.place(x.place))
  }
  if (x.nextAt && x.state !== 'running') {
    const left = Math.max(0, x.nextAt - now)
    facts.push(
      <b key="n" className="auto-next">
        <Icon name="arrow" dir="right" />
        {short(left)}
      </b>,
    )
    said.push(t.nextIn(short(left)))
  }
  if (x.every) {
    facts.push(<b key="e" className="auto-dim">/{short(x.every)}</b>)
    said.push(t.every(short(x.every)))
  }
  if ((x.state === 'done' || x.state === 'failed') && x.endedAt) {
    facts.push(<b key="end">{t.endedAgo(short(now - x.endedAt, true))}</b>)
    said.push(t.endedAgo(short(now - x.endedAt, true)))
  }
  if (x.since && (x.state === 'scheduled' || x.state === 'paused')) {
    facts.push(<span key="s" className="auto-dim">{t.runningFor(short(now - x.since, true))}</span>)
    said.push(t.since(short(now - x.since, true)))
  }
  if (x.priority) said.push(t.priority(x.priority))
  if (x.est) said.push(t.est(x.est))
  if (x.heavy) said.push(t.heavy)
  const note = (x.state === 'done' || x.state === 'failed' || x.kind === 'job') && x.note && x.note !== '—' ? x.note : ''
  const label = t.taskLabel(x.title, t[`state_${x.state}`], said.join(', '))
  const openSession = x.sessionId
    ? () => {
        setH24Open(false)
        push({ kind: 'session', id: x.sessionId! })
      }
    : undefined
  const body = (
    <>
      <span className="auto-st" aria-hidden />
      <span className="auto-ic" aria-hidden>
        {x.state === 'running' ? (
          <span className="spin fluo">
            <Icon name="star" />
          </span>
        ) : (
          <Icon name={STATE_ICON[x.state]} dir={x.state === 'scheduled' ? 'right' : 'up'} />
        )}
      </span>
      <span className="auto-main" aria-hidden>
        <span className="auto-title">
          {x.title}
          {x.demo && <span className="tr-tag">{tb.demo}</span>}
        </span>
        {(facts.length > 0 || note) && (
          <span className="auto-facts">
            {facts}
            {note && <span className="auto-note">{note}</span>}
          </span>
        )}
      </span>
      <Intensity priority={x.priority} est={x.state === 'running' ? undefined : x.est} heavy={x.heavy} />
    </>
  )
  return (
    <div className={`auto-task st-${x.state}`} data-h24={x.id}>
      {openSession ? (
        <button className="in auto-row" onClick={openSession} aria-label={label}>
          {body}
        </button>
      ) : (
        <div className="in auto-row" role="group" aria-label={label}>
          {body}
          {x.toggle && (
            <button className="ch" onClick={() => void api.toggleH24(x.id).then(refresh)} aria-label={x.state === 'paused' ? t.resume(x.title) : t.pause(x.title)}>
              <Icon name={x.state === 'paused' ? 'play' : 'pause'} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
