// An automation's on/off state in weevils next, the same in its page and in the side bar's autonomous band: on
// (it runs at its times), paused (by the person), stopped (a recurring one that ended after failed runs in a row,
// server/optimizers.ts finish()), or over (a one-off that ran). A switch just flipped and a delete just confirmed show
// at once, in both places, until the server's snapshot says the same (then forgotten), like Your factory's switches.
import { useEffect, useState } from 'react'
import type { Optimizer, Snapshot } from '../../shared/api.ts'
import { clip } from '../../shared/asks.ts'

export type AutoOnOff = 'on' | 'paused' | 'stopped' | 'over'

/** Whether it has times of its own: every N, a daily window, or « when I sleep ». */
export const recurring = (o: Pick<Optimizer, 'every' | 'window' | 'onSleep'>): boolean => !!(o.every || o.window || o.onSleep)

/** Its state as the server last said it. */
export function onOffOf(o: Pick<Optimizer, 'state' | 'paused' | 'waiting' | 'every' | 'window' | 'onSleep'>): AutoOnOff {
  if (o.state === 'queued' || o.state === 'running') return o.paused || o.waiting === 'paused' ? 'paused' : 'on'
  if (o.state === 'failed' && recurring(o)) return 'stopped'
  return 'over'
}

/** Whether the switch can act on it: anything that has a next run, or a recurring one that stopped. */
export const switchable = (s: AutoOnOff): boolean => s !== 'over'

// ---------------------------------------------------------------- what was just done, shown at once

const flipped = new Map<string, boolean>()
const gone = new Set<string>()
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** The switch flipped: on (true) or off (false), shown at once; null forgets it (the server refused). */
export function flipAuto(id: string, on: boolean | null) {
  if (on === null) flipped.delete(id)
  else flipped.set(id, on)
  emit()
}
/** Deleted: out of the side bar at once; null brings it back (the server refused). */
export function dropAuto(id: string, dropped: boolean) {
  if (dropped) gone.add(id)
  else gone.delete(id)
  emit()
}

/** Its state now: a switch just flipped, else the server's. */
export function onOffNow(o: Optimizer): AutoOnOff {
  const f = flipped.get(o.id)
  const s = onOffOf(o)
  if (f === undefined || !switchable(s)) return s
  return f ? 'on' : s === 'stopped' ? 'stopped' : 'paused'
}
export const droppedNow = (id: string): boolean => gone.has(id)

/** Re-renders on a flip, and forgets each flip once the snapshot agrees with it. */
export function useAutoFlips(snap: Pick<Snapshot, 'optimizers'>) {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    subs.add(f)
    return () => void subs.delete(f)
  }, [])
  useEffect(() => {
    let changed = false
    const list = snap.optimizers ?? []
    for (const [id, on] of flipped) {
      const o = list.find((x) => x.id === id)
      if (!o || (onOffOf(o) === 'on') === on) { flipped.delete(id); changed = true }
    }
    for (const id of gone) {
      const o = list.find((x) => x.id === id)
      if (!o || o.state === 'refused') { gone.delete(id); changed = true }
    }
    if (changed) emit()
  }, [snap])
}

// ---------------------------------------------------------------- what it does, in one sentence

/** « This automation may, on its own, … »: how its standing authorization opens, not what it does. */
const AUTHORIZED = /^(?:this automation may,? on its own,?|on its own,? this automation may|cette automatisation peut,? d['’]elle-même,?|d['’]elle-même,? cette automatisation peut)\s*/i // i18n-ignore: words read in a stored scope, never shown

/** What it does, one plain sentence: why it was set up, else its scope without its legal opening. */
export function doesLine(o: Pick<Optimizer, 'why' | 'scope'>): string {
  const why = o.why?.trim()
  const scope = o.scope?.trim().replace(AUTHORIZED, '')
  const text = why || (scope ? scope.charAt(0).toLocaleUpperCase() + scope.slice(1) : '')
  return clip(text.replace(/\s+/g, ' '), 220)
}
