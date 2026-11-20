// weevilsd's own small model calls (titles, classification, judges, the « for you » writing, repository blurbs) run
// apart from the user's Claude Code and Codex setup. Started like an ordinary `claude -p`, each one loaded the user's
// hooks (some start `npx`), plugins, MCP servers, skills, CLAUDE.md and memory: hundreds of thousands of input
// tokens and seconds of start-up for a one-line answer. Sign-in is untouched: credentials are not settings, and the
// few settings that say how to reach the model (env, apiKeyHelper, cloud credential helpers) are passed on.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** An empty private folder to run in: no project CLAUDE.md, AGENTS.md or .claude/settings.json is ever found from
 *  there (os.tmpdir() is shared with every user of a Linux machine). */
export function quietDir(home = os.homedir()): string {
  const dir = path.join(home, '.cache', 'weevils', 'quiet')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Settings keys that only say how to reach the model; everything else (hooks, plugins, output styles…) stays out. */
const AUTH_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'forceLoginMethod', 'forceLoginOrgUUID'] as const

function userSettings(env: NodeJS.ProcessEnv, home: string): Record<string, unknown> {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {}
  } catch {
    return {}
  }
}

/** An enterprise MCP policy makes Claude Code refuse --strict-mcp-config; the policy then decides MCP anyway. */
const MANAGED_MCP = ['/etc/claude-code/managed-mcp.json', '/Library/Application Support/ClaudeCode/managed-mcp.json']

export interface QuietClaude {
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
}

/**
 * The flags and environment of an isolated `claude -p`: no settings file loaded (user, project or local), only the
 * MCP servers given (none), no skills or commands, no CLAUDE.md, no auto-memory, no claude.ai connectors, safe mode
 * where the CLI knows it. The user's settings `env` reaches the call through its environment (never on the command
 * line, where other users could read a key), and the auth helpers through --settings.
 */
export function quietClaude(o: { env?: NodeJS.ProcessEnv; home?: string; exists?: (p: string) => boolean } = {}): QuietClaude {
  const base = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const exists = o.exists ?? fs.existsSync
  const user = userSettings(base, home)
  const settings: Record<string, unknown> = { disableAllHooks: true, disableClaudeAiConnectors: true }
  for (const k of AUTH_KEYS) if (typeof user[k] === 'string' && user[k]) settings[k] = user[k]
  const userEnv: Record<string, string> = {}
  if (user.env && typeof user.env === 'object') for (const [k, v] of Object.entries(user.env as Record<string, unknown>)) if (typeof v === 'string') userEnv[k] = v
  const strict = MANAGED_MCP.some((p) => exists(p)) ? [] : ['--strict-mcp-config']
  return {
    args: ['--setting-sources', '', '--settings', JSON.stringify(settings), ...strict, '--disable-slash-commands'],
    env: {
      ...base,
      ...userEnv,
      CLAUDE_CODE_SAFE_MODE: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    },
    cwd: quietDir(home),
  }
}

const codexHelp = new Map<string, string>()
/** `codex exec --help`, once per binary: older versions refuse flags they don't know. */
function execHelp(bin: string): string {
  let h = codexHelp.get(bin)
  if (h === undefined) {
    try {
      h = execFileSync(bin, ['exec', '--help'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      h = ''
    }
    codexHelp.set(bin, h)
  }
  return h
}

/**
 * Extra flags for weevilsd's own `codex exec`: without the user's config.toml (its MCP servers, profiles and
 * instructions), when this Codex knows --ignore-user-config. A config that sets its own model provider is kept: the
 * call would otherwise go to a provider the user doesn't use.
 */
export function quietCodexArgs(bin = 'codex', o: { env?: NodeJS.ProcessEnv; home?: string; help?: (bin: string) => string } = {}): string[] {
  const env = o.env ?? process.env
  const help = (o.help ?? execHelp)(bin)
  if (!/--ignore-user-config\b/.test(help)) return []
  const codexHome = env.CODEX_HOME || path.join(o.home ?? os.homedir(), '.codex')
  try {
    if (/^\s*(model_provider|model_providers)\b/m.test(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8'))) return []
  } catch {
    /* no config: nothing to ignore, the flag is harmless */
  }
  return ['--ignore-user-config']
}
