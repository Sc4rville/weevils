// Auto-merge of safe automation output (docs/automations/auto-merge.md).
//
// A task branch normally waits for the person's go. A few kinds of change are low-risk and self-contained, and the
// person asked for them to land on their own once the checks pass: a new theme, copy (text and docs), an added asset,
// a pure cleanup (code only removed, server included, with the whole test suite green). Beyond those, an automation
// the person set up is their standing authorization for its own job: a run that stays inside its automation's scope
// lands too (ScopeJudge), whatever folder it touches. Only keys and passwords, and the agents' own instructions, stay
// the person's call everywhere; out-of-scope work waits with one plain line saying why.
//
// Only weevils' own repository (the checkout this server runs from) merges on its own: the path rules below are
// weevils' layout. The order: rebase on the current main, classify the result, run the checks, push fast-forward to
// main (never forced), then bring the running app up to it (a dist rebuild; a restart when a cleanup changed server
// code). Pure parts are exported for tests.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'

export type SafeKind = 'theme' | 'copy' | 'asset' | 'cleanup' | 'scope'
/** added: lines the change adds to that file (git diff --numstat), when known. */
export type Change = { status: string; path: string; added?: number }
/** Why a change waits for the person, in one word (server/optimizers.ts landingWhy says it in plain words). */
export type Review = 'installer' | 'security' | 'dependencies' | 'instructions' | 'data' | 'code' | 'removed' | 'css' | 'tests'
export type Verdict = { safe: boolean; kinds: SafeKind[]; themes: string[]; why?: string }

/** Never on their own, whatever else the change holds, even a pure removal: each with the reason the person reads. */
const NEVER: [Review, RegExp][] = [
  ['installer', /^(scripts|get|\.github)\//],
  ['installer', /(^|\/)install\.sh$|\.sh$|^server\/(weevils-[\w-]+|wv|tmux-guard)$/],
  ['dependencies', /^package(-lock)?\.json$/],
  ['instructions', /(^|\/)(AGENTS|CLAUDE)\.md$|^\.claude\/|^server\/[\w.-]+\.md$/],
  ['security', /auth|secret|token|credential|password|\.env|door|guard|jail|sandbox|permission|security|crypt|sign|login/i],
  ['data', /migrat/i],
]
const COPY = [/^src\/i18n\/[\w-]+\.ts$/, /^docs\/[\w./-]+\.md$/, /^README(\.[\w-]+)?\.md$/]
const THEME = [/^src\/[\w/-]+\.css$/, /^src\/ui\/app-context\.tsx$/, /^shared\/link-colors\.ts$/]
const TESTS = /^(test\/[\w./-]+|(src|server|shared)\/[\w/-]+\.test\.tsx?)$/
/** Code a pure cleanup may remove lines from (the typecheck and the whole test suite then prove nothing used them). */
const CODE = /^(src|server|shared)\/[\w/.-]+\.(tsx?|mjs|css)$/
/** Added files only: images, fonts and sounds (no SVG: it can hold script). */
const ASSET = /^(public|src\/assets|docs)\/[\w./-]+\.(png|jpe?g|webp|gif|avif|woff2?|mp3|ogg|wav)$/i

/** A theme the diff adds: a `:root[data-theme='<id>'] {` block among the added CSS lines. */
export const addedThemes = (addedCss: string[]) => [...new Set(addedCss.flatMap((l) => [...l.matchAll(/^:root\[data-theme='([\w-]+)'\] \{/g)].map((m) => m[1])))]

/**
 * Reserved to the person whatever the automation's job: files that hold keys and passwords, and the instructions every
 * agent reads (an automation never rewrites its own rules or another agent's).
 */
const RESERVED: [Review, RegExp][] = [
  ['security', /secret|credential|password|token|(^|\/)\.env/i],
  ['instructions', /(^|\/)(AGENTS|CLAUDE)\.md$|^\.claude\/|^server\/orchestrator[\w.-]*\.md$/],
]
export function reserved(changes: Change[]): string | null {
  for (const { path } of changes) {
    const hit = RESERVED.find(([, r]) => r.test(path))
    if (hit) return review(hit[0], path)
  }
  return null
}

/**
 * Is this run's change inside the job its automation was set up for? The automation is the person's standing
 * authorization for that job: in scope, it lands like any safe change (server code included, after the whole test
 * suite); out of scope, why in one plain sentence for the card. null: no answer (the change waits).
 */
export type ScopeJudge = (change: { files: string; commits: string }) => Promise<{ inScope: boolean; why: string } | null>

/** The reason a change waits, as autoMerge reports it: « review:<why>:<path> ». */
const review = (why: Review, path = '') => `review:${why}:${path}`
/** Server-side code changed: the running weevils must restart to take it (shared/ is read by the server too). */
export const touchesServer = (changes: Change[]) => changes.some((c) => /^(server|shared)\//.test(c.path) && !TESTS.test(c.path))

/**
 * Is this change one of the safe kinds? Every changed path must belong to one: theme files only when the change adds a
 * theme, copy files, tests that go with them, added assets, or a pure cleanup: code files (server included) the change
 * only removes lines from or deletes, with test fixes. Nothing on the never list, and the added CSS loads nothing from
 * outside.
 */
export function classify(changes: Change[], addedCss: string[]): Verdict {
  const themes = addedThemes(addedCss)
  const kinds = new Set<SafeKind>()
  const no = (why: string): Verdict => ({ safe: false, kinds: [], themes, why })
  if (!changes.length) return no('nothing to merge')
  for (const { status, path, added } of changes) {
    const never = NEVER.find(([, r]) => r.test(path))
    if (never) return no(review(never[0], path))
    if (TESTS.test(path)) continue
    // Only removes: a file deleted, or lines taken out and none put in (dead code, unused imports and exports).
    const removes = CODE.test(path) && (status === 'D' || (status === 'M' && added === 0))
    if (!/^[AM]$/.test(status) && !removes) return no(review('removed', path))
    if (status === 'A' && ASSET.test(path)) kinds.add('asset')
    else if (COPY.some((r) => r.test(path)) && !(removes && status === 'D')) kinds.add(themes.length && path === 'src/i18n/bands.ts' ? 'theme' : 'copy')
    else if (themes.length && THEME.some((r) => r.test(path))) kinds.add('theme')
    else if (removes) kinds.add('cleanup')
    else return no(review('code', path))
  }
  if (addedCss.some((l) => /@import|url\(\s*['"]?(https?:)?\/\//i.test(l))) return no(review('css'))
  if (!kinds.size) return no(review('tests'))
  return { safe: true, kinds: [...kinds], themes: kinds.has('theme') ? themes : [] }
}

type Git = (dir: string, args: string[], timeout?: number) => Promise<string | null>
/** Runs a command in <dir>: true when it exits 0. */
type Run = (dir: string, cmd: string, args: string[], timeout: number) => Promise<boolean>
export const runOk: Run = (dir, cmd, args, timeout) => new Promise((resolve) => execFile(cmd, args, { cwd: dir, timeout, maxBuffer: 64 << 20 }, (e) => resolve(!e)))
/**
 * Where the checks run: the run's own jail and environment (Optimizers.jail, guardEnv). The checks execute what the
 * automation wrote (its tests, its node_modules' binaries): never with more rights than the run itself had.
 */
export type Sandbox = { wrap: string[]; set: Record<string, string>; unset: string[] }
const sandboxed = (run: Run, box: Sandbox | undefined): Run => (dir, cmd, args, timeout) => {
  if (!box) return run(dir, cmd, args, timeout)
  const env = [...box.unset.filter((k) => /^[A-Za-z_]\w*$/.test(k)).flatMap((k) => ['-u', k]), ...Object.entries(box.set).filter(([k]) => /^[A-Za-z_]\w*$/.test(k)).map(([k, v]) => `${k}=${v}`)]
  const [head, ...rest] = [...box.wrap, 'env', ...env, cmd, ...args]
  return run(dir, head, rest, timeout)
}
const gitOut: Git = (dir, args, timeout = 30_000) => new Promise((resolve) => execFile('git', ['-C', dir, ...args], { timeout }, (e, out) => resolve(e ? null : String(out).trim())))

export type MergeResult = { merged: false; why: string } | { merged: true; commit: string; kinds: SafeKind[]; themes: string[]; /** Server code changed: restart to take it. */ restart?: boolean }

/**
 * Lands a task branch on main when it is safe: rebase on origin/main (a conflict leaves the branch as it was), classify,
 * check (typecheck, i18n, the tests related to the change), push fast-forward. <app> is weevils' own checkout: any
 * other repository is never merged here.
 */
export async function autoMerge(dir: string, app: string, box?: Sandbox, git: Git = gitOut, plain: Run = runOk, judge?: ScopeJudge): Promise<MergeResult> {
  const run = sandboxed(plain, box)
  const [mine, ours] = await Promise.all([git(dir, ['remote', 'get-url', 'origin']), git(app, ['remote', 'get-url', 'origin'])])
  if (!mine || mine !== ours) return { merged: false, why: 'not weevils' }
  // Only tracked work counts: a run's leftovers (screenshots, scratch files) are never committed, so they never land.
  if ((await git(dir, ['status', '--porcelain', '--untracked-files=no'])) !== '') return { merged: false, why: 'uncommitted changes' }
  if ((await git(dir, ['fetch', '-q', 'origin', 'main'], 60_000)) === null) return { merged: false, why: 'fetch failed' }
  if ((await git(dir, ['rebase', '-q', 'origin/main'], 120_000)) === null) {
    await git(dir, ['rebase', '--abort'])
    return { merged: false, why: 'conflicts with main' }
  }
  const names = await git(dir, ['diff', '--name-status', '--no-renames', 'origin/main...HEAD'])
  const patch = await git(dir, ['diff', '-U0', 'origin/main...HEAD', '--', '*.css'])
  if (names === null || patch === null) return { merged: false, why: 'diff failed' }
  const counts = new Map((await git(dir, ['diff', '--numstat', '--no-renames', 'origin/main...HEAD']) ?? '').split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter((f) => /^\d+$/.test(f[0])).map((f) => [f[2], Number(f[0])] as const))
  const changes = names.split('\n').filter(Boolean).map((l) => { const [status, path] = l.split('\t'); return { status: status[0], path, added: counts.get(path) } })
  const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1))
  let v = classify(changes, added)
  if (!v.safe) {
    // Not safe on its face: the automation's own job decides, except for what stays the person's everywhere.
    const floor = reserved(changes)
    if (floor || !judge) return { merged: false, why: floor ?? v.why ?? 'needs review' }
    const files = changes.map((c) => `${c.status} ${c.path} (+${c.added ?? '?'})`).join('\n')
    const commits = (await git(dir, ['log', '--format=%s', 'origin/main..HEAD'])) ?? ''
    const j = await judge({ files, commits }).catch(() => null)
    if (!j) return { merged: false, why: 'scope unknown' }
    if (!j.inScope) return { merged: false, why: `scope:${j.why}` }
    v = { safe: true, kinds: ['scope'], themes: [] }
  }
  for (const [args, t] of [[['run', 'typecheck'], 300_000], [['run', 'i18n:check'], 120_000]] as const)
    if (!(await run(dir, 'npm', [...args], t))) return { merged: false, why: `npm ${args.join(' ')} failed` }
  // A cleanup removes code something might still use at run time: the whole suite, not only the related tests.
  const tests = v.kinds.includes('cleanup') || v.kinds.includes('scope') || touchesServer(changes) ? ['vitest', 'run'] : ['vitest', 'run', '--changed', 'origin/main', '--passWithNoTests']
  if (!(await run(dir, 'npx', tests, 900_000))) return { merged: false, why: 'tests failed' }
  // To the repository main is fetched from (`remote get-url` gives the fetch URL): a checkout may point its pushes
  // elsewhere on purpose (weevils' own: pushurl to a private archive), main lives where it is fetched.
  if ((await git(dir, ['push', '-q', mine, 'HEAD:refs/heads/main'], 120_000)) === null) return { merged: false, why: 'push refused (main moved?)' }
  const commit = (await git(dir, ['rev-parse', 'HEAD'])) ?? ''
  return { merged: true, commit, kinds: v.kinds, themes: v.themes, ...(touchesServer(changes) ? { restart: true } : {}) }
}

/** The default app's own build (package.json « build » runs both). */
const NEXT_CONFIG = 'next/vite.config.ts'

/**
 * The running weevils takes the merged commit: its checkout fast-forwards (only when on main and clean: someone's work
 * is never touched) and the app is rebuilt, the classic one and the default one (next/). When server code changed (a
 * cleanup), the service restarts the way an update restarts it (weevils-service restart: agent sessions live in tmux
 * and go on).
 */
export async function updateLive(app: string, commit: string, git: Git = gitOut, run: Run = runOk, restart?: () => void, exists: (p: string) => boolean = fs.existsSync): Promise<boolean> {
  if ((await git(app, ['symbolic-ref', '--short', 'HEAD'])) !== 'main') return false
  if ((await git(app, ['status', '--porcelain', '--untracked-files=no'])) !== '') return false
  if ((await git(app, ['fetch', '-q', 'origin', 'main'], 60_000)) === null) return false
  if ((await git(app, ['merge', '-q', '--ff-only', commit], 60_000)) === null) return false
  // weevils' own vite (the app checkout's node_modules, never the run's): the CSS and copy are only bundled.
  if (!(await run(app, 'npx', ['vite', 'build'], 600_000))) return false
  // The default app (next/) bundles the same themes and copy into its own folder: without its build, what just
  // landed (a new theme in the selector) would show in the classic app only.
  if (exists(`${app}/${NEXT_CONFIG}`) && !(await run(app, 'npx', ['vite', 'build', '-c', NEXT_CONFIG], 600_000))) return false
  restart?.()
  return true
}

/** Restarts the running weevils a few seconds later, detached (it outlives the server it stops), like an update. */
export function restartWeevils(home = process.env.HOME ?? '', delay = 5000) {
  const bin = `${home}/.local/bin/weevils-service`
  if (!fs.existsSync(bin)) return
  setTimeout(() => spawn(bin, ['restart'], { detached: true, stdio: 'ignore' }).unref(), delay).unref()
}
