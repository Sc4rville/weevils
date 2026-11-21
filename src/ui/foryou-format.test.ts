// « For you » as a feed of posts: every legacy kind maps to a post format or is hidden; titles and texts stay whole.
import { describe, expect, it } from 'vitest'
import type { ForYouItem } from '../../shared/foryou.ts'
import { cardLine, cleanSubject, formatOf, LINE_MAX, postParts, routine, shortLine, shortText, STALE_MS, STREAM_CAP, streamOf } from './foryou-format'

const NOW = 10 * 86_400_000
const it0 = (o: Partial<ForYouItem>): ForYouItem => ({ id: 'b:x', kind: 'boss', tone: 'neutral', at: NOW - 60_000, who: 'weevils', text: 'Something.', ...o })
const media = [{ id: 'm', type: 'image' as const, url: '/m', name: 'm.png', bytes: 1 }]
const stream = (items: ForYouItem[]) => streamOf(items, STREAM_CAP, true, NOW)

describe('formatOf', () => {
  it.each<[string, Partial<ForYouItem>, ReturnType<typeof formatOf>]>([
    ['automated proposals never make a post', { kind: 'proposals', cards: [{ id: 'c', title: 'T', why: '', source: 'tip', kind: 'k' }] }, null],
    ['an alert asks for a look', { kind: 'alert', tone: 'alert' }, 'action'],
    ['a mail is a note', { kind: 'mail' }, 'note'],
    ['weevboss relay mail hides', { kind: 'mail', title: '[weevboss] ACTION — brief' }, null],
    ['a question asks for an answer', { kind: 'session', tone: 'question' }, 'action'],
    ['a cut session asks for a look', { kind: 'session', tone: 'alert' }, 'action'],
    ['a result is a note', { kind: 'session', tone: 'result' }, 'note'],
    ['a result with media is visual', { kind: 'session', tone: 'result', media }, 'visual'],
    ['a neutral session hides', { kind: 'session', tone: 'neutral' }, null],
    ['media is visual', { kind: 'media', media }, 'visual'],
    ['a result group is visual', { kind: 'media', resultGroup: { key: 'shop-alcove', final: media[0], finalAt: 1, history: [], otherMedia: [], newerUpdate: false } }, 'visual'],
    ['weevboss asking with buttons is action', { kind: 'boss', actions: [{ id: 'a', label: 'do' }] }, 'action'],
    ['a digest never asks for a tap', { kind: 'boss', id: 'd:1', actions: [{ id: 'a', label: 'do' }] }, 'note'],
    ['a boss word is a note', { kind: 'boss' }, 'note'],
    ['a long titled text is a piece', { kind: 'boss', title: 'On finishing', text: 'A sentence that goes on. '.repeat(20) }, 'piece'],
    ['an automation start is chatter', { kind: 'boss', id: 'auto:go:1' }, null],
    ['an automation proposal is chatter', { kind: 'boss', id: 'auto:proposed:1' }, null],
    ['improve never makes a post', { kind: 'improve', actions: [{ id: 'a', label: 'do' }] }, null],
    ['generated trivia never makes a post', { kind: 'insight' }, null],
    ['a figure alone never makes a post', { kind: 'milestone', text: '100 turns, twice last week' }, null],
    ['stats never make a post', { kind: 'stat', text: '12 turns today, up from 4' }, null],
    ['work in progress is chatter', { work: { intentId: 'i', status: 'running' } }, null],
    ['work done is a note', { work: { intentId: 'i', status: 'completed' } }, 'note'],
  ])('%s', (_, o, want) => expect(formatOf(it0(o))).toBe(want))
})

describe('a post: title on top, short text under it', () => {
  it('a caption splits into its title sentence and the rest', () => {
    const p = postParts(it0({ kind: 'media', media, title: 'Video cards lost their white boxes. Save is a plain icon now, play fades away.', text: '' }))
    expect(p).toEqual({ title: 'Video cards lost their white boxes', text: 'Save is a plain icon now, play fades away.' })
  })
  it('a session result: the outcome is the title, the report goes on under it', () => {
    const p = postParts(it0({ kind: 'session', tone: 'result', title: 'menu', text: 'I built the new café menu. It is live on staging, with prices from the sheet.' }))
    expect(p.title).toBe('Built the new café menu')
    expect(p.text).toBe('It is live on staging, with prices from the sheet.')
  })
  it('a question leads with its short title', () => {
    expect(postParts(it0({ kind: 'session', tone: 'question', lead: 'Merge the spec?', text: 'Do you take my 4 recommendations?' }))).toEqual({ title: 'Merge the spec?', text: 'Do you take my 4 recommendations?' })
  })
  it('never a half-open bracket in a title', () => {
    expect(postParts(it0({ kind: 'media', media, title: 'next: tapping an automation now opens its overview (name, what it does, a link to its results).' })).title).toBe('next: tapping an automation now opens its overview')
  })
  it('a clipped text ends on whole words, never on « the »', () => {
    expect(shortText('The same look as the boss screen — bigger text, your words a tinted band to the right edge, the…')).toBe('The same look as the boss screen — bigger text, your words a tinted band to the right edge')
    expect(shortText('Done and live. Then the second part of the thing was cut in the mid…')).toBe('Done and live.')
  })
})

describe('short lines', () => {
  it('keeps the first sentence, drops markdown, clamps on a word', () => {
    expect(shortLine('**Shipped** the `menu`. Then a long tail of details nobody needs here.')).toBe('Shipped the menu.')
    const line = shortLine('word '.repeat(80))
    expect(line.length).toBeLessThanOrEqual(LINE_MAX)
    expect(line.endsWith('…')).toBe(false)
  })
  it('outcome words, not a diary', () => {
    expect(shortLine("I couldn't run the install test because Docker was blocked.")).toBe("Couldn't run the install test because Docker was blocked.")
  })
})

describe('streamOf', () => {
  it('keeps only posts, at most STREAM_CAP', () => {
    const many = Array.from({ length: 200 }, (_, i) => it0({ id: `b:${i}`, kind: i % 2 ? 'boss' : 'stat', text: i % 2 ? `A word number ${i} worth reading today.` : '12 turns, up from 4' }))
    const out = stream(many)
    expect(out.length).toBe(STREAM_CAP)
    expect(out.every((i) => i.kind === 'boss')).toBe(true)
  })
  it('repeated results of one job fold into the newest, with how many runs', () => {
    const run = (id: string, text: string) => it0({ id, kind: 'session', tone: 'result', title: 'UI ad factory', text })
    const out = stream([run('s:1', 'I rendered three new ads for the café page.'), run('s:2', 'I rendered two new ads for the shop.'), run('s:3', 'I rendered an ad for the gym page.')])
    expect(out.map((i) => [i.id, i.runs])).toEqual([['s:1', 3]])
  })
  it('a routine run that did nothing is not news', () => {
    expect(routine(it0({ kind: 'session', tone: 'result', text: 'I skipped the ad batch this run because the factory is stopped.' }))).toBe(true)
    expect(routine(it0({ kind: 'boss', text: 'UI ad factory: run skipped, no batch started.' }))).toBe(true)
    expect(routine(it0({ kind: 'session', tone: 'result', text: 'I rendered three new ads.' }))).toBe(false)
    expect(stream([it0({ id: 's:1', kind: 'session', tone: 'result', text: 'I skipped the batch this run, nothing to do.' })])).toEqual([])
  })
  it('stale posts leave; a question waiting stays', () => {
    const old = NOW - STALE_MS - 1
    const out = stream([it0({ id: 'b:old', at: old, text: 'An old word from last week, read already.' }), it0({ id: 's:q', at: old, kind: 'session', tone: 'question', text: 'Do you take my four recommendations?' })])
    expect(out.map((i) => i.id)).toEqual(['s:q'])
  })
})

describe('junk filters', () => {
  it('strips [tags] and shouted prefixes from subjects', () => {
    expect(cleanSubject('[weevboss] ACTION — HOW TO TAKE OVER PARIS EP01 — brief…')).toBe('How to take over paris ep01 — brief')
    expect(cleanSubject('FYI: the pod is down')).toBe('the pod is down')
    expect(cardLine(it0({ kind: 'mail', title: '[x] URGENT - Invoice from Hostinger' }))).toBe('Invoice from Hostinger')
  })
  it('hides automation lifecycle notices and bare titles', () => {
    const out = stream([
      it0({ id: 'b:a', text: 'The automation "Index your content ideas" is wrapped up.' }),
      it0({ id: 'auto:go:1', text: 'The automation "X" is running.' }),
      it0({ id: 'b:c', text: 'content ideas index' }),
      it0({ id: 'b:d', text: 'Shorts posted before 9 am get twice the reach of evening ones.' }),
    ])
    expect(out.map((i) => i.id)).toEqual(['b:d'])
  })
  it('dedupes contained text, keeping the richest', () => {
    const out = stream([
      it0({ id: 'b:n', text: 'weevils install drop-off is down to twelve percent this week' }),
      it0({ id: 'r', kind: 'session', tone: 'result', title: 'Install drop-off', text: 'The weevils install drop-off is down to twelve percent this week, after the new onboarding.', media }),
    ])
    expect(out.map((i) => i.id)).toEqual(['r'])
  })
  it('a session sentence and the media it posted are one post: the media, titled with the words', () => {
    const s = it0({ id: 's', kind: 'session', tone: 'result', sessionId: 'S', text: 'I built the new menu for the café, live on staging now.' })
    const v = it0({ id: 'v', kind: 'media', sessionId: 'S', text: '', media })
    const out = stream([s, v])
    expect(out.map((i) => i.id)).toEqual(['v'])
    expect(out[0].title).toBe('Built the new menu for the café, live on staging now.')
  })
})
