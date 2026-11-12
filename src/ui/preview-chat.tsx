import { useEffect, useId, useRef, useState } from 'react'
import type { Session, SessionDetail } from '../../shared/api'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/preview'
import { Composer, Messages } from './bits'
import { OutboxStatus } from './outbox-status'
import './preview-chat.css'

/** Only an explicitly selected, visible URL can accompany feedback. Never send credentials,
 * query/hash secrets, or the private static-site capability embedded in its path. */
export function previewContextUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (!['https:', 'http:'].includes(u.protocol) || u.pathname.startsWith('/api/site/')) return ''
    return `${u.origin}${u.pathname}`
  } catch { return '' }
}

export function PreviewChat({ sessions, project, frame, url }: {
  sessions: Session[]; project: string; frame: React.RefObject<HTMLIFrameElement | null>; url: string
}) {
  const t = useT(M)
  const region = useId()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState(() => sessions.length === 1 ? sessions[0].id : '')
  // With several sessions, require a deliberate choice; never retarget an existing draft automatically.
  const target = chosen
  const session = sessions.find(s => s.id === target)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = panel.current
    const stop = (e: PointerEvent) => e.stopPropagation()
    el?.addEventListener('pointerdown', stop)
    return () => el?.removeEventListener('pointerdown', stop)
  }, [])
  return <section ref={panel} className="preview-chat">
    <button className="link preview-chat-toggle" aria-expanded={open} aria-controls={region} onClick={() => setOpen(v => !v)}>{t.feedback}{session ? ` · ${session.title}` : ` · ${project}`}</button>
    <div id={region} hidden={!open}>
      {(sessions.length !== 1 || !session) && <label className="preview-chat-target">{t.target}<select value={chosen} onChange={e => setChosen(e.target.value)}><option value="">{t.chooseSession}</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      {!sessions.length && <p className="in meta">{t.noSession}</p>}
      {session && <Feedback key={session.id} session={session} project={project} active={open} frame={frame} url={url}/>}
    </div>
  </section>
}

function Feedback({ session, project, active, frame, url }: {
  session: Session; project: string; active: boolean; frame: React.RefObject<HTMLIFrameElement | null>; url: string
}) {
  const t = useT(M)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [readError, setReadError] = useState('')
  const [context, setContext] = useState('')
  const lastContext = useRef('')
  const [current, setCurrent] = useState(false)
  const [include, setInclude] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const transcript = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  // Retrying the same draft keeps its original body and destination even after browsing elsewhere.
  const retryKey = `weevils-preview-retry:${session.id}`
  const retry = useRef<{ text: string; body: string } | null>(null)
  useEffect(() => {
    try { retry.current = JSON.parse(sessionStorage.getItem(retryKey) ?? 'null') } catch { /* unavailable storage */ }
  }, [retryKey])
  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const value = await api.session(session.id)
        if (!cancelled) { setDetail(value); setReadError('') }
      } catch (e) { if (!cancelled) setReadError((e as Error).message) }
      if (!cancelled) timer = setTimeout(() => void refresh(), 3000)
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [session.id, active, t])
  useEffect(() => {
    if (active && following.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight
  }, [detail, active])
  useEffect(() => {
    if (!accepted) return
    const timer = setTimeout(() => setAccepted(false), 3500)
    return () => clearTimeout(timer)
  }, [accepted])
  useEffect(() => {
    if (!active) return
    const update = () => {
      let raw = url, readable = false
      try { const actual = frame.current?.contentWindow?.location.href; if (actual && actual !== 'about:blank') { raw = actual; readable = true } } catch { /* Cross-origin pages remain opaque. */ }
      const next = previewContextUrl(raw)
      if (lastContext.current !== next) setInclude(false)
      lastContext.current = next
      setContext(next)
      setCurrent(readable)
    }
    update()
    const timer = setInterval(update, 750)
    return () => clearInterval(timer)
  }, [active, url, frame])
  const send = async (text: string) => {
    const body = retry.current?.text === text ? retry.current.body : `${text}${include && context ? `\n\n${t.pageContext}: ${context}` : ''}`
    retry.current = { text, body }
    try { sessionStorage.setItem(retryKey, JSON.stringify(retry.current)) } catch { /* outbox still owns delivery */ }
    await api.send(session.id, body)
    retry.current = null
    try { sessionStorage.removeItem(retryKey) } catch { /* unavailable storage */ }
    setAccepted(true)
  }
  return <>
    <div className="preview-chat-target meta">{project} · {session.title}</div>
    <div ref={transcript} className="preview-chat-messages session-thread" onScroll={e => { const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64 }}>
      {detail && <Messages session messages={detail.messages} author={session.tool} />}
      {readError && <p role="status">{readError}</p>}
    </div>
    {context && <label className="preview-chat-context meta"><input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} /><span>{current ? t.includeCurrent : t.includeOpened}<span className="preview-chat-url">{context}</span></span></label>}
    <OutboxStatus scope={`/api/sessions/${encodeURIComponent(session.id)}/`} />
    {accepted && <div className="in meta" role="status">{t.accepted}</div>}
    <Composer draftKey={`preview:${session.id}`} placeholder={t.writeFeedback} label={t.feedback} onSend={send} disabled={!(detail?.session ?? session).controllable} sayErrors />
  </>
}
