// The five internal layouts of « For you »: every legacy kind maps to one of them or is hidden, the lines stay short.
import { describe, expect, it } from 'vitest'
import type { ForYouItem } from '../../shared/foryou.ts'
import { bigNumber, cardLine, formatOf, LINE_MAX, shortLine, STREAM_CAP, streamOf } from './foryou-format'

const it0 = (o: Partial<ForYouItem>): ForYouItem => ({ id: 'x', kind: 'boss', tone: 'neutral', at: 1, who: 'weevils', text: 'Something.', ...o })
const media = [{ id: 'm', type: 'image' as const, url: '/m', name: 'm.png', bytes: 1 }]

describe('formatOf', () => {
  it.each<[string, Partial<ForYouItem>, ReturnType<typeof formatOf>]>([
    ['live proposals ask for a tap', { kind: 'proposals', cards: [{ id: 'c', title: 'T', why: '', source: 'tip', kind: 'k' }] }, 'action'],
    ['empty proposals hide', { kind: 'proposals', cards: [] }, null],
    ['an alert asks for a look', { kind: 'alert', tone: 'alert' }, 'action'],
    ['a mail asks for a look', { kind: 'mail' }, 'action'],
    ['a question asks for an answer', { kind: 'session', tone: 'question' }, 'action'],
    ['a cut session asks for a look', { kind: 'session', tone: 'alert' }, 'action'],
    ['a result is progress', { kind: 'session', tone: 'result' }, 'progress'],
    ['a result with media is visual', { kind: 'session', tone: 'result', media }, 'visual'],
    ['a neutral session hides', { kind: 'session', tone: 'neutral' }, null],
    ['media is visual', { kind: 'media', media }, 'visual'],
    ['a result group is visual', { kind: 'media', resultGroup: { key: 'tlo-alcove', final: media[0], finalAt: 1, history: [], otherMedia: [], newerUpdate: false } }, 'visual'],
    ['a boss idea with buttons is action', { kind: 'boss', actions: [{ id: 'a', label: 'do' }] }, 'action'],
    ['a boss word without buttons is a thought', { kind: 'boss' }, 'think'],
    ['an automation start is chatter', { kind: 'boss', id: 'auto:go:1' }, null],
    ['an automation done is progress', { kind: 'boss', id: 'auto:done:1' }, 'progress'],
    ['an automation proposal is action', { kind: 'boss', id: 'auto:proposed:1' }, 'action'],
    ['improve with buttons is action', { kind: 'improve', actions: [{ id: 'a', label: 'do' }] }, 'action'],
    ['improve without is a thought', { kind: 'improve' }, 'think'],
    ['an insight is learn', { kind: 'insight' }, 'learn'],
    ['the token audit hides', { kind: 'insight', id: 'cost:audit:1' }, null],
    ['a milestone is progress', { kind: 'milestone', text: '100 turns' }, 'progress'],
    ['a repeated saving line hides', { kind: 'stat', id: 'cost:gain:1', text: 'saved 12 %' }, null],
    ['plain bars without a figure hide', { kind: 'stat', text: '' }, null],
    ['a stat with a figure is progress', { kind: 'stat', text: '12 turns today' }, 'progress'],
    ['work in progress is chatter', { work: { intentId: 'i', status: 'running' } }, null],
    ['work done is progress', { work: { intentId: 'i', status: 'completed' } }, 'progress'],
  ])('%s', (_, o, want) => expect(formatOf(it0(o))).toBe(want))
})

describe('short lines', () => {
  it('keeps the first sentence, drops markdown, clamps on a word', () => {
    expect(shortLine('**Shipped** the `menu`. Then a long tail of details nobody needs here.')).toBe('Shipped the menu.')
    const long = 'word '.repeat(80)
    const line = shortLine(long)
    expect(line.length).toBeLessThanOrEqual(LINE_MAX + 1)
    expect(line.endsWith('…')).toBe(true)
  })
  it('a big number comes out of a milestone', () => {
    expect(bigNumber(it0({ kind: 'milestone', text: '100 turns delivered' }))).toEqual({ n: '100', rest: 'turns delivered' })
    expect(bigNumber(it0({ kind: 'milestone', text: 'a first time' }))).toBeNull()
  })
  it('an own proposal keeps its title (the card renders it as the user’s)', () => {
    expect(cardLine(it0({ kind: 'proposals', cards: [{ id: 'c', title: 'Run the backup nightly', why: 'x', source: 'optimizer', kind: 'k', own: true }] }))).toBe('Run the backup nightly')
  })
})

describe('streamOf', () => {
  it('keeps only items with a layout, at most STREAM_CAP', () => {
    const many = Array.from({ length: 200 }, (_, i) => it0({ id: `b${i}`, kind: i % 2 ? 'boss' : 'stat', text: i % 2 ? 'A thought.' : '' }))
    const out = streamOf(many)
    expect(out.length).toBe(STREAM_CAP)
    expect(out.every((i) => i.kind === 'boss')).toBe(true)
    expect(STREAM_CAP).toBeLessThanOrEqual(60)
  })
})

describe('plainLine paths', () => {
  it('drops file paths but keeps before/after words', async () => {
    const { plainLine } = await import('./foryou-format')
    expect(plainLine('Fixed src/ui/foryou.tsx and ~/x/y today')).toBe('Fixed and today')
    expect(plainLine('before/after shots')).toBe('before/after shots')
  })
})
