// The onboarding lab (server/lab.ts, docs/onboarding-lab.md), a builder's dev tool, absent unless the instance runs it.
// A small green switch by weevboss's field: on, what you send (typed, dictated, a capture) is a remark about the
// onboarding, not a newcomer's reply; an agent changes the code, the step plays again and the page reloads where it
// was. The switch pulses while a change is being made. On, the remarks and what each changed sit above the field,
// with « undo », « keep » (tested, then on main) and « start over » as coloured words. Off: the role-play goes on.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../src/api.ts'
import { useT } from '../../src/i18n/index.ts'
import LM from '../../src/i18n/lab.ts'
import './lab.css'
import type { LabState } from '../../shared/lab.ts'

const KEY = 'weevils-lab-on'
const read = () => {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Pure (tested): a change was played again (or undone, or the instance put back to blank) since the last look. */
export function changedSince(before: LabState | null, now: LabState): boolean {
  if (!before) return false
  if ((now.reset ?? 0) > (before.reset ?? 0)) return true
  const was = new Map(before.items.map((i) => [i.id, i.status]))
  return now.items.some((i) => (i.status === 'done' || i.status === 'undone') && was.get(i.id) !== i.status && was.has(i.id))
}

export const labBusy = (s: LabState | null) => !!s && (s.items.some((i) => i.status === 'waiting' || i.status === 'working') || s.keep?.status === 'testing')

export function useLab() {
  const [state, setState] = useState<LabState | null>(null)
  const [on, setOn] = useState(read)
  const last = useRef<LabState | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = async () => {
      const s = await api.lab().catch(() => null)
      if (!alive) return
      if (s && !s.on) return setState(null)
      if (s) {
        if (changedSince(last.current, s)) return void setTimeout(() => location.reload(), 250)
        last.current = s
        setState(s)
      }
      // Faster while a change is on its way; a restart of the instance only makes a look fail.
      timer = setTimeout(look, labBusy(s ?? last.current) ? 1500 : 4000)
    }
    void look()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  const toggle = () =>
    setOn((v) => {
      try {
        sessionStorage.setItem(KEY, v ? '0' : '1')
      } catch { /* no storage */ }
      return !v
    })
  const remarking = !!state?.on && on
  return { state, on: remarking, toggle, busy: labBusy(state) }
}

export function LabSwitch({ on, busy, toggle }: { on: boolean; busy: boolean; toggle: () => void }) {
  const t = useT(LM)
  return <button type="button" className={`lab-switch${on ? ' on' : ''}${busy ? ' busy' : ''}`} aria-pressed={on} aria-label={t.toggle} onClick={toggle} />
}

export function LabList({ state }: { state: LabState }) {
  const t = useT(LM)
  const [asked, setAsked] = useState<string | null>(null)
  const act = (kind: 'undo' | 'keep' | 'reset', id?: string) => {
    setAsked(`${kind}:${id ?? ''}`)
    void api.labDo(kind, id).catch(() => setAsked(null))
  }
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [state.items.length])
  const kept = state.keep?.status === 'landed' && state.items.every((i) => i.status !== 'done' || i.at < state.keep!.at)
  return (
    <div className="lab-list" ref={list}>
      {state.items.map((i) => (
        <p key={i.id} className={`lab-item ${i.status}`}>
          <span className="said">{i.text}</span>
          {i.change && <span className="change">{i.change}</span>}
          {i.status === 'done' && <button type="button" className="lab-act" disabled={asked === `undo:${i.id}`} onClick={() => act('undo', i.id)}>{t.undo}</button>}
        </p>
      ))}
      <p className="lab-acts">
        {state.items.some((i) => i.status === 'done') && (
          <button type="button" className={`lab-act${state.keep?.status === 'testing' ? ' busy' : ''}${state.keep?.status === 'failed' ? ' failed' : ''}`} disabled={state.keep?.status === 'testing'} onClick={() => act('keep')}>
            {kept ? t.kept : t.keep}
          </button>
        )}
        {state.keep?.status === 'failed' && state.keep.why && <span className="why">{state.keep.why}</span>}
        <button type="button" className="lab-act" disabled={asked === 'reset:'} onClick={() => act('reset')}>{t.again}</button>
      </p>
    </div>
  )
}
