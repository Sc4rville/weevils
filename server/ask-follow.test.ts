// A secondary machine follows the main one's permission choice: weevils' config and Claude Code's one-time warning.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { followAsk } from './ask-follow.ts'
import { bossClaude } from './agent-launch.ts'

function world(settings?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askf-'))
  const claudeSettings = path.join(dir, 'claude', 'settings.json')
  if (settings !== undefined) {
    fs.mkdirSync(path.dirname(claudeSettings), { recursive: true })
    fs.writeFileSync(claudeSettings, typeof settings === 'string' ? settings : JSON.stringify(settings))
  }
  const env: NodeJS.ProcessEnv = {}
  const written: Record<string, string>[] = []
  const writeConfig = (c: Record<string, string>) => { written.push(c); Object.assign(env, c) }
  const read = () => JSON.parse(fs.readFileSync(claudeSettings, 'utf8'))
  return { dir, claudeSettings, skipMark: path.join(dir, 'skip-mark'), env, written, writeConfig, read }
}

describe('followAsk', () => {
  it('prompts off on the main machine: off here too, and Claude Code\'s warning skipped (weevils\' mark written)', () => {
    const w = world({ hooks: { Stop: [] }, model: 'opus' })
    w.env.WEEVILS_SAFE = '1'
    const r = followAsk(false, { ...w, root: false })
    expect(r).toEqual({ ask: false, changed: true })
    expect(w.written).toEqual([{ WEEVILS_SAFE: '0' }])
    expect(w.read()).toEqual({ hooks: { Stop: [] }, model: 'opus', skipDangerousModePermissionPrompt: true })
    expect(fs.existsSync(w.skipMark)).toBe(true)
    // Again: nothing to change.
    expect(followAsk(false, { ...w, root: false }).changed).toBe(false)
    expect(w.written).toHaveLength(1)
  })
  it('back on: weevils\' skip is taken back, the person\'s own is kept', () => {
    const w = world({})
    followAsk(false, { ...w, root: false })
    expect(followAsk(true, { ...w, root: false })).toEqual({ ask: true, changed: true })
    expect(w.read()).toEqual({})
    expect(fs.existsSync(w.skipMark)).toBe(false)
    const mine = world({ skipDangerousModePermissionPrompt: true })
    mine.env.WEEVILS_SAFE = '0'
    followAsk(true, { ...mine, root: false })
    expect(mine.read()).toEqual({ skipDangerousModePermissionPrompt: true })
  })
  it('as root: Claude Code refuses to skip its prompts, so this machine keeps asking', () => {
    const w = world({})
    expect(followAsk(false, { ...w, root: true })).toEqual({ ask: true, changed: false, refused: 'root' })
    expect(w.written).toEqual([])
    expect(w.read()).toEqual({})
  })
  it('settings that cannot be read are never overwritten; none at all are created', () => {
    const bad = world('{ not json')
    followAsk(false, { ...bad, root: false })
    expect(fs.readFileSync(bad.claudeSettings, 'utf8')).toBe('{ not json')
    const none = world()
    followAsk(false, { ...none, root: false })
    expect(none.read()).toEqual({ skipDangerousModePermissionPrompt: true })
  })
  it('a symlinked settings.json (dotfiles) stays a link; the file it points to gets the change', () => {
    const w = world()
    const real = path.join(w.dir, 'dotfiles-settings.json')
    fs.writeFileSync(real, '{"theme":"dark"}')
    fs.mkdirSync(path.dirname(w.claudeSettings), { recursive: true })
    fs.symlinkSync(real, w.claudeSettings)
    followAsk(false, { ...w, root: false })
    expect(fs.lstatSync(w.claudeSettings).isSymbolicLink()).toBe(true)
    expect(JSON.parse(fs.readFileSync(real, 'utf8'))).toEqual({ theme: 'dark', skipDangerousModePermissionPrompt: true })
  })
  it('an install that never chose (no WEEVILS_SAFE): its agents work on their own, nothing written, the warning skipped', () => {
    const w = world({})
    expect(followAsk(false, { ...w, root: false })).toEqual({ ask: false, changed: false })
    expect(w.written).toEqual([])
    expect(w.read()).toEqual({ skipDangerousModePermissionPrompt: true })
  })
  it('« Ask me » with a session on its own by its own choice: the warning stays skipped for it', () => {
    const w = world({})
    followAsk(false, { ...w, root: false })
    expect(followAsk(true, { ...w, root: false, keepSkip: true })).toEqual({ ask: true, changed: true })
    expect(w.written).toEqual([{ WEEVILS_SAFE: '1' }])
    expect(w.read()).toEqual({ skipDangerousModePermissionPrompt: true })
  })
  it('the next session launched here takes it, without a restart', () => {
    const before = process.env.WEEVILS_SAFE
    try {
      const w = world({})
      followAsk(true, { ...w, env: process.env, writeConfig: (c) => Object.assign(process.env, c), root: false })
      expect(bossClaude()).toEqual(['claude', '--permission-mode', 'default'])
      followAsk(false, { ...w, env: process.env, writeConfig: (c) => Object.assign(process.env, c), root: false })
      expect(bossClaude()).toEqual(['claude', '--dangerously-skip-permissions'])
    } finally {
      if (before === undefined) delete process.env.WEEVILS_SAFE
      else process.env.WEEVILS_SAFE = before
    }
  })
})
