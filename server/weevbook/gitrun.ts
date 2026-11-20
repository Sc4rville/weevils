// One git command, as the weevbook's sync and checkpoints run it (docs/spec/03-sync-and-lease.md, 04-resume.md): never
// a prompt, English messages, a time limit, and nothing of the caller's own git environment (a GIT_DIR or an index
// that would point the command at the user's repository by accident).

import { execFile } from 'node:child_process'
import type { GitResult, GitRunner } from './lease.ts'

/** Variables that would make a command act on another repository or index than the one it names. */
const INHERITED = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX']

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  input?: string | Buffer
  /** Killed after this long (ms): the answer is then a failure, code 124. */
  timeoutMs?: number
  /** Bytes, not text (cat-file of a binary blob). */
  buffer?: boolean
}

export function runGit(args: readonly string[], o: RunOptions = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env }
    for (const k of INHERITED) delete env[k]
    Object.assign(env, { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, o.env)
    const child = execFile('git', [...args], { cwd: o.cwd, env, maxBuffer: 1 << 30, timeout: o.timeoutMs ?? 120_000, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null
      const code = !e ? 0 : e.killed ? 124 : typeof e.code === 'number' ? e.code : 1
      resolve({ code, stdout: String(stdout), stderr: e?.killed ? `timed out after ${o.timeoutMs ?? 120_000} ms` : String(stderr) }) // i18n-ignore: a log line
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(o.input)
  })
}

/** The same, throwing on a failure: for commands that must work (plumbing in a repository weevils owns). */
export async function gitOk(args: readonly string[], o: RunOptions = {}): Promise<string> {
  const r = await runGit(args, o)
  if (r.code !== 0) throw new Error(`git ${args.find((a) => !a.startsWith('-')) ?? args[0]}: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`) // i18n-ignore: git's own error, for the log
  return r.stdout
}

/** ssh as the hub uses it: never a question, a short wait to connect, one connection kept a moment for the next push. */
export function sshCommand(controlDir?: string): string {
  const base = 'ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=2'
  return controlDir ? `${base} -o ControlMaster=auto -o ControlPersist=120 -o ControlPath=${controlDir}/hub-ssh-%C` : base
}

/**
 * The runner LeaseClient takes (lease.ts), in the weevbook's repository: network commands (fetch, push, ls-remote)
 * get the hub's ssh and `netMs`, the others `localMs`.
 */
export function hubRunner(gitDir: string, o: { ssh?: string; netMs?: number; localMs?: number } = {}): GitRunner {
  return (args, opts = {}) => {
    const net = args[0] === 'push' || args[0] === 'fetch' || args[0] === 'ls-remote'
    return runGit(['--git-dir', gitDir, ...args], {
      env: { ...(o.ssh ? { GIT_SSH_COMMAND: o.ssh } : {}), ...opts.env },
      input: opts.input,
      timeoutMs: net ? (o.netMs ?? 60_000) : (o.localMs ?? 60_000),
    })
  }
}
