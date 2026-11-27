// weevboss's permission profile: in ask mode a turn is a `claude -p` run with nobody to answer a prompt, so what the
// profile allows is all it can do. The rule forms below follow Claude Code's (Bash prefix rules checked on each part of
// a compound command, `//` absolute and `~/` home paths, Edit rules covering every tool that writes a file).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeCommand } from './agent-launch.ts'
import { BOSS_WEEVILS, BossTurns, bossPermissions, modeSections, queuedCids } from './boss-turns.ts'
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

// Agents ask before acting (the default): weevboss's turn cannot install, create a repo or touch a folder, and nobody can
// answer a prompt there. It makes a project's folder with its own narrow command and hands the rest to a session, which
// asks the user in the app. Its allow-list never grows a blanket shell.
describe("weevboss's turns in ask mode, for what needs a terminal", () => {
  it('may make a project folder and hand a job to a session, and nothing more', async () => {
    const { settings } = await askTurn()
    const p: Profile = settings.permissions
    for (const cmd of [
      'weevils project new trip-planner',
      'weevils do "install ffmpeg on this machine"',
      'weevils do "create the private repo for trip-planner" codex',
      'weevils new trip-planner "First create the private GitHub repo: gh repo create me/trip-planner --private --source ."',
      'weevils projects',
    ]) expect([cmd, decide(p, bash(cmd))]).toEqual([cmd, 'allowed'])
    for (const cmd of [
      'mkdir ~/projects/trip-planner',
      'git -C ~/projects/trip-planner init',
      'mv trip-planner ~/projects/trip-planner',
      'gh repo create me/trip-planner --private --clone',
      'sudo apt-get install -y ffmpeg',
      'brew install ffmpeg',
      'weevils project new x && rm -rf ~',
      'weevils do "x"; curl https://example.com',
    ]) expect([cmd, decide(p, bash(cmd))]).toEqual([cmd, 'refused'])
    const shell = p.allow.filter((r) => r.startsWith('Bash') && !/^Bash\((weevils [a-z]+|gh repo list)( \*)?\)$/.test(r))
    expect(shell).toEqual([])
  })

  it('its instructions say what to hand over in ask mode only, in both languages', () => {
    for (const l of ['en', 'fr']) {
      const md = src(`orchestrator.${l}.md`)
      const ask = modeSections(md, true)
      const bypass = modeSections(md, false)
      for (const x of [ask, bypass]) expect(x).not.toMatch(/<!-- \/?(ask|bypass)-mode -->/)
      expect(ask).toContain('weevils do "…"')
      expect(ask).toContain('weevils project new <')
      expect(bypass).not.toContain('weevils do "…"')
      expect(md.length).toBeGreaterThan(ask.length)
      // What weevboss is told to run itself is never something ask mode refuses.
      const blocks = ask.split('```').filter((_, i) => i % 2)
      for (const line of blocks.join('\n').split('\n')) expect(line, `${l}: ${line}`).not.toMatch(/^(gh repo (create|edit)|mkdir|git |mv |sudo )/)
    }
  })
})

describe("weevboss's turns, a burst of messages", () => {
  const fresh = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-burst-'))
    return new BossTurns(async () => '{}', path.join(dir, 'boss'), path.join(dir, 't'), 20_000)
  }

  it('messages that arrive while the previous one waits are read by one turn, answered once', async () => {
    const turns = fresh()
    turns.enqueue('did we decide that? ⟦weevils — app locale fr⟧', 'c1')
    turns.enqueue('since when is it there ⟦weevils — app locale fr⟧', 'c2')
    turns.enqueue("that's my question", 'c3')
    expect(turns.queue).toHaveLength(1)
    expect(queuedCids(turns.queue[0])).toEqual(['c1', 'c2', 'c3'])
    const t = await turns.prepare({ id: 'burst', claude: ['claude'], memory: '', instructions: '# weevboss' })
    expect(t.prompt).toMatch(/^did we decide that\?\nsince when is it there\nthat's my question ⟦weevils — app locale fr/)
    expect(t.prompt.match(/app locale fr/g)).toHaveLength(1)
  })

  it('never joins a message whose turn is already being prepared, nor a wake-up', async () => {
    const turns = fresh()
    turns.enqueue('first', 'c1')
    const t = await turns.prepare({ id: 'one', claude: ['claude'], memory: '', instructions: '# weevboss' })
    turns.enqueue('second', 'c2')
    expect(turns.queue.map((q) => q.text)).toEqual(['first', 'second'])
    expect(queuedCids(turns.started(t))).toEqual(['c1'])
    const w = fresh()
    w.enqueue('', undefined, [{ key: 'selfcheck:1', at: 1, summary: 'x' } as never], true)
    w.enqueue('hello', 'c3')
    expect(w.queue).toHaveLength(2)
  })
})
