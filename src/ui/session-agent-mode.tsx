// A session's own permission choice, on its page (server/agent-modes.ts): in its settings, one link the other way from
// what it does now (« Ask me in this session » / « Autonomous in this session »); in its status line, a word only
// while it differs from the global choice (Your factory > Intelligence > Agents), a tap opens its settings. Nothing
// where its machine runs weevils as root (it always asks there).
import { useState } from 'react'
import type { AgentMode, Session, Snapshot } from '../../shared/api.ts'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/agents'
import { useApp } from './app-context'

/** The global choice as this app knows it (absent from an older weevilsd: on their own, the default). */
const globalAsks = (snap: Pick<Snapshot, 'agents'>) => snap.agents?.ask ?? false

/** Whether a session asks before acting now: always as root, else its own choice, else the global one. */
export function sessionAsks(s: Pick<Session, 'agentMode' | 'agentLocked'>, snap: Pick<Snapshot, 'agents'>): boolean {
  if (s.agentLocked) return true
  return s.agentMode ? s.agentMode === 'ask' : globalAsks(snap)
}

/** Its own choice differs from the global one (and is not locked by root): said in its status line. */
export function sessionDiffers(s: Pick<Session, 'agentMode' | 'agentLocked'>, snap: Pick<Snapshot, 'agents'>): boolean {
  return !s.agentLocked && !!s.agentMode && sessionAsks(s, snap) !== globalAsks(snap)
}

/** The mode a tap asks for: the other way; back to the global choice (null) when the other way is the global one. */
export function nextMode(s: Pick<Session, 'agentMode' | 'agentLocked'>, snap: Pick<Snapshot, 'agents'>): AgentMode | null {
  const to = !sessionAsks(s, snap)
  return to === globalAsks(snap) ? null : to ? 'ask' : 'auto'
}

/** In the session's settings: the link that switches it the other way. */
export function SessionAgentMode({ session }: { session: Session }) {
  const t = useT(M)
  const { snap, refresh } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (session.agentLocked || session.offline) return null
  const asks = sessionAsks(session, snap)
  const flip = async () => {
    setBusy(true)
    setErr('')
    try {
      await api.agentMode(session.id, nextMode(session, snap))
      refresh()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <button type="button" className="link session-agent-mode" disabled={busy} onClick={() => void flip()}>{asks ? t.sessionAuto : t.sessionAsk}</button>
    {err && <span role="alert" className="meta"> {err}</span>}
  </>
}

/** In the status line, only while it differs from the global choice: one word, a tap opens its settings. */
export function SessionAgentMark({ session, onOpen }: { session: Session; onOpen: () => void }) {
  const t = useT(M)
  const { snap } = useApp()
  if (!sessionDiffers(session, snap)) return null
  return <> · <button type="button" className="link inline session-agent-mark" aria-label={t.differsAria} onClick={onOpen}>{t.differs(sessionAsks(session, snap))}</button></>
}
