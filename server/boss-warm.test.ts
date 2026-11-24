import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { aheadCommand, spareWaiting } from './boss-warm.ts'
import { BossTurns, turnKey } from './boss-turns.ts'

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-warm-'))
  const turns = new BossTurns(async () => '{}', path.join(dir, 'boss'), path.join(dir, 't'), 20_000)
  turns.choose('opus', 'high')
  return turns
}

describe("weevboss's turn started ahead", () => {
  it('the key leaves the id out and changes with model or effort', () => {
    const a = ['claude', '-p', '--session-id', 'A', '--model', 'opus', '--effort', 'high']
    expect(turnKey(a, 'A')).toBe(turnKey(a.map((x) => (x === 'A' ? 'B' : x)), 'B'))
    expect(turnKey(a, 'A')).not.toBe(turnKey(a.map((x) => (x === 'high' ? 'low' : x)), 'A'))
  })

  it('takes the next message: same key as the message turn, small talk included (it keeps the chosen effort)', async () => {
    const turns = setup()
    const ahead = await turns.ahead({ id: 'spare1', claude: ['claude'], memory: '', instructions: '# weevboss' })
    expect(ahead.args).toContain('spare1')
    turns.enqueue('send the menu fix to my-app')
    const t = await turns.prepare({ id: 'spare1', claude: ['claude'], memory: '', instructions: '# weevboss', live: 'right now: Tuesday' })
    expect(t.key).toBe(ahead.key)
    expect(t.prompt).toMatch(/^send the menu fix to my-app ⟦weevils — right now: Tuesday/)
    turns.started(t)
    turns.enqueue('yo')
    const fast = await turns.prepare({ id: 'other', claude: ['claude'], memory: '', instructions: '# weevboss' })
    expect(fast.fast).toBe(true)
    expect(fast.command[fast.command.indexOf('--effort') + 1]).toBe('low') // started fresh: low effort
    expect(fast.key).toBe(ahead.key) // taken by a process started ahead: the chosen effort
  })

  it('a model change, a wake-up or new instructions do not take it', async () => {
    const turns = setup()
    const ahead = await turns.ahead({ id: 's', claude: ['claude'], memory: '', instructions: '# weevboss' })
    turns.enqueue('hello there, what is running?')
    turns.choose('sonnet', 'high')
    expect((await turns.prepare({ id: 's', claude: ['claude'], memory: '', instructions: '# weevboss' })).key).not.toBe(ahead.key)
    turns.choose('opus', 'high')
    expect((await turns.prepare({ id: 's', claude: ['claude'], memory: '', instructions: '# weevboss v2' })).key).not.toBe(ahead.key)
    const t = setup()
    t.enqueue('', undefined, [{ key: 'selfcheck:1', at: 1, summary: 'x' } as never], true)
    expect((await t.prepare({ id: 's', claude: ['claude'], memory: '', instructions: '# weevboss' })).key).toBeUndefined()
  })

  it('runs claude-pump in one-message mode with stream-json, and is not waiting without a pump', () => {
    const c = aheadCommand('abc', ['claude', '-p', '--session-id', 'abc'])
    expect(c).toContain('WEEVILS_PUMP_ONESHOT=1')
    expect(c.join(' ')).toMatch(/claude-pump\.mjs .* abc - -- claude -p --session-id abc --input-format stream-json --output-format stream-json --verbose$/)
    expect(spareWaiting({ id: 'nope-' + Date.now(), pane: 'x', key: '', at: 0 })).toBe(false)
  })
})
