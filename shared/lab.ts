// The onboarding lab's state, as the app reads it (server/lab.ts, next/src/lab.tsx).
export type LabStatus = 'waiting' | 'working' | 'done' | 'failed' | 'undone'

export interface LabItem {
  id: string
  at: number
  text: string
  status: LabStatus
  /** What changed, one plain sentence by the agent (or why nothing did). */
  change?: string
}

export interface LabState {
  on: boolean
  items: LabItem[]
  /** « keep »: the changes tested and landed on main, or why not. */
  keep?: { status: 'testing' | 'landed' | 'failed'; why?: string; at: number }
  /** When the host last put the instance back to blank (« start over »): the app reloads. */
  reset?: number
}
