// Sessions in weevils next use the app's session page (pages.tsx SessionPage) and its stand-ins (src/ui/pending.ts),
// not the threads reading whose stand-in only goes when the server's text is exactly the typed one. These pin that a
// sent message shows once, whatever the server adds to it.
import { describe, expect, it } from 'vitest'
import type { Message } from '../../shared/api.ts'
import { mergePending, type Pending } from '../../src/ui/pending.ts'

const before: Message[] = [{ id: 'u0', role: 'user', text: 'start', at: 1 } as Message, { id: 'a0', role: 'assistant', text: 'ok', at: 2 } as Message]
const stand = (typed: string): Pending => ({ id: 'pending-1', role: 'user', text: typed, at: 3, typed, after: 'a0', known: ['u0'] })

describe('a sent message in a session shows once', () => {
  it('while the server does not have it: once, as its stand-in', () => {
    expect(mergePending(before, [stand('merge it')]).map((m) => m.id)).toEqual(['u0', 'a0', 'pending-1'])
  })
  it('with a photo the server added: once, the server copy in its place', () => {
    const real = [...before, { id: 'u1', role: 'user', text: 'merge it (photo: /home/x/inbox/a.jpg)', at: 4 } as Message, { id: 'a1', role: 'assistant', text: 'done', at: 5 } as Message]
    expect(mergePending(real, [stand('merge it')]).map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1'])
  })
  it("with weevils' context the server added: once", () => {
    const real = [...before, { id: 'u1', role: 'user', text: 'merge it ⟦weevils context⟧', at: 4 } as Message]
    expect(mergePending(real, [stand('merge it')]).map((m) => m.id)).toEqual(['u0', 'a0', 'u1'])
  })
  it('an older message with the same words does not hide the new one', () => {
    const real: Message[] = [{ id: 'u0', role: 'user', text: 'merge it', at: 1 } as Message]
    expect(mergePending(real, [{ ...stand('merge it'), after: 'u0' }]).map((m) => m.id)).toEqual(['u0', 'pending-1'])
  })
})
