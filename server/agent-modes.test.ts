// A session's own permission choice (server/agent-modes.ts): kept in the data folder, absent means the global choice.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentsChoice, effectiveAsk, isAgentMode, SessionModes } from './agent-modes.ts'

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modes-')), 'agent-modes.json')

describe('a session\'s own choice', () => {
  it('its own choice wins over the global one; as root, it always asks', () => {
    expect(effectiveAsk(undefined, false, false)).toBe(false)
    expect(effectiveAsk(undefined, true, false)).toBe(true)
    expect(effectiveAsk('ask', false, false)).toBe(true)
    expect(effectiveAsk('auto', true, false)).toBe(false)
    expect(effectiveAsk('auto', false, true)).toBe(true)
  })

  it('the global choice as the app shows it: on their own by default, « Ask me » with WEEVILS_SAFE=1, locked as root', () => {
    expect(agentsChoice({}, false)).toEqual({ ask: false })
    expect(agentsChoice({ WEEVILS_SAFE: '0' }, false)).toEqual({ ask: false })
    expect(agentsChoice({ WEEVILS_SAFE: '1' }, false)).toEqual({ ask: true })
    expect(agentsChoice({}, true)).toEqual({ ask: true, locked: 'root' })
  })

  it('kept in a small file, read back by the next weevils; null forgets it', () => {
    const file = tmp()
    const m = new SessionModes(file)
    expect(m.get('s1')).toBeUndefined()
    expect(m.set('s1', 'ask')).toBe(true)
    expect(m.set('s1', 'ask')).toBe(false)
    expect(m.set('s2', 'auto')).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ s1: 'ask', s2: 'auto' })
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600')
    const again = new SessionModes(file)
    expect(again.get('s1')).toBe('ask')
    expect(again.anyAuto()).toBe(true)
    expect(again.set('s2', null)).toBe(true)
    expect(again.anyAuto()).toBe(false)
    expect(new SessionModes(file).get('s2')).toBeUndefined()
  })

  it('a Codex pane linked to its transcript keeps its choice under its new id', () => {
    const m = new SessionModes(tmp())
    m.set('wv-demo-abc123', 'ask')
    m.move('wv-demo-abc123', 'codex-id')
    expect(m.get('wv-demo-abc123')).toBeUndefined()
    expect(m.get('codex-id')).toBe('ask')
  })

  it('an unreadable or odd file: every session follows the global choice', () => {
    const file = tmp()
    fs.writeFileSync(file, '{ not json')
    expect(new SessionModes(file).get('s1')).toBeUndefined()
    fs.writeFileSync(file, JSON.stringify({ s1: 'yes', s2: 'ask' }))
    const m = new SessionModes(file)
    expect(m.get('s1')).toBeUndefined()
    expect(m.get('s2')).toBe('ask')
    expect(isAgentMode('auto') && isAgentMode('ask') && !isAgentMode(null) && !isAgentMode('bypass')).toBe(true)
  })

  it('bounded: the oldest choices go first', () => {
    const m = new SessionModes(tmp())
    for (let i = 0; i < 510; i++) m.set(`s${i}`, 'ask')
    expect(m.get('s0')).toBeUndefined()
    expect(m.get('s9')).toBeUndefined()
    expect(m.get('s10')).toBe('ask')
    expect(m.get('s509')).toBe('ask')
  })
})
