// How weevils starts an agent: the base command (with or without permission prompts) and, for project sessions only,
// the standing plain-voice rule (server/i18n/plain-voice.ts). weevboss keeps the bare command: it has its own system
// prompt (server/boss-turns.ts, --append-system-prompt-file) and its own voice.
//
// Agents run on their own by default (no permission prompt); the person chooses in the app, once for every machine
// (Your factory > Intelligence > Agents, server/ask-follow.ts) and per session (server/agent-modes.ts).
import { installationLang, type Lang } from './i18n.ts'
import PlainVoice from './i18n/plain-voice.ts'
import LivingResults from './i18n/living-results.ts'
import ReadableReplies from './i18n/readable-replies.ts'
import AgentTools from './i18n/agent-tools.ts'

/** weevils runs as root here: Claude Code refuses to skip its permission prompts then, so agents always ask. */
export const runsAsRoot = (): boolean => process.getuid?.() === 0

/** The global choice: agents ask before acting (answered from the app) only when the person chose it (WEEVILS_SAFE=1,
 *  written by the app's « Ask me », or an older installer's default kept as it was), or as root. Unset, 0 or anything
 *  else: they run on their own. */
export const askPermissions = (env: NodeJS.ProcessEnv = process.env, root: boolean = runsAsRoot()): boolean => root || env.WEEVILS_SAFE?.trim() === '1'

/** Claude Code, asking or not. Asking is said explicitly (--permission-mode default): with no flag, a session would take
 *  the person's own default mode from ~/.claude/settings.json, bypassPermissions included, and never ask. */
export const claudeCommand = (ask: boolean): string[] => (ask ? ['claude', '--permission-mode', 'default'] : ['claude', '--dangerously-skip-permissions'])
/** Codex's flags, asking or not. Asking is said explicitly too (approvals on request, writes inside the folder only):
 *  with no flag, ~/.codex/config.toml's approval_policy = "never" or sandbox_mode = "danger-full-access" would win. */
export const codexFlags = (ask: boolean): string[] => (ask ? ['-a', 'on-request', '-s', 'workspace-write'] : ['--dangerously-bypass-approvals-and-sandbox'])

/** Whether a command weevils launches asks before acting: read from its own flags (undefined: not an agent command
 *  weevils built, nothing to say). */
export function launchAsks(command: readonly string[]): boolean | undefined {
  if (command.includes('--dangerously-skip-permissions') || command.includes('--dangerously-bypass-approvals-and-sandbox')) return false
  if (command.includes('--permission-mode') || command.includes('on-request')) return true
  return undefined
}

/** weevboss's Claude command, bare. Read at each launch (the global choice): a switch in the app, or a secondary
 *  machine following the main one's (server/ask-follow.ts), needs no restart. */
export const bossClaude = (ask: boolean = askPermissions()): string[] => claudeCommand(ask)
/** weevboss's Codex flags, bare. */
export const bossCodexFlags = (ask: boolean = askPermissions()): string[] => codexFlags(ask)

/** The rule, in the installation's language (the one picked in the app), read at launch time. */
export const plainVoice = (l: Lang = installationLang()): string => PlainVoice[l].rule

export const projectInstructions = (l: Lang = installationLang()): string => plainVoice(l) + '\n\n' + ReadableReplies[l].rule + '\n\n' + AgentTools[l].rule + '\n\n' + LivingResults[l].rule

/** A project session's Claude command: the bare one plus the plain-voice rule appended to Claude Code's system prompt.
 *  ask: the session's own mode (server/agent-modes.ts), the global choice by default. */
export const projectClaude = (l?: Lang, ask: boolean = askPermissions()): string[] => [...claudeCommand(ask), '--append-system-prompt', projectInstructions(l)]

/** A project session's Codex flags (after « codex » or « codex resume »): the rule as developer instructions. The value
 *  is TOML; a JSON string is a valid TOML basic string. */
export const projectCodexFlags = (l?: Lang, ask: boolean = askPermissions()): string[] => [...codexFlags(ask), '-c', `developer_instructions=${JSON.stringify(projectInstructions(l))}`]

/** Codex in an unattended run (an automation, server/optimizers.ts): working on its own, it never waits for an approval
 *  nobody would give, and it keeps Codex's own sandbox (writes in its folder only), part of the run's jail with bwrap,
 *  the deny list and the barriers: never the bypass flag, whatever the global choice. Asking: as a project session. */
export const unattendedCodexFlags = (l?: Lang, ask: boolean = askPermissions()): string[] =>
  ask ? projectCodexFlags(l, true) : ['-a', 'never', '-s', 'workspace-write', '-c', `developer_instructions=${JSON.stringify(projectInstructions(l))}`]
