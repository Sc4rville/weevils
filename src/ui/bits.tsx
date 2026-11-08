import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { Message, Session } from '../../shared/api.ts'
import { useApp } from './app-context'
import { dur, status } from './format'

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
  return <span className={s === 'working' ? 'spin' : undefined}>{status[s].ch}</span>
}

export function SessionRow({ session }: { session: Session }) {
  const { push, now } = useApp()
  const st = status[session.status]
  const waiting = session.status === 'needs_user'
  const ref = session.status === 'working' && session.workStartedAt ? session.workStartedAt : session.lastActivityAt
  return (
    <button
      className={`row ${waiting ? 'invert' : ''}`}
      onClick={() => push({ kind: 'session', id: session.id })}
      aria-label={`${session.tool}, ${session.title}, ${st.label}${waiting && session.attention ? ` : ${session.attention}` : ''}`}
    >
      <span className="in" aria-hidden>
        <span className="st">
          <StatusChar s={session.status} />
        </span>
        <span className="dur">{dur(now - (session.status === 'done' ? session.lastActivityAt : ref))}</span>
        <span className="tool">{session.tool}</span>
        <span className="stack-text">
          <span className="title">{session.title}</span>
          {waiting && session.attention && <span className="meta ellipsis">{session.attention}</span>}
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

export function Messages({ messages, author }: { messages: Message[]; author: string }) {
  return (
    <AnimatePresence initial={false}>
      {messages.map((m) => (
        <Appear key={m.id}>
          {m.role === 'event' ? (
            <div className="msg band event">
              <div className="in">
                <div className="text">→ {m.text}</div>
              </div>
            </div>
          ) : (
            <div className={`msg band ${m.role === 'user' ? 'tone' : ''}`}>
              <div className="in">
                <span className="who">{m.role === 'user' ? 'toi' : author}</span>
                <div className="text">{m.text}</div>
              </div>
            </div>
          )}
        </Appear>
      ))}
    </AnimatePresence>
  )
}
