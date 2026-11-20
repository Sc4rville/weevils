// `weevils weevbook check`: every thread of the weevbook against the invariants of docs/spec/01-thread.md (THREAD-n,
// validateJournal) and 02-weevbook.md (BOOK-n, validateFolder), plus what step 1 adds: each thread's ref holds its
// folder as it is on disk, and `main` lists every thread at its ref or an ancestor of it (SYNC-8).

import fsp from 'node:fs/promises'
import path from 'node:path'
import { parseJournal, validateFolder, validateJournal, type Violation } from './journal.ts'
import { Locked, Weevbook, walk } from './store.ts'

export interface CheckReport {
  threads: number
  events: number
  /** Broken invariants by number, and the first few of each with their thread. */
  byInvariant: Record<string, number>
  examples: { thread: string; violation: Violation }[]
  repaired: number
}

export async function check(dir: string, machine: string, o: { repair?: boolean; examples?: number } = {}): Promise<CheckReport> {
  const book = await Weevbook.open(dir, machine)
  if (!(await book.lockWait())) throw new Locked('weevbook.lock')
  const report: CheckReport = { threads: 0, events: 0, byInvariant: {}, examples: [], repaired: 0 }
  const add = (thread: string, v: Violation) => {
    report.byInvariant[v.invariant] = (report.byInvariant[v.invariant] ?? 0) + 1
    if (report.examples.length < (o.examples ?? 20)) report.examples.push({ thread, violation: v })
  }
  let wrote = false
  try {
    const index = await book.mainIndex()
    const listed = new Map((index ?? []).map((t) => [t.thread, t]))
    for (const { id, path: rel } of book.threads()) {
      report.threads++
      // thread.md and meta.json are rebuilt from the journal, never trusted (02-weevbook.md, failure cases).
      if (o.repair && (await book.rebuild(id))) {
        report.repaired++
        wrote = true
        await book.commitThread(id, `repair · ${machine}`) // i18n-ignore: commit subject
      }
      const dirAbs = book.abs(rel)
      const files: Record<string, Uint8Array> = {}
      for (const f of await walk(dirAbs)) files[f.split(path.sep).join('/')] = await fsp.readFile(path.join(dirAbs, f))
      const { events } = parseJournal(Buffer.from(files['events.jsonl'] ?? new Uint8Array()).toString('utf8'))
      report.events += events.length
      for (const v of validateJournal(events)) add(id, v)
      for (const v of validateFolder({ path: rel, files })) add(id, v)
      // Step 1: the ref holds the folder, or an earlier state of it (a running turn is committed at its end): its
      // journal is the start of the folder's.
      const ref = await book.threadRef(id)
      const journal = Buffer.from(files['events.jsonl'] ?? new Uint8Array())
      if (!ref) add(id, { invariant: 'REF', info: `no refs/threads/${id}` })
      else if ((await book.folderTree(id)) !== (await book.treeOf(ref))) {
        const committed = await book.blob(`${ref}:events.jsonl`)
        if (!committed || !journal.subarray(0, committed.length).equals(committed)) add(id, { invariant: 'REF', info: 'the journal of refs/threads is not the start of the folder\'s' })
      }
      // SYNC-8: main lists the thread at its ref or an ancestor of it.
      const entry = listed.get(id)
      if (!entry) add(id, { invariant: 'SYNC-8', info: 'not in index.json of main' })
      else if (ref && !(await book.isAncestor(entry.commit, ref))) add(id, { invariant: 'SYNC-8', info: 'index.json names a commit that is not on its ref' })
    }
    if (wrote) await book.compose()
  } finally {
    await book.unlock(wrote)
  }
  return report
}
