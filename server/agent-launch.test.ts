// Project session agents (Claude Code and Codex) start with the plain-voice rule; weevboss never does.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { bossClaude, bossCodexFlags, plainVoice, projectInstructions, projectClaude, projectCodexFlags } from './agent-launch.ts'
import PlainVoice from './i18n/plain-voice.ts'

const CLAUDE = bossClaude()
const CODEX_FLAGS = bossCodexFlags()
const src = (f: string) => fs.readFileSync(path.join(import.meta.dirname, f), 'utf8')

describe('the plain-voice rule', () => {
  it('is short, plain, and in the app language', () => {
    expect(plainVoice('fr')).toBe(PlainVoice.fr.rule)
    expect(plainVoice('en')).toBe(PlainVoice.en.rule)
    expect(plainVoice('fr')).toMatch(/en français/)
    expect(plainVoice('en')).toMatch(/in English/)
    for (const l of ['fr', 'en'] as const) {
      expect(plainVoice(l)).toMatch(/2 (à|to) 4/)
      expect(plainVoice(l).length).toBeLessThan(700)
    }
  })

  it('Claude: appended to the system prompt of a project session, in either language', () => {
    for (const l of ['fr', 'en'] as const) {
      const c = projectClaude(l)
      expect(c.slice(0, CLAUDE.length)).toEqual([...CLAUDE])
      expect(c.slice(CLAUDE.length)).toEqual(['--append-system-prompt', projectInstructions(l)])
    }
  })

  it('Codex: developer instructions, a TOML string that reads back as the rule', () => {
    for (const l of ['fr', 'en'] as const) {
      const f = projectCodexFlags(l)
      expect(f.slice(0, CODEX_FLAGS.length)).toEqual([...CODEX_FLAGS])
      const [flag, kv] = f.slice(CODEX_FLAGS.length)
      expect(flag).toBe('-c')
      const [key, value] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]
      expect(key).toBe('developer_instructions')
      // A JSON string with only \" \\ \n \t \uXXXX escapes is a valid TOML basic string.
      expect(value).toMatch(/^"(?:[^"\\]|\\["\\nt]|\\u[0-9a-f]{4})*"$/)
      expect(JSON.parse(value)).toBe(projectInstructions(l))
      expect(projectInstructions(l)).toContain('weevils page')
      expect(projectInstructions(l)).toContain('weevils post')
    }
  })

  it('weevboss keeps the bare commands', () => {
    const bare = [...CLAUDE, ...CODEX_FLAGS].join(' ')
    expect(bare).not.toContain('--append-system-prompt')
    expect(bare).not.toContain('developer_instructions')
    // boss-turns builds weevboss's own command from core's bare one.
    expect(src('boss-turns.ts')).not.toMatch(/projectClaude|projectCodexFlags|plain-voice/)
    const core = src('core.ts')
    const bossSpawns = core.split('\n').filter((l) => /this\.spawn\('(claude|codex)', ORCH_DIR/.test(l))
    expect(bossSpawns.length).toBeGreaterThanOrEqual(3)
    for (const l of bossSpawns) expect(l).not.toMatch(/project(Claude|CodexFlags)/)
    // ... and the commands they spawn (resumed or new, Claude or Codex) are built from the bare ones.
    for (const l of core.split('\n').filter((x) => /const command = known \?/.test(x))) expect(l).not.toMatch(/project(Claude|CodexFlags)/)
    expect(core).toContain('turns.prepare({ id, claude: bossClaude()')
  })
})

describe('permission prompts', () => {
  it('agents ask by default; only an explicit WEEVILS_SAFE=0 turns that off', async () => {
    const { askPermissions } = await import('./agent-launch.ts')
    expect(askPermissions({})).toBe(true)
    expect(askPermissions({ WEEVILS_SAFE: '' })).toBe(true)
    expect(askPermissions({ WEEVILS_SAFE: '1' })).toBe(true)
    expect(askPermissions({ WEEVILS_SAFE: '0' })).toBe(false)
    expect(askPermissions({ WEEVILS_SAFE: ' 0 ' })).toBe(false)
  })
  it('with nothing set (a test HOME): sessions ask, said explicitly so the person\'s own default mode cannot skip it', () => {
    // No flag would let ~/.claude/settings.json (defaultMode: bypassPermissions) or ~/.codex/config.toml
    // (approval_policy = "never", sandbox_mode = "danger-full-access") decide, and the session would never ask.
    expect(CLAUDE).toEqual(['claude', '--permission-mode', 'default'])
    expect(CODEX_FLAGS).toEqual(['-a', 'on-request', '-s', 'workspace-write'])
    expect(projectClaude('en').slice(0, 3)).toEqual(['claude', '--permission-mode', 'default'])
    expect(projectCodexFlags('en').slice(0, 4)).toEqual(['-a', 'on-request', '-s', 'workspace-write'])
    expect(projectClaude('en').join(' ')).not.toMatch(/dangerously/)
    expect(projectCodexFlags('en').join(' ')).not.toMatch(/dangerously/)
  })
  it('turned off (WEEVILS_SAFE=0): the skip flags, as before', async () => {
    const { claudeCommand, codexFlags } = await import('./agent-launch.ts')
    expect(claudeCommand(false)).toEqual(['claude', '--dangerously-skip-permissions'])
    expect(codexFlags(false)).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(claudeCommand(true)).toEqual([...CLAUDE])
    expect(codexFlags(true)).toEqual([...CODEX_FLAGS])
  })
  it('read at each launch: a machine that follows the main one switches without a restart', () => {
    const before = process.env.WEEVILS_SAFE
    try {
      process.env.WEEVILS_SAFE = '0'
      expect(bossClaude()).toEqual(['claude', '--dangerously-skip-permissions'])
      expect(bossCodexFlags()).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
      expect(projectClaude('en').slice(0, 2)).toEqual(['claude', '--dangerously-skip-permissions'])
      expect(projectCodexFlags('en')[0]).toBe('--dangerously-bypass-approvals-and-sandbox')
      process.env.WEEVILS_SAFE = '1'
      expect(bossClaude()).toEqual(['claude', '--permission-mode', 'default'])
    } finally {
      if (before === undefined) delete process.env.WEEVILS_SAFE
      else process.env.WEEVILS_SAFE = before
    }
  })
  it('wv, the terminal launcher, asks the same way', () => {
    const wv = src('wv')
    expect(wv).toMatch(/else claude_flags=\(--permission-mode default\); codex_flags=\(-a on-request -s workspace-write\); fi/)
    expect(wv).toMatch(/if \[ "\$\{WV_SAFE:-\}" = 0 \]; then claude_flags=\(--dangerously-skip-permissions\); codex_flags=\(--dangerously-bypass-approvals-and-sandbox\)/)
  })
})
