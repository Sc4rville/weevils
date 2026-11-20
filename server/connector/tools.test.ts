// The connector's five tools against a weevbook in a temporary folder (docs/spec/05-connector.md, CONN-1 to CONN-5
// and CONN-8): parts, replays, a chat sent again later, refused calls, redaction, and the limits of every result.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { check } from '../weevbook/check.ts'
import { parseJournal, renderThread, type EventDraft, type JournalEvent } from '../weevbook/journal.ts'
import { Weevbook } from '../weevbook/store.ts'
import { Connector, LIMITS, PART_MAX, TOOLS, messageHash, type CallContext, type ToolResult } from './tools.ts'

let dir: string
let wb: string
let conns: Connector[] = []
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-'))
  wb = path.join(dir, 'weevbook')
})
afterEach(() => {
  for (const c of conns) c.stop()
  conns = []
  fs.rmSync(dir, { recursive: true, force: true })
})

const BASE = 'https://weevils.example.com'
const GPT: CallContext = { app: 'chatgpt', base: BASE }
const CLAUDE: CallContext = { app: 'claude-ai', base: BASE }
let clock = Date.parse('2026-11-19T19:05:40Z')
function connector(o: Partial<ConstructorParameters<typeof Connector>[0]> = {}) {
  const c = new Connector({ dir: wb, machine: 'laptop', projects: () => ['trip-planner', 'weevils'], now: () => (clock += 1000), log: () => {}, composeMs: 10, ...o })
  conns.push(c)
  return c
}
const text = (r: ToolResult) => r.content[0].text
/** A chat of `n` messages, user and assistant in turn. */
const chat = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ role: (from + i) % 2 ? 'assistant' : 'user', text: `message ${from + i}: ${(from + i) % 2 ? 'an answer' : 'a question'} about offline maps for trip-planner` }) as const)
const send = (c: Connector, args: Record<string, unknown>, ctx = GPT) => c.call('send_to_weevboss', { app: ctx.app, offset: 0, final: true, ...args }, ctx)

/** Every thread on disk: its journal's events and the raw bytes. */
async function threads() {
  const book = await Weevbook.open(wb, 'reader')
  const out: { id: string; events: JournalEvent[]; bytes: Buffer; folder: string }[] = []
  for (const { id, path: rel } of book.threads()) {
    const bytes = fs.readFileSync(path.join(book.abs(rel), 'events.jsonl'))
    out.push({ id, events: parseJournal(bytes.toString('utf8')).events, bytes, folder: book.abs(rel) })
  }
  return out
}
const messages = (events: JournalEvent[]) => events.filter((e) => e.type === 'message')

describe('the five tools (CONN-1)', () => {
  it('are exactly the five of the spec, with their required arguments', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(['send_to_weevboss', 'continue_with_agent', 'search_weevbook', 'read_thread', 'thread_status'])
    const send = TOOLS[0].inputSchema as { required: string[]; anyOf: unknown[]; properties: { messages: { maxItems: number; items: { properties: { text: { maxLength: number } } } } } }
    expect(send.required).toEqual(['app', 'offset', 'messages', 'final'])
    expect(send.anyOf).toEqual([{ required: ['conversation'] }, { required: ['thread'] }])
    expect(send.properties.messages.maxItems).toBe(40)
    expect(send.properties.messages.items.properties.text.maxLength).toBe(20_000)
    expect(TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name)).toEqual(['search_weevbook', 'read_thread', 'thread_status'])
  })
})

describe('send_to_weevboss', () => {
  it('makes a thread of a chat: one event per message, keyed from the call, filed and readable like any other', async () => {
    const c = connector()
    const msgs = chat(6)
    const r = await send(c, { conversation: 'offline-maps-for-the-itinerary', title: 'Offline maps for the itinerary', messages: msgs })
    expect(r.isError).toBeUndefined()
    const [t] = await threads()
    expect(text(r)).toBe(`Saved 6 messages to "Offline maps for the itinerary" in trip-planner. ${BASE}/t/${t.id}`)
    const m = messages(t.events)
    expect(m).toHaveLength(6)
    expect(m[0]).toMatchObject({ leg: null, role: 'user', source: 'connector', app: 'chatgpt', key: `conn:chatgpt:offline-maps-for-the-itinerary:0:${messageHash('user', msgs[0].text)}` })
    expect(m[1]).toMatchObject({ role: 'assistant', source: 'connector', app: 'chatgpt' })
    expect(t.events[0]).toMatchObject({ type: 'meta', thread: t.id, title: 'Offline maps for the itinerary' })
    expect(t.events.at(-1)).toMatchObject({ type: 'meta', project: 'trip-planner' })
    expect(t.folder).toContain(`/projects/trip-planner/`)
    // The chat app's answers show under its name in thread.md.
    expect(renderThread(t.events)).toContain('**ChatGPT**')
    // `weevils weevbook check` finds nothing to say: journal, folder, ref and main.
    const report = await check(wb, 'laptop')
    expect(report.byInvariant).toEqual({})
    expect(report.threads).toBe(1)
  })

  it('takes a long chat in parts, and gives the same messages as one call (CONN-3)', async () => {
    const c = connector()
    const all = chat(52)
    const one = await send(c, { conversation: 'part-1-then-part-2', offset: 0, messages: all.slice(0, 40), final: false })
    expect(text(one)).toBe('Saved messages 0 to 39. Send the next part with offset 40.')
    expect(text(one).length).toBeLessThanOrEqual(LIMITS.part)
    const two = await send(c, { conversation: 'part-1-then-part-2', offset: 40, messages: all.slice(40) })
    expect(text(two)).toMatch(/^Saved 52 messages to "message 0: a question about offline maps for trip-planner" in trip-planner\. https:/)
    // The same chat in one call is refused (a part holds 40), so in two other parts of 26: the same events.
    await send(c, { conversation: 'same-chat-two-halves', offset: 0, messages: all.slice(0, 26), final: false })
    await send(c, { conversation: 'same-chat-two-halves', offset: 26, messages: all.slice(26) })
    const [a, b] = (await threads()).map((t) => messages(t.events).map((e) => ({ role: e.role, text: e.text, source: e.source, app: e.app, key: e.key!.split(':').slice(3).join(':') })))
    expect(a).toHaveLength(52)
    expect(a).toEqual(b)
  })

  it('writes nothing when a part comes again, byte for byte (CONN-2), and says so', async () => {
    const c = connector()
    const part = chat(40)
    await send(c, { conversation: 'sent-twice-chat', messages: part, final: false })
    const before = (await threads())[0].bytes
    const again = await send(c, { conversation: 'sent-twice-chat', messages: part, final: false })
    expect(text(again)).toMatch(/^Already saved: nothing new in messages 0 to 39\. https:\/\/weevils\.example\.com\/t\/[0-9A-Z]{26}$/)
    expect((await threads())[0].bytes.equals(before)).toBe(true)
    // A retry of the final part, too.
    await send(c, { conversation: 'sent-twice-chat', offset: 40, messages: chat(2, 40) })
    const done = (await threads())[0].bytes
    await send(c, { conversation: 'sent-twice-chat', offset: 40, messages: chat(2, 40) })
    expect((await threads())[0].bytes.equals(done)).toBe(true)
  })

  it('keeps the saved version of an edited message, and says how many differ', async () => {
    const c = connector()
    await send(c, { conversation: 'edited-chat-here', messages: chat(4) })
    const edited = chat(4).map((m, i) => (i === 1 ? { ...m, text: 'another answer' } : m))
    const r = await send(c, { conversation: 'edited-chat-here', messages: edited })
    expect(text(r)).toContain('1 earlier message differs from what was saved; the saved version was kept.')
    expect(messages((await threads())[0].events)[1].text).toBe(chat(4)[1].text)
  })

  it('extends the thread of a chat sent again later, even after a restart, instead of making a second one', async () => {
    await send(connector(), { conversation: 'chat-that-goes-on', messages: chat(6) })
    // weevilsd restarted: the thread is found by the keys of its journal, nothing else.
    const later = connector()
    const r = await send(later, { conversation: 'chat-that-goes-on', offset: 0, messages: chat(9) })
    expect(text(r)).toMatch(/^Saved 9 messages to /)
    const all = await threads()
    expect(all).toHaveLength(1)
    expect(messages(all[0].events)).toHaveLength(9)
    // The same name from the other chat app is another conversation.
    await send(later, { conversation: 'chat-that-goes-on', messages: chat(2) }, CLAUDE)
    expect(await threads()).toHaveLength(2)
  })

  it('appends to a thread named by its id', async () => {
    const c = connector()
    await send(c, { conversation: 'first-chat-name', messages: chat(2) })
    const [t] = await threads()
    const r = await send(c, { thread: t.id, messages: [{ role: 'user', text: 'and one more thing from another chat' }] })
    expect(r.isError).toBeUndefined()
    const after = await threads()
    expect(after).toHaveLength(1)
    expect(messages(after[0].events).at(-1)!.key).toMatch(new RegExp(`^conn:chatgpt:${t.id.toLowerCase()}:0:`))
  })

  it('refuses a gap, and writes nothing', async () => {
    const c = connector()
    await send(c, { conversation: 'chat-with-a-gap', messages: chat(6), final: false })
    const before = (await threads())[0].bytes
    const r = await send(c, { conversation: 'chat-with-a-gap', offset: 46, messages: chat(2, 46) })
    expect(r).toEqual({ content: [{ type: 'text', text: 'Send messages starting at offset 6 first.' }], isError: true })
    expect((await threads())[0].bytes.equals(before)).toBe(true)
  })

  it('refuses bad names, more than 40 messages, too long a text, and writes nothing', async () => {
    const c = connector()
    const refused = async (args: Record<string, unknown>, says: RegExp) => {
      const r = await send(c, args)
      expect(r.isError).toBe(true)
      expect(text(r)).toMatch(says)
    }
    await refused({ conversation: 'Has Capitals', messages: chat(1) }, /"conversation" must be 8 to 80 lower-case letters/)
    await refused({ conversation: 'short', messages: chat(1) }, /"conversation" must be/)
    await refused({ conversation: 'x'.repeat(81), messages: chat(1) }, /"conversation" must be/)
    await refused({ conversation: 'conv:with:colons', messages: chat(1) }, /"conversation" must be/)
    await refused({ thread: 'not-a-thread-id', messages: chat(1) }, /"thread" must be a thread id/)
    await refused({ thread: '01M7TK6GX01G5BY7YG590JEA4Q', messages: chat(1) }, /There is no thread 01M7TK6GX01G5BY7YG590JEA4Q/)
    await refused({ messages: chat(1) }, /Give "conversation", or "thread"/)
    await refused({ conversation: 'a-good-name', messages: chat(1), extra: 1 }, /"extra" is not an argument/)
    await refused({ conversation: 'a-good-name', messages: chat(PART_MAX + 1) }, /A part holds at most 40 messages/)
    await refused({ conversation: 'a-good-name', messages: [{ role: 'user', text: 'x'.repeat(20_001) }] }, /messages\[0\]\.text is longer than 20000 characters/)
    await refused({ conversation: 'a-good-name', messages: [{ role: 'system', text: 'hi' }] }, /"messages\[0\]\.role" must be one of "user", "assistant"/)
    await refused({ conversation: 'a-good-name', messages: [] }, /"messages" is empty/)
    await refused({ conversation: 'a-good-name', offset: -1, messages: chat(1) }, /"offset" must be at least 0/)
    // A name redaction would hide: its keys could never be found again.
    await refused({ conversation: 'my-api-token-chat', messages: chat(1) }, /Choose a name without words like token/)
    expect(await threads()).toEqual([])
  })

  it('redacts what looks like a secret, and still recognises the part when it comes again (CONN-8)', async () => {
    const c = connector()
    const secret = [{ role: 'user', text: 'my key is sk-proj-abcdefghijklmnopqrstuv and password=hunter2, keep it' }] as const
    await send(c, { conversation: 'pasted-credential-chat', messages: secret })
    const [t] = await threads()
    const m = messages(t.events)[0]
    expect(m.text).not.toContain('abcdefghijklmnop')
    expect(m.text).not.toContain('hunter2')
    expect(m.text).toContain('[redacted]')
    expect(fs.readFileSync(path.join(t.folder, 'thread.md'), 'utf8')).not.toContain('hunter2')
    const again = await send(c, { conversation: 'pasted-credential-chat', messages: secret })
    expect(text(again)).toMatch(/^Already saved/)
  })

  it('takes the app from the token, not from the arguments', async () => {
    const c = connector()
    await c.call('send_to_weevboss', { conversation: 'which-app-is-it', app: 'chatgpt', offset: 0, final: true, messages: chat(2) }, CLAUDE)
    const m = messages((await threads())[0].events)
    expect(m.every((e) => e.app === 'claude-ai' && e.key!.startsWith('conn:claude-ai:which-app-is-it:'))).toBe(true)
    expect(renderThread((await threads())[0].events)).toContain('**Claude**')
  })

  it('files under the project the user named', async () => {
    const c = connector()
    const r = await send(c, { conversation: 'named-project-chat', project: 'Garden Plans', messages: chat(2) })
    expect(text(r)).toContain(' in garden-plans. ')
  })

  it('never writes into a thread an engine writes (an open leg)', async () => {
    const book = await Weevbook.open(wb, 'laptop')
    expect(await book.lock()).toBe(true)
    const T = '01M7HSBBM02XDK5FKDXG64FE62'
    const at = '2026-11-16T09:00:00.000Z'
    const events: EventDraft[] = [
      { id: '01M7HSBBM00000000000000001', at, leg: null, type: 'meta', thread: T, project: 'weevils' },
      { id: '01M7HSBBM00000000000000002', at, leg: 'L1', type: 'leg.start', engine: 'claude:abc123@laptop', session: 's1', cwd: '/home/x/projects/weevils', rung: 0, epoch: 1 },
    ]
    await book.append(T, { events })
    await book.commitThread(T, 'test')
    await book.unlock(true)
    const before = fs.readFileSync(path.join(book.abs(book.pathOf(T)!), 'events.jsonl'))
    const c = connector()
    const r = await send(c, { thread: T, messages: chat(1) })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/^An agent session writes this thread/)
    const r2 = await c.call('continue_with_agent', { thread: T, request: 'do-the-thing', instruction: 'Do it.' }, GPT)
    expect(r2.isError).toBe(true)
    expect(fs.readFileSync(path.join(book.abs(book.pathOf(T)!), 'events.jsonl')).equals(before)).toBe(true)
  })

  it('answers "busy" and writes nothing when the weevbook stays locked', async () => {
    const other = await Weevbook.open(wb, 'laptop')
    expect(await other.lock()).toBe(true)
    try {
      const r = await send(connector({ lockMs: 300 }), { conversation: 'locked-out-chat', messages: chat(1) })
      expect(r).toMatchObject({ isError: true, content: [{ text: 'The weevbook is busy. Try again in a minute; nothing was written.' }] })
    } finally {
      await other.unlock(false)
    }
    expect(await threads()).toEqual([])
  })
})

describe('continue_with_agent', () => {
  it('saves the request and a turn, held until a machine takes work from the weevbook; a retry starts no second turn (CONN-4)', async () => {
    const c = connector()
    const ask = { conversation: 'offline-maps-for-the-itinerary', app: 'chatgpt', request: 'tile-cache-with-cap', instruction: 'Implement the tile cache we discussed, with the 40 MB cap.' }
    const early = await c.call('continue_with_agent', ask, GPT)
    expect(early.isError).toBe(true)
    expect(text(early)).toMatch(/^This chat is not saved yet/)
    await send(c, { conversation: 'offline-maps-for-the-itinerary', title: 'Offline maps', messages: chat(6) })
    const r = await c.call('continue_with_agent', ask, GPT)
    const [t] = await threads()
    expect(text(r)).toBe(`Saved. No machine can work on it now: none of the user's machines takes work from the weevbook now. It starts as soon as one can. ${BASE}/t/${t.id}`)
    const turns = t.events.filter((e) => e.type === 'turn')
    expect(turns).toMatchObject([
      { turn: 1, state: 'accepted', leg: null },
      { turn: 1, state: 'held', rule: 'hold', reason: 'no-machine' },
    ])
    const request = t.events.find((e) => e.type === 'message' && e.key === 'conn:chatgpt:offline-maps-for-the-itinerary:req:tile-cache-with-cap')
    expect(request).toMatchObject({ role: 'user', source: 'connector', text: ask.instruction })
    expect(turns[0]).toMatchObject({ message: request!.id })
    const bytes = (await threads())[0].bytes
    expect(text(await c.call('continue_with_agent', ask, GPT))).toBe(text(r))
    expect((await threads())[0].bytes.equals(bytes)).toBe(true)
    // Another request: another turn.
    await c.call('continue_with_agent', { ...ask, request: 'second-request' }, GPT)
    expect((await threads())[0].events.filter((e) => e.type === 'turn' && e.state === 'accepted')).toHaveLength(2)
    expect((await check(wb, 'laptop')).byInvariant).toEqual({})
  })

  it('hands the turn to a dispatcher when there is one', async () => {
    const seen: [string, number][] = []
    const c = connector({ dispatch: async (thread, turn) => (seen.push([thread, turn]), { taken: true }) })
    await send(c, { conversation: 'dispatched-chat', title: 'Dispatched', messages: chat(2) })
    const r = await c.call('continue_with_agent', { conversation: 'dispatched-chat', app: 'chatgpt', request: 'go-ahead', instruction: 'Go.' }, GPT)
    const [t] = await threads()
    expect(seen).toEqual([[t.id, 1]])
    expect(text(r)).toBe(`An agent is working on "Dispatched" in trip-planner. Ask for thread_status to follow it. ${BASE}/t/${t.id}`)
  })
})

describe('continue_with_agent with threads on (WEEVILS_THREADS)', () => {
  it('hands the request to the dispatcher\'s inbox, even while an agent writes the thread; a retry is the same request', async () => {
    const got: { thread: string; text: string; key: string; app: string; project?: string | null }[] = []
    const c = connector({ accept: async (thread, m) => void got.push({ thread, ...m }) })
    await send(c, { conversation: 'inbox-chat', title: 'Inbox', messages: chat(2) })
    const [t] = await threads()
    const before = t.bytes
    const ask = { conversation: 'inbox-chat', app: 'chatgpt', request: 'go-ahead', instruction: 'Go.', project: 'Trip Planner' }
    const r = await c.call('continue_with_agent', ask, GPT)
    expect(r.isError).toBeFalsy()
    expect(got).toEqual([{ thread: t.id, text: 'Go.', key: 'conn:chatgpt:inbox-chat:req:go-ahead', app: 'chatgpt', project: 'trip-planner' }])
    // The connector writes nothing itself: the dispatcher files it with the lease.
    expect((await threads())[0].bytes.equals(before)).toBe(true)
    expect(text(r)).toContain('An agent is working on "Inbox"')
  })
})

describe('search_weevbook, read_thread, thread_status', () => {
  it('find, read and tell where a thread stands', async () => {
    const c = connector()
    await send(c, { conversation: 'offline-maps-chat', title: 'Offline maps for the itinerary', messages: chat(8) })
    await send(c, { conversation: 'garden-chat-one', title: 'Watering the tomatoes', project: 'garden', messages: chat(2) })
    const [maps] = (await threads()).filter((t) => t.events[0].type === 'meta' && (t.events[0] as { title?: string }).title?.startsWith('Offline'))

    const found = text(await c.call('search_weevbook', { query: 'offline MAPS' }, GPT))
    expect(found).toMatch(new RegExp(`^${maps.id} · Offline maps for the itinerary · trip-planner · 2026-11-19 \\d\\d:\\d\\d UTC · waiting$`))
    expect(text(await c.call('search_weevbook', { query: 'tomatoes', project: 'trip-planner' }, GPT))).toMatch(/^No thread matches/)
    expect(text(await c.call('search_weevbook', { query: 'tomatoes' }, GPT))).toContain('Watering the tomatoes · garden')

    const recent = text(await c.call('read_thread', { thread: maps.id, mode: 'recent', count: 2 }, GPT))
    expect(recent).toContain('# Offline maps for the itinerary')
    expect(recent).toContain('**User**')
    expect(recent).toContain('**ChatGPT**')
    expect(recent).toContain('message 7: an answer')
    expect(recent).not.toContain('message 5:')
    const summary = text(await c.call('read_thread', { thread: maps.id, mode: 'summary' }, GPT))
    expect(summary).toContain('## First request')
    expect(summary).toContain('message 0: a question')

    expect(text(await c.call('thread_status', { conversation: 'offline-maps-chat', app: 'chatgpt' }, GPT))).toBe(
      `"Offline maps for the itinerary" (trip-planner): waiting for you. Last reply: "${chat(8)[7].text}"`,
    )
    await c.call('continue_with_agent', { thread: maps.id, request: 'build-it', instruction: 'Build it.' }, GPT)
    expect(text(await c.call('thread_status', { thread: maps.id }, GPT))).toMatch(/^"Offline maps for the itinerary" \(trip-planner\): paused: none of the user's machines takes work/)
    expect(text(await c.call('thread_status', { conversation: 'never-sent-chat', app: 'chatgpt' }, GPT))).toMatch(/^No thread holds this conversation yet/)
  })

  it('keep every result within its limit, in plain text (CONN-5)', async () => {
    const c = connector()
    const long = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${'word '.repeat(3990)}${i}` }) as const)
    const results: [keyof typeof LIMITS, ToolResult][] = []
    results.push(['part', await send(c, { conversation: 'a-very-long-chat', title: 'T'.repeat(120), messages: long, final: false })])
    results.push(['final', await send(c, { conversation: 'a-very-long-chat', title: 'T'.repeat(120), offset: 40, messages: long })])
    results.push(['replay', await send(c, { conversation: 'a-very-long-chat', offset: 40, messages: long })])
    const [t] = await threads()
    results.push(['continue', await c.call('continue_with_agent', { thread: t.id, request: 'long-one', instruction: 'x'.repeat(8000), project: 'p'.repeat(60) }, GPT)])
    results.push(['read', await c.call('read_thread', { thread: t.id, mode: 'summary' }, GPT)])
    results.push(['read', await c.call('read_thread', { thread: t.id, mode: 'recent', count: 20 }, GPT)])
    results.push(['status', await c.call('thread_status', { thread: t.id }, GPT)])
    results.push(['error', await send(c, { conversation: 'a-very-long-chat', offset: 400, messages: long })])
    for (let i = 0; i < 12; i++) await send(c, { conversation: `another-long-${i}`, title: `T ${'T'.repeat(118)}`, messages: chat(1) })
    const search = await c.call('search_weevbook', { query: 'T', limit: 10 }, GPT)
    expect(text(search).split('\n').length).toBeLessThanOrEqual(LIMITS.search)
    for (const [kind, r] of results) {
      expect(text(r).length, kind).toBeLessThanOrEqual(LIMITS[kind])
      expect(() => JSON.parse(text(r)), kind).toThrow()
    }
  })
})
