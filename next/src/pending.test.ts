import { describe, expect, it } from 'vitest'
import type { Message } from '../../shared/api.ts'
import { stillPending, words, type Pending } from './pending.ts'

const u = (id: string, text: string): Message => ({ id, role: 'user', text, at: 1 }) as Message
const a = (id: string, text: string): Message => ({ id, role: 'assistant', text, at: 1 }) as Message
const stand = (key: string, text: string, before: Message[]): Pending => ({ key, text, photos: [], known: new Set(before.filter((m) => m.role === 'user').map((m) => m.id)) })

describe('stand-ins of sent messages', () => {
  const before = [u('u0', 'hello'), a('a0', 'hi')]

  it('ends when the server copy carries a photo the typed text did not', () => {
    const p = [stand('k', 'c tellement lent et long', before)]
    const after = [...before, u('u1', 'so slow and long (photo: /home/x/inbox/a.jpg)'), a('a1', 'Agreed')]
    expect(stillPending(p, after)).toEqual([])
  })

  it('ends with a file or weevils context added, French spacing included', () => {
    expect(words('voici ⟦weevils ctx⟧ (fichier : /in/a.pdf)')).toBe('voici')
    expect(stillPending([stand('k', 'voici', before)], [...before, u('u1', 'voici (fichier : /in/a.pdf)')])).toEqual([])
  })

  it('stays while the server has not got it, even when the thread only keeps its last messages', () => {
    const p = [stand('k', 'new one', before)]
    expect(stillPending(p, before)).toEqual(p)
    expect(stillPending(p, [before[1]])).toEqual(p)
  })

  it('ends in order when the server copy reads differently: one new user message per stand-in', () => {
    const p = [stand('k1', 'first', before), stand('k2', 'second', before)]
    const one = [...before, u('u1', 'FIRST, as rewritten')]
    expect(stillPending(p, one).map((x) => x.key)).toEqual(['k2'])
    expect(stillPending(p, [...one, u('u2', 'second')])).toEqual([])
  })

  it('an older message with the same words does not end a new stand-in', () => {
    const p = [stand('k', 'hello', before)]
    expect(stillPending(p, before)).toEqual(p)
  })
})
