import { describe, expect, it } from 'vitest'
import type { Message, Session } from '../../shared/api.ts'
import { dispatched, stirred, target } from './dispatch.ts'

const NOW = 1_000_000_000
const u = (id: string, reaction?: string, at = NOW - 5000): Message => ({ id, role: 'user', text: 'x', at, ...(reaction ? { reaction } : {}) }) as Message
const s = (id: string, messageCount: number, status = 'idle', lastActivityAt = 0): Session => ({ id, messageCount, status, lastActivityAt }) as unknown as Session

describe('weevboss handing work over', () => {
  it('fires when your message goes from seen (or nothing) to sent, working or waiting', () => {
    expect(dispatched([u('a', '👀'), u('b'), u('c', '👀')], [u('a', '📤'), u('b', '🛠️'), u('c', '❓')], NOW)).toEqual(['a', 'b', 'c'])
  })

  it('fires for a message that arrives already sent between two snapshots', () => {
    expect(dispatched([], [u('a', '📤')], NOW)).toEqual(['a'])
  })

  it('never fires for an answer, a step forward, an old message or one already played', () => {
    expect(dispatched([u('a', '👀')], [u('a', '💬')], NOW)).toEqual([])
    expect(dispatched([u('a', '👀')], [u('a', '✅')], NOW)).toEqual([])
    expect(dispatched([u('a', '📤')], [u('a', '🛠️')], NOW)).toEqual([])
    expect(dispatched([u('a', '👀', NOW - 3_600_000)], [u('a', '📤', NOW - 3_600_000)], NOW)).toEqual([])
    expect(dispatched([u('a', '👀')], [u('a', '📤')], NOW, new Set(['a']))).toEqual([])
    expect(dispatched([], [{ ...u('a', '📤'), role: 'assistant' }], NOW)).toEqual([])
  })

  it('aims at the session that moved last: new, a message more, or just started', () => {
    const moved = new Map<string, number>()
    stirred([s('a', 3), s('b', 5)], [s('a', 3), s('b', 6), s('c', 1)], 100, moved)
    expect([...moved.keys()].sort()).toEqual(['b', 'c'])
    stirred([s('a', 3)], [s('a', 3, 'working')], 200, moved)
    expect(target(moved, [s('a', 3), s('b', 6), s('c', 1)])?.id).toBe('a')
    stirred([], [], 100_000, moved)
    expect(target(moved, [s('a', 3)])).toBeUndefined()
  })
})
