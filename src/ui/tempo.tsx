// Tempo in the app (docs/product/tempo.md): one icon at the top of a repo's Requests page (and one line in Settings
// for the global ceiling). A tap sets the next mode: only the icon changes, and a slim band slides in from the side
// with what that mode will use, from the spend ledger, with how sure it is. Past the highest open mode, or on a long
// press, a wide panel drops from the top: the 7 modes on one track, locked ones shown, each with a small card.

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { AGENTS, REPO_DEFAULT, TEMPO_MODES, lowerOf, rankOf, type Figure, type TempoMode, type TempoModeView, type TempoView } from '../../shared/tempo.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/tempo'
import { useApp } from './app-context'
import { Icon } from './icons'
import { TEMPO_ICONS } from './tempo-icons'
import './tempo.css'

let shared: { v: TempoView | null; at: number; inflight: Promise<TempoView | null> | null } = { v: null, at: 0, inflight: null }
const subs = new Set<(v: TempoView) => void>()
const publish = (v: TempoView) => {
  shared = { v, at: Date.now(), inflight: null }
  for (const f of subs) f(v)
}
/** Test hook. */
export function resetTempo() {
  shared = { v: null, at: 0, inflight: null }
}

/** The Tempo view, shared by every icon on screen; read again at most once a minute while the app changes. */
export function useTempo(): [TempoView | null, (mode: TempoMode, repo: string | null) => Promise<void>] {
  const { snap } = useApp()
  const [v, setV] = useState<TempoView | null>(shared.v)
  useEffect(() => {
    subs.add(setV)
    return () => void subs.delete(setV)
  }, [])
  useEffect(() => {
    if (Date.now() - shared.at < 60_000 || shared.inflight) return
    // No Tempo on this server (another machine, an older weevilsd): no control, nothing else changes.
    shared.inflight = Promise.resolve().then(() => api.tempo()).then((x) => (publish(x), x)).catch(() => ((shared.inflight = null), null))
  }, [snap.version])
  const set = async (mode: TempoMode, repo: string | null) => publish(await api.setTempo(mode, repo))
  return [v, set]
}

/** The mode a repo is set to (its own, else Cruise under the ceiling), and whether the global ceiling holds it lower. */
export function modeFor(v: TempoView, repo: string | null): { chosen: TempoMode; capped: boolean } {
  if (!repo) return { chosen: v.global, capped: false }
  const chosen = v.repos[repo] ?? lowerOf(REPO_DEFAULT, v.global)
  return { chosen, capped: rankOf(chosen) > rankOf(v.effective) }
}

/** The next mode a tap sets: the next open one, or null when the next is locked (the panel opens instead). */
export function nextOf(v: TempoView, m: TempoMode): TempoMode | null {
  const i = rankOf(m)
  const next = TEMPO_MODES[i + 1]
  if (!next) return 'pause'
  return v.modes.find((x) => x.id === next)?.unlocked ? next : null
}

/** Tokens in millions (or billions): the number and its unit apart, so a range says its unit once. */
const millions = (x: number): [string, string] => (x >= 1e9 ? [(x / 1e9).toFixed(x >= 1e10 ? 0 : 1), 'B'] : [String(Math.max(1, Math.round(x / 1e6))), 'M'])
const percent = (x: number): [string, string] => [String(Math.round(x)), '%']
/** A figure in words: the value when measured, « about » the value while rough or a default (the band also says
 *  how sure it is; a range crossing two rough figures is too wide to read). Exported for tests. */
export function amount(f: Figure, unit: (x: number) => [string, string], about: string): string {
  const [v, u] = unit(f.value)
  return f.confidence === 'measured' ? `${v} ${u}` : `${about} ${v} ${u}`
}

/** The side band's sentence for a mode. Exported for tests. */
export function bandLine(t: (typeof M)['en'], m: TempoModeView): { line: string; sure: string } {
  if (m.id === 'pause') return { line: t.paused, sure: '' }
  const b = m.band
  const tokens = amount(b.tokensPerDay, millions, t.about)
  const pct = b.pctIntelligence ? amount(b.pctIntelligence, percent, t.about) : null
  const mem = `${b.memGb.value < 1 ? b.memGb.value.toFixed(1) : Math.round(b.memGb.value)} GB`
  const conf = b.pctIntelligence ?? b.tokensPerDay
  return { line: t.rate(tokens, pct, mem), sure: t.sure(conf.confidence, conf.days ?? 0) }
}

/** One Tempo control's behaviour: the tap, the long press, and its band and panel. */
function useControl(repo: string | null) {
  const [v, set] = useTempo()
  const [band, setBand] = useState<TempoMode | null>(null)
  const [panel, setPanel] = useState(false)
  const hold = useRef<number | null>(null)
  const held = useRef(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  if (!v) return null
  const { chosen } = modeFor(v, repo)
  const flash = (m: TempoMode) => {
    setBand(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setBand(null), 5200)
  }
  const tap = () => {
    if (held.current) return void (held.current = false)
    const next = nextOf(v, chosen)
    if (!next) return setPanel(true)
    void set(next, repo).then(() => flash(next)).catch(() => setPanel(true))
  }
  const up = () => void (hold.current && clearTimeout(hold.current))
  const press = {
    onClick: tap,
    onPointerDown: () => {
      held.current = false
      hold.current = window.setTimeout(() => ((held.current = true), setPanel(true)), 450)
    },
    onPointerUp: up,
    onPointerLeave: up,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }
  const overlays = (
    <>
      <TempoBand v={v} mode={band} repo={repo} onOpen={() => (setBand(null), setPanel(true))} />
      <TempoPanel v={v} repo={repo} open={panel} onClose={() => setPanel(false)} onSet={(m) => void set(m, repo).then(() => (setPanel(false), flash(m)))} />
    </>
  )
  return { chosen, press, overlays }
}

/** The repo's icon, at the top of its Requests page. Only the icon changes on a tap. */
export function TempoIcon({ repo }: { repo: string | null }) {
  const t = useT(M)
  const c = useControl(repo)
  if (!c) return null
  return (
    <>
      <button type="button" className="ch tempo-ch" aria-label={t.aria(t.name(c.chosen))} {...c.press}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={c.chosen} className="tempo-ic" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ duration: 0.18 }}>
            <Icon name={TEMPO_ICONS[c.chosen]} />
          </motion.span>
        </AnimatePresence>
      </button>
      {c.overlays}
    </>
  )
}

/** The global Tempo, a line of the Settings band (the ceiling over every repo): the same tap, band and panel. */
export function TempoLine() {
  const t = useT(M)
  const c = useControl(null)
  if (!c) return null
  return (
    <>
      <button type="button" className="row tempo-row" aria-label={t.globalAria(t.name(c.chosen))} {...c.press}>
        <span className="in">
          <span className="st" aria-hidden><Icon name={TEMPO_ICONS[c.chosen]} /></span>
          <span className="stack-text"><span className="ellipsis">{t.title}</span></span>
          <span className="val">{t.name(c.chosen)}</span>
        </span>
      </button>
      {c.overlays}
    </>
  )
}

/** The slim band that slides in from the side after a change (also after a move of next's Tempo cells). */
export function TempoBand({ v, mode, repo, onOpen }: { v: TempoView; mode: TempoMode | null; repo: string | null; onOpen: () => void }) {
  const t = useT(M)
  const m = mode ? v.modes.find((x) => x.id === mode) : undefined
  const { line, sure } = m ? bandLine(t, m) : { line: '', sure: '' }
  const capped = mode && repo ? modeFor(v, repo).capped : false
  return (
    <AnimatePresence>
      {m && (
        <motion.button type="button" key={m.id} className="tempo-band" role="status" onClick={onOpen}
          initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}>
          <span className="tempo-band-name">{t.name(m.id)}</span>
          <span className="tempo-band-line">{line}</span>
          {(sure || capped) && <span className="tempo-band-sure">{[capped ? t.capped(t.name(v.effective)) : '', sure].filter(Boolean).join(' · ')}</span>}
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/** The wide panel from the top: a track with the 7 modes, and the card of the one tapped. */
export function TempoPanel({ v, repo, open, onClose, onSet }: { v: TempoView; repo: string | null; open: boolean; onClose: () => void; onSet: (m: TempoMode) => void }) {
  const t = useT(M)
  const { chosen } = modeFor(v, repo)
  const [pick, setPick] = useState<TempoMode>(chosen)
  useEffect(() => {
    if (open) setPick(nextOf(v, chosen) ? chosen : (TEMPO_MODES[rankOf(chosen) + 1] ?? chosen))
  }, [open])
  const m = v.modes.find((x) => x.id === pick)!
  const lit = rankOf(chosen)
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="veil" className="tempo-veil" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div key="panel" className="tempo-panel" role="dialog" aria-label={t.title}
            initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.4, bottom: 0 }} onDragEnd={(_, i) => (i.offset.y < -60 ? onClose() : undefined)}>
            <div className="tempo-track" role="radiogroup">
              <div className="tempo-rail"><i style={{ width: `${(lit / (TEMPO_MODES.length - 1)) * 100}%` }} /></div>
              {v.modes.map((x, i) => (
                <button type="button" key={x.id} role="radio" aria-checked={x.id === pick} aria-label={t.name(x.id)}
                  className={['tempo-stop', i <= lit && 'on', !x.unlocked && 'locked', x.id === pick && 'picked'].filter(Boolean).join(' ')} onClick={() => setPick(x.id)}>
                  <Icon name={TEMPO_ICONS[x.id]} />
                </button>
              ))}
            </div>
            <TempoCard m={m} current={m.id === chosen} onUse={() => onSet(m.id)} />
            <button type="button" className="tempo-close" onClick={onClose} aria-label={t.close}><Icon name="chevron" /></button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function TempoCard({ m, current, onUse }: { m: TempoModeView; current: boolean; onUse: () => void }) {
  const t = useT(M)
  const { line, sure } = bandLine(t, m)
  const u = m.unlock
  const opens = [u?.subscriptions ? t.subs(u.subscriptions) : '', u?.cores ? t.vps(u.cores, u.ramGb ?? 0) : '', u?.hostPlan ? t.hostPlan(u.hostPlan, u.hostPrice) : ''].filter(Boolean)
  return (
    <motion.div key={m.id} className={`tempo-card${m.unlocked ? '' : ' locked'}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
      <div className="tempo-card-head">
        <span className="tempo-card-name">{t.name(m.id)}</span>
        <span className="meta">{[t.agents(AGENTS[m.id]), m.needHours ? t.needs(m.needHours) : m.id === 'pause' ? '' : t.anyPlan].filter(Boolean).join(' · ')}</span>
      </div>
      <p className="tempo-card-example">{t.example(m.id)}</p>
      {m.id !== 'pause' && <p className="tempo-card-rate">{line}{sure ? <span className="meta tempo-card-sure">{sure}</span> : null}</p>}
      {!m.unlocked ? (
        <p className="tempo-card-opens"><b>{t.opensWith}</b> {opens.join(' · ')}</p>
      ) : current ? (
        <p className="meta strong">{t.current}</p>
      ) : (
        <button type="button" className="tempo-use" onClick={onUse}>{t.use(t.name(m.id))}</button>
      )}
    </motion.div>
  )
}
