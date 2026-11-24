// How weevils starts an agent: the base command (with or without permission prompts) and, for project sessions only,
// the standing plain-voice rule (server/i18n/plain-voice.ts). weevboss keeps the bare command: it has its own system
// prompt (server/boss-turns.ts, --append-system-prompt-file) and its own voice.
import { installationLang, type Lang } from './i18n.ts'
import PlainVoice from './i18n/plain-voice.ts'
import LivingResults from './i18n/living-results.ts'
import ReadableReplies from './i18n/readable-replies.ts'
import AgentTools from './i18n/agent-tools.ts'

/** Agents ask before acting (answered from the app) unless the person turned that off: WEEVILS_SAFE=0 (installer
 *  --no-ask-permissions). Unset counts as asking. */
export const askPermissions = (env: NodeJS.ProcessEnv = process.env): boolean => env.WEEVILS_SAFE?.trim() !== '0'

/** Claude Code, asking or not. Asking is said explicitly (--permission-mode default): with no flag, a session would take
 *  the person's own default mode from ~/.claude/settings.json, bypassPermissions included, and never ask. */
export const claudeCommand = (ask: boolean): string[] => (ask ? ['claude', '--permission-mode', 'default'] : ['claude', '--dangerously-skip-permissions'])
/** Codex's flags, asking or not. Asking is said explicitly too (approvals on request, writes inside the folder only):
 *  with no flag, ~/.codex/config.toml's approval_policy = "never" or sandbox_mode = "danger-full-access" would win. */
export const codexFlags = (ask: boolean): string[] => (ask ? ['-a', 'on-request', '-s', 'workspace-write'] : ['--dangerously-bypass-approvals-and-sandbox'])

/** weevboss's Claude command, bare. Read at each launch: a secondary machine follows the main one's choice without a
 *  restart (server/ask-follow.ts). */
export const bossClaude = (): string[] => claudeCommand(askPermissions())
/** weevboss's Codex flags, bare. */
export const bossCodexFlags = (): string[] => codexFlags(askPermissions())

/** The rule, in the installation's language (the one picked in the app), read at launch time. */
export const plainVoice = (l: Lang = installationLang()): string => PlainVoice[l].rule

export const projectInstructions = (l: Lang = installationLang()): string => plainVoice(l) + '\n\n' + ReadableReplies[l].rule + '\n\n' + AgentTools[l].rule + '\n\n' + LivingResults[l].rule

/** A project session's Claude command: the bare one plus the plain-voice rule appended to Claude Code's system prompt. */
export const projectClaude = (l?: Lang): string[] => [...bossClaude(), '--append-system-prompt', projectInstructions(l)]

/** A project session's Codex flags (after « codex » or « codex resume »): the rule as developer instructions. The value
 *  is TOML; a JSON string is a valid TOML basic string. */
export const projectCodexFlags = (l?: Lang): string[] => [...bossCodexFlags(), '-c', `developer_instructions=${JSON.stringify(projectInstructions(l))}`]
