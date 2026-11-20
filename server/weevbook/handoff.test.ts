import { describe, expect, it } from 'vitest'
import { HANDOFF_MAX, HEADINGS, checkHandoff, firstRequest, handoffEvent, journalHandoff, nextHandoff, renderSince } from './handoff.ts'
import type { JournalEvent } from './journal.ts'
import { prefaceSign } from './turn.ts'

const T = '01M7M8E6XRZ0FEBHYK2C5GNQF4'
const at = (s: number) => new Date(Date.parse('2026-11-20T10:00:00Z') + s * 1000).toISOString()
let seq = 0
const ev = (e: Record<string, unknown>, leg: string | null = 'L1') => ({ v: 1, seq: ++seq, id: `01M7M8E6XRZ0FEBHYK2C5GN${String(seq).padStart(3, '0')}`, at: at(seq), leg, ...e }) as unknown as JournalEvent
function thread(): JournalEvent[] {
  seq = 0
  return [
    ev({ type: 'meta', thread: T, title: 'Currency on prices', project: 'shop' }, null),
    ev({ type: 'leg.start', engine: 'claude:a3f9c1@laptop', session: 's1', cwd: '/home/user/projects/shop', rung: 0, epoch: 1 }),
    ev({ type: 'message', role: 'user', text: 'Show prices with the currency', source: 'weevils' }),
    ev({ type: 'tool', call: 'c1', name: 'Edit', summary: 'Edit · src/money.ts' }),
    ev({ type: 'tool', call: 'c2', name: 'Bash', summary: 'Bash · npm test' }),
    ev({ type: 'message', role: 'assistant', text: 'Prices now show the currency. Should the cart show it too?' }),
  ]
}

describe('handoff.md', () => {
  it('written from the journal alone: front matter, the seven headings in order, the files and commands', () => {
    const h = journalHandoff(T, thread(), Date.parse('2026-11-20T11:00:00Z'))
    expect(checkHandoff(h, T)).toEqual({ upTo: 6, by: 'journal' })
    for (const x of HEADINGS) expect(h).toContain(`## ${x}`)
    expect(h).toContain('# Handoff: Currency on prices')
    expect(h).toContain('- src/money.ts')
    expect(h).toContain('Bash · npm test')
    expect(h).toContain('Should the cart show it too?')
    expect(checkHandoff(h, 'another')).toBeNull()
  })
  it('a secret in the journal is not carried', () => {
    const events = [...thread(), ev({ type: 'tool', call: 'c3', name: 'Bash', summary: 'Bash · STRIPE_API_KEY=fake-value-for-the-test-0123 npm run pay' })]
    expect(journalHandoff(T, events, Date.now())).not.toContain('fake-value-for-the-test-0123')
  })
  it('the small model rewrites it when its answer keeps the shape; otherwise the journal writes it', async () => {
    const events = thread()
    const good = async (prompt: string) => {
      expect(prompt).toContain('<events>')
      return journalHandoff(T, events, 0).replace('## Decisions\n', '## Decisions\n- Prices use the shop locale.\n')
    }
    const a = await nextHandoff({ thread: T, events, previous: null, now: 1, by: 'claude:a3f9c1@laptop', write: good })
    expect(a.by).toBe('claude:a3f9c1@laptop')
    expect(a.text).toContain('Prices use the shop locale')
    expect(checkHandoff(a.text, T)).toEqual({ upTo: 6, by: 'claude:a3f9c1@laptop' })
    const b = await nextHandoff({ thread: T, events, previous: null, now: 1, by: 'x', write: async () => 'Sure! Here is a summary.' })
    expect(b.by).toBe('journal')
    const c = await nextHandoff({ thread: T, events, previous: null, now: 1, by: 'x', write: async () => 'x'.repeat(HANDOFF_MAX * 2) })
    expect(c.by).toBe('journal')
    const d = await nextHandoff({ thread: T, events, previous: null, now: 1, by: 'x', write: () => Promise.reject(new Error('limit')) })
    expect(d.by).toBe('journal')
    expect(handoffEvent(a.text, a.upTo, a.by, 1, T)).toMatchObject({ type: 'handoff', upTo: 6, by: a.by, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })
  it('the first request of a new session: signed, the handoff, what came after it, the last messages, the request', () => {
    const events = thread()
    const h = journalHandoff(T, events.slice(0, 4), 0)
    const text = firstRequest(T, events, h, 'And on the cart?')
    expect(text.startsWith(prefaceSign(T))).toBe(true)
    expect(text).toContain('Do not mention the change.')
    const order = ['<handoff>', '<since-the-handoff>', '<last-messages>', '<request>'].map((x) => text.indexOf(x))
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true)
    expect(text).toContain(renderSince(events, 4))
    expect(text.endsWith('And on the cart?\n</request>')).toBe(true)
  })
})
