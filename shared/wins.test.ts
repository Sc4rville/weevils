// A win weevboss marks in its reply ([[win]]**…**) and the wins weevils detects are one moment when close together:
// one id, so the app celebrates once. Ordinary bold is never a win; the marker never reaches voice or notifications.
import { describe, expect, it } from 'vitest'
import type { Message } from './api.ts'
import { humanFeedText } from './feed-text.ts'
import { splitChips } from './setup.ts'
import { saysWin, threadWins, WIN_GROUP_MS, withoutWinMarks } from './wins.ts'

const boss = (id: string, text: string, at: number, o: Partial<Message> = {}): Message => ({ id, role: 'assistant', text, at, ...o })
const MIN = 60_000

describe('wins in weevboss’s thread', () => {
  it('a marked bold phrase is a win; ordinary bold, plans and other authors are not', () => {
    expect(saysWin('By the way, [[win]]**Pli now continues on the VPS**, with all its history.')).toBe(true)
    expect(saysWin('**not yet**: the fix is on a branch')).toBe(false)
    expect(saysWin('[[win]] no bold here')).toBe(false)
    const out = threadWins([
      boss('a', '**bug** found, on it', 0),
      boss('b', '[[win]]**Deployed**: the new themes are live.', 10 * MIN),
      boss('c', '[[win]]**Devil** says hi', 20 * MIN, { devil: true }),
      { id: 'u', role: 'user', text: '[[win]]**me**', at: 30 * MIN } as Message,
    ])
    expect(out.map((m) => m.win?.id)).toEqual([undefined, 'said:b', undefined, undefined])
    expect(out[1].win).toEqual({ id: 'said:b', kind: 'said', at: 10 * MIN })
  })

  it('a detected win and weevboss announcing it are one celebration, whichever comes first', () => {
    const event = boss('setup-1', '[[win]]**“Pli” now continues on vps**, with all its history.', 0, { win: { id: 'move:t:0', kind: 'move', at: 0 } })
    const said = boss('r1', 'By the way, [[win]]**Pli now continues on the VPS**.', 40_000)
    expect(threadWins([event, said]).map((m) => m.win?.id)).toEqual(['move:t:0', 'move:t:0'])
    // weevboss first: the line that follows takes its id; the earlier one never changes as the thread grows.
    const first = threadWins([{ ...said, at: 0 }])[0].win?.id
    const both = threadWins([{ ...said, at: 0 }, { ...event, at: 30_000 }])
    expect(both.map((m) => m.win?.id)).toEqual([first, first])
    // Far apart: two moments, two celebrations.
    expect(new Set(threadWins([event, { ...said, at: WIN_GROUP_MS + 1 }]).map((m) => m.win?.id)).size).toBe(2)
  })

  it('the marker is dropped for voice, notifications and For you; the words stay', () => {
    const t = 'By the way, [[win]]**Pli now continues on the VPS**.'
    expect(withoutWinMarks(t)).toBe('By the way, **Pli now continues on the VPS**.')
    expect(splitChips(t).text).toBe('By the way, **Pli now continues on the VPS**.')
    expect(humanFeedText(t)).not.toContain('[[win]]')
  })
})
