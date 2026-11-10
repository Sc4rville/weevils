import { AnimatePresence, animate, motion, useDragControls, useMotionValue } from 'motion/react'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Optimizer, OptimizerField, Snapshot } from '../../shared/api.ts'
import { api } from '../api'
import { useApp } from './app-context'
import { Collapse, spring } from './bits'
import { Icon, type IconName } from './icons'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/h24'
import B from '../i18n/bits'
import { tapHint } from './hints'
import { DRAWER_SLOT, STATES, autoTree, counts, openByDefault, propColors, short, tasksOf, type AutoCategory, type AutoGroup, type AutoTask, type TaskState } from './h24-tree'
import './h24.css'
import { flash, when } from './follow'
import { VoiceLogo } from './voice'

const color = (slot: string) => ({ '--c': `var(--${slot})` }) as CSSProperties

/** Bande « auto » collée en bas : on la tire vers le haut (ou on la touche) pour voir ce qui tourne tout seul. */
export function H24Rail() {
  const { snap, colors, h24Open: open, setH24Open: setOpen, h24Focus } = useApp()
  const t = useT(M)
  const talks = useTalks()
  // Une tâche réécrite à l'instant : sa nouvelle version, avant que le snapshot ne suive.
  const opts = (snap.optimizers ?? []).map(talks.item)
  const proposed = opts.filter((o) => o.state === 'proposed')
  const tree = autoTree({ ...snap, optimizers: opts })
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

  // Tiroir refermé : le champ ouvert sous une tâche se ferme avec lui.
  const closeTalk = talks.setOpen
  useEffect(() => {
    if (!open) closeTalk(null)
  }, [open, closeTalk])

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
          <TalkCtx.Provider value={talks}>
            <Proposals list={proposed} below={below} />
            <MachineLine />
            {tree.map((cat) => (
              <Category key={cat.id} cat={cat} />
            ))}
          </TalkCtx.Provider>
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

const KIND_ICON: Record<Optimizer['kind'], IconName> = { tests: 'terminal', watch: 'external', content: 'file', explore: 'slash', other: 'star' }
/** Après un dépliage, ✓ et × attendent ce délai : le doigt qui vient de déplier ne lance ni ne refuse rien. */
export const SETTLE_MS = 450

/** Les champs que la dernière réécriture a changés clignotent un instant (classe chg). */
const chg = (on: boolean, base = '') => `${base}${on ? `${base ? ' ' : ''}auto-chg` : ''}`

/**
 * Une colonne touchée se déplie : elle prend presque toute la largeur, titre et raison en entier ; les autres
 * deviennent de fines bandes de couleur (les toucher les déplie à leur tour). Retouchée, elle se replie. Dépliée, une
 * bulle ouvre un champ juste dessous (écrit ou dit) : la réponse s'écrit dans la carte, la carte se réécrit, ✓ valide
 * ce qui est à l'écran.
 */
function Proposals({ list, below }: { list: Optimizer[]; below: string }) {
  const t = useT(M)
  const { refresh } = useApp()
  const k = useContext(TalkCtx)!
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [wide, setWide] = useState<string | null>(null)
  const movedAt = useRef(-Infinity)
  // Une couleur par proposition, gardée tant qu'elle est là : celle qui part n'en fait pas changer les autres.
  const slots = useRef(new Map<string, string>())
  const shown = list.filter((o) => !gone.has(o.id)).slice(0, 3).map(k.item)
  slots.current = propColors(shown.map((o) => o.id), slots.current, below)
  const open = shown.some((o) => o.id === wide) ? wide : null
  const talking = open !== null && k.open === open ? open : null
  const expand = (id: string | null) => {
    movedAt.current = performance.now()
    setWide(id)
    if (k.open && k.open !== id && shown.some((o) => o.id === k.open)) k.setOpen(null)
  }
  const answer = (o: Optimizer, yes: boolean) => {
    if (performance.now() - movedAt.current < SETTLE_MS || (yes && k.busy.has(o.id))) return
    setGone((g) => new Set(g).add(o.id))
    if (k.open === o.id) k.setOpen(null)
    void (yes ? api.acceptOptimizer(o.id, o.rev ?? 0) : api.refuseOptimizer(o.id))
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
    <div className="auto-props-wrap">
      <div className="auto-props" role="list" aria-label={t.proposals}>
        <AnimatePresence initial={false}>
          {shown.map((o) => {
            const slim = open !== null && open !== o.id
            const isOpen = open === o.id
            const f = k.flash.get(o.id) ?? []
            const busy = k.busy.has(o.id)
            return (
              <motion.div
                key={o.id}
                role="listitem"
                className={`auto-prop${slim ? ' slim' : ''}${isOpen ? ' open' : ''}`}
                style={color(slots.current.get(o.id) ?? 'p9')}
                initial={{ flexGrow: 0, minWidth: 0, opacity: 0 }}
                animate={{ flexGrow: slim ? 0 : 1, minWidth: 22, opacity: 1 }}
                exit={{ flexGrow: 0, minWidth: 0, opacity: 0 }}
                transition={spring}
              >
                <motion.div className="auto-prop-in" inert={slim} animate={{ opacity: slim ? 0 : 1 }} transition={spring}>
                  <button className="auto-prop-body" onClick={() => expand(isOpen ? null : o.id)} aria-expanded={isOpen}>
                    <span className={chg(f.includes('kind') || f.includes('repo'), 'k')} aria-hidden>
                      <Icon name={KIND_ICON[o.kind]} />
                      <span>{t[`kind_${o.kind}`]}</span>
                      {isOpen && o.repo && <span className="auto-repo">{o.repo}</span>}
                    </span>
                    <span className={chg(f.includes('title'), 't')}>{o.title}</span>
                    {o.why && <span className={chg(f.includes('why'), 'w')}>{o.why}</span>}
                  </button>
                  {isOpen && <TalkLines o={o} />}
                  <span className="i" aria-hidden onClick={() => expand(isOpen ? null : o.id)}>
                    <Conds o={o} f={f} />
                    <span className={chg(f.includes('est') || f.includes('priority') || f.includes('heavy'))}>
                      <Intensity priority={o.priority} est={o.est} heavy={o.heavy} />
                    </span>
                  </span>
                  <div className="acts">
                    <button className="ok" onClick={() => answer(o, true)} disabled={busy} aria-label={busy ? t.acceptBusy(o.title) : t.accept(o.title)}>
                      <Icon name="check" />
                    </button>
                    {isOpen && (
                      <button className={`talk${talking === o.id ? ' on' : ''}`} onClick={() => k.setOpen(talking === o.id ? null : o.id)} aria-expanded={talking === o.id} aria-label={t.talk(o.title)}>
                        <Icon name="quote" />
                      </button>
                    )}
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
      <Collapse open={!!talking}>
        {talking && (
          <div className="auto-prop-say" style={color(slots.current.get(talking) ?? 'p9')}>
            <TalkField id={talking} title={shown.find((o) => o.id === talking)?.title ?? ''} />
          </div>
        )}
      </Collapse>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parler d'une tâche : une question écrite ou dite (même logo, même voix que weevboss), la réponse sur place, la tâche
// réécrite (les champs changés clignotent). Un seul champ ouvert à la fois dans le tiroir.

/** Ce qu'une réponse peut réécrire, et l'échange : la version reçue avec la réponse, avant que le snapshot ne suive. */
const TALKED = ['title', 'why', 'kind', 'repo', 'est', 'priority', 'heavy', 'notBefore', 'window', 'every', 'talk', 'changed', 'rev'] as const
const FLASH_MS = 1700

interface Talks {
  /** La tâche dont le champ est ouvert. */
  open: string | null
  setOpen: (id: string | null) => void
  /** Une question en vol (✓ attend), et son texte, montré tout de suite. */
  busy: ReadonlySet<string>
  asking: ReadonlyMap<string, string>
  /** Pas de réponse (modèle, réseau) : la note à montrer, rien n'a changé. */
  notes: ReadonlyMap<string, string>
  flash: ReadonlyMap<string, OptimizerField[]>
  /** La dernière réponse à une question dite : le logo la lit. */
  reply: { key?: string; text?: string }
  item: (o: Optimizer) => Optimizer
  send: (id: string, text: string, voice?: boolean) => Promise<boolean>
}
const TalkCtx = createContext<Talks | null>(null)

function without<V>(m: ReadonlyMap<string, V>, k: string): Map<string, V> {
  const n = new Map(m)
  n.delete(k)
  return n
}

function useTalks(): Talks {
  const { refresh } = useApp()
  const [open, setOpenState] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [asking, setAsking] = useState<ReadonlyMap<string, string>>(new Map())
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map())
  const [flashes, setFlashes] = useState<ReadonlyMap<string, OptimizerField[]>>(new Map())
  const [local, setLocal] = useState<ReadonlyMap<string, Optimizer>>(new Map())
  const [reply, setReply] = useState<{ key?: string; text?: string }>({})
  const seq = useRef(0)
  const inflight = useRef(new Set<string>())
  const setOpen = useCallback((id: string | null) => {
    setOpenState(id)
    setReply({})
  }, [])
  const item = (o: Optimizer): Optimizer => {
    const l = local.get(o.id)
    if (!l || ((l.rev ?? 0) <= (o.rev ?? 0) && (l.talk?.length ?? 0) <= (o.talk?.length ?? 0))) return o
    const out: Record<string, unknown> = { ...o }
    for (const key of TALKED) out[key] = l[key]
    return out as unknown as Optimizer
  }
  const send = async (id: string, text: string, voice = false) => {
    const said = text.trim()
    if (!said || inflight.current.has(id)) return false
    inflight.current.add(id)
    setBusy((b) => new Set(b).add(id))
    setAsking((a) => new Map(a).set(id, said))
    setNotes((n) => without(n, id))
    try {
      const r = await api.talkOptimizer(id, said)
      if (r.item && !r.failed) setLocal((m) => new Map(m).set(id, r.item!))
      if (r.failed) setNotes((n) => new Map(n).set(id, r.reply))
      if (r.changed.length) {
        const mark = r.changed
        setFlashes((m) => new Map(m).set(id, mark))
        window.setTimeout(() => setFlashes((m) => (m.get(id) === mark ? without(m, id) : m)), FLASH_MS)
      }
      setReply(voice && r.reply ? { key: String(++seq.current), text: r.reply } : {})
      return !r.failed
    } catch (e) {
      setNotes((n) => new Map(n).set(id, (e as Error).message))
      return false
    } finally {
      inflight.current.delete(id)
      setBusy((b) => {
        const n = new Set(b)
        n.delete(id)
        return n
      })
      setAsking((a) => without(a, id))
      refresh()
    }
  }
  return { open, setOpen, busy, asking, notes, flash: flashes, reply, item, send }
}

/** Le champ sous une carte ou une ligne : le logo vocal et la question écrite, côte à côte sous le pouce. */
function TalkField({ id, title }: { id: string; title: string }) {
  const t = useT(M)
  const k = useContext(TalkCtx)!
  const [draft, setDraft] = useState('')
  const heard = useRef('')
  const input = useRef<HTMLInputElement>(null)
  const waiting = k.busy.has(id)
  // Sur ordinateur le champ est prêt ; sur téléphone le clavier attend un tap (le logo vocal est juste là).
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true })
  }, [])
  const go = async (text: string, voice = false) => {
    const said = text.trim()
    if (!said || waiting) return
    setDraft('')
    if (!(await k.send(id, said, voice))) setDraft((d) => d || said)
  }
  const voiceText = (x: string) => {
    heard.current = heard.current ? `${heard.current} ${x}` : x
    setDraft(heard.current)
  }
  const voiceSend = () => {
    const q = heard.current.trim()
    heard.current = ''
    if (q) void go(q, true)
  }
  return (
    <div className="auto-say">
      <VoiceLogo take={() => ''} onText={voiceText} onSend={voiceSend} replyKey={k.reply.key} replyText={k.reply.text} working={waiting} />
      <form
        className="auto-form"
        onSubmit={(e) => {
          e.preventDefault()
          heard.current = ''
          void go(draft)
        }}
      >
        <span className="strong" aria-hidden>
          <Icon name="chevron" dir="right" />
        </span>
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && k.setOpen(null)}
          aria-label={t.talkInput(title)}
          enterKeyHint="send"
          maxLength={500}
        />
        <button type="submit" className="auto-send" aria-label={t.send} disabled={!draft.trim() || waiting}>
          <Icon name="arrow" dir="up" />
        </button>
      </form>
    </div>
  )
}

/** L'échange : les dernières lignes (la réponse la plus récente en gras), les plus anciennes repliées derrière +N. */
function TalkLines({ o, max = 2, all: allInit = false, onFewer }: { o: Optimizer; max?: number; all?: boolean; onFewer?: () => void }) {
  const t = useT(M)
  const k = useContext(TalkCtx)!
  const [all, setAll] = useState(allInit)
  const asking = k.asking.get(o.id)
  const note = k.notes.get(o.id)
  const waiting = k.busy.has(o.id)
  const lines = [...(o.talk ?? []), ...(asking ? [{ who: 'user' as const, text: asking, at: 0 }] : [])]
  if (!lines.length && !note && !waiting) return null
  const visible = all ? lines : lines.slice(-max)
  const hidden = lines.length - visible.length
  let lastAuto = visible.length - 1
  while (lastAuto >= 0 && visible[lastAuto].who !== 'auto') lastAuto--
  return (
    <div className="auto-lines" aria-live="polite">
      {hidden > 0 && (
        <button className="auto-more" onClick={() => setAll(true)} aria-label={t.earlier(hidden)}>
          +{hidden}
        </button>
      )}
      {all && (lines.length > max || onFewer) && (
        <button className="auto-more" onClick={onFewer ?? (() => setAll(false))} aria-label={t.fewer}>
          <Icon name="chevron" dir="up" />
        </button>
      )}
      {visible.map((l, i) => (
        <p key={`${l.at}-${i}`} className={`auto-line ${l.who}${i === lastAuto ? ' last' : ''}${l.at === 0 ? ' sending' : ''}`}>
          {l.text}
        </p>
      ))}
      {waiting && (
        <span className="spin fluo auto-line-wait" aria-hidden>
          <Icon name="star" />
        </span>
      )}
      {note && !waiting && <p className="auto-line note">! {note}</p>}
    </div>
  )
}

/** Heure d'un départ : « 01:00 » aujourd'hui ou dans les 24 h, « mer. 08:00 » dans la semaine, sinon la date. */
function at(ts: number, now: number): string {
  const loc = intlLocale()
  const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts)
  if (ts - now < 20 * 3600_000) return time
  if (ts - now < 6 * 24 * 3600_000) return `${new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(ts)} ${time}`
  return `${new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }).format(ts)} ${time}`
}
const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
/** Une fenêtre de nuit (elle commence le soir ou au cœur de la nuit, finit au matin) : « nuit » devant ses heures. */
const isNight = (w: { from: number; to: number }) => (w.from >= 20 * 60 || w.from < 5 * 60) && w.to <= 9 * 60

/** Les conditions d'une tâche en chiffres : pas avant (→ 01:00), sa fenêtre (nuit 01:00–06:00), sa fréquence (/7j). */
function Conds({ o, f = [] }: { o: Optimizer; f?: OptimizerField[] }) {
  const t = useT(M)
  const { now } = useApp()
  const start = o.startAt ?? (o.notBefore && o.notBefore > now ? o.notBefore : undefined)
  if (!start && !o.window && !o.every) return null
  return (
    <span className="auto-conds">
      {start && (
        <b className={chg(f.includes('notBefore'), 'auto-cond')}>
          <Icon name="arrow" dir="right" />
          {at(start, now)}
        </b>
      )}
      {o.window && (
        <b className={chg(f.includes('window'), 'auto-cond')}>
          {isNight(o.window) && `${t.night} `}
          {hm(o.window.from)}–{hm(o.window.to)}
        </b>
      )}
      {o.every && <b className={chg(f.includes('every'), 'auto-cond')}>/{short(o.every)}</b>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// La machine : charge et mémoire libre, et ce qui retient une tâche acceptée.

const machineShown = (snap: Snapshot) => !!snap.autoMachine && (snap.optimizers ?? []).some((o) => o.state !== 'proposed')

function MachineLine() {
  const t = useT(M)
  const { snap } = useApp()
  const m = snap.autoMachine
  // Retenue par la machine (pas par son heure).
  const held = (snap.optimizers ?? []).some((o) => o.state === 'queued' && o.waiting !== 'time')
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
  const { now, push, refresh, setH24Open, snap } = useApp()
  const k = useContext(TalkCtx)
  // Une tâche proposée puis acceptée : on peut encore en parler (une bulle), son échange reste dessous.
  const found = x.kind === 'optimizer' ? (snap.optimizers ?? []).find((o) => o.id === x.id) : undefined
  const opt = found && k ? k.item(found) : undefined
  const talkOpen = !!opt && k?.open === x.id
  const f = (opt && k?.flash.get(x.id)) ?? []
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
  if (x.window) {
    const [from, to] = [hm(x.window.from), hm(x.window.to)]
    facts.push(
      <b key="win" className={chg(f.includes('window'), 'auto-dim')}>
        {isNight(x.window) && `${t.night} `}
        {from}–{to}
      </b>,
    )
    said.push(t.window(from, to))
  }
  if (x.every) {
    facts.push(<b key="e" className={chg(f.includes('every'), 'auto-dim')}>/{short(x.every)}</b>)
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
  // Une tâche récurrente qui attend son prochain passage garde la nouvelle du dernier.
  const note = (x.state === 'done' || x.state === 'failed' || x.kind === 'job' || !!opt?.runs?.length) && x.note && x.note !== '—' ? x.note : ''
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
        <span className={chg(f.includes('title'), 'auto-title')}>
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
      <span className={chg(f.includes('est') || f.includes('priority') || f.includes('heavy'))}>
        <Intensity priority={x.priority} est={x.state === 'running' ? undefined : x.est} heavy={x.heavy} />
      </span>
    </>
  )
  return (
    <div className={`auto-task st-${x.state}`} data-h24={x.id}>
      <div className="in auto-row">
        {openSession ? (
          <button className="auto-row-main" onClick={openSession} aria-label={label}>
            {body}
          </button>
        ) : (
          <div className="auto-row-main" role="group" aria-label={label}>
            {body}
          </div>
        )}
        {x.toggle && (
          <button className="ch" onClick={() => void api.toggleH24(x.id).then(refresh)} aria-label={x.state === 'paused' ? t.resume(x.title) : t.pause(x.title)}>
            <Icon name={x.state === 'paused' ? 'play' : 'pause'} />
          </button>
        )}
        {opt && k && (
          <button className={`ch auto-talk-ic${talkOpen ? ' on' : ''}`} onClick={() => k.setOpen(talkOpen ? null : x.id)} aria-expanded={talkOpen} aria-label={t.talk(x.title)}>
            <Icon name="quote" />
          </button>
        )}
      </div>
      {opt && <TaskTalk o={opt} open={talkOpen} />}
    </div>
  )
}

/**
 * Sous une tâche acceptée : d'où elle vient (l'échange qui l'a réécrite, replié sur une ligne, déplié d'un tap), ses
 * passages précédents si elle revient, et le champ quand sa bulle est ouverte.
 */
function TaskTalk({ o, open }: { o: Optimizer; open: boolean }) {
  const t = useT(M)
  const { now } = useApp()
  const k = useContext(TalkCtx)!
  const [more, setMore] = useState(false)
  const lines = o.talk ?? []
  const busy = k.busy.has(o.id) || k.notes.has(o.id)
  if (!open && !more && !lines.length && !busy) return null
  const runs = o.runs ?? []
  return (
    <div className="in auto-hist">
      {open || more || busy ? (
        <>
          {more && runs.length > 0 && (
            <ul className="auto-runs">
              {[...runs].reverse().map((r) => (
                <li key={r.at} className={r.ok ? '' : 'bad'} aria-label={r.ok ? t.runOk(short(now - r.at, true)) : t.runFailed(short(now - r.at, true))}>
                  <Icon name={r.ok ? 'check' : 'close'} />
                  <b aria-hidden>{t.endedAgo(short(now - r.at, true))}</b>
                  {r.note && <span aria-hidden>{r.note}</span>}
                </li>
              ))}
            </ul>
          )}
          <TalkLines key={more ? 'all' : 'last'} o={o} all={more} onFewer={more ? () => setMore(false) : undefined} />
          {open && <TalkField id={o.id} title={o.title} />}
        </>
      ) : (
        <button className="auto-hist-one" onClick={() => setMore(true)} aria-expanded={false} aria-label={t.history(o.title, lines.length)}>
          <Icon name="quote" />
          <span aria-hidden>{lines.at(-1)?.text}</span>
          {lines.length > 1 && <b aria-hidden>+{lines.length - 1}</b>}
        </button>
      )}
    </div>
  )
}
