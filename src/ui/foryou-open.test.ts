// Where a tap in For you leads: every destination the server can name resolves to something real, an automation
// opens on its own page (never a drawer the host may not have), and what cannot be resolved offers no button.
import { describe, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import type { ForYouOpen } from '../../shared/foryou'
import { resolveOpen, runOpen, type OpenHandlers } from './foryou-open'

const snap = { optimizers: [{ id: 'a1', state: 'queued' }, { id: 'gone', state: 'refused' }], h24: [{ id: 'timer:backup' }] } as unknown as Snapshot
/** One of each destination a For you post can carry (shared/foryou.ts ForYouOpen). The server's posts are typed with
 *  it, and resolveOpen does not compile when a destination is added there without a rule. */
const TARGETS: ForYouOpen[] = [
  { page: 'session', id: 's1' },
  { page: 'boss' },
  { page: 'boss', mid: 'm9' },
  { page: 'auto', id: 'a1' },
  { page: 'auto', id: 'timer:backup' },
  { page: 'auto', id: 'no-longer-there' },
  { page: 'auto', id: 'gone' },
  { page: 'auto' },
  { page: 'usage' },
  { page: 'machine' },
]

describe('a For you destination', () => {
  it('always resolves to something real, and running it always does one thing', () => {
    for (const target of TARGETS) {
      const step = resolveOpen(target, snap, 'myshop')
      expect(step, JSON.stringify(target)).not.toBeNull()
      const h: OpenHandlers = { page: vi.fn(), boss: vi.fn(), autos: vi.fn() }
      runOpen(step!, h)
      const calls = [h.page, h.boss, h.autos].reduce((n, f) => n + vi.mocked(f).mock.calls.length, 0)
      expect(calls, JSON.stringify(target)).toBe(1)
    }
  })

  it('an automation opens on its own page; one that is gone, or none named, opens the list', () => {
    expect(resolveOpen({ page: 'auto', id: 'a1' }, snap)).toEqual({ to: 'page', page: { kind: 'auto', id: 'a1' } })
    expect(resolveOpen({ page: 'auto', id: 'timer:backup' }, snap)).toEqual({ to: 'page', page: { kind: 'auto', id: 'timer:backup' } })
    for (const target of [{ page: 'auto', id: 'no-longer-there' }, { page: 'auto', id: 'gone' }, { page: 'auto' }] as ForYouOpen[]) expect(resolveOpen(target, snap)).toEqual({ to: 'autos' })
    expect(resolveOpen({ page: 'auto', id: 'a1' }, {} as Snapshot)).toEqual({ to: 'autos' })
  })

  it('the others go where they say', () => {
    expect(resolveOpen({ page: 'session', id: 's1' }, snap)).toEqual({ to: 'page', page: { kind: 'session', id: 's1' } })
    expect(resolveOpen({ page: 'boss', mid: 'm9' }, snap)).toEqual({ to: 'boss', mid: 'm9' })
    expect(resolveOpen({ page: 'usage' }, snap)).toEqual({ to: 'page', page: { kind: 'usage' } })
    expect(resolveOpen({ page: 'machine' }, snap, 'myshop')).toEqual({ to: 'page', page: { kind: 'machine', projectId: 'myshop' } })
  })

  it('what this app does not know leads nowhere, so that no button is drawn for it', () => {
    expect(resolveOpen(undefined, snap)).toBeNull()
    expect(resolveOpen({ page: 'hologram' } as unknown as ForYouOpen, snap)).toBeNull()
    expect(resolveOpen({ page: 'session', id: '' }, snap)).toBeNull()
  })
})
