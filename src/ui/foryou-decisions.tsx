// A « decisions » post (shared/foryou.ts ForYouDecision): the few choices that are the person's alone, in one place.
// Each one is a short plain question and what to tap, as living links in the post (never a row of buttons); a list is
// ticked, then sent. A tap records the answer and sends it back to where the question waits (server/foryou.ts decide);
// the line then says what was answered, and nothing more is asked of it.
import { useState } from 'react'
import type { ForYouDecision, ForYouItem } from '../../shared/foryou.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/foryou'
import { useForYouOpen } from './foryou-open'
import { useForYou } from './foryou-store'

const buzz = () => navigator.vibrate?.(8)

function Decision({ item, d }: { item: ForYouItem; d: ForYouDecision }) {
  const t = useT(M)
  const fy = useForYou()
  const open = useForYouOpen()
  const [ticked, setTicked] = useState<string[]>([])
  // Sent and not yet back in the stream: shown as answered at once, so a second tap has nothing to hit.
  const [sent, setSent] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  const answered = d.answer?.choices ?? sent
  const send = async (choices: string[]) => {
    if (answered) return
    buzz()
    setErr('')
    setSent(choices)
    try {
      await api.foryouDecide(item.id, d.id, choices)
      fy.refresh()
    } catch (e) {
      setSent(null)
      setErr((e as Error).message)
    }
  }
  const labels = answered ? d.choices.filter((c) => answered.includes(c.id)).map((c) => c.label) : []
  return (
    <section className={`fy-dec${answered ? ' done' : ''}`} aria-label={d.question}>
      {d.from && (d.open
        ? <button type="button" className="fy-dec-from" onClick={() => open(d.open!, item.projectId)}>{d.from}</button>
        : <p className="fy-dec-from">{d.from}</p>)}
      <p className="fy-dec-q">{d.question}</p>
      {d.note && !answered && <p className="fy-dec-note">{d.note}</p>}
      {answered ? (
        <ul className="fy-dec-said">
          {(labels.length ? labels : [t.decisionNone]).map((l) => <li key={l}><span aria-hidden>✓ </span>{l}</li>)}
        </ul>
      ) : d.many ? (
        <>
          <ul className="fy-dec-ticks">
            {d.choices.map((c) => (
              <li key={c.id}>
                <label className="fy-dec-tick">
                  <input type="checkbox" checked={ticked.includes(c.id)} onChange={(e) => setTicked((v) => (e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id)))} />
                  <span className="fy-dec-box" aria-hidden />
                  <span>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="fy-dec-picks">
            <button type="button" className="living lk-preview do fy-dec-pick" disabled={!ticked.length} onClick={() => void send(ticked)}>{t.decisionSend(ticked.length)}</button>
            <button type="button" className="living lk-preview do fy-dec-pick quiet" onClick={() => void send([])}>{t.decisionNone}</button>
          </p>
        </>
      ) : (
        <p className="fy-dec-picks">
          {d.choices.map((c) => <button key={c.id} type="button" className="living lk-preview do fy-dec-pick" onClick={() => void send([c.id])}>{c.label}</button>)}
        </p>
      )}
      {err && <p className="fy-dec-err" role="alert">{err}</p>}
    </section>
  )
}

/** The decisions of a post, one under the other, in the post's own colour. */
export function Decisions({ item }: { item: ForYouItem }) {
  if (!item.decisions?.length) return null
  return <div className="in fy-decs">{item.decisions.map((d) => <Decision key={d.id} item={item} d={d} />)}</div>
}
