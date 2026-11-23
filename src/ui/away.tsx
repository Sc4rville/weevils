// A machine of yours that does not answer is never a bare « offline »: one plain line says why, as the machine weevils
// runs on sees it (server/remotes.ts awayWhy), and since when; one tap copies the line that brings it back (a fresh
// one-time code: the same computer pasting it keeps its name, server/join.ts). Used by weevils next's machine page
// (next/src/factory.tsx) and the classic machines page (src/ui/infra.tsx).
import { useState } from 'react'
import type { MachineAway } from '../../shared/api.ts'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/away'
import './away.css'

/** « 15:03 » today, « yesterday 15:03 », else « Nov 21 ». */
export function sinceWhen(t: number, now: number, yesterday: (time: string) => string): string {
  const d = new Date(t)
  const time = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(new Date(now)) - day(d)) / 86_400_000)
  if (days <= 0) return time
  if (days === 1) return yesterday(time)
  return d.toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' })
}

/** The sentence alone (tests, and any place that has no room for the button). */
export function awayText(t: (typeof M)['fr'], name: string, away: MachineAway, now = Date.now()): string {
  const since = away.since ? t.since(sinceWhen(away.since, now, t.yesterday)) : ''
  return t[away.why](name, since)
}

/**
 * Copies text that is still coming (the fresh line is made on the tap): Safari keeps the tap's permission only for a
 * copy started inside it, which a ClipboardItem holding a promise is. Elsewhere, a plain copy once it is there.
 */
async function copyComing(text: Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((s) => new Blob([s], { type: 'text/plain' })) })])
      return true
    }
  } catch {
    // falls through to a plain copy
  }
  try {
    await navigator.clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}

export function AwayLine({ name, away, line: getLine }: { name: string; away: MachineAway; line: () => Promise<string> }) {
  const t = useT(M)
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'shown'>('idle')
  const [line, setLine] = useState('')
  const [err, setErr] = useState('')
  const copy = () => {
    if (state === 'busy') return
    setState('busy')
    setErr('')
    const coming = getLine()
    void coming.then(setLine, (e: Error) => setErr(e.message))
    void copyComing(coming).then(
      (ok) => setState(ok ? 'copied' : 'shown'),
      () => setState('shown'),
    )
  }
  return (
    <div className="away" role="status">
      <p className="away-why">{awayText(t, name, away)}</p>
      {err ? (
        <p className="away-err" role="alert">{err}</p>
      ) : state === 'copied' || state === 'shown' ? (
        <>
          <p className="away-done">{state === 'copied' ? t.copied(name) : t.shown(name)}</p>
          {line && <code className="away-line">{line}</code>}
        </>
      ) : (
        <button className="away-copy" disabled={state === 'busy'} onClick={copy}>
          {state === 'busy' ? t.copying : t.copy(name)}
        </button>
      )}
    </div>
  )
}
