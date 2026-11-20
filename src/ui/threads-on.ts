// Whether threads are on (WEEVILS_THREADS), for the components that hide the relay or show a thread: kept apart from
// threads.tsx so that bits.tsx and relay.tsx can ask without importing the pages.
import type { Snapshot } from '../../shared/api.ts'

/** Threads are on: the server says so in its config. */
export const threadsOn = (snap: Snapshot) => !!snap.config?.threads

/** The thread a session row carries, when threads are on. */
export const threadOf = (snap: Snapshot, sessionId: string) => (threadsOn(snap) ? snap.sessions.find((s) => s.id === sessionId)?.thread : undefined)

/** The weevbook's name for a project (its slug, as the server writes it in meta.json). */
export const projectSlug = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '')
