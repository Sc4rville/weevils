import { describe, expect, it } from 'vitest'
import { CALM_MS, candidates, discoveryHint, lastOffered, mayOffer, nextStep, stepDone, TRIES, tryBrief, type JourneyFacts } from './journey.ts'

// The onboarding journey (docs/onboarding.md): one step at a time, a milestone per step passed, and from the second day
// at most one discovery a day, said by weevboss when it fits.
const facts = (o: Partial<JourneyFacts> = {}): JourneyFacts => ({
  ready: true, github: false, first: { os: 'linux', mobile: false, standalone: false }, devices: 1, devicesAtHello: 1, push: 0, others: 0, alwaysOn: true, marks: {}, ...o,
})
const H = 3600_000

describe('the steps', () => {
  it('come in order, each once, and only once a subscription can think', () => {
    expect(nextStep(facts({ ready: false }))).toBeNull()
    expect(nextStep(facts())).toBe('tour')
    expect(nextStep(facts({ marks: { 'offer:tour': 1 } }))).toBe('github')
    expect(nextStep(facts({ marks: { 'tour:skip': 1 }, github: true }))).toBe('phone')
    expect(nextStep(facts({ marks: { 'tour:done': 1, 'offer:phone': 1 }, github: true }))).toBe('push')
    expect(nextStep(facts({ marks: { 'tour:done': 1 }, github: true, devices: 2, push: 1 }))).toBe('machine')
    expect(nextStep(facts({ marks: { 'tour:done': 1 }, github: true, devices: 2, push: 1, others: 1 }))).toBeNull()
  })

  it('the phone is done by a second device since the hello, or by a first visit from a phone', () => {
    expect(stepDone('phone', facts())).toBe(false)
    expect(stepDone('phone', facts({ devices: 2 }))).toBe(true)
    expect(stepDone('phone', facts({ devices: 3, devicesAtHello: 3 }))).toBe(false)
    expect(stepDone('phone', facts({ first: { os: 'ios', mobile: true, standalone: false } }))).toBe(true)
  })

  it('a machine that sleeps is done by the server offer it already had', () => {
    expect(stepDone('machine', facts({ alwaysOn: false, marks: { 'vps:later': 1 } }))).toBe(true)
    expect(stepDone('machine', facts({ alwaysOn: false }))).toBe(false)
  })
})

describe('when weevils offers by itself', () => {
  const base = { now: 10 * H, firstRunAt: 9 * H, lastThreadAt: 10 * H - CALM_MS, bossWorking: false, flowOpen: false, offers: [] as number[], ignored: 0 }
  it('once the thread is calm and weevboss idle, in the first days, under a cap', () => {
    expect(mayOffer(base)).toBe(true)
    expect(mayOffer({ ...base, lastThreadAt: base.now - 10_000 })).toBe(false)
    expect(mayOffer({ ...base, bossWorking: true })).toBe(false)
    expect(mayOffer({ ...base, firstRunAt: undefined })).toBe(false)
    expect(mayOffer({ ...base, firstRunAt: base.now - 4 * 24 * H })).toBe(false)
    expect(mayOffer({ ...base, offers: [base.now - H, base.now - 2 * H, base.now - 3 * H] })).toBe(false)
    expect(mayOffer({ ...base, offers: [base.now - 25 * H, base.now - 26 * H, base.now - 27 * H] })).toBe(true)
  })
  it('never after two offers passed by in a row', () => {
    expect(mayOffer({ ...base, ignored: 1 })).toBe(true)
    expect(mayOffer({ ...base, ignored: 2 })).toBe(false)
  })
})

describe('the examples to try', () => {
  it('each has a brief for weevboss', () => {
    for (const t of TRIES) expect(tryBrief(t)).toMatch(/^The user tapped an example to try/)
  })
})

describe('the following days', () => {
  const at = 100 * H
  it('nothing on the first day, nor after two weeks, nor twice in a day', () => {
    expect(discoveryHint(facts(), { now: at, firstRunAt: at - 5 * H, hintedToday: 0 })).toBe('')
    expect(discoveryHint(facts(), { now: at, firstRunAt: at - 15 * 24 * H, hintedToday: 0 })).toBe('')
    expect(discoveryHint(facts({ marks: { 'discover:voice': at - 3 * H } }), { now: at, firstRunAt: at - 30 * H, hintedToday: 0 })).toBe('')
    expect(discoveryHint(facts({ marks: { 'won:push': at - 3 * H } }), { now: at, firstRunAt: at - 30 * H, hintedToday: 0 })).toBe('')
    expect(discoveryHint(facts(), { now: at, firstRunAt: at - 30 * H, hintedToday: 8 })).toBe('')
  })
  it('the day after: up to three candidates, the steps left first, with when they fit and how to mark one', () => {
    const hint = discoveryHint(facts({ marks: { 'tour:done': at - 30 * H } }), { now: at, firstRunAt: at - 30 * H, hintedToday: 0 })
    expect(hint).toMatch(/^one discovery for the user today, at most, and only if it truly fits/)
    expect(hint).toContain('github = their conversations kept on their own GitHub')
    expect(hint).toContain('phone = weevils on their phone')
    expect(hint).toContain('push = a notification')
    expect(hint).not.toContain('tour =')
    expect(hint).toContain('`weevils setup mark discover:<id>`')
  })
  it('a discovery given or a step done is never offered again', () => {
    const ids = (f: JourneyFacts) => candidates(f).map((d) => d.id)
    expect(ids(facts({ github: true, devices: 2, push: 1, others: 1, marks: { 'tour:done': 1 } }))).toEqual(['auto', 'voice', 'camera'])
    expect(ids(facts({ github: true, devices: 2, push: 1, others: 1, marks: { 'tour:done': 1, 'discover:auto': 1 } }))).toEqual(['voice', 'camera', 'codex'])
  })
  it('the last thing offered counts steps, milestones and discoveries, nothing else', () => {
    expect(lastOffered({ 'offer:github': 5, 'won:brain': 7, 'discover:voice': 3, 'vault:summary': 99, 'tip:x': 50 })).toBe(7)
  })
})
