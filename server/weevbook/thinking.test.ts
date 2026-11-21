// Claude's signed blocks through the weevbook (docs/spec/07-vault.md, VAULT-4): raw keeps them byte for byte, a
// session moved to another folder keeps them byte for byte, and a block an older redaction changed is dropped at
// resume, the conversation staying one chain.
import { describe, expect, it } from 'vitest'
import { rewritePaths } from '../bring.ts'
import { REDACTED, redactRawLine } from './redact.ts'
import { mendThinking } from './resume.ts'

const thinking = { type: 'thinking', thinking: 'The key is password=hunter22 in /home/alex/shop/.env', signature: 'EqQBCkYIBxgCKkA+/sig==' }
const line = (o: object) => JSON.stringify(o)

describe('signed blocks in raw', () => {
  it('redaction leaves a thinking block as written and still redacts the rest of the line', () => {
    const l = line({ type: 'assistant', uuid: 'a', message: { content: [thinking, { type: 'text', text: 'set password=hunter22' }] } })
    const out = JSON.parse(redactRawLine(l))
    expect(out.message.content[0]).toEqual(thinking)
    expect(out.message.content[1].text).toContain(REDACTED)
    expect(out.message.content[1].text).not.toContain('hunter22')
  })

  it('redacted_thinking too', () => {
    const r = { type: 'redacted_thinking', data: 'token=abcdefghijklmnop' }
    const l = line({ type: 'assistant', uuid: 'a', message: { content: [r] } })
    expect(redactRawLine(l)).toBe(l)
  })

  it('a session moved to another folder keeps its thinking byte for byte; every other path moves', () => {
    const l = line({ type: 'assistant', cwd: '/home/alex/shop', uuid: 'a', message: { content: [thinking, { type: 'tool_use', input: { file_path: '/home/alex/shop/a.ts' } }] } })
    const text = `${l}\n${line({ type: 'user', cwd: '/home/alex/shop' })}\n`
    const [a, b] = rewritePaths(text, '/home/alex/shop', '/srv/shop').split('\n').map((x) => (x ? JSON.parse(x) : x))
    expect(a.message.content[0]).toEqual(thinking)
    expect(a.cwd).toBe('/srv/shop')
    expect(a.message.content[1].input.file_path).toBe('/srv/shop/a.ts')
    expect(b.cwd).toBe('/srv/shop')
  })

  it('a session with no signed block is rewritten as text, as before', () => {
    expect(rewritePaths('{"cwd":"/a/b"}\n{"x":"/a/b/c"}\n', '/a/b', '/z')).toBe('{"cwd":"/z"}\n{"x":"/z/c"}\n')
  })
})

describe('thinking an older redaction changed', () => {
  it('goes at resume; a line left empty goes too and its child takes its parent', () => {
    const bad = { ...thinking, thinking: `The key is password=${REDACTED}` }
    const text = [
      line({ type: 'user', uuid: 'u1', parentUuid: null, message: { content: 'hi' } }),
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [bad] } }),
      line({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', message: { content: [thinking, { type: 'text', text: 'ok' }] } }),
      line({ type: 'assistant', uuid: 'a3', parentUuid: 'a2', message: { content: [bad, { type: 'text', text: 'done' }] } }),
      '',
    ].join('\n')
    const out = mendThinking(text).split('\n').filter(Boolean).map((x) => JSON.parse(x))
    expect(out.map((o) => o.uuid)).toEqual(['u1', 'a2', 'a3'])
    expect(out[1]).toMatchObject({ parentUuid: 'u1', message: { content: [thinking, { type: 'text', text: 'ok' }] } })
    expect(out[2].message.content).toEqual([{ type: 'text', text: 'done' }])
  })

  it('a session with nothing damaged is returned as it is', () => {
    const text = `${line({ type: 'assistant', uuid: 'a', message: { content: [thinking] } })}\n`
    expect(mendThinking(text)).toBe(text)
  })
})
