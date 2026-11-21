// weevboss short and fast: the proactive length guard (a Stop hook), the live session list in a turn's context.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Session } from '../shared/api.ts'
import { claudeCommand } from './agent-launch.ts'
// @ts-expect-error plain JS hook, no types
import { proactiveProblem, stopVerdict } from './boss-short.mjs'
import { BossTurns, sessionsDigest } from './boss-turns.ts'

// The 07:59 message of 2026-11-21 that started this: two paragraphs, a ledger walk, a session id, reasoning.
const WALL = `**Ad factory** has skipped every run since your 16 Nov stop, and nothing was spent. The stop marker is a file git ignores, so a "Make stop file visible" button is waiting for you in For you. It's your call because it touches the automation.

Six UI asks sent to session 431a560f, about 7 h without news, are still open in my ledger: the multicolour links replacing the square buttons, the thin drawer bar, removing the chat button with sleep mode in its place, removing the "received" texts, and the automation-request rule. No session is running now. Main's merges since midnight show the shortcut, the logo and \`weevils capture\`. I couldn't confirm the other items from them, so I'm not closing any of these yet.`
const SHORT = '**Ad factory** is still stopped: **Make stop file visible** waits in [For you](/#foryou).'

describe('the proactive length guard', () => {
  it('sends a wall back and lets a glanceable line through', () => {
    const problem = proactiveProblem(WALL)
    expect(problem).toMatch(/characters/)
    expect(problem).toMatch(/session id/)
    expect(proactiveProblem(SHORT)).toBe('')
    expect(proactiveProblem('[[weevils:silent]]')).toBe('')
  })
  it('counts a link by its label, wants a bold word, refuses a list', () => {
    expect(proactiveProblem(`**Done**: [the report](https://example.com/${'x'.repeat(400)})`)).toBe('')
    expect(proactiveProblem('First version is up.')).toMatch(/bold/)
    expect(proactiveProblem('**Waiting**\n- one\n- two')).toMatch(/list|lines/)
  })
  it('refuses once only: the rewrite always goes through', () => {
    expect(stopVerdict({ last_assistant_message: WALL, stop_hook_active: false })).toMatch(/Write it again/)
    expect(stopVerdict({ last_assistant_message: WALL, stop_hook_active: true })).toBeNull()
  })
  it('runs as a Claude Code Stop hook: exit 2 and the reason on stderr', () => {
    const hook = path.join(import.meta.dirname, 'boss-short.mjs')
    const bad = spawnSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: WALL }) })
    expect(bad.status).toBe(2)
    expect(String(bad.stderr)).toMatch(/too long/)
    const good = spawnSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: SHORT }) })
    expect(good.status).toBe(0)
  })
})

const session = (over: Partial<Session>): Session => ({ id: 'aaaaaaaa-1111', projectId: 'p1', tool: 'claude', machineId: 'vps', status: 'idle', title: 'Fix the login', lastActivityAt: 1, subagents: [], ...over }) as Session

describe("a weevboss turn's context", () => {
  it('lists the open sessions the way weevils sessions does, cut ones first', () => {
    const text = sessionsDigest([session({}), session({ id: 'bbbbbbbb-2', status: 'interrupted', interrupted: { at: 1, reason: 'died' } as Session['interrupted'] }), session({ id: 'cccccccc-3', status: 'done' })], () => 'weevils')
    expect(text.split('\n')).toEqual(['bbbbbbbb weevils claude @vps interrupted Fix the login · cut (died)', 'aaaaaaaa weevils claude @vps idle Fix the login'])
    expect(sessionsDigest([], () => '')).toBe('none open')
  })
  it('carries them in the hidden block; only an event-only turn gets the length guard', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-short-'))
    const turns = new BossTurns(async () => '{}', path.join(dir, 'boss'), path.join(dir, 't'), 20_000)
    turns.enqueue('where are we at?')
    const user = await turns.prepare({ id: 'u1', claude: claudeCommand(true), memory: '', instructions: '# weevboss', sessions: 'aaaaaaaa  weevils claude @vps idle Fix the login' })
    expect(fs.readFileSync(path.join(dir, 'boss', 'turns', 'u1.txt'), 'utf8')).toMatch(/open sessions right now[^⟧]*aaaaaaaa {2}weevils/)
    expect(JSON.parse(user.command[user.command.indexOf('--settings') + 1]).hooks).toBeUndefined()
    turns.started(user)
    turns.enqueue('', undefined, [{ key: 'k', kind: 'selfcheck', at: 1, summary: 'x' }], true)
    const pro = await turns.prepare({ id: 'p1', claude: claudeCommand(true), memory: '', instructions: '# weevboss' })
    const stop = JSON.parse(pro.command[pro.command.indexOf('--settings') + 1]).hooks.Stop[0].hooks[0].command
    expect(stop).toContain('boss-short.mjs')
  })
})
