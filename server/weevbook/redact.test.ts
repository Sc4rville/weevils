import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactToolText } from '../codex-command-details.ts'
import { walk } from './store.ts'
import { REDACTED, redactEvent, redactRawLine, redactText, redactValue } from './redact.ts'

describe('redaction (docs/spec/02-weevbook.md#redaction)', () => {
  it('redacts a string whole: no cut at 8,000 characters', () => {
    const long = `${'x'.repeat(20_000)} TOKEN=abc123 ${'y'.repeat(20_000)}`
    expect(redactToolText(long)).toHaveLength(8000)
    const out = redactText(long)
    expect(out).toHaveLength(long.length - 'abc123'.length + REDACTED.length)
    expect(out).toContain('TOKEN=[redacted]')
    expect(out.endsWith('y'.repeat(100))).toBe(true)
  })

  it('is a fixed point (BOOK-9)', () => {
    for (const s of ['Authorization: Bearer abc.def', 'curl https://alex:hunter2@example.com/x', 'sk-abcdefghijklmnop', 'password = "secret value"', 'api_key=1234']) {
      const once = redactText(s)
      expect(once).not.toBe(s)
      expect(redactText(once)).toBe(once)
    }
  })

  it('keeps a raw line byte for byte when nothing in it is a secret', () => {
    // Key order, spacing and escapes are the provider's own: a raw line that parses the same is not enough.
    const line = '{"type":"user", "message":{"content":"caf\\u00e9 on example.com"},"n":1.50}'
    expect(redactRawLine(line)).toBe(line)
  })

  it('redacts each string value of a raw line, which stays JSON (redactToolText on the line would break it)', () => {
    const o = { type: 'user', message: { content: 'deploy with GITHUB_TOKEN=ghp_abc and done' }, headers: { Authorization: 'Bearer sk-live-abcdefghijk' }, list: ['ok', 'password: hunter2'] }
    const line = JSON.stringify(o)
    // The text patterns over the whole line swallow the quotes after a key named like a secret.
    expect(() => JSON.parse(redactToolText(`{"token":"x","b":1}`))).toThrow()
    const out = redactRawLine(line)
    const back = JSON.parse(out)
    expect(back.message.content).toBe('deploy with GITHUB_TOKEN=[redacted] and done')
    expect(back.headers.Authorization).toBe(REDACTED)
    expect(back.list).toEqual(['ok', 'password: [redacted]'])
    expect(back.type).toBe('user')
    expect(out).not.toContain('ghp_abc')
    expect(out).not.toContain('hunter2')
    expect(redactRawLine(out)).toBe(out)
  })

  it('redacts a value under a key that names a secret, whatever it looks like', () => {
    expect(redactValue({ refresh_token: 'r-1', apiKey: 'k', note: 'k' })).toEqual({ refresh_token: REDACTED, apiKey: REDACTED, note: 'k' })
    expect(redactValue({ token: '' })).toEqual({ token: '' })
    const same = { a: [1, 'plain', { b: null }] }
    expect(redactValue(same)).toBe(same)
  })

  it('keeps a line that is not JSON as one JSON string, redacted', () => {
    const out = redactRawLine('{"type":"user","message":{"content":"pass password=abc')
    expect(typeof JSON.parse(out)).toBe('string')
    expect(JSON.parse(out)).toBe('{"type":"user","message":{"content":"pass password=[redacted]')
  })

  it('redacts every string field of an event', () => {
    const e = redactEvent({ id: 'x', at: '2026-11-16T09:00:00Z', leg: 'L1', type: 'tool', call: 'c', name: 'Bash', summary: 'Bash · curl -H "Authorization: Bearer abc"' } as const)
    expect(e.summary).toBe('Bash · curl -H "Authorization: [redacted] [redacted]"')
    expect(redactEvent(e)).toBe(e)
  })

  it('redacting twice changes nothing: every line and string of the fixtures, and commands that name a variable (BOOK-9)', async () => {
    const leaves = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [])
    const home = path.resolve(import.meta.dirname, '../../test/fixtures/weevbook/home')
    const shapes = [
      '. "$CONF"; EXAMPLE_API_KEY="$EXAMPLE_API_KEY" npm run check && echo done',
      'k=$(grep -h "^EXAMPLE_API_KEY=" .env 2>/dev/null | cut -d= -f2-)',
      'EXAMPLE_API_KEY="$(grep -h "^EXAMPLE_API_KEY=" .env | cut -d= -f2-)" npm run check',
      'export EXAMPLE_TOKEN=abc123 && curl -H "Authorization: Bearer $EXAMPLE_TOKEN" https://example.com',
    ]
    const lines = [...shapes.map((command) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }))]
    for (const f of await walk(home)) if (f.endsWith('.jsonl')) lines.push(...fs.readFileSync(path.join(home, f), 'utf8').split('\n').filter((l) => l.trim()))
    expect(lines.length).toBeGreaterThan(70)
    for (const line of lines) {
      const once = redactRawLine(line)
      expect(redactRawLine(once), line).toBe(once)
      for (const s of leaves(JSON.parse(once))) expect(redactText(s), s).toBe(s)
    }
    // A variable named is not a value: those lines stay as they were.
    for (const l of lines.slice(0, 3)) expect(redactRawLine(l)).toBe(l)
  })
})
