import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { Message, Session } from '../../shared/api.ts'
import { useApp } from './app-context'
import { dur, plain, segments, status, step, userText } from './format'

/** Ressort commun : léger dépassement, pour que les bandes aient de l'inertie. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }

/** Dépliage en hauteur : ce qui est en dessous est poussé en douceur. */
export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c"
          id={id}
          className="clip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Apparition d'un élément ajouté à une liste (nouvelle session, nouveau message). */
export function Appear({ children }: { children: ReactNode }) {
  return (
    <motion.div className="clip" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
      {children}
    </motion.div>
  )
}

export function StatusChar({ s }: { s: Session['status'] }) {
  return <span className={s === 'working' ? 'spin fluo' : undefined}>{status[s].ch}</span>
}

/** Barre fine qui balaie en vert fluo : l'agent travaille, là, maintenant. */
export function Pulse({ on }: { on: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {on && <motion.div key="p" className="pulse" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />}
    </AnimatePresence>
  )
}

/** Long message de Scarville : replié au-delà de quelques lignes, un geste pour tout lire. */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420
  return (
    <>
      <div className={`text ${long && !open ? 'clamp' : ''}`}>{text}</div>
      {long && (
        <button className="link small" onClick={() => setOpen((v) => !v)}>
          {open ? '− replier' : '+ tout lire'}
        </button>
      )}
    </>
  )
}

export function SessionRow({ session }: { session: Session }) {
  const { push, now } = useApp()
  const st = status[session.status]
  const waiting = session.status === 'needs_user'
  const ref = session.status === 'working' && session.workStartedAt ? session.workStartedAt : session.lastActivityAt
  // Sous le titre : la question qui t'attend, sinon ce que la session fait en ce moment.
  const sub = waiting && session.attention ? session.attention : session.now
  return (
    <button
      className={`row ${waiting ? 'tone' : ''} ${session.status === 'working' ? 'live' : ''}`}
      onClick={() => push({ kind: 'session', id: session.id })}
      aria-label={`${session.tool}, ${session.title}, ${st.label}${sub ? ` : ${sub}` : ''}`}
    >
      <span className="in" aria-hidden>
        <span className="st">
          <StatusChar s={session.status} />
        </span>
        <span className="dur">{dur(now - (session.status === 'done' ? session.lastActivityAt : ref))}</span>
        <span className="tool">
          {session.tool}
          {session.machineId !== 'vps' && <span className="tag">@{session.machineId}</span>}
        </span>
        <span className="stack-text">
          <span className="title">{session.title}</span>
          {sub && <span className="meta ellipsis">{sub}</span>}
        </span>
      </span>
    </button>
  )
}

/** Ligne pleine largeur : un caractère-icône, un texte, une flèche. */
export function Line({
  ch,
  children,
  meta,
  onClick,
  className = '',
  label,
  disabled,
  go = '→',
}: {
  ch?: ReactNode
  children: ReactNode
  meta?: ReactNode
  onClick?: () => void
  className?: string
  label?: string
  disabled?: boolean
  go?: string | null
}) {
  return (
    <button className={`row ${className}`} onClick={onClick} aria-label={label} disabled={disabled}>
      <span className="in">
        {ch != null && (
          <span className="st" aria-hidden>
            {ch}
          </span>
        )}
        <span className="stack-text">
          <span className="ellipsis">{children}</span>
          {meta && <span className="meta ellipsis">{meta}</span>}
        </span>
        {go && !disabled && (
          <span className="go" aria-hidden>
            {go}
          </span>
        )}
      </span>
    </button>
  )
}

export function Composer({
  placeholder,
  label,
  onSend,
  onFocus,
  prompt = '>',
  className = 'tone',
  disabled,
}: {
  placeholder: string
  label: string
  onSend: (text: string) => void | Promise<void>
  onFocus?: () => void
  prompt?: string
  className?: string
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    try {
      await onSend(t)
    } catch {
      setText(t) // on rend le texte en cas d'échec, rien n'est perdu
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={`composer band ${className}`} onSubmit={submit}>
      <div className="in">
        <span className="prompt" aria-hidden>
          {busy ? <span className="spin">*</span> : prompt}
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="send"
          autoComplete="off"
          disabled={disabled}
        />
        <button className="send" type="submit" disabled={!text.trim() || busy || disabled} aria-label="envoyer">
          ↑
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Le fil : la vraie conversation, simplifiée. Toi, l'agent, et ce qu'il fait entre deux réponses.

/** Prose d'agent sans markdown ; les blocs de code sont repliés derrière « code · n lignes ». */
export function Prose({ text }: { text: string }) {
  const parts = useMemo(() => segments(text), [text])
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <div key={i} className="text">
            {plain(p.body)}
          </div>
        ) : (
          <Snippet key={i} code={p.body} />
        ),
      )}
    </>
  )
}

function Snippet({ code }: { code: string }) {
  const [open, setOpen] = useState(false)
  const n = code.split('\n').length
  return (
    <div className="snippet">
      <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? '−' : '+'} code · {n} {n > 1 ? 'lignes' : 'ligne'}
      </button>
      <Collapse open={open}>
        <pre className="code mono small">{code}</pre>
      </Collapse>
    </div>
  )
}

type Group = { kind: 'msg'; m: Message } | { kind: 'steps'; id: string; steps: Message[] }

/** Les actions consécutives de l'agent (lire, modifier, lancer…) forment un seul bloc replié. */
function group(messages: Message[]): Group[] {
  const out: Group[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (m.role === 'event') {
      if (last?.kind === 'steps') last.steps.push(m)
      else out.push({ kind: 'steps', id: m.id, steps: [m] })
    } else out.push({ kind: 'msg', m })
  }
  return out
}

function Steps({ steps, live }: { steps: Message[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  const last = step(steps[steps.length - 1].text)
  if (steps.length === 1) {
    return (
      <div className="msg band event">
        <div className="in">
          <div className="text">→ {last}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="msg band event">
      <button className="in steps-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text">
          {live ? <span className="spin fluo">*</span> : '→'} {steps.length} étapes · <span key={last} className="fade-in">{last}</span>
        </span>
        <span className="go" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      <Collapse open={open}>
        <div className="in steps-list">
          {steps.map((s) => (
            <div key={s.id} className="text">
              → {step(s.text)}
            </div>
          ))}
        </div>
      </Collapse>
    </div>
  )
}

const WINDOW = 60

export function Messages({ messages, author, working = false }: { messages: Message[]; author: string; working?: boolean }) {
  const [all, setAll] = useState(false)
  const hidden = all ? 0 : Math.max(0, messages.length - WINDOW)
  const groups = useMemo(() => group(messages.slice(hidden)), [messages, hidden])
  return (
    <AnimatePresence initial={false}>
      {hidden > 0 && (
        <Line key="older" ch="↑" go={null} onClick={() => setAll(true)}>
          <span className="meta">{hidden} messages plus anciens</span>
        </Line>
      )}
      {groups.map((g, i) =>
        g.kind === 'steps' ? (
          <Appear key={g.id}>
            <Steps steps={g.steps} live={working && i === groups.length - 1} />
          </Appear>
        ) : (
          <Appear key={g.m.id}>
            <div className={`msg band ${g.m.role === 'user' ? 'tone' : ''}`}>
              <div className="in">
                <span className="who">{g.m.role === 'user' ? 'toi' : author}</span>
                {g.m.role === 'user' ? <Clamp text={userText(g.m.text)} /> : <Prose text={g.m.text} />}
              </div>
            </div>
          </Appear>
        ),
      )}
    </AnimatePresence>
  )
}

/** L'agent travaille : une ligne vivante en bas du fil. */
export function Working({ author, since }: { author: string; since?: number | null }) {
  const { now } = useApp()
  return (
    <motion.div className="msg band working" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring}>
      <div className="in">
        <span className="who">
          <span className="spin fluo">*</span> {author} travaille{since ? ` · ${dur(now - since)}` : ''}
          <span className="dots" aria-hidden>
            <i>·</i>
            <i>·</i>
            <i>·</i>
          </span>
        </span>
      </div>
    </motion.div>
  )
}
