// What sends the agents' tests and builds through the heavy-job queue (server/heavy/queue.ts) without asking anything
// of them: small stand-ins for npm, npx, pnpm, yarn, bun, cargo, go and pytest, in a folder put first in the PATH of
// every session weevils starts (server/mux.ts spawnWv). A stand-in looks at its arguments: a test run, a build, a
// check or a lint goes through `weevils-heavy` (wait for a turn, maybe run on an idle machine of the user's); a test
// run narrowed to some files only lowers its priority (an agent iterating on one test does not queue behind a whole
// suite); everything else (installs, dev servers, watchers, a script) runs at once, as if the stand-in were not there.
// Inside a job (WEEVILS_HEAVY set), or without node, the real tool runs directly. WEEVILS_HEAVY_QUEUE=0 turns it off.
//
// The stand-ins are written when weevilsd starts, for the tools this machine has (a stand-in for a tool that is not
// installed would make `which cargo` lie), and removed when a tool is gone.
import { loginPath } from './jobs.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const TOOLS = ['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'cargo', 'go', 'pytest'] as const
export type Tool = (typeof TOOLS)[number]

export const shimDir = (dataDir: string) => path.join(dataDir, 'shims')

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** The classification, in plain sh (bash 3.2 and dash too): sets `kind` to q (the queue), l (lower priority) or empty. */
// i18n-ignore: shell comments inside the stand-ins
const CLASSIFY = String.raw`
# A script name that is a test, a check, a lint or a build (never a watcher, a dev server or a preview).
heavy_script() {
  case $1 in
    *watch*|*dev*|*serve*|*start*|*preview*|*storybook*) return 1 ;;
    test|tests|test[:._-]*|check|check[:._-]*|build|build[:._-]*|lint|lint[:._-]*|typecheck|typecheck[:._-]*|types|tsc|e2e|e2e[:._-]*|verify|verify[:._-]*|ci|ci[:._-]*) return 0 ;;
  esac
  return 1
}
# Arguments after the script or the tool: a file or a name narrows the run (l); a watch flag is not a batch job.
narrowed() {
  v=0
  for a in "$@"; do
    if [ $v = 1 ]; then v=0; continue; fi
    case $a in
      --watch|-w|--ui|watch|dev) return 2 ;;
      --retry|--reporter|--project|--config|-c|--dir|--root|--shard|--maxWorkers|--minWorkers|--pool|--environment|--bail|--timeout|--testTimeout|--outputFile|--coverage.provider|-n|--maxfail|-p|--workers|-j|--max-workers) v=1 ;;
      run|bench|--run|--) ;;
      -*) ;;
      *) return 0 ;;
    esac
  done
  return 1
}
tool_kind() { # tool_kind <tool> <its arguments…>
  t=$1; shift
  case $t in
    vitest|jest|mocha|ava)
      narrowed "$@"; r=$?
      [ $r = 2 ] && return 0
      [ $r = 0 ] && kind=l || kind=q ;;
    tsc|vue-tsc)
      for a in "$@"; do case $a in -w|--watch) return 0 ;; esac; done
      kind=q ;;
    eslint|biome|oxlint) kind=q ;;
    vite|next|nuxt|astro|webpack|rollup|parcel|turbo|nx)
      for a in "$@"; do case $a in build|run) kind=q; return 0 ;; esac; done ;;
    playwright|cypress)
      for a in "$@"; do case $a in test|run) kind=q; return 0 ;; esac; done ;;
  esac
  return 0
}
first_positional() { # prints the first argument that is not an option, and how many arguments come before it
  i=0
  for a in "$@"; do
    case $a in -*) i=$((i + 1)) ;; *) printf '%s %s' "$i" "$a"; return 0 ;; esac
  done
  return 1
}
script_kind() { # script_kind <script> <arguments after it…>
  s=$1; shift
  heavy_script "$s" || return 0
  # « npm test -- foo.test.ts »: the extra arguments narrow the run.
  seen=0
  for a in "$@"; do
    if [ $seen = 1 ]; then case $a in -*) ;; *) kind=l; return 0 ;; esac; fi
    [ "$a" = -- ] && seen=1
  done
  kind=q
}
package_manager() { # package_manager <npm|pnpm|yarn|bun> <arguments…>
  pm=$1; shift
  p=$(first_positional "$@") || return 0
  skip=\${p%% *}; cmd=\${p#* }
  while [ "$skip" -ge 0 ]; do shift; skip=$((skip - 1)); done
  case $cmd in
    test|t|tst) script_kind test "$@" ;;
    run|run-script|rum|urn) [ $# -gt 0 ] && { s=$1; shift; script_kind "$s" "$@"; } ;;
    ci|clean-install|install-clean|cit|install-ci-test) [ "$pm" = npm ] && kind=q ;;
    exec|x|dlx)
      p=$(first_positional "$@") || return 0
      skip=\${p%% *}; t=\${p#* }
      while [ "$skip" -ge 0 ]; do shift; skip=$((skip - 1)); done
      tool_kind "$t" "$@" ;;
    *) [ "$pm" = npm ] && return 0
       if heavy_script "$cmd"; then script_kind "$cmd" "$@"; else tool_kind "$cmd" "$@"; fi ;;
  esac
  return 0
}
`.replace(/\\\$/g, '$')

/** The stand-in for one tool. `launcher` is weevils-heavy's path. */
export function shimScript(tool: Tool, dir: string, launcher: string): string {
  return [
    '#!/bin/sh',
    `# weevils: ${tool} through the heavy-job queue (server/heavy/shims.ts). Rewritten when weevilsd starts.`,
    `d=${sq(dir)}`,
    'set -f; P=; IFS=:',
    'for x in $PATH; do [ "$x" = "$d" ] || P=${P:+$P:}$x; done',
    'unset IFS; set +f; PATH=$P; export PATH',
    `if [ -n "\${WEEVILS_HEAVY:-}" ] || [ "\${WEEVILS_HEAVY_QUEUE:-1}" = 0 ] || [ ! -x ${sq(launcher)} ]; then exec ${tool} "$@"; fi`,
    'kind=',
    CLASSIFY.trim(),
    CLASSIFY_CALL[tool],
    `case $kind in`,
    `  q) exec ${sq(launcher)} -- ${tool} "$@" ;;`,
    `  l) exec nice -n 10 ${tool} "$@" ;;`,
    `esac`,
    `exec ${tool} "$@"`,
    '',
  ].join('\n')
}

/** npx / bunx: the tool is the first argument that is not an option; what follows it is its own. */
const NPX = String.raw`
npx_kind() {
  while [ $# -gt 0 ]; do
    case $1 in
      -p|--package|-c|--call) shift ;;
      -*) ;;
      *) t=$1; shift; tool_kind "$t" "$@"; return 0 ;;
    esac
    shift
  done
}
npx_kind "$@"`.trim()

const CLASSIFY_CALL: Record<Tool, string> = {
  npm: 'package_manager npm "$@"',
  pnpm: 'package_manager pnpm "$@"',
  yarn: 'package_manager yarn "$@"',
  bun: 'case ${1:-} in test) kind=q ;; *) package_manager bun "$@" ;; esac',
  npx: NPX,
  bunx: NPX,
  cargo: 'case ${1:-} in build|b|test|t|check|c|clippy|bench|doc) kind=q ;; esac',
  go: 'case ${1:-} in build|test|vet) kind=q ;; esac',
  pytest: 'narrowed "$@"; [ $? = 0 ] && kind=l || kind=q',
}

/** weevils-heavy itself: node on weevils' own code, with the port of this install baked in (like the weevils command). */
export function launcherScript(repo: string, port: number, node = process.execPath): string {
  return [
    '#!/bin/sh',
    '# weevils-heavy -- <command…>: runs a test, a build or a check in its turn (server/heavy/cli.ts). Written by weevilsd.',
    `WEEVILS_PORT=\${WEEVILS_PORT:-${port}}; export WEEVILS_PORT`,
    `n=${sq(node)}; [ -x "$n" ] || n=node`,
    `exec "$n" --no-warnings ${sq(path.join(repo, 'server', 'heavy', 'cli.ts'))} "$@"`,
    '',
  ].join('\n')
}

const put = (file: string, text: string) => {
  try {
    if (fs.readFileSync(file, 'utf8') === text) return
  } catch {
    /* new */
  }
  fs.writeFileSync(`${file}.tmp`, text, { mode: 0o755 })
  fs.renameSync(`${file}.tmp`, file)
}

/** The tools this machine has: in weevilsd's PATH or in the user's login shell's (where ~/.cargo/bin often is). */
export async function presentTools(shell = process.env.SHELL || '/bin/sh', own = shimDirOf()): Promise<Set<Tool>> {
  const found = new Set<Tool>()
  const dirs = (await loginPath(shell)).split(':')
  for (const t of TOOLS) {
    for (const d of dirs) {
      if (!d || d === own) continue
      try {
        fs.accessSync(path.join(d, t), fs.constants.X_OK)
        found.add(t)
        break
      } catch {
        /* not here */
      }
    }
  }
  return found
}

let installedDir = ''
const shimDirOf = () => installedDir

/**
 * Writes weevils-heavy (in ~/.local/bin, next to the weevils command) and the stand-ins (in <data>/shims) for the tools
 * present; returns the stand-ins' folder, to put first in the sessions' PATH, or '' when the queue is off.
 */
export async function installShims(o: { dataDir: string; repo: string; port: number; binDir?: string; env?: NodeJS.ProcessEnv; tools?: Set<Tool> }): Promise<string> {
  const env = o.env ?? process.env
  const dir = shimDir(o.dataDir)
  installedDir = dir
  const bin = o.binDir ?? path.join(env.HOME || os.homedir(), '.local', 'bin')
  const launcher = path.join(bin, 'weevils-heavy')
  try {
    fs.mkdirSync(bin, { recursive: true })
    put(launcher, launcherScript(o.repo, o.port))
    if (env.WEEVILS_HEAVY_QUEUE === '0') {
      fs.rmSync(dir, { recursive: true, force: true })
      return ''
    }
    fs.mkdirSync(dir, { recursive: true })
    const tools = o.tools ?? (await presentTools())
    for (const t of TOOLS) {
      const f = path.join(dir, t)
      if (tools.has(t)) put(f, shimScript(t, dir, launcher))
      else fs.rmSync(f, { force: true })
    }
    return dir
  } catch (e) {
    console.error(`heavy-job queue: stand-ins not written (${(e as Error).message})`) // i18n-ignore: server log
    return ''
  }
}

/** A PATH with the stand-ins first (once). */
export const withShims = (dir: string, p = process.env.PATH ?? '') => (dir ? [dir, ...p.split(':').filter((x) => x && x !== dir)].join(':') : p)
