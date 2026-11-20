// Threads in the app (docs/spec, step 4, behind WEEVILS_THREADS): one conversation is one weevbook thread, whatever
// engines carried it. The conversation view shows its messages and one of three states (working, your move, paused);
// a paused thread says, in one sentence, what the person can do, and only when there is something to do. The weevbook
// page lists the threads by project, searches them, rereads one and continues it. Nothing here names an engine, an
// account or a relay.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../../shared/api.ts'
import type { ThreadHold, ThreadLine, ThreadList, ThreadState, ThreadView } from '../../shared/threads.ts'
import { api } from '../api'
import { intlLocale, useT } from '../i18n'
import M from '../i18n/threads'
import { useApp } from './app-context'
import { Composer, Line, Messages } from './bits'
import { ago } from './format'
import { useFollow } from './follow'
import { SessionQuestion } from './session-question'
import { projectSlug, threadsOn } from './threads-on'

export { threadOf, threadsOn } from './threads-on'
import { FootError, Shell } from './shell'


const STATE_CHAR: Record<ThreadState, string> = { working: '*', waiting: '·', paused: '‖' }

function useStateWord() {
  const t = useT(M)
  return (state: ThreadState) => (state === 'working' ? t.working : state === 'waiting' ? t.waiting : t.paused)
}

/** « 16 h 05 » (or the weekday first when it is not within the day). */
function clock(at: number, now: number) {
  const d = new Date(at)
  const time = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
  return at - now < 20 * 3600_000 ? time : `${d.toLocaleDateString(intlLocale(), { weekday: 'long' })} ${time}`
}

/** The one sentence of a paused thread, and whether it comes with « ask again ». Null: nothing for the person to do. */
export function useHoldSentence() {
  const t = useT(M)
  return (hold: ThreadHold | undefined): { text: string; again: boolean; write?: boolean } | null => {
    if (!hold) return null
    switch (hold.reason) {
      // Never goes on by itself: the person writes again (the composer below), no other action.
      case 'stopped':
        return { text: t.stopped, again: false, write: true }
      case 'no-machine':
        return { text: t.noMachine(hold.machine), again: false }
      case 'not-signed-in':
        return { text: t.notSignedIn(hold.provider === 'codex' ? 'Codex' : 'Claude', hold.machine), again: false }
      case 'only-there':
        return { text: t.onlyThere(hold.machine), again: false }
      case 'attempts':
        return { text: t.attempts, again: true }
      case 'expired':
        return { text: t.expired, again: true }
      // no-room: the accounts start again by themselves; the state line says when.
      default:
        return null
    }
  }
}

/** A thread, read again whenever the server announces a change. */
function useThread(id: string) {
  const { snap } = useApp()
  const [view, setView] = useState<ThreadView | null>(null)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let off = false
    api
      .thread(id)
      .then((v) => {
        if (off) return
        setView(v)
        setMissing(false)
      })
      .catch(() => !off && setMissing(true))
    return () => {
      off = true
    }
  }, [id, snap.version])
  return { view, missing, setView }
}

/**
 * The conversation of a thread. `session`: the row it collapses into, when one is listed (its project's colour, and the
 * question its engine asks, a permission the person must answer).
 */
export function ThreadPage({ id, session }: { id: string; session?: Session }) {
  const t = useT(M)
  const { snap, now, colors } = useApp()
  const word = useStateWord()
  const sentence = useHoldSentence()
  const { view, missing, setView } = useThread(id)
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState<{ id: string; text: string } | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const messages = useMemo(() => {
    const list = view?.messages ?? []
    // The message on its way shows at once; it leaves when the thread has it.
    return sending && !list.some((m) => m.role === 'user' && m.text === sending.text && m.at >= Date.now() - 600_000) ? [...list, { id: sending.id, role: 'user' as const, text: sending.text, at: Date.now() }] : list
  }, [view, sending])
  const last = messages.at(-1)
  useFollow(body, messages.length > 0, 80, `${messages.length}:${last?.id}:${last?.text.length}:${view?.state}`)
  const project = snap.projects.find((p) => p.id === session?.projectId) ?? snap.projects.find((p) => view?.project && projectSlug(p.name) === view.project)
  const live = session ?? (view?.session ? snap.sessions.find((s) => s.id === view.session) : undefined)

  const send = async (text: string) => {
    const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setErr(null)
    setSending({ id: `pending-${key}`, text })
    try {
      await api.threadSend(id, text, key)
      setView(await api.thread(id).catch(() => view))
    } catch (e) {
      setErr((e as Error).message)
      throw e
    } finally {
      setSending(null)
    }
  }
  // A paused thread's sentence; a thread that waits for the person says it stopped, when it did (06-dispatch.md).
  const hold = view?.state === 'paused' || view?.hold?.reason === 'stopped' ? sentence(view?.hold) : null
  const stateLine = view && (
    <>
      <span aria-hidden>{STATE_CHAR[view.state]}</span> {word(view.state)}
      {view.state === 'paused' && view.hold?.reason === 'no-room' && view.hold.until ? <> · {t.until(clock(view.hold.until, now))}</> : null}
    </>
  )
  return (
    <Shell
      slot={(project && colors[project.id]) ?? 'agent'}
      kicker={project?.name ?? view?.project ?? 'weevbook'}
      title={view?.title || (missing ? t.untitled : '…')}
      scrollHeading
      sessionLayout
      meta={stateLine}
      bodyRef={body}
      foot={
        <>
          <FootError text={err} />
          <Composer draftKey={`thread:${id}`} placeholder={t.write} label={t.composerLabel(view?.title ?? '')} onSend={send} voice />
        </>
      }
    >
      <div className="ask-thread session-thread thread-view" data-thread={id}>
        {view && <Messages session plain messages={messages} author="" working={view.state === 'working'} />}
      </div>
      {hold && (
        <div className="in thread-hold" role="status">
          <span>{hold.text}</span>
          {' '}
          {hold.write ? null : hold.again && view?.hold?.request ? (
            <button className="link" onClick={() => void send(view.hold!.request!).catch(() => undefined)}>
              {t.askAgain}
            </button>
          ) : (
            // Done what the sentence says (the machine is on, the account signed in): the dispatcher looks now.
            <button className="link" onClick={() => void api.threadContinue(id).then(setView).catch((e) => setErr((e as Error).message))}>
              {t.continue}
            </button>
          )}
        </div>
      )}
      {live?.status === 'needs_user' && <SessionQuestion session={live} onError={setErr} />}
    </Shell>
  )
}

/** Threads by project, searched, reread and continued (02-weevbook.md). Reached from a project's page. */
export function WeevbookPage({ projectId }: { projectId?: string }) {
  const t = useT(M)
  const { snap, now, push, colors } = useApp()
  const word = useStateWord()
  const project = projectId ? snap.projects.find((p) => p.id === projectId) : undefined
  const [slug, setSlug] = useState<string | undefined>(project ? projectSlug(project.name) : undefined)
  const [q, setQ] = useState('')
  const [list, setList] = useState<ThreadList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    const timer = setTimeout(() => {
      api
        .threads({ ...(slug ? { project: slug } : {}), ...(q.trim() ? { q: q.trim() } : {}) })
        .then((l) => !off && (setList(l), setErr(null)))
        .catch((e) => !off && setErr((e as Error).message))
    }, q ? 250 : 0)
    return () => {
      off = true
      clearTimeout(timer)
    }
  }, [slug, q, snap.version])
  const name = (p: string) => snap.projects.find((x) => projectSlug(x.name) === p)?.name ?? p
  const open = (l: ThreadLine) => push({ kind: 'thread', id: l.thread })
  return (
    <Shell slot={(projectId && colors[projectId]) || 'agent'} kicker={project?.name ?? 'weevils'} title={t.weevbook} meta={list ? null : t.reading}>
      <div className="in weevbook-search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
      </div>
      {list && list.projects.length > 1 && (
        <div className="in weevbook-projects" role="group">
          <button className="link" aria-pressed={!slug} onClick={() => setSlug(undefined)}>
            {t.allProjects}
          </button>
          {list.projects.map((p) => (
            <span key={p}>
              {' · '}
              <button className="link" aria-pressed={slug === p} onClick={() => setSlug(p)}>
                {name(p)}
              </button>
            </span>
          ))}
        </div>
      )}
      {err && <div className="in meta" role="alert">{err}</div>}
      {list && !list.threads.length && <div className="in meta empty">{q.trim() ? t.noMatch : t.none}</div>}
      {list?.threads.map((l) => (
        <Line key={l.thread} ch={STATE_CHAR[l.state]} meta={[word(l.state), !slug && l.project ? name(l.project) : '', ago(now - l.updated), l.snippet ? `… ${l.snippet} …` : ''].filter(Boolean).join(' · ')} onClick={() => open(l)}>
          {l.title || t.untitled}
        </Line>
      ))}
      <div style={{ height: 96 }} />
    </Shell>
  )
}

/** The way into the weevbook from a project's page, when threads are on. */
export function WeevbookLine({ projectId, name }: { projectId: string; name: string }) {
  const t = useT(M)
  const { snap, push } = useApp()
  if (!threadsOn(snap)) return null
  return (
    <Line ch="≡" label={t.weevbookAria(name)} onClick={() => push({ kind: 'weevbook', projectId })}>
      {t.weevbook}
    </Line>
  )
}
