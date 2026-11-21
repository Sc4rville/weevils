// `weevils weevbook backfill | check | compare | resume | sync status` (server/weevils-cli runs this file with
// weevils' own node).
// It works on this machine's files directly, in its own process: weevilsd keeps running, and the weevbook's lock
// lets one of them write at a time.
//
//   backfill            every Claude Code and Codex session of this machine into the weevbook (idempotent);
//                       --since <date> only those active since that day, --match <words> only those whose title or
//                       first request holds the words
//   check [--repair]    every thread against the invariants of docs/spec; --repair rebuilds thread.md and meta.json
//   compare [--verbose] what the app shows for each session against what the weevbook holds; exit 1 on a loss
//   resume <thread> [--wait]   the thread continues on this machine, same provider (step 3, docs/spec/04-resume.md);
//                       the engine is started through the local weevilsd
//   sync status         how the sync with the hub goes, as weevilsd last wrote it (step 2)
//   vault setup | push | restore | status | summary   the encrypted copy on the person's GitHub (07-vault.md, vault-cli.ts)
//   backfill --once     the import at install: nothing when DATA_DIR/weevbook-backfilled is there, which it writes;
//                       it takes the --since or --match the join line left in CONFIG_DIR/backfill.json (server/join.sh)
//
// Paths can be given for a copy: --data-dir, --claude-dir, --codex-dir (tests, or another machine's files).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_DIR, CODEX_DIR, CONFIG_DIR, DATA_DIR, HOME, MACHINE, PORT, PROJECTS_DIR, PROJECT_ROOTS, WEEVBOOK, WEEVBOOK_HUB } from '../config.ts'
import { tr } from '../i18n.ts'
import M from '../i18n/weevbook.ts'
import S from '../i18n/weevbook-sync.ts'
import type { HubStatus } from './hub.ts'
import { resumeThread, type Launch } from './resume.ts'
import { backfill, backfillMarker, type BackfillFilter, type BookPaths } from './backfill.ts'
import { vaultMain } from './vault-cli.ts'
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

/**
 * What a backfill takes: `--since <date>` and `--match <words>` of the command line; for the import at install
 * (`--once`) with neither, what the join line left on this machine (CONFIG_DIR/backfill.json). Null: a date that is
 * not one.
 */
function backfillFilter(args: string[], configDir = CONFIG_DIR): BackfillFilter | null {
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  let since = opt('--since')
  let match = opt('--match')
  if (since === undefined && match === undefined && args.includes('--once')) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(opt('--config-dir') ?? configDir, 'backfill.json'), 'utf8')) as { since?: unknown; match?: unknown }
      if (typeof saved.since === 'string') since = saved.since
      if (typeof saved.match === 'string') match = saved.match
    } catch {
      /* no choice left: everything */
    }
  }
  const at = since === undefined ? undefined : Date.parse(since)
  if (at !== undefined && !Number.isFinite(at)) return null
  return { ...(at !== undefined ? { since: at } : {}), ...(match?.trim() ? { match: match.trim() } : {}) }
}

/** Runs one command; its exit code. `out` receives each line (stdout by default). */
export async function main(args: string[], out: (line: string) => void = (l) => console.log(l)): Promise<number> {
  const t = tr(M)
  const p = paths(args)
  const verbose = args.includes('--verbose')
  try {
    switch (args[0]) {
      case 'backfill': {
        const marker = backfillMarker(path.dirname(p.dir))
        const once = args.includes('--once')
        if (once && fs.existsSync(marker)) return 0
        const filter = backfillFilter(args)
        if (!filter) {
          out(t.badSince)
          return 2
        }
        const r = await backfill(p, { ...filter, onSession: (_r, i, n) => process.stderr.isTTY && i % 25 === 0 && process.stderr.write(`\r${t.progress(i, n)}`) })
        if (process.stderr.isTTY) process.stderr.write('\r')
        out(t.backfill(r.sessions, r.created, r.updated, r.unchanged, r.empty))
        if (r.skipped) out(t.skipped(r.skipped))
        out(t.written(r.events, r.lines))
        if (r.refused) out(t.refused(r.refused))
        for (const f of r.failed) out(t.failed(f.file, f.error))
        out(t.main(r.main))
        if (once) fs.writeFileSync(marker, `${new Date().toISOString()} ${r.sessions} sessions, ${r.failed.length} failed\n`)
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
      case 'resume':
        return await resume(args, p, out)
      case 'vault':
        return await vaultMain(args, out)
      case 'sync':
        if (args[1] === 'status') return status(args, out)
        out(tr(S).usage)
        return 2
      default:
        out(t.usage)
        out(tr(S).usage)
        return 2
    }
  } catch (e) {
    out(e instanceof Locked ? t.locked : (e as Error).message)
    return 1
  }
}

/** `sync status`: DATA_DIR/weevbook-hub.json, as weevilsd's hub sync last wrote it. */
function status(args: string[], out: (line: string) => void): number {
  const s = tr(S)
  const i = args.indexOf('--data-dir')
  const file = path.join(i >= 0 ? args[i + 1] : DATA_DIR, 'weevbook-hub.json')
  let st: HubStatus
  try {
    st = JSON.parse(fs.readFileSync(file, 'utf8')) as HubStatus
  } catch {
    out(WEEVBOOK && WEEVBOOK_HUB ? s.noStatus(file) : s.noHub)
    return 1
  }
  out(s.hub(st.hub, st.here, st.steals))
  out(s.state(st.state, st.at, st.reached))
  if (st.error) out(s.error(st.error))
  out(s.pending(st.pending, st.checkpoints))
  out(s.held(Object.keys(st.held).length, st.working))
  for (const l of st.lost) out(s.lost(l.thread, l.to, l.orphan, l.at))
  for (const x of st.stolen) out(s.stolen(x.thread, x.from, Math.round(x.delayMs / 1000), x.at))
  if (st.notes) out(s.notes(st.notes))
  if (st.composed) out(s.composed(st.composed))
  return st.state === 'ok' ? 0 : 1
}

/** The engine started by the local weevilsd (it owns the terminals): once it sees the rebuilt session, its request. */
async function launchThroughWeevilsd(l: Launch) {
  const s = tr(S)
  const token = /([0-9a-f]{32,128})\s*$/i.exec(fs.readFileSync(path.join(DATA_DIR, 'local-token'), 'utf8'))?.[1] ?? ''
  const headers = { 'content-type': 'application/json', 'x-weevils-local': token }
  const base = `http://127.0.0.1:${PORT}`
  for (let i = 0; ; i++) {
    const snap = (await fetch(`${base}/api/snapshot`, { headers }).then((r) => r.json())) as { sessions?: { id: string }[] }
    if (snap.sessions?.some((x) => x.id === l.session)) break
    if (i >= 60) throw new Error(s.notKnown(l.session))
    await new Promise((r) => setTimeout(r, 1000))
  }
  const r = await fetch(`${base}/api/sessions/${encodeURIComponent(l.session)}/send`, { method: 'POST', headers, body: JSON.stringify({ text: l.text }) })
  if (!r.ok) throw new Error(s.sendFailed(r.status, (await r.text()).slice(0, 300)))
}

/** `resume <thread> [--wait]`: steps 3 of docs/spec, on this machine. */
async function resume(args: string[], p: ReturnType<typeof paths>, out: (line: string) => void): Promise<number> {
  const s = tr(S)
  const thread = args[1]
  if (!thread || thread.startsWith('-')) {
    out(s.usage)
    return 2
  }
  if (!WEEVBOOK || !WEEVBOOK_HUB) {
    out(s.noHub)
    return 1
  }
  const data = path.dirname(p.dir)
  const r = await resumeThread({
    thread, dir: p.dir, dataDir: data, sessions: p.sessions, machine: p.machine, home: p.home, claudeDir: p.claudeDir, codexDir: p.codexDir,
    roots: p.roots, projectsDir: PROJECTS_DIR, hub: WEEVBOOK_HUB, wait: args.includes('--wait'), launch: launchThroughWeevilsd,
  })
  if (!r.ok) {
    out(s.refused(r.why, r.detail))
    if (r.why === 'held' && r.wait !== undefined && Number.isFinite(r.wait)) out(s.wait(Math.ceil(r.wait / 1000)))
    return 1
  }
  if (r.stole) out(s.stole)
  out(r.turn === null ? s.placed(thread, r.leg) : s.resumed(r.turn, thread, r.engine, r.rung, r.rule, r.attempt ?? 1))
  out(r.restored ? s.folder(r.restored.dir, r.restored.mode) : s.noCheckpoint(r.cwd))
  out(s.session(r.file))
  out(s.took(r.ms))
  return 0
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
