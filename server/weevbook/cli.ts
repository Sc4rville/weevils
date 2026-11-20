// `weevils weevbook backfill | check | compare` (server/weevils-cli runs this file with weevils' own node).
// It works on this machine's files directly, in its own process: weevilsd keeps running, and the weevbook's lock
// lets one of them write at a time.
//
//   backfill            every Claude Code and Codex session of this machine into the weevbook (idempotent)
//   check [--repair]    every thread against the invariants of docs/spec; --repair rebuilds thread.md and meta.json
//   compare [--verbose] what the app shows for each session against what the weevbook holds; exit 1 on a loss
//
// Paths can be given for a copy: --data-dir, --claude-dir, --codex-dir (tests, or another machine's files).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_DIR, CODEX_DIR, DATA_DIR, HOME, MACHINE, PROJECT_ROOTS } from '../config.ts'
import { tr } from '../i18n.ts'
import M from '../i18n/weevbook.ts'
import { backfill, type BookPaths } from './backfill.ts'
import { check } from './check.ts'
import { compare } from './compare.ts'
import { Locked } from './store.ts'

export function paths(args: string[]): BookPaths {
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const data = opt('--data-dir') ?? DATA_DIR
  return {
    dir: path.join(data, 'weevbook'),
    sessions: path.join(data, 'weevbook-sessions.jsonl'),
    claudeDir: opt('--claude-dir') ?? CLAUDE_DIR,
    codexDir: opt('--codex-dir') ?? CODEX_DIR,
    home: HOME,
    machine: MACHINE.id,
    roots: PROJECT_ROOTS,
  }
}

/** Runs one command; its exit code. `out` receives each line (stdout by default). */
export async function main(args: string[], out: (line: string) => void = (l) => console.log(l)): Promise<number> {
  const t = tr(M)
  const p = paths(args)
  const verbose = args.includes('--verbose')
  try {
    switch (args[0]) {
      case 'backfill': {
        const r = await backfill(p, { onSession: (_r, i, n) => process.stderr.isTTY && i % 25 === 0 && process.stderr.write(`\r${t.progress(i, n)}`) })
        if (process.stderr.isTTY) process.stderr.write('\r')
        out(t.backfill(r.sessions, r.created, r.updated, r.unchanged, r.empty))
        out(t.written(r.events, r.lines))
        if (r.refused) out(t.refused(r.refused))
        for (const f of r.failed) out(t.failed(f.file, f.error))
        out(t.main(r.main))
        return r.failed.length ? 1 : 0
      }
      case 'check': {
        const r = await check(p.dir, p.machine, { repair: args.includes('--repair') })
        out(t.checked(r.threads, r.events))
        if (r.repaired) out(t.repaired(r.repaired))
        const broken = Object.entries(r.byInvariant).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
        if (!broken.length) {
          out(t.sound)
          return 0
        }
        for (const [inv, n] of broken) out(t.broken(inv, n))
        for (const e of r.examples) out(`  ${e.thread} ${e.violation.invariant}${e.violation.seq ? ` seq ${e.violation.seq}` : ''}: ${e.violation.info}`)
        return 1
      }
      case 'compare': {
        const r = await compare(p)
        out(t.compared(r.sessions, r.compared, r.identical, r.empty))
        out(t.messages(r.messages, r.identicalMessages))
        out(t.intended(r.intended.redacted, r.intended.long, r.intended.error))
        if (r.withoutThread) out(t.withoutThread(r.withoutThread))
        for (const [k, n] of Object.entries(r.missing)) out(t.missing(k, n))
        for (const [k, n] of Object.entries(r.altered)) out(t.altered(k, n))
        for (const [k, n] of Object.entries(r.extra)) out(t.extra(k, n))
        const unread = r.diffs.reduce((s, d) => s + d.unread, 0)
        if (unread) out(t.unread(unread))
        if (verbose) {
          for (const d of r.diffs) {
            out(`  ${d.key} ${d.thread ?? '-'} ${d.file}`)
            for (const m of d.missing) out(`    - ${JSON.stringify(m).slice(0, 200)}`)
            for (const m of d.altered) out(`    ~ ${JSON.stringify(m.app).slice(0, 200)}\n      ${JSON.stringify(m.book).slice(0, 200)}`)
            for (const m of d.extra) out(`    + ${JSON.stringify(m).slice(0, 200)}`)
          }
        }
        out(r.losses ? t.losses(r.losses) : t.noLoss)
        return r.losses || r.withoutThread ? 1 : 0
      }
      default:
        out(t.usage)
        return 2
    }
  } catch (e) {
    out(e instanceof Locked ? t.locked : (e as Error).message)
    return 1
  }
}

// Run as a program (weevils-cli), not imported: the path may come through a symlink (WEEVILS_DIR), node gives the real one.
const self = fileURLToPath(import.meta.url)
const invoked = (() => {
  try {
    return process.argv[1] ? fs.realpathSync(process.argv[1]) : ''
  } catch {
    return ''
  }
})()
if (invoked === self) process.exitCode = await main(process.argv.slice(2))
