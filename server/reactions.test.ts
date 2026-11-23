import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/api.ts'
import type { Ask } from '../shared/ledger.ts'
import { ExplicitReactions, REACTIONS as R, isEmoji, messageReaction, withBossReactions, withSessionReactions } from './reactions.ts'

const ask = (o: Partial<Ask>): Ask => ({ id: 'r1', text: 't', quote: 'q', src: 'u1', from: 'user', at: 1, kind: 'task', status: 'open', dispatches: [], progressAt: 1, ...o })
const sent = (session: string) => [{ session, at: 1 }]
const st = (m: Record<string, string>) => (id: string) => m[id] as never
const user = (id: string, at = 1): Message => ({ id, role: 'user', text: 'x', at })
const reply = (id: string, at = 2): Message => ({ id, role: 'assistant', text: 'y', at })

describe('reactions, from real state', () => {
  it('one ask: seen, sent, working, waiting, done, answered, ignored', () => {
    expect(messageReaction([ask({})], st({}))).toBe(R.seen)
    expect(messageReaction([ask({ status: 'dispatched', dispatches: sent('s') })], st({ s: 'idle' }))).toBe(R.sent)
    expect(messageReaction([ask({ status: 'dispatched', dispatches: sent('s') })], st({ s: 'working' }))).toBe(R.working)
    expect(messageReaction([ask({ status: 'dispatched', dispatches: sent('s') })], st({ s: 'needs_user' }))).toBe(R.waiting)
    expect(messageReaction([ask({ status: 'done' })], st({}))).toBe(R.done)
    expect(messageReaction([ask({ status: 'done', kind: 'question' })], st({}))).toBe(R.answered)
    expect(messageReaction([ask({ status: 'dropped' })], st({}))).toBe(R.ignored)
    expect(messageReaction([], st({}))).toBeUndefined()
  })
  it('several asks: the step all of them reached; a question to you wins; dropped ones aside', () => {
    const s = st({ a: 'working', b: 'idle', c: 'needs_user' })
    expect(messageReaction([ask({ status: 'done' }), ask({ status: 'dispatched', dispatches: sent('a') })], s)).toBe(R.working)
    expect(messageReaction([ask({ status: 'dispatched', dispatches: sent('a') }), ask({ status: 'dispatched', dispatches: sent('b') })], s)).toBe(R.sent)
    expect(messageReaction([ask({ status: 'done' }), ask({ status: 'dispatched', dispatches: sent('c') })], s)).toBe(R.waiting)
    expect(messageReaction([ask({ status: 'done' }), ask({ status: 'dropped' })], s)).toBe(R.done)
    expect(messageReaction([ask({ status: 'done', kind: 'question' }), ask({ status: 'done' })], s)).toBe(R.done)
  })
  it("weevboss's thread: asks found by their message (whole or in parts), 👀 while received, explicit wins", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-'))
    const explicit = new ExplicitReactions(path.join(dir, 'r.json'))
    const msgs = [user('u1'), reply('a1'), user('u2-t', 3), reply('a2', 4), user('u3', 5)]
    const asks = [ask({ src: 'u1', status: 'done' }), ask({ src: 'u2', status: 'dispatched', dispatches: sent('s') })]
    const out = withBossReactions(msgs, { asks, sessionStatus: st({ s: 'working' }), working: true, explicit })
    expect(out.map((m) => m.reaction)).toEqual([R.done, undefined, R.working, undefined, R.seen])
    explicit.set('u1', '🎉')
    expect(new ExplicitReactions(path.join(dir, 'r.json')).get('u1')).toBe('🎉')
    const again = withBossReactions(msgs, { asks, sessionStatus: st({ s: 'working' }), working: false, pendingSince: 5, explicit })
    expect(again.map((m) => m.reaction)).toEqual(['🎉', undefined, R.working, undefined, R.seen])
    explicit.set('u1', '')
    expect(withBossReactions(msgs, { asks, sessionStatus: st({}), working: false, explicit })[0].reaction).toBe(R.done)
  })
  it("weevboss's thread: a message waiting on you says which session asks (the thread links to it)", () => {
    const msgs = [user('u1'), reply('a1')]
    const asks = [ask({ src: 'u1', status: 'dispatched', dispatches: sent('s1') })]
    const waiting = withBossReactions(msgs, { asks, sessionStatus: st({ s1: 'needs_user' }), working: false })
    expect(waiting[0]).toMatchObject({ reaction: R.waiting, waitingOn: 's1' })
    expect(withBossReactions(msgs, { asks, sessionStatus: st({ s1: 'working' }), working: false })[0].waitingOn).toBeUndefined()
  })
  it("a session's thread: only the latest message you (or another author) wrote, while it works or asks you", () => {
    const msgs: Message[] = [user('u1'), reply('a1'), { id: 'o1', role: 'orchestrator', author: 'weevboss', text: 'z', at: 3 }]
    expect(withSessionReactions(msgs, { status: 'working' }).map((m) => m.reaction)).toEqual([undefined, undefined, R.working])
    expect(withSessionReactions(msgs, { status: 'needs_user' }).at(-1)!.reaction).toBe(R.waiting)
    expect(withSessionReactions(msgs, { status: 'idle' }).some((m) => m.reaction)).toBe(false)
  })
  it('an explicit reaction is one emoji, never text', () => {
    for (const e of ['👍', '✅', '🛠️', '👍🏽', '🇫🇷', '👨‍💻']) expect(isEmoji(e)).toBe(true)
    for (const e of ['ok', 'done ✅', '1', '', '👍👍👍👍👍👍👍👍👍👍👍']) expect(isEmoji(e)).toBe(false)
  })

  it('a request verified done (a landed commit as evidence): its message carries the win, once per request', () => {
    const verified = ask({ id: 'r7', src: 'u1', status: 'done', closedAt: 50, closedBy: 'auto', dispatches: [{ session: 's', at: 1, evidence: 'abc1234' }] })
    const closedByHand = ask({ id: 'r8', src: 'u2', status: 'done', closedAt: 60, dispatches: sent('s') })
    const out = withBossReactions([user('u1'), user('u2', 2)], { asks: [verified, closedByHand], sessionStatus: st({}), working: false })
    expect(out[0].win).toEqual({ id: 'done:r7', kind: 'done', at: 50 })
    expect(out[1].reaction).toBe(R.done)
    expect(out[1].win).toBeUndefined()
  })
})
