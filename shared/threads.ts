// What the app reads about weevbook threads (docs/spec, step 4, behind WEEVILS_THREADS). A thread is one
// conversation, whatever engines carried it: nothing here names an engine, a leg, a provider or a machine, except the
// one fact a held turn needs for the person to act.

import type { Message } from './api.ts'

/** The only three states the app shows (docs/spec/02-weevbook.md, meta.json `state`). */
export type ThreadState = 'working' | 'waiting' | 'paused'

/**
 * Why a thread is paused, when the person must act (docs/spec/06-dispatch.md, « When nothing matches »). The app
 * turns it into one sentence and one action. `stopped` comes with a thread that waits for the person: a turn that
 * will never go on by itself (06-dispatch.md, « Activation »); one line says so, writing again continues.
 */
export interface ThreadHold {
  reason: 'no-machine' | 'no-room' | 'not-signed-in' | 'only-there' | 'attempts' | 'expired' | 'stopped' | string
  /** no-room: when the first account starts again (ms). */
  until?: number | null
  /** not-signed-in, only-there: the machine's name; no-machine: the machines that have the project. */
  machine?: string
  /** not-signed-in: Claude or Codex. */
  provider?: 'claude' | 'codex'
  /** attempts, expired: the request to give again. */
  request?: string
}

/** One thread in the weevbook page's list. */
export interface ThreadLine {
  thread: string
  title: string
  project: string | null
  /** The last event (ms). */
  updated: number
  state: ThreadState
  /** Search: where the words were found, a few words around them. */
  snippet?: string
}

/** A thread, reread in the app: its messages in the app's own shape, its state, and the session to show it with. */
export interface ThreadView {
  thread: string
  title: string
  project: string | null
  updated: number
  state: ThreadState
  hold?: ThreadHold
  messages: Message[]
  /** The provider session of the open leg on this install, when there is one (the row it collapses into). */
  session?: string
}

export interface ThreadList {
  threads: ThreadLine[]
  /** Projects with at least one thread, by name. */
  projects: string[]
}
