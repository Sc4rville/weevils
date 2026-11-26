// One choice for the whole weevils: the agents on every machine run on their own (the default) or ask before acting, as
// the main machine's do. The person makes that choice in the app, on the main machine (Your factory > Intelligence >
// Agents, POST /api/factory/agents; WEEVILS_SAFE=1 is « ask me », an older installer's default included). A machine
// plugged in from a line gets it at the join (server/join.sh); one already plugged in gets it from the main machine
// over the link they already have (Remote.followAsk in server/remotes.ts), on its next update, without a line pasted
// again. Sessions read it at each launch (server/agent-launch.ts): no restart. A session may have its own choice on
// top (server/agent-modes.ts).
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, HOME } from './config.ts'
import { askPermissions } from './agent-launch.ts'

export interface AskFollow {
  /** What the agents of this machine do now. */
  ask: boolean
  changed: boolean
  /** Kept asking: Claude Code refuses to skip its prompts as root (server/install.sh says the same). */
  refused?: 'root'
}

export interface AskFollowDeps {
  writeConfig: (changes: Record<string, string>) => void
  env?: NodeJS.ProcessEnv
  /** ~/.claude/settings.json */
  claudeSettings?: string
  /** The mark of a skipDangerousModePermissionPrompt weevils wrote (server/install.sh, the same file). */
  skipMark?: string
  root?: boolean
  /** A session runs on its own by its own choice (server/agent-modes.ts): Claude Code's warning stays skipped even when
   *  the global choice is to ask. */
  keepSkip?: boolean
}

/** This machine follows the main one's choice: weevils' config, and Claude Code's one-time warning about running
 *  without prompts (skipped only when prompts are off, taken back only if weevils wrote it), as install.sh does. */
export function followAsk(ask: boolean, d: AskFollowDeps): AskFollow {
  const env = d.env ?? process.env
  const root = d.root ?? process.getuid?.() === 0
  if (!ask && root) return { ask: true, changed: false, refused: 'root' }
  const changed = askPermissions(env, root) !== ask
  if (changed) d.writeConfig({ WEEVILS_SAFE: ask ? '1' : '0' })
  if (!root) claudeSkip(!ask || !!d.keepSkip, d)
  return { ask, changed }
}

/** Claude Code's one-time warning about running without prompts: skipped (weevils' mark written) or taken back (only
 *  if weevils wrote it). Never as root, where the skip is refused anyway. */
export function claudeSkip(skip: boolean, d: Pick<AskFollowDeps, 'claudeSettings' | 'skipMark'> = {}) {
  claudeSkipPrompt(skip, d.claudeSettings ?? path.join(HOME, '.claude', 'settings.json'), d.skipMark ?? path.join(DATA_DIR, 'claude-skip-prompt'))
}

function claudeSkipPrompt(skip: boolean, file: string, mark: string) {
  let real = file
  let settings: Record<string, unknown>
  try {
    real = fs.realpathSync(file)
    settings = JSON.parse(fs.readFileSync(real, 'utf8') || '{}')
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !skip) return // unreadable settings: never overwritten
    settings = {}
  }
  const now = settings.skipDangerousModePermissionPrompt === true
  if (skip === now) return
  if (!skip && !fs.existsSync(mark)) return // the person's own setting, not weevils'
  if (skip) settings.skipDangerousModePermissionPrompt = true
  else delete settings.skipDangerousModePermissionPrompt
  fs.mkdirSync(path.dirname(real), { recursive: true })
  let mode = 0o600
  try {
    mode = fs.statSync(real).mode & 0o777
  } catch {
    // a new file
  }
  const tmp = `${real}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', { mode })
  fs.renameSync(tmp, real)
  if (skip) {
    fs.mkdirSync(path.dirname(mark), { recursive: true })
    fs.writeFileSync(mark, '')
  } else fs.rmSync(mark, { force: true })
}
