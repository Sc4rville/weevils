// Replies read like a chat app: the blocks an agent writes are recognised, emphasis never reaches into code or links.
import { describe, expect, it } from 'vitest'
import { blocks, spans, type Block } from './md'

describe('blocks', () => {
  it('headings, a bold line as heading, paragraphs, lists after a paragraph line, quote, rule', () => {
    const b = blocks('## Done\nThe fix is live.\nWhat changed:\n- one **thing**\n  - a detail\n- two\n\n**Next steps:**\n1. ship\n2. tell Scarville\n\n> send this\n> to them\n\n---\nend')
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'list', 'heading', 'list', 'quote', 'rule', 'para'])
    expect(b[2]).toMatchObject({ ordered: false, items: [{ text: 'one **thing**', sub: ['a detail'] }, { text: 'two', sub: [] }] })
    expect(b[3]).toMatchObject({ level: 3, text: 'Next steps' })
    expect(b[4]).toMatchObject({ ordered: true, start: 1 })
    expect(b[5]).toMatchObject({ text: 'send this\nto them' })
  })
  it('a table and a fenced code block keep their content', () => {
    const b = blocks('| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 |\n\n```sh\nnpm test\n# not a heading\n```')
    expect(b[0]).toEqual({ kind: 'table', head: ['a', 'b'], rows: [['1', '2'], ['3']] })
    expect(b[1]).toEqual({ kind: 'code', lang: 'sh', body: 'npm test\n# not a heading' })
  })
  it('an unclosed fence takes the rest; plain text stays one paragraph with its line breaks', () => {
    expect(blocks('one\ntwo')).toEqual([{ kind: 'para', text: 'one\ntwo' }])
    expect(blocks('```\nx')).toEqual([{ kind: 'code', lang: '', body: 'x' }])
  })
})

describe('spans', () => {
  it('bold and italic, not inside code, snake_case or a link target', () => {
    expect(spans('a **b** *c* _d_')).toEqual([{ kind: 'text', s: 'a ' }, { kind: 'strong', s: 'b' }, { kind: 'text', s: ' ' }, { kind: 'em', s: 'c' }, { kind: 'text', s: ' ' }, { kind: 'em', s: 'd' }])
    expect(spans('`a **b**` my_var_name 2*3*4')).toEqual([{ kind: 'text', s: '`a **b**` my_var_name 2*3*4' }])
    expect(spans('[x](https://a.io/_b_)')).toEqual([{ kind: 'text', s: '[x](https://a.io/_b_)' }])
  })
})

describe('a win weevboss marked', () => {
  it('[[win]]**…** is a coloured phrase; ordinary bold stays bold; a lone marker never shows', () => {
    expect(spans('By the way, [[win]]**Pli now continues on the VPS**, with all its history.')).toEqual([
      { kind: 'text', s: 'By the way, ' },
      { kind: 'win', s: 'Pli now continues on the VPS' },
      { kind: 'text', s: ', with all its history.' },
    ])
    expect(spans('**not yet**: on a branch')).toEqual([{ kind: 'strong', s: 'not yet' }, { kind: 'text', s: ': on a branch' }])
    expect(spans('done [[win]] here')).toEqual([{ kind: 'text', s: 'done here' }])
  })
})


it('a fold: « +++ Summary » … « +++ », closed at first, its inside read as blocks again', () => {
  const b = blocks('What it does:\n\n- one\n- two\n\n+++ See the details\n- a key for weevils alone\n\n`~/weevils`\n+++\n\nAfter.')
  expect(b.map((x) => x.kind)).toEqual(['para', 'list', 'fold', 'para'])
  const f = b[2] as Extract<Block, { kind: 'fold' }>
  expect(f.summary).toBe('See the details')
  expect(f.body.map((x) => x.kind)).toEqual(['list', 'para'])
  // A lone « +++ » with nothing open is plain text; an unclosed fold runs to the end.
  expect(blocks('+++').map((x) => x.kind)).toEqual(['para'])
  expect((blocks('+++ More\nrest') [0] as Extract<Block, { kind: 'fold' }>).body).toEqual([{ kind: 'para', text: 'rest' }])
})
