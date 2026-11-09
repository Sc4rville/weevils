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
  /** Ce que la session fait en ce moment (dernier bloc), une phrase courte. Écrit par le renommeur. */
  now?: string
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
  /** Machine qui porte chaque repo (fichiers, nouvelle session). */
  where: Record<string, string>
  lastActivityAt: number
}

export interface Machine {
  id: string
  name: string
  note: string
  online?: boolean
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

/** Conversation ChatGPT / Claude.ai importée (sans ses messages). */
export interface ConversationSummary {
  id: string
  source: 'chatgpt' | 'claude'
  title: string
  projectId: string | null
  updatedAt: number
  messageCount: number
  preview: string
  /** new : pas encore vue ; auto : rangée par weevils ; pending : à ranger par toi ; accepted / corrected : ton choix ; none : laissée de côté. */
  status: 'new' | 'auto' | 'pending' | 'accepted' | 'corrected' | 'none'
  suggestedProjectId?: string
  reason?: string
  confidence?: number
}

export interface ConversationDetail {
  conversation: ConversationSummary
  messages: Message[]
}

/** Destination proposée par l'agent principal pour un message : une session ouverte, ou une nouvelle session dans un projet. */
export interface Suggestion {
  id: string
  kind: 'session' | 'new'
  projectId: string
  sessionId?: string
  tool: Tool
  /** Ce qu'on lit sur la puce : « envoyer à » / « nouvelle session », puis le titre. */
  title: string
  detail: string
  score: number
}

export interface MainMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  targetSessionId?: string
  ask?: { text: string; chosenSessionId?: string; suggestions?: Suggestion[] }
}

export interface Snapshot {
  version: number
  now: number
  machines: Machine[]
  projects: Project[]
  sessions: Session[]
  h24: H24Activity[]
  conversations: ConversationSummary[]
  conversationCounts: { total: number; pending: number; byProject: Record<string, number> }
  /** Classement en cours (lots restants), pour l'afficher. */
  classifier: { running: boolean; queued: number; lastError?: string }
  main: MainMessage[]
}

export interface SessionDetail {
  session: Session
  messages: Message[]
}
