// Auto-merge of safe automation output (docs/automations/auto-merge.md).
//
// A task branch normally waits for the person's go. A few kinds of change are low-risk and self-contained, and the
// person asked for them to land on their own once the checks pass: a new theme, copy (text and docs), an added asset.
// Everything else (server, install, auth, security, data, scripts, dependencies, agent instructions) stays a branch.
//
// Only weevils' own repository (the checkout this server runs from) merges on its own: the path rules below are
// weevils' layout. The order: rebase on the current main, classify the result, run the checks, push fast-forward to
// main (never forced), then bring the running app up to it (the safe kinds are front-end only: a dist rebuild, no
// restart). Pure parts are exported for tests.
import { execFile } from 'node:child_process'

export type SafeKind = 'theme' | 'copy' | 'asset'
export type Change = { status: string; path: string }
export type Verdict = { safe: boolean; kinds: SafeKind[]; themes: string[]; why?: string }

/** Never on their own, whatever else the change holds. */
const NEVER = [
  /^server\//,
  /^scripts\//,
  /^\.github\//,
  /^\.claude\//,
  /^install\.sh$/,
  /^package(-lock)?\.json$/,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /auth|secret|token|credential|password|\.env/i,
]
const COPY = [/^src\/i18n\/[\w-]+\.ts$/, /^docs\/[\w./-]+\.md$/, /^README(\.[\w-]+)?\.md$/]
const THEME = [/^src\/[\w/-]+\.css$/, /^src\/ui\/app-context\.tsx$/, /^shared\/link-colors\.ts$/]
const TESTS = /^(test\/[\w./-]+|src\/[\w/-]+\.test\.tsx?|shared\/[\w-]+\.test\.ts)$/
/** Added files only: images, fonts and sounds (no SVG: it can hold script). */
const ASSET = /^(public|src\/assets|docs)\/[\w./-]+\.(png|jpe?g|webp|gif|avif|woff2?|mp3|ogg|wav)$/i

/** A theme the diff adds: a `:root[data-theme='<id>'] {` block among the added CSS lines. */
export const addedThemes = (addedCss: string[]) => [...new Set(addedCss.flatMap((l) => [...l.matchAll(/^:root\[data-theme='([\w-]+)'\] \{/g)].map((m) => m[1])))]

/**
 * Is this change one of the safe kinds? Every changed path must belong to one: theme files only when the change adds a
 * theme, copy files, tests that go with them, added assets. No deletion or rename, nothing on the never list, and the
 * added CSS loads nothing from outside.
 */
export function classify(changes: Change[], addedCss: string[]): Verdict {
  const themes = addedThemes(addedCss)
  const kinds = new Set<SafeKind>()
  if (!changes.length) return { safe: false, kinds: [], themes, why: 'nothing to merge' }
  for (const { status, path } of changes) {
    if (NEVER.some((r) => r.test(path))) return { safe: false, kinds: [], themes, why: `${path} needs review` }
    if (!/^[AM]$/.test(status)) return { safe: false, kinds: [], themes, why: `${path}: ${status} needs review` }
    if (TESTS.test(path)) continue
    if (status === 'A' && ASSET.test(path)) kinds.add('asset')
    else if (COPY.some((r) => r.test(path))) kinds.add(themes.length && path === 'src/i18n/bands.ts' ? 'theme' : 'copy')
    else if (themes.length && THEME.some((r) => r.test(path))) kinds.add('theme')
    else return { safe: false, kinds: [], themes, why: `${path} needs review` }
  }
  if (addedCss.some((l) => /@import|url\(\s*['"]?(https?:)?\/\//i.test(l))) return { safe: false, kinds: [], themes, why: 'CSS loads from outside' }
  if (!kinds.size) return { safe: false, kinds: [], themes, why: 'tests only' }
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

export type MergeResult = { merged: false; why: string } | { merged: true; commit: string; kinds: SafeKind[]; themes: string[] }

/**
 * Lands a task branch on main when it is safe: rebase on origin/main (a conflict leaves the branch as it was), classify,
 * check (typecheck, i18n, the tests related to the change), push fast-forward. <app> is weevils' own checkout: any
 * other repository is never merged here.
 */
export async function autoMerge(dir: string, app: string, box?: Sandbox, git: Git = gitOut, plain: Run = runOk): Promise<MergeResult> {
  const run = sandboxed(plain, box)
  const [mine, ours] = await Promise.all([git(dir, ['remote', 'get-url', 'origin']), git(app, ['remote', 'get-url', 'origin'])])
  if (!mine || mine !== ours) return { merged: false, why: 'not weevils' }
  if ((await git(dir, ['status', '--porcelain'])) !== '') return { merged: false, why: 'uncommitted changes' }
  if ((await git(dir, ['fetch', '-q', 'origin', 'main'], 60_000)) === null) return { merged: false, why: 'fetch failed' }
  if ((await git(dir, ['rebase', '-q', 'origin/main'], 120_000)) === null) {
    await git(dir, ['rebase', '--abort'])
    return { merged: false, why: 'conflicts with main' }
  }
  const names = await git(dir, ['diff', '--name-status', '--no-renames', 'origin/main...HEAD'])
  const patch = await git(dir, ['diff', '-U0', 'origin/main...HEAD', '--', '*.css'])
  if (names === null || patch === null) return { merged: false, why: 'diff failed' }
  const changes = names.split('\n').filter(Boolean).map((l) => { const [status, path] = l.split('\t'); return { status: status[0], path } })
  const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1))
  const v = classify(changes, added)
  if (!v.safe) return { merged: false, why: v.why ?? 'needs review' }
  for (const [args, t] of [[['run', 'typecheck'], 300_000], [['run', 'i18n:check'], 120_000]] as const)
    if (!(await run(dir, 'npm', [...args], t))) return { merged: false, why: `npm ${args.join(' ')} failed` }
  if (!(await run(dir, 'npx', ['vitest', 'run', '--changed', 'origin/main', '--passWithNoTests'], 600_000))) return { merged: false, why: 'tests failed' }
  // To the repository main is fetched from (`remote get-url` gives the fetch URL): a checkout may point its pushes
  // elsewhere on purpose (weevils' own: pushurl to a private archive), main lives where it is fetched.
  if ((await git(dir, ['push', '-q', mine, 'HEAD:refs/heads/main'], 120_000)) === null) return { merged: false, why: 'push refused (main moved?)' }
  const commit = (await git(dir, ['rev-parse', 'HEAD'])) ?? ''
  return { merged: true, commit, kinds: v.kinds, themes: v.themes }
}

/**
 * The running weevils takes the merged commit: its checkout fast-forwards (only when on main and clean: someone's work
 * is never touched) and the app is rebuilt. No restart: the safe kinds never change the server.
 */
export async function updateLive(app: string, commit: string, git: Git = gitOut, run: Run = runOk): Promise<boolean> {
  if ((await git(app, ['symbolic-ref', '--short', 'HEAD'])) !== 'main') return false
  if ((await git(app, ['status', '--porcelain', '--untracked-files=no'])) !== '') return false
  if ((await git(app, ['fetch', '-q', 'origin', 'main'], 60_000)) === null) return false
  if ((await git(app, ['merge', '-q', '--ff-only', commit], 60_000)) === null) return false
  // weevils' own vite (the app checkout's node_modules, never the run's): the CSS and copy are only bundled.
  return run(app, 'npx', ['vite', 'build'], 600_000)
}
