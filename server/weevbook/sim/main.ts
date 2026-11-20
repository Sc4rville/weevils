// npm run sim -- --seeds 20000          many random runs, then a summary
// npm run sim -- --seeds 500 --from 7000 the seeds 7000 to 7499
// npm run sim -- --seed 4242 --trace     one run, step by step, with its violations
// npm run sim -- --reference --trace     the reference scenario of docs/spec/06-dispatch.md
// npm run sim -- --seeds 2000 --workers 1 on one thread (by default: the cores less one, at most 8)
//
// Exit code 1 when any run breaks an invariant. Every failing seed is printed: run it again with --seed.

import { runSeeds } from './pool.ts'
import { simulate, simulateReference, summarize, type Result } from './simulate.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}

function one(r: Result, trace: boolean) {
  if (trace) for (const line of r.world.trace ?? []) console.log(line)
  console.log(`${r.scenario.name}: ${r.violations.length ? `${r.violations.length} violation(s)` : 'ok'}; ${JSON.stringify(r.stats)}`)
  for (const v of r.violations) console.log(`  ${v.invariant}: ${v.info}`)
  process.exitCode = r.violations.length ? 1 : 0
}

if (flag('reference')) one(simulateReference({ trace: flag('trace') }), flag('trace'))
else if (args.includes('--seed')) one(simulate(num('seed', 1), { trace: flag('trace') }), flag('trace'))
else {
  const seeds = num('seeds', 2000)
  const from = num('from', 1)
  const started = Date.now()
  const results = await runSeeds(from, seeds, args.includes('--workers') ? num('workers', 1) : undefined)
  for (const r of results) if (r.violations.length) console.log(`seed ${r.seed}: ${r.violations.map((v) => `${v.invariant}: ${v.info}`).join(' | ')}`)
  const s = summarize(results)
  const ref = simulateReference()
  const t = s.totals
  const pct = (n: number) => `${((100 * n) / Math.max(1, s.seeds)).toFixed(1)} %`
  console.log(`
weevbook simulator: seeds ${from} to ${from + seeds - 1}, ${((Date.now() - started) / 1000).toFixed(1)} s
  runs with violations   ${s.failed.length}${s.failed.length ? ` (first: ${s.failed.slice(0, 10).map((f) => f.seed).join(', ')}; replay one with --seed <n> --trace)` : ''}
  by invariant           ${Object.entries(s.byInvariant).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}
  reference scenario     ${ref.violations.length ? `${ref.violations.length} violation(s)` : 'ok'}
  simulated              ${s.simulatedHours.toFixed(0)} hours; clocks beyond 30 s in ${s.wideClockRuns} runs (${pct(s.wideClockRuns)})
  messages accepted      ${t.messages}, turns done ${t.turnsDone}, held ${Object.entries(t.held).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}
  engine runs            ${t.runs}, stopped by quota ${t.quotaStops}
  steals                 ${t.steals}, longest delay after the last renewal ${(s.maxStealDelay / 1000).toFixed(1)} s (bound 130 s, clocks within 30 s)
  live holders stolen    ${t.liveSteals} (could renew all along; a violation when clocks are within 30 s)
  orphan refs            ${t.orphans}, late notes ${t.lateNotes}
  engine changes         ${t.switches}, at most ${s.maxSwitches} in one thread`)
  if (s.failed.length || ref.violations.length) process.exitCode = 1
}
