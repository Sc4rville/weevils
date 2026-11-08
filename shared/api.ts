// Contrat entre weevilsd (VPS) et l'app. Horodatages en millisecondes, compteurs toujours dérivés côté app.

export type Tool = 'claude' | 'codex'
export type SessionStatus = 'working' | 'needs_user' | 'idle' | 'done'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'event'
  text: string
  at: number
}

export interface Subagent {
  id: string
  label: string
  activity: string
  status: 'working' | 'done'
  startedAt: number
  endedAt?: number
}

export interface Session {
  id: string
  projectId: string
  repo: string | null
  machineId: string
  tool: Tool
  title: string
  status: SessionStatus
  /** Ce qui t'attend (permission, question), quand status = needs_user. */
  attention?: string
  cwd: string
  branch?: string
  openedAt: number
  lastActivityAt: number
  /** Début du travail en cours ; null quand la session ne travaille pas. */
  workStartedAt: number | null
  /** weevils (lancée depuis l'app), terminal, headless… */
  origin: string
  /** weevils peut lui écrire (pane zellij pilotée, ou reprise headless possible). */
  controllable: boolean
  /** Un processus tourne encore. */
  live: boolean
  /** weevils voit son écran (pane zellij pilotée). */
  hasScreen: boolean
  subagents: Subagent[]
  lastMessage?: string
  messageCount: number
}

export interface Project {
  id: string
  name: string
  /** 'repo' : famille de repos de ~/projects ; 'invented' : catégorie créée par weevils. */
  kind: 'repo' | 'invented'
  repos: string[]
  lastActivityAt: number
}

export interface Machine {
  id: string
  name: string
  note: string
}

export interface H24Activity {
  id: string
  title: string
  kind: 'timer' | 'job'
  projectId: string | null
  schedule: string
  enabled: boolean
  runState: 'running' | 'waiting' | 'paused'
  runStartedAt: number | null
  lastEvent: string
  canToggle: boolean
}

export interface Conversation {
  id: string
  source: 'chatgpt' | 'claude'
  title: string
  projectId: string | null
  updatedAt: number
  suggestedProjectId?: string
  suggestionReason?: string
  suggestion?: 'pending' | 'accepted' | 'corrected'
  messages: Message[]
}

export interface MainMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  targetSessionId?: string
  ask?: { text: string; chosenSessionId?: string }
}

export interface Snapshot {
  version: number
  now: number
  machines: Machine[]
  projects: Project[]
  sessions: Session[]
  h24: H24Activity[]
  conversations: Conversation[]
  main: MainMessage[]
}

export interface SessionDetail {
  session: Session
  messages: Message[]
}
