import { describe, expect, it } from 'vitest'
import { RESULT_KEEP, RESULT_MAX, slimLine, slimMarker, slimRaw } from './slim.ts'

const M = 'alex-macbook-7'
const big = (n: number, c = 'x') => c.repeat(n)
const SIG = 'EqQBCkYIBxgCKkDu9+signature/with=padding=='
/** A Claude line as Claude Code writes it: odd spacing, a number that would not survive a parse, a signed block. */
const claude = (content: unknown[], more = '') => `{"parentUuid":"p-1","isSidechain":false, "cwd":"/home/alex/shop","sessionId":"s","big":12345678901234567890,"type":"user","message":{"role":"user","content":${JSON.stringify(content)}}${more},"uuid":"u-1","timestamp":"2026-11-20T10:00:00.000Z"}`
const thinking = { type: 'thinking', thinking: 'Let me look at é 😀 the file "a.ts"', signature: SIG }
const parse = (l: string) => JSON.parse(l) as { message: { content: { type: string; content?: unknown; text?: string; thinking?: string; signature?: string; tool_use_id?: string }[] }; toolUseResult?: unknown; uuid: string; parentUuid: string }

describe('slim raw (docs/spec/07-vault.md): the two cuts, and nothing else', () => {
  it('a line with nothing to cut is the same string, whatever is in it', () => {
    const lines = [
      claude([{ type: 'tool_result', tool_use_id: 't1', content: big(RESULT_MAX) }]), // exactly 20 KB: kept
      claude([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big(5000) }] }], `,"toolUseResult":${JSON.stringify({ stdout: big(1900) })}`),
      claude([{ type: 'text', text: big(90_000) }]), // a long message of the person is not a tool result
      claude([thinking, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: big(40_000) } }]),
      claude([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big(60_000, 'A') } }]), // a pasted picture
      claude([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], `,"toolUseResult":${JSON.stringify(big(5000))}`), // a string: an error text
      '{"type":"summary","summary":"x"}',
      JSON.stringify('a line cut by a crash, kept as a JSON string "toolUseResult" "tool_result" ' + big(30_000)),
      'not json at all "tool_result" ' + big(30_000),
    ]
    for (const l of lines) expect(slimLine(l, 'claude', M)).toBe(l)
  })

  it('a tool result over 20 KB keeps its first and last 8 KB with the marker naming the machine; the rest of the line is the same bytes', () => {
    const text = `${big(RESULT_KEEP, 'a')}${big(30_000, 'm')}${big(RESULT_KEEP, 'z')}`
    const line = claude([thinking, { type: 'tool_result', tool_use_id: 'toolu_1', content: text }])
    const slim = slimLine(line, 'claude', M)
    expect(slim).not.toBe(line)
    const got = parse(slim).message.content[1].content as string
    expect(got).toBe(`${big(RESULT_KEEP, 'a')}\n[… 29 KB kept on ${M} …]\n${big(RESULT_KEEP, 'z')}`)
    expect(got).toContain(slimMarker(30_000, M))
    // Around the cut value, not one byte moved: the number no parser keeps, the spacing, the signed block's own text.
    const at = line.indexOf(JSON.stringify(text))
    expect(slim.slice(0, at)).toBe(line.slice(0, at))
    expect(slim.endsWith(line.slice(at + JSON.stringify(text).length))).toBe(true)
    expect(slim).toContain('"big":12345678901234567890,')
    expect(slim).toContain(JSON.stringify(thinking))
    expect(parse(slim).message.content[0]).toEqual(thinking)
    expect(parse(slim).message.content[1].tool_use_id).toBe('toolu_1')
  })

  it('cuts text blocks one by one, never half a character, and turns an image over 20 KB into the marker alone', () => {
    const emoji = '😀'.repeat(8000) // 32 KB, four bytes each
    const line = claude([
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: emoji }, { type: 'text', text: 'short' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: big(400_000, 'A') } }] },
      { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big(900, 'A') } }] },
    ])
    const c = parse(slimLine(line, 'claude', M)).message.content
    const [t, s, img] = c[0].content as { type: string; text: string }[]
    expect(t.text.startsWith('😀'.repeat(2048))).toBe(true)
    expect(t.text.endsWith('😀'.repeat(2048))).toBe(true)
    expect(t.text.includes(`\n[… 15 KB kept on ${M} …]\n`)).toBe(true)
    expect(Buffer.from(t.text).toString()).toBe(t.text) // no lone surrogate
    expect(s).toEqual({ type: 'text', text: 'short' })
    expect(img.type).toBe('text')
    expect(img.text).toMatch(new RegExp(`^\\[… image, 39\\d KB kept on ${M} …\\]$`))
    expect(c[1].content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big(900, 'A') } }]) // a small picture stays
  })

  it('drops toolUseResult over 2 KB, wherever it sits in the line, and keeps a smaller one', () => {
    const result = { type: 'tool_result', tool_use_id: 't1', content: 'done' }
    const tur = JSON.stringify({ stdout: big(3000), stderr: '', interrupted: false })
    const last = `{"type":"user","message":{"role":"user","content":[${JSON.stringify(result)}]},"uuid":"u-2","toolUseResult":${tur}}`
    const first = `{"toolUseResult":${tur},"type":"user","message":{"role":"user","content":[${JSON.stringify(result)}]},"uuid":"u-2"}`
    const middle = claude([result], `, "toolUseResult" : ${tur} `)
    expect(slimLine(last, 'claude', M)).toBe(`{"type":"user","message":{"role":"user","content":[${JSON.stringify(result)}]},"uuid":"u-2"}`)
    expect(slimLine(first, 'claude', M)).toBe(`{"type":"user","message":{"role":"user","content":[${JSON.stringify(result)}]},"uuid":"u-2"}`)
    const m = slimLine(middle, 'claude', M)
    expect(parse(m).toolUseResult).toBeUndefined()
    expect(parse(m).uuid).toBe('u-1')
    expect(m).toContain('"big":12345678901234567890,')
    const small = claude([result], `,"toolUseResult":${JSON.stringify({ stdout: big(1000) })}`)
    expect(slimLine(small, 'claude', M)).toBe(small)
    // Both cuts in one line.
    const both = claude([{ type: 'tool_result', tool_use_id: 't1', content: big(50_000) }], `,"toolUseResult":${tur}`)
    const b = parse(slimLine(both, 'claude', M))
    expect(b.toolUseResult).toBeUndefined()
    expect((b.message.content[0].content as string).length).toBeLessThan(RESULT_MAX)
  })

  it('is idempotent: slim of slim is slim', () => {
    const lines = [
      claude([{ type: 'tool_result', tool_use_id: 't1', content: big(100_000) }], `,"toolUseResult":${JSON.stringify({ stdout: big(100_000) })}`),
      claude([{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'é'.repeat(30_000) }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: big(100_000, 'A') } }] }]),
    ]
    for (const l of lines) {
      const once = slimLine(l, 'claude', M)
      expect(once.length).toBeLessThan(l.length / 4)
      expect(slimLine(once, 'claude', M)).toBe(once)
    }
  })

  it('Codex: tool outputs and command outputs over 20 KB are cut the same way; reasoning and compaction stay byte for byte', () => {
    const out = (payload: unknown) => `{"timestamp":"2026-11-20T10:00:00.000Z","type":"response_item","payload":${JSON.stringify(payload)}}`
    const text = `${big(RESULT_KEEP, 'a')}${big(50_000, 'm')}${big(RESULT_KEEP, 'z')}`
    const str = slimLine(out({ type: 'function_call_output', call_id: 'c1', output: text }), 'codex', M)
    expect((JSON.parse(str) as { payload: { output: string; call_id: string } }).payload).toEqual({ type: 'function_call_output', call_id: 'c1', output: `${big(RESULT_KEEP, 'a')}\n[… 49 KB kept on ${M} …]\n${big(RESULT_KEEP, 'z')}` })
    const arr = slimLine(out({ type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text }, { type: 'input_image', image_url: `data:image/png;base64,${big(300_000, 'A')}`, detail: 'high' }] }), 'codex', M)
    const items = (JSON.parse(arr) as { payload: { output: { type: string; text: string }[] } }).payload.output
    expect(items[0].text).toContain(`[… 49 KB kept on ${M} …]`)
    expect(items[1].type).toBe('input_text')
    expect(items[1].text).toMatch(/^\[… image, 29\d KB kept on /)
    const cmd = `{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"CommandExecution","id":"x","command":["ls"],"aggregated_output":${JSON.stringify(text)},"exit_code":0}}}`
    expect((JSON.parse(slimLine(cmd, 'codex', M)) as { payload: { item: { aggregated_output: string; exit_code: number } } }).payload.item).toMatchObject({ aggregated_output: expect.stringContaining('KB kept on') as string, exit_code: 0 })
    for (const keep of [
      out({ type: 'reasoning', summary: [], encrypted_content: big(80_000, 'Q') }),
      out({ type: 'message', role: 'user', content: [{ type: 'input_text', text: big(80_000) }] }),
      `{"type":"compacted","payload":{"replacement_history":[{"type":"function_call_output","output":${JSON.stringify(big(80_000))}}]}}`,
      out({ type: 'function_call_output', call_id: 'c1', output: big(RESULT_MAX) }),
    ]) expect(slimLine(keep, 'codex', M)).toBe(keep)
    expect(slimLine(str, 'codex', M)).toBe(str)
    expect(slimLine(arr, 'codex', M)).toBe(arr)
  })

  it('a segment keeps every line in order, uncut lines as the identical bytes, and appended bytes slim to the same as the whole', async () => {
    const lines = [
      claude([{ type: 'text', text: 'hello' }]),
      claude([thinking]),
      claude([{ type: 'tool_result', tool_use_id: 't1', content: big(70_000) }], `,"toolUseResult":${JSON.stringify({ stdout: big(70_000) })}`),
      claude([{ type: 'text', text: 'après, é' }]),
      claude([{ type: 'tool_result', tool_use_id: 't2', content: big(30_000, 'q') }]),
      claude([{ type: 'text', text: 'end' }]),
    ]
    const raw = Buffer.from(`${lines.join('\n')}\n`)
    const slim = await slimRaw(raw, 'claude', M)
    expect(slim.toString()).toBe(`${lines.map((l) => slimLine(l, 'claude', M)).join('\n')}\n`)
    expect(slim.length).toBeLessThan(raw.length / 3)
    // A segment with nothing to cut is the same buffer.
    const plain = Buffer.from(`${lines[0]}\n${lines[1]}\n`)
    expect(await slimRaw(plain, 'claude', M)).toBe(plain)
    // What a second push adds, slimmed alone, is the tail of the whole slimmed.
    const cutAt = Buffer.byteLength(`${lines.slice(0, 3).join('\n')}\n`)
    const a = await slimRaw(raw.subarray(0, cutAt), 'claude', M, 1)
    const b = await slimRaw(raw.subarray(cutAt), 'claude', M, 1)
    expect(Buffer.concat([a, b]).equals(slim)).toBe(true)
    expect((await slimRaw(slim, 'claude', M)).equals(slim)).toBe(true)
  })
})
