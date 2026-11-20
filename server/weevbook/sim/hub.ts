// The hub of the simulator: refs and commits in memory, with the two guarantees the lease protocol relies on, as a
// bare repository gives them (docs/spec/03-sync-and-lease.md): a push is atomic (every ref or none), and each ref
// update can require the ref's current value (`--force-with-lease`) or a fast-forward. Every accepted push is logged
// for the invariant checks.

import type { JournalEvent } from '../journal.ts'
import type { Lease } from '../lease.ts'

export interface ThreadCommit {
  kind: 'thread'
  id: string
  parent: string | null
  /** The whole journal at this commit (events.jsonl). */
  journal: readonly JournalEvent[]
  depth: number
}
export interface LeaseCommit {
  kind: 'lease'
  id: string
  lease: Lease
}
export type Commit = ThreadCommit | LeaseCommit

export interface Update {
  ref: string
  /** The new value; null deletes the ref. */
  to: string | null
  /** Required current value (null: must not exist); undefined: no check. */
  expect?: string | null
  /** The new value must have the current one as ancestor (refs/threads, refs/orphans are never forced). */
  ff?: boolean
}
export interface Pushed {
  t: number
  by: string
  updates: { ref: string; from: string | null; to: string | null }[]
}

export class Hub {
  readonly refs = new Map<string, string>()
  readonly commits = new Map<string, Commit>()
  readonly log: Pushed[] = []
  /** refs/orphans/<thread>/…, by thread: a machine's fetch of one thread reads only these. */
  private readonly orphanRefs = new Map<string, Map<string, string>>()
  private n = 0

  /** Stores a thread commit (as a machine's `commit-tree` would, before any push). */
  threadCommit(parent: string | null, journal: readonly JournalEvent[]): string {
    const id = `t${++this.n}`
    const depth = parent ? (this.commits.get(parent) as ThreadCommit).depth + 1 : 0
    this.commits.set(id, { kind: 'thread', id, parent, journal, depth })
    return id
  }
  leaseCommit(lease: Lease): string {
    const id = `l${++this.n}`
    this.commits.set(id, { kind: 'lease', id, lease })
    return id
  }
  thread(id: string): ThreadCommit {
    return this.commits.get(id) as ThreadCommit
  }
  lease(id: string): Lease {
    return (this.commits.get(id) as LeaseCommit).lease
  }

  /** The orphan refs of one thread, with their commits. */
  orphans(thread: string): { ref: string; commit: string }[] {
    return [...(this.orphanRefs.get(thread) ?? [])].map(([ref, commit]) => ({ ref, commit }))
  }

  /** `a` is `b` or one of its ancestors. */
  ancestor(a: string, b: string): boolean {
    const ca = this.thread(a)
    let c: ThreadCommit | undefined = this.thread(b)
    while (c && c.depth > ca.depth) c = c.parent ? this.thread(c.parent) : undefined
    return c?.id === a
  }

  /** One atomic push. Returns the refs whose own condition failed; none applied unless all pass. */
  push(by: string, updates: readonly Update[], t: number): { ok: true } | { ok: false; culprits: string[] } {
    const culprits: string[] = []
    for (const u of updates) {
      const cur = this.refs.get(u.ref) ?? null
      if (u.expect !== undefined && cur !== u.expect) culprits.push(u.ref)
      else if (u.ff && cur && u.to && !this.ancestor(cur, u.to)) culprits.push(u.ref)
    }
    if (culprits.length) return { ok: false, culprits }
    const applied: Pushed['updates'] = []
    for (const u of updates) {
      const from = this.refs.get(u.ref) ?? null
      if (from === u.to) continue
      if (u.to === null) this.refs.delete(u.ref)
      else this.refs.set(u.ref, u.to)
      if (u.ref.startsWith('refs/orphans/')) {
        const thread = u.ref.split('/')[2]
        const m = this.orphanRefs.get(thread) ?? new Map<string, string>()
        if (u.to === null) m.delete(u.ref)
        else m.set(u.ref, u.to)
        this.orphanRefs.set(thread, m)
      }
      applied.push({ ref: u.ref, from, to: u.to })
    }
    if (applied.length) this.log.push({ t, by, updates: applied })
    return { ok: true }
  }
}
