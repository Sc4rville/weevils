import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import type { Message, Session } from '../state/types'
import { useApp } from './app-context'
import { dur, durLong, status } from './format'

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

export function SessionRow({ session }: { session: Session }) {
  const { push, now } = useApp()
  const st = status[session.status]
  const waiting = session.status === 'needs_user'
  return (
    <button
      className={`row ${waiting ? 'invert' : ''}`}
      onClick={() => push({ kind: 'session', id: session.id })}
      aria-label={`${session.tool}, ${session.title}, ${st.label}, ouverte depuis ${durLong(now - session.openedAt)}`}
    >
      <span className="in" aria-hidden>
        <span className="st">
          <span className={session.status === 'working' ? 'spin' : undefined}>{st.ch}</span>
        </span>
        <span className="dur">{dur(now - session.openedAt)}</span>
        <span className="tool">{session.tool}</span>
        <span className="title">{session.title}</span>
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
}: {
  placeholder: string
  label: string
  onSend: (text: string) => void
  onFocus?: () => void
  prompt?: string
  className?: string
}) {
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    onSend(t)
  }
  return (
    <form className={`composer band ${className}`} onSubmit={submit}>
      <div className="in">
        <span className="prompt" aria-hidden>
          {prompt}
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="on"
        />
        <button className="send" type="submit" disabled={!text.trim()} aria-label="envoyer">
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
          <div className={`msg band ${m.role === 'user' ? 'tone' : ''} ${m.role === 'event' ? 'event' : ''}`}>
            <div className="in">
              <span className="who">{m.role === 'user' ? (m.via ? 'toi · via weevils' : 'toi') : m.role === 'event' ? '* événement' : author}</span>
              <div className="text">{m.text}</div>
            </div>
          </div>
        </Appear>
      ))}
    </AnimatePresence>
  )
}
