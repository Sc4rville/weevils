// A thread fetched again each time the snapshot moves (pages.tsx SessionPage, calm.tsx, next's useSession): one fetch
// at a time, and once more when it returns if anything moved meanwhile; every answer that comes back is shown.
// Before (2026-11-26), each move started a new fetch and threw away the answer of the one before: on a busy weevils
// the snapshot moved faster than a thread came back (about a second), the fetches piled up behind each other, no
// answer was ever kept, and a conversation opened on its title alone, its history never shown.
import { useEffect, useRef } from 'react'

type Run = { key: string; running: boolean; again: boolean }

/** Follows one thing (key: a session's id) whenever `moved` changes: load() runs alone, its answer goes to take(),
 *  a failure to fail(); a move during a run asks for exactly one more run after it. A new key starts afresh and
 *  ignores the answers still on their way for the old one. */
export function useFollowFetch<T>(key: string, moved: unknown, load: () => Promise<T>, take: (d: T) => void, fail?: (e: Error) => void, enabled = true) {
  const run = useRef<Run>({ key, running: false, again: false })
  const latest = useRef({ load, take, fail })
  latest.current = { load, take, fail }
  useEffect(() => () => { run.current = { key: '', running: false, again: false } }, [])
  useEffect(() => {
    if (!enabled) return
    if (run.current.key !== key) run.current = { key, running: false, again: false }
    const box = run.current
    const go = () => {
      box.running = true
      latest.current
        .load()
        .then((d) => { if (run.current === box) latest.current.take(d) }, (e: Error) => { if (run.current === box) latest.current.fail?.(e) })
        .finally(() => {
          box.running = false
          if (box.again && run.current === box) { box.again = false; go() }
        })
    }
    if (box.running) box.again = true
    else go()
  }, [key, moved, enabled])
}
