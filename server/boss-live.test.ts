import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSmallTalk, liveDigest, nowLine } from './boss-live.ts'
import { BossTurns } from './boss-turns.ts'

const NOW = Date.UTC(2026, 10, 24, 17, 5)
const session = (id: string, over: Record<string, unknown> = {}) => ({ id, projectId: 'p1', machineId: 'vps', tool: 'claude', title: `Title ${id}`, status: 'done', lastActivityAt: NOW - 60_000, cwd: '/x', ...over })
const snap = (sessions: ReturnType<typeof session>[]) => ({
  sessions, projects: [{ id: 'p1', name: 'my-app' }], machines: [{ id: 'vps', name: 'vps', online: true }, { id: 'pc', name: 'pc', online: false }],
}) as unknown as Parameters<typeof liveDigest>[0]

describe("the live part of weevboss's turn", () => {
  it('says the date and time in the given zone', () => {
    expect(nowLine(NOW, 'Europe/Paris')).toBe('Tuesday, 24 November 2026, 18:05 (Europe/Paris)')
  })

  it('lists machines and sessions with their state, cut ones first, then newest', () => {
    const d = liveDigest(snap([
      session('aaaaaaaa11', { status: 'working', now: 'runs the tests', lastActivityAt: NOW - 5 * 60_000 }),
      session('bbbbbbbb22', { status: 'interrupted', interrupted: { reason: 'limit' }, lastActivityAt: NOW - 3 * 3600_000 }),
      session('cccccccc33', { status: 'needs_user' }),
    ]), NOW, undefined, 'Europe/Paris')
    expect(d).toContain('Tuesday, 24 November 2026, 18:05')
    expect(d).toContain('machines: vps (this one), pc (offline)')
    const rows = d.split('\n').filter((l) => l.startsWith('- '))
    expect(rows.map((r) => r.slice(2, 10))).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa'])
    expect(rows[2]).toBe('- aaaaaaaa my-app · claude @vps · working · Title aaaaaaaa11 · runs the tests · 5 min ago')
    expect(rows[0]).toContain('cut (limit)')
  })

  it('leaves out old finished sessions, archived ones and what the caller skips', () => {
    const d = liveDigest(snap([
      session('old00000', { lastActivityAt: NOW - 2 * 86400_000 }),
      session('arch0000', { archived: true }),
      session('turn0000'),
      session('bg000000', { lastActivityAt: NOW - 2 * 86400_000, background: 1 }),
      session('keep0000'),
    ]), NOW, (s) => s.id === 'turn0000')
    expect(d).not.toMatch(/old00000|arch0000|turn0000/)
    expect(d).toContain('bg000000')
    expect(d).toContain('keep0000')
  })

  it("says where a session's result lives, so the words naming it link to it: its newest post's link, else its page", () => {
    const d = liveDigest({ ...snap([session('land0000'), session('page0000'), session('none0000')]), pageBand: [{ slug: 'notes', title: 'My notes', kind: 'preview', path: '/p/preview/notes', session: 'page0000' }] } as unknown as Parameters<typeof liveDigest>[0],
      NOW, undefined, undefined, new Map([['land0000', { url: 'https://landing.example.com/c', label: 'the [new] landing' }]]))
    const row = (id: string) => d.split('\n').find((l) => l.includes(id)) ?? ''
    expect(row('land0000')).toContain('its result lives at [the new landing](https://landing.example.com/c)')
    expect(row('page0000')).toContain('its result lives at [My notes](/p/preview/notes)')
    expect(row('none0000')).not.toContain('lives at')
  })

  it('caps the list and says how to see the rest', () => {
    const d = liveDigest(snap(Array.from({ length: 30 }, (_, i) => session(`s${String(i).padStart(7, '0')}`, { status: 'working' }))), NOW)
    expect(d.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(24)
    expect(d).toContain('(6 more: weevils sessions all)')
  })
})

describe('small talk', () => {
  it('is a few words with no link, path, id or number', () => {
    for (const t of ['yo', 'ok', 'merci !', 'on est quel jour', 'ok vas-y', 'What day is it?', 'Oui, merci 👍', "c'est bon"]) expect([t, isSmallTalk(t)]).toEqual([t, true])
    for (const t of ['', '/model opus', 'look at https://example.com', 'relance 873a024f', 'merge PR 152', 'fix the menu then deploy it to the shop please', 'a'.repeat(41), 'what now?', 'on en est où', 'and kusaila?', 'yes merge it']) expect([t, isSmallTalk(t)]).toEqual([t, false])
  })

  it("runs at low effort with the same model, and the live part reaches the turn's hidden block", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-live-'))
    const turns = new BossTurns(async () => '{}', path.join(dir, 'boss'), path.join(dir, 't'), 20_000)
    turns.choose('opus', 'high')
    turns.enqueue('yo ⟦weevils — Explicit app locale: English (en).⟧')
    const a = await turns.prepare({ id: 't1', claude: ['claude'], memory: '', instructions: '# weevboss', live: 'right now: Tuesday' })
    expect(a.fast).toBe(true)
    expect(a.command[a.command.indexOf('--effort') + 1]).toBe('low')
    expect(a.command[a.command.indexOf('--model') + 1]).toBe('opus')
    expect(fs.readFileSync(path.join(dir, 'boss', 'turns', 't1.txt'), 'utf8')).toMatch(/^yo ⟦weevils — Explicit app locale: English \(en\)\. — right now: Tuesday/)
    turns.started(a)
    turns.enqueue('send the menu fix to my-app and tell me when it is live')
    const b = await turns.prepare({ id: 't2', claude: ['claude'], memory: '', instructions: '# weevboss' })
    expect(b.fast).toBeUndefined()
    expect(b.command[b.command.indexOf('--effort') + 1]).toBe('high')
  })
})
