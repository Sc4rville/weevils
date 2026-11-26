import { describe, expect, it } from 'vitest'
import { chipOf, stateIn, waitingCount, type ChipAsk } from './request-chip.ts'

const NOW = 1_800_000_000_000
const MIN = 60_000
const ask = (o: Partial<ChipAsk> = {}): ChipAsk => ({ status: 'dispatched', dispatches: [], ...o })
const sent = (session: string, at = NOW - 5 * MIN, outcome?: 'done' | 'question' | 'failed' | 'progress') => [{ session, at, ...(outcome ? { outcome } : {}) }]

describe('waitingCount: the requests that wait on the person', () => {
  it('counts a request whose session waits for an answer, and one that came back with a question', () => {
    const asks = [
      ask({ dispatches: sent('asks') }),
      ask({ dispatches: sent('rests', NOW - 3 * 86_400_000, 'question'), stale: true }),
    ]
    expect(waitingCount(asks, [{ id: 'asks', status: 'needs_user' }, { id: 'rests', status: 'idle' }])).toBe(2)
  })

  it('a question still waits when its session is gone, however old', () => {
    expect(waitingCount([ask({ dispatches: sent('gone', NOW - 9 * 86_400_000, 'question'), stale: true })], [])).toBe(1)
  })

  it('leaves out what is closed, what runs, and what waits on nobody', () => {
    const asks = [
      // Closed with a question on record, or on a session that asks: done is done.
      ask({ status: 'done', dispatches: sent('asks', NOW - 5 * MIN, 'question') }),
      ask({ status: 'dropped', dispatches: sent('asks') }),
      // Being worked on, even when its last word was a question: the answer was given, it runs again.
      ask({ dispatches: sent('works', NOW - MIN, 'question') }),
      // Never sent, came back to check, stalled, failed: none of these is the person's move.
      ask({ status: 'open' }),
      ask({ dispatches: sent('rests', NOW - 5 * MIN, 'done') }),
      ask({ dispatches: sent('lost'), stale: true }),
      ask({ dispatches: sent('rests', NOW - 5 * MIN, 'failed') }),
    ]
    const sessions = [{ id: 'asks', status: 'needs_user' as const }, { id: 'works', status: 'working' as const, workStartedAt: NOW - MIN }, { id: 'rests', status: 'idle' as const }]
    expect(waitingCount(asks, sessions)).toBe(0)
  })

  it('an open request never sent, on a list with a session that asks, is not counted: only what was sent there is', () => {
    const asks = [ask({ status: 'open' }), ask({ dispatches: sent('asks') }), ask({ dispatches: sent('asks', NOW - 4 * MIN) })]
    expect(waitingCount(asks, [{ id: 'asks', status: 'needs_user' }])).toBe(2)
  })

  it('reads a working session as the list does: an older question on it still waits, the brief in hand does not', () => {
    const older = ask({ dispatches: sent('s', NOW - 5 * 3_600_000, 'question') })
    const inHand = ask({ dispatches: sent('s', NOW - 10 * MIN, 'question') })
    const sessions = [{ id: 's', status: 'working' as const, workStartedAt: NOW - 8 * MIN }]
    expect(waitingCount([older, inHand], sessions)).toBe(1)
    // The brief in hand may be a request closed since: it still tells the older question apart.
    expect(waitingCount([older, { ...inHand, status: 'done' }], sessions)).toBe(1)
    // The very same word as the list, request by request.
    const state = stateIn([older, inHand], sessions)
    expect([older, inHand].map((a) => chipOf(a, state(a)))).toEqual(['needs', 'running'])
  })

  it('an empty ledger counts nothing; a large one is read in one pass', () => {
    expect(waitingCount([], [])).toBe(0)
    const many = Array.from({ length: 20_000 }, (_, i) => ask({ status: i % 10 ? 'done' : 'dispatched', dispatches: sent(`s${i % 50}`, NOW - i * MIN, i % 20 ? 'done' : 'question') }))
    const sessions = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, status: 'idle' as const }))
    // Open: every 10th; of those, a question on every 20th.
    expect(waitingCount(many, sessions)).toBe(1000)
  })
})

describe('the server\'s own ask fits the rule', () => {
  it('a ledger ask with no « stale » of its own reads the same word for « needs you »', () => {
    // The shape the ledger keeps (shared/ledger.ts Ask), with more fields than the rule reads.
    const own = { id: 'r1', text: 'Pick a colour', quote: 'which colour', src: 'm1', from: 'user', at: NOW, kind: 'task' as const, status: 'dispatched' as const, dispatches: [{ session: 'aa', label: 'shop-app · claude · Colours', at: NOW, outcome: 'question' as const, report: 'Blue or green?' }], progressAt: NOW }
    expect(chipOf(own, 'idle')).toBe('needs')
    expect(waitingCount([own], [{ id: 'aa', status: 'idle' }])).toBe(1)
  })
})
