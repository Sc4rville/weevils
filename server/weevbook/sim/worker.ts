// One worker of the pool (pool.ts): runs the seeds it is given and sends back each result's violations and figures.

import { parentPort, workerData } from 'node:worker_threads'
import { simulate } from './simulate.ts'

const { seeds } = workerData as { seeds: number[] }
const out = seeds.map((seed) => {
  const { violations, stats } = simulate(seed)
  return { seed, violations, stats }
})
parentPort!.postMessage(out)
