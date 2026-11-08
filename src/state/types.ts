// Modèle de données du prototype. Pensé pour être remplacé par le vrai backend sans toucher l'UI :
// horodatages absolus, identifiants stables, compteurs toujours dérivés (jamais stockés).

export type Theme = 'light' | 'dark'
export type Tool = 'claude' | 'codex'
export type Source = 'chatgpt' | 'claude'
export type Role = 'user' | 'assistant' | 'event'
export type SessionStatus = 'working' | 'needs_user' | 'idle' | 'done'
export type H24RunState = 'running' | 'waiting' | 'paused'

export interface Message {
  id: string
  role: Role
  text: string
  at: number
  via?: 'weevils'
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
  machineId: string
  tool: Tool
  title: string
  status: SessionStatus
  origin: string
  openedAt: number
  /** Début du travail en cours ; null quand la session ne travaille pas. */
  workStartedAt: number | null
  messages: Message[]
  subagents: Subagent[]
}

export interface Project {
  id: string
  name: string
  /** Emplacement de palette (variable CSS --<color>). */
  color: string
  /** 'invented' : catégorie créée par weevils pour des éléments sans repo. */
  kind: 'repo' | 'invented'
  repo: { label: string; files: { path: string; content: string }[] } | null
}

export interface Machine {
  id: string
  name: string
  note: string
}

export interface Choice {
  id: string
  label: string
  eventMessage: string
}

export interface Intervention {
  id: string
  projectId: string
  sessionId: string
  title: string
  description: string
  choices: Choice[]
  status: 'pending' | 'resolved'
  resolvedChoiceId?: string
}

export interface Conversation {
  id: string
  source: Source
  title: string
  projectId: string | null
  updatedAt: number
  suggestedProjectId?: string
  suggestionReason?: string
  /** pending : à ranger ; accepted / corrected : rangée (la correction reste possible). */
  suggestion?: 'pending' | 'accepted' | 'corrected'
  messages: Message[]
}

export interface H24Activity {
  id: string
  projectId: string
  title: string
  schedule: string
  /** Le service est activé (planifié en permanence). */
  enabled: boolean
  /** Ce qu'il fait à l'instant. */
  runState: H24RunState
  runStartedAt: number | null
  lastEvent: string
  /** État mémorisé avant la pause, restauré à la reprise. */
  beforePause?: { enabled: boolean; runState: H24RunState; runStartedAt: number | null }
}

export interface MainMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  /** Session vers laquelle l'instruction est partie (lien « ouvrir »). */
  targetSessionId?: string
  /** Commande non comprise : on propose les destinations, une seule fois. */
  ask?: { text: string; chosenSessionId?: string }
}

export interface State {
  version: 1
  theme: Theme
  machines: Machine[]
  projects: Project[]
  sessions: Session[]
  interventions: Intervention[]
  conversations: Conversation[]
  h24: H24Activity[]
  main: MainMessage[]
  /** Événements de démo déjà déclenchés (dédoublonnage jusqu'à la remise à zéro). */
  firedEvents: string[]
}
