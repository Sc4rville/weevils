// Many seeds at once, spread over worker threads: the same results as one by one, in seed order, faster.

import os from 'node:os'
import { Worker } from 'node:worker_threads'
import type { Stats, Violation } from './check.ts'

export interface SeedResult {
  seed: number
  violations: Violation[]
  stats: Stats
}

/** Runs seeds `from` to `from + count - 1` on `workers` threads (by default, the cores less one, at most 8). */
export async function runSeeds(from: number, count: number, workers = Math.max(1, Math.min(8, os.availableParallelism() - 1))): Promise<SeedResult[]> {
  const chunks: number[][] = Array.from({ length: Math.min(workers, count) }, () => [])
  for (let i = 0; i < count; i++) chunks[i % chunks.length].push(from + i)
  const parts = await Promise.all(
    chunks.map(
      (seeds) =>
        new Promise<SeedResult[]>((resolve, reject) => {
          const w = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { seeds } })
          w.once('message', resolve)
          w.once('error', reject)
          w.once('exit', (code) => code !== 0 && reject(new Error(`simulator worker exited with ${code}`)))  // i18n-ignore
        }),
    ),
  )
  return parts.flat().sort((a, b) => a.seed - b.seed)
}
