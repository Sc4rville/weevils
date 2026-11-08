import { createContext, useContext, type Dispatch } from 'react'
import type { Action } from '../state/store'
import type { State, Tool } from '../state/types'

export type Page =
  | { kind: 'session'; id: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'conversations'; projectId: string }
  | { kind: 'files'; projectId: string }
  | { kind: 'file'; projectId: string; path: string }
  | { kind: 'machine'; projectId: string }
  | { kind: 'new'; projectId: string }

export interface AppCtx {
  state: State
  dispatch: Dispatch<Action>
  now: number
  push: (page: Page) => void
  replace: (page: Page) => void
  back: () => void
  expanded: string | null
  setExpanded: (id: string | null) => void
  h24Open: boolean
  setH24Open: (open: boolean) => void
  act: {
    sendToSession: (sessionId: string, text: string) => void
    sendToConversation: (conversationId: string, text: string) => void
    sendMain: (text: string) => void
    chooseMain: (mainMsgId: string, sessionId: string) => void
    createSession: (projectId: string, tool: Tool, title: string, text: string) => string
    fireTerminal: () => void
    reset: () => void
  }
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp hors du fournisseur')
  return v
}
