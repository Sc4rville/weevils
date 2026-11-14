// weevboss's request ledger (server/boss-ledger.ts), as the server keeps it and the app's « requests » page reads it.

export type AskStatus = 'open' | 'dispatched' | 'done' | 'dropped'
export type Outcome = 'done' | 'question' | 'failed' | 'progress'

export interface Dispatch {
  session: string
  /** Project · tool · title of the session when it was sent, for a reader who no longer sees it. */
  label?: string
  at: number
  brief?: string
  expect?: string
  /** What the session said back, judged once per stop. */
  report?: string
  outcome?: Outcome
  reportAt?: number
  /** lastActivityAt of the session when it was last judged (a new stop is judged again). */
  judgedAt?: number
}

export interface Ask {
  /** r12 */
  id: string
  /** The request in one plain sentence, in the app's language. */
  text: string
  /** The user's exact words. */
  quote: string
  /** The message it came from: a journal id (weevils recall) or a capture id. */
  src: string
  /** 'user' or the declared author of an agent message. */
  from: string
  at: number
  kind: 'task' | 'question'
  status: AskStatus
  goal?: string
  dispatches: Dispatch[]
  /** The latest word on it (a report, a note, why it was closed). */
  note?: string
  progressAt: number
  closedAt?: number
  closedBy?: 'user' | 'weevboss' | 'auto'
}

export interface Goal {
  /** A short slug: blow-up, open-source… */
  id: string
  title: string
  why?: string
  status: 'active' | 'done' | 'paused'
  at: number
  progress?: string
  progressAt?: number
}

export type TraceKind = 'request' | 'dispatch' | 'report' | 'decision' | 'status' | 'goal'
export interface TraceEntry {
  at: number
  kind: TraceKind
  text: string
  /** kind status: what the request became (done, dropped, open, dispatched, progress). */
  status?: string
  goal?: string
  asks?: string[]
  session?: string
  who?: string
  why?: string
  expect?: string
  src?: string
}

export type KnowledgeKind = 'rule' | 'decision' | 'fact'
export interface Knowledge {
  /** k12 */
  id: string
  kind: KnowledgeKind
  text: string
  at: number
  updatedAt: number
  /** Messages it came from (recall ids), newest last. */
  src: string[]
  goal?: string
  /** How many times it was stated again. */
  seen: number
}

/** GET /api/boss/ledger */
export interface LedgerView {
  goals: (Goal & { total: number; done: number; open: number; stale: number; sessions: string[] })[]
  asks: (Ask & { stale: boolean })[]
  pending: { cid: string; at: number; text: string; from: string }[]
  trace: TraceEntry[]
  knowledge: Knowledge[]
  digestTokens: number
}
