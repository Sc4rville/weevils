// Agent keys (server/agent-keys.ts): made with a name, verified by their hash only, revoked at once, and known to the
// author system so the app shows their name.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentKeyError, AgentKeyStore, slugOf } from './agent-keys.ts'
import { authorById, loadAuthors, normalizeFrom, publicAuthors, setExtraAuthors } from './authors.ts'

let dir: string
let file: string
let clock: number
const make = (env: Record<string, string> = {}) => new AgentKeyStore({ file, now: () => clock, declared: () => loadAuthors(env) })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-keys-'))
  file = path.join(dir, 'data', 'agent-keys.json')
  clock = Date.parse('2026-11-20T10:00:00Z')
})
afterEach(() => {
  setExtraAuthors(() => [])
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('slugOf', () => {
  it('makes an author id from a name', () => {
    expect(slugOf('Helper')).toBe('helper')
    expect(slugOf('Mon Agent n°2')).toBe('mon-agent-n-2')
    expect(slugOf('  Élise_bot ')).toBe('elise_bot')
    expect(slugOf('🤖')).toBe('')
    expect(slugOf('a'.repeat(50))).toHaveLength(32)
  })
})

describe('AgentKeyStore', () => {
  it('creates a key shown once, keeps only its hash, in a 0600 file', () => {
    const s = make()
    const k = s.create('Helper')
    expect(k.key).toMatch(/^wva_[0-9a-f]{8}_[A-Za-z0-9_-]{32,}$/)
    expect(k).toMatchObject({ id: 'helper', name: 'Helper', scope: 'boss:messages', createdAt: clock })
    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).not.toContain(k.key)
    expect(raw).not.toContain(k.key.split('_').at(-1)!)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    // The list never carries a secret or its hash.
    expect(JSON.stringify(s.list())).not.toMatch(/wva_|hash/)
    expect(s.list()).toEqual([{ id: 'helper', name: 'Helper', color: k.color, scope: 'boss:messages', createdAt: clock }])
  })

  it('verifies the right key only, and survives a restart', () => {
    const k = make().create('Helper')
    const s = make()
    expect(s.verify(k.key)?.id).toBe('helper')
    expect(s.verify(k.key.slice(0, -1) + (k.key.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(s.verify('wva_00000000_' + 'x'.repeat(32))).toBeNull()
    expect(s.verify('nope')).toBeNull()
    expect(s.verify(undefined)).toBeNull()
  })

  it('revokes at once; the author keeps its name for old messages, the id can be made again', () => {
    const s = make()
    const k = s.create('Helper')
    expect(s.revoke('helper')).toBe(true)
    expect(s.verify(k.key)).toBeNull()
    expect(make().verify(k.key)).toBeNull()
    expect(s.list()).toEqual([])
    expect(s.authors().map((a) => a.name)).toEqual(['Helper'])
    expect(s.revoke('helper')).toBe(false)
    const again = s.create('Helper')
    expect(s.verify(again.key)?.id).toBe('helper')
    expect(s.verify(k.key)).toBeNull()
  })

  it('refuses reserved, empty and taken names', () => {
    const s = make()
    for (const n of ['weevboss', 'Weevils', 'boss', 'codex', 'Claude', 'agent', 'owner', 'user', 'you', 'me']) {
      expect(() => s.create(n)).toThrow(AgentKeyError)
    }
    expect(() => s.create('')).toThrow(AgentKeyError)
    expect(() => s.create('🤖')).toThrow(AgentKeyError)
    expect(() => s.create('x'.repeat(41))).toThrow(AgentKeyError)
    s.create('Helper')
    expect(() => s.create('helper')).toThrow(/already exists/)
  })

  it('a key may take a declared author’s id and speaks as it (its name and colour stay)', () => {
    const s = make({ WEEVILS_AUTHOR_ALEX: 'Alex Bot | #123456 | alex@example.com' })
    const k = s.create('Alex')
    expect(k).toMatchObject({ id: 'alex', name: 'Alex Bot', color: '#123456' })
  })

  it('writes the last use at most every few minutes', () => {
    const s = make()
    s.create('Helper')
    s.touch('helper')
    expect(make().list()[0].lastUsedAt).toBe(clock)
    clock += 60_000
    s.touch('helper')
    expect(s.list()[0].lastUsedAt).toBe(clock)
    expect(make().list()[0].lastUsedAt).toBe(clock - 60_000)
    clock += 10 * 60_000
    s.touch('helper')
    expect(make().list()[0].lastUsedAt).toBe(clock)
  })
})

describe('authors from agent keys', () => {
  it('are known to the app (name, colour), as a `from` too', () => {
    const s = make()
    s.create('Helper')
    setExtraAuthors(() => s.authors())
    expect(authorById('helper')).toMatchObject({ name: 'Helper', via: 'key' })
    expect(publicAuthors().find((a) => a.id === 'helper')).toEqual({ id: 'helper', name: 'Helper', color: s.list()[0].color })
    expect(normalizeFrom('helper')).toBe('helper')
    expect(normalizeFrom('stranger')).toBeUndefined()
  })
})
