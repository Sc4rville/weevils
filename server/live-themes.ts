// Which themes the running app really has, and which ones an automation's run is adding (docs/themes.md, « The
// post »). A For you post that offers a theme to try is shown only once every built app here has it: a link that
// tries a theme never leads to an app that does not know it, and a run's « new theme » post never comes before the
// theme is on main and built. Read from the built styles themselves (`[data-theme=<id>]` in dist/assets/*.css), so it
// holds for any build, old or new, and says nothing the app could not do.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { addedThemes } from './auto-merge.ts'

const ID = /\[data-theme=["']?([a-z][a-z0-9-]*)["']?\]/g

/** The theme ids a built app's styles carry; null when that app is not built here. */
export function builtThemes(dist: string): Set<string> | null {
  let names: string[]
  try {
    names = fs.readdirSync(path.join(dist, 'assets')).filter((n) => n.endsWith('.css'))
  } catch {
    return null
  }
  if (!names.length || !fs.existsSync(path.join(dist, 'index.html'))) return null
  const out = new Set<string>()
  for (const n of names) {
    let css = ''
    try { css = fs.readFileSync(path.join(dist, 'assets', n), 'utf8') } catch { /* being rebuilt: next read */ }
    for (const m of css.matchAll(ID)) out.add(m[1])
  }
  return out
}

/**
 * The themes every built app here has (the classic one and the default one): what a phone can really show. Read again
 * only when a build changed (its index.html). null when no app is built here (a dev server): nothing can be said.
 */
export function liveThemesReader(dists: string[], read: (dist: string) => Set<string> | null = builtThemes): () => Set<string> | null {
  let key = ''
  let last: Set<string> | null = null
  return () => {
    const now = dists.map((d) => { try { return fs.statSync(path.join(d, 'index.html')).mtimeMs } catch { return 0 } }).join(':')
    if (now === key) return last
    const sets = dists.map(read).filter((s): s is Set<string> => !!s)
    key = now
    last = sets.length ? new Set([...sets[0]].filter((t) => sets.every((s) => s.has(t)))) : null
    return last
  }
}

/**
 * The themes a checkout adds over main, committed or not: the `:root[data-theme='<id>'] {` blocks its styles have and
 * `origin/main` has not (the same reading as the landing check, server/auto-merge.ts). Empty for anything that is not
 * a checkout of weevils, or when git cannot say.
 */
export function addedThemesIn(cwd: string, git: (cwd: string, args: string[]) => string = gitSync): string[] {
  if (!cwd || !fs.existsSync(path.join(cwd, 'src', 'styles.css'))) return []
  try {
    const diff = git(cwd, ['diff', '--unified=0', '--no-color', 'origin/main', '--', 'src/styles.css'])
    return addedThemes(diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)))
  } catch {
    return []
  }
}

function gitSync(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
}
