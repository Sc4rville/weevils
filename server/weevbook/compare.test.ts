import { describe, expect, it } from 'vitest'
import { diffSession, redactedFrom, type Item } from './compare.ts'

describe('compare: what counts as a redaction', () => {
  it('the weevbook may replace parts of the app’s text with [redacted], never change the rest', () => {
    expect(redactedFrom('deploy with TOKEN abc123 then ok', 'deploy with TOKEN [redacted] then ok')).toBe(true)
    expect(redactedFrom('a=1 b=2 c=3', '[redacted] b=2 [redacted]')).toBe(true)
    expect(redactedFrom('a b c', 'a [redacted]')).toBe(true)
    // The app redacted part of it already, the weevbook more.
    expect(redactedFrom('run KEY=[redacted]68fd4 now', 'run KEY=[redacted] now')).toBe(true)
    expect(redactedFrom('deploy with TOKEN abc123 then ok', 'deploy with TOKEN [redacted] then no')).toBe(false)
    expect(redactedFrom('deploy with TOKEN abc123', 'deploy [redacted] TOKEN abc123 extra')).toBe(false)
    expect(redactedFrom('same text', 'same text')).toBe(false)
  })

  it('two labels cut at the same length are compared on what both show', () => {
    expect(redactedFrom('Bash · grep -cE "^KEY=[redacted]68fd4…', 'Bash · grep -cE "^KEY=[redacted]…')).toBe(true)
    expect(redactedFrom('Bash · run KEY=abcdef0123 && make bui…', 'Bash · run KEY=[redacted] && make build && make t…')).toBe(true)
    expect(redactedFrom('Bash · npm test…', 'Bash · run KEY=[redacted]…')).toBe(false)
  })

  it('a step redacted more and a usage limit are intended differences, not losses', () => {
    const app: Item[] = [
      { kind: 'said', role: 'user', text: 'Check the key is set.' },
      { kind: 'step', key: 'Bash · grep -cE "^KEY=[redacted]68fd4…' },
      { kind: 'reply', text: "You've hit your weekly limit · resets Nov 13, 4pm (UTC)" },
    ]
    const book = [
      { kind: 'said', role: 'user', text: 'Check the key is set.' },
      { kind: 'step', key: 'Bash · grep -cE "^KEY=[redacted]…' },
      { kind: 'failed' },
    ] as Item[]
    expect(diffSession(app, book)).toEqual({ identical: 1, intended: { redacted: 1, long: 0, error: 1 }, missing: [], altered: [], extra: [] })
  })
})
