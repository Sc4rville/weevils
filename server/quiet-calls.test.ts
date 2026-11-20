import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { quietClaude, quietCodexArgs } from './quiet-calls.ts'

let home = ''
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-quiet-')) })
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const writeSettings = (dir: string, s: object) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s))
}

it('runs claude without any settings file, MCP server, skill, CLAUDE.md or memory, in a private empty folder', () => {
  const q = quietClaude({ env: { PATH: '/bin' }, home, exists: () => false })
  expect(q.args.slice(0, 2)).toEqual(['--setting-sources', ''])
  expect(q.args).toContain('--strict-mcp-config')
  expect(q.args).toContain('--disable-slash-commands')
  expect(JSON.parse(q.args[q.args.indexOf('--settings') + 1])).toEqual({ disableAllHooks: true, disableClaudeAiConnectors: true })
  expect(q.env).toMatchObject({ PATH: '/bin', CLAUDE_CODE_SAFE_MODE: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' })
  expect(q.cwd).toBe(path.join(home, '.cache', 'weevils', 'quiet'))
  expect(fs.statSync(q.cwd).mode & 0o777).toBe(0o700)
  expect(fs.readdirSync(q.cwd)).toEqual([])
})

it('keeps what reaches the model (settings env, auth helpers) and drops hooks and plugins', () => {
  writeSettings(path.join(home, '.claude'), {
    env: { ANTHROPIC_BASE_URL: 'https://gateway.example', HTTPS_PROXY: 'http://proxy:3128', N: 3 },
    apiKeyHelper: '~/bin/key',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'npx something' }] }] },
    enabledPlugins: { 'x@y': true },
  })
  const q = quietClaude({ env: {}, home, exists: () => false })
  const flag = JSON.parse(q.args[q.args.indexOf('--settings') + 1])
  expect(flag).toEqual({ disableAllHooks: true, disableClaudeAiConnectors: true, apiKeyHelper: '~/bin/key' })
  // env values travel in the environment, never on the command line
  expect(q.args.join(' ')).not.toContain('gateway.example')
  expect(q.env.ANTHROPIC_BASE_URL).toBe('https://gateway.example')
  expect(q.env.HTTPS_PROXY).toBe('http://proxy:3128')
  expect(q.env.N).toBeUndefined()
})

it('reads the active account folder and leaves MCP to an enterprise policy', () => {
  const dir = path.join(home, 'account-2')
  writeSettings(dir, { apiKeyHelper: 'helper-2' })
  const q = quietClaude({ env: { CLAUDE_CONFIG_DIR: dir }, home, exists: (p) => p.endsWith('managed-mcp.json') })
  expect(JSON.parse(q.args[q.args.indexOf('--settings') + 1]).apiKeyHelper).toBe('helper-2')
  expect(q.args).not.toContain('--strict-mcp-config')
})

it('drops the codex config only when this codex knows how and the config names no provider of its own', () => {
  const knows = () => '      --ignore-user-config\n          Do not load config.toml'
  expect(quietCodexArgs('codex', { env: {}, home, help: () => 'Usage: codex exec' })).toEqual([])
  expect(quietCodexArgs('codex', { env: {}, home, help: knows })).toEqual(['--ignore-user-config'])
  fs.mkdirSync(path.join(home, '.codex'))
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n[mcp_servers.big]\ncommand = "npx"\n')
  expect(quietCodexArgs('codex', { env: {}, home, help: knows })).toEqual(['--ignore-user-config'])
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model_provider = "azure"\n')
  expect(quietCodexArgs('codex', { env: {}, home, help: knows })).toEqual([])
})
