import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Journal, validateJournal, type EventDraft, type JournalEvent } from '../journal.ts'
import type { Adapter, Out } from './adapter.ts'
import { ClaudeAdapter } from './claude.ts'
import { CodexAdapter } from './codex.ts'

const FX = path.resolve(import.meta.dirname, '../../../test/fixtures/weevbook/home')
const CLAUDE = path.join(FX, 'claude/projects/-home-alex-projects-shop-app/3f6c1b2a-8d4e-4c1f-9a7b-2e5d6c8f0a11.jsonl')
const NOTES = path.join(FX, 'claude/projects/-home-alex-notes/5a1e9c40-2b7d-4e8f-8c3a-7d9b0e1f2a33.jsonl')
const CODEX = path.join(FX, 'codex/sessions/2026/11/17/rollout-2026-11-17T10-00-00-0193a7c2-5e1d-7b8a-9c4f-2d6e8a1b3c5d.jsonl')

const lines = (file: string) =>
  fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try {
      return JSON.parse(l) as unknown
    } catch {
      return undefined
    }
  })

/** Every line through the adapter, then the end of the session; the events with their leg. */
function read(a: Adapter, input: unknown[]): Out[] {
  const outs = input.flatMap((o) => a.line(o))
  return [...outs, ...a.settle(true)]
}
/** The events as a journal: the thread's first lines (what sync.ts writes), then the adapter's. */
function journal(outs: Out[], a: Adapter): JournalEvent[] {
  const j = new Journal()
  const at = new Date(a.firstAt ?? 0).toISOString()
  j.append({ id: '01M7HSBBM00000000000000000', at, leg: null, type: 'meta', thread: '01M7HSBBM00000000000000001' })
  j.append({ id: '01M7HSBBM00000000000000002', at, leg: 'L1', type: 'leg.start', engine: a.engine, session: a.t.id, cwd: a.cwd ?? '', rung: 0, epoch: 1 })
  for (const o of outs) j.append({ ...o.event, leg: 'L1' } as EventDraft)
  return j.events
}
const brief = (events: JournalEvent[]) =>
  events.flatMap((e) => {
    if (e.type === 'message') return [`${e.role}: ${e.text}`]
    if (e.type === 'tool') return [`tool ${e.summary}`]
    if (e.type === 'turn') return [`turn ${e.turn} ${e.state}${e.attempt ? ` #${e.attempt}` : ''}${e.state === 'failed' ? ` ${e.reason} ${e.effect}` : ''}`]
    if (e.type === 'attachment') return [`attachment ${e.name} ${e.mime} ${e.bytes}`]
    if (e.type === 'meta' && e.title) return [`title ${e.title}`]
    return []
  })

describe('Claude Code adapter', () => {
  const a = new ClaudeAdapter({ file: CLAUDE, engine: 'claude:abc123@laptop' })
  const outs = read(a, lines(CLAUDE))
  const events = journal(outs, a)

  it('gives a journal that breaks no invariant', () => {
    expect(validateJournal(events)).toEqual([])
  })

  it('turns, messages, steps and their order', () => {
    expect(brief(events)).toEqual([
      'user: The checkout page shows prices without the currency. Can you fix it?',
      'turn 1 accepted',
      'turn 1 assigned #1',
      'turn 1 running',
      'title The checkout page shows prices without the currency. Can yo…',
      'assistant: Let me look at how prices are formatted.',
      'tool Grep · formatPrice',
      // Sent while the agent worked: Claude Code takes it into the running turn.
      'user: Use the euro sign for now',
      'tool Read · src/money.ts',
      'tool Edit · src/money.ts',
      // One reply written over three lines (thinking, then two texts), each saying end_turn: one message, one turn.
      'assistant: Prices now go through formatPrice with the euro sign.\n\nI also updated the test that checks the total.',
      'turn 1 done',
      'title Show the currency on checkout prices',
      'user: Deploy it to staging with GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwx1234',
      'turn 2 accepted',
      'turn 2 assigned #1',
      'turn 2 running',
      'tool Bash · Trigger the staging deploy',
      'assistant: Deployed to https://staging.example.com.',
      'turn 2 done',
      'user: The pay button looks off on mobile, see the screenshot.',
      'attachment image-1.png image/png 70',
      'turn 3 accepted',
      'turn 3 assigned #1',
      'turn 3 running',
      'tool Read · src/checkout/PayButton.tsx',
      // Esc: the user stopped the turn. Not a failure.
      'turn 3 done',
      'user: Never mind, just make the pay button full width.',
      'turn 4 accepted',
      'turn 4 assigned #1',
      'turn 4 running',
      // The usage limit: the turn failed, and Claude Code's sentence about it is not a reply.
      'turn 4 failed quota none',
      'user: continue',
      'turn 4 assigned #2',
      'turn 4 running',
      'tool Edit · src/checkout/PayButton.tsx',
      'assistant: The pay button is now full width on small screens.',
      'turn 4 done',
      'title Checkout fixes',
    ])
  })

  it('writes a checkpoint just before each done (THREAD-14), with rule shadow', () => {
    const done = events.flatMap((e, i) => (e.type === 'turn' && e.state === 'done' ? [events[i - 1]] : []))
    expect(done).toHaveLength(4)
    for (const c of done) expect(c).toMatchObject({ type: 'checkpoint', kind: 'none' })
    for (const e of events) if (e.type === 'turn' && e.state === 'assigned') expect(e).toMatchObject({ engine: 'claude:abc123@laptop', rule: 'shadow' })
  })

  it('dates a turn ended by the provider at its last line, not at the next one', () => {
    const done = events.find((e) => e.type === 'turn' && e.state === 'done' && e.turn === 2)!
    expect(done.at).toBe('2026-11-16T09:02:44.000Z')
  })

  it('hands over the bytes of a pasted image', () => {
    const img = outs.find((o) => o.event.type === 'attachment')!
    expect(img.content?.subarray(1, 4).toString()).toBe('PNG')
  })

  it('a session read in two halves gives the same events as read at once', () => {
    const all = lines(CLAUDE)
    for (const cut of [5, 13, 14, 25]) {
      const b = new ClaudeAdapter({ file: CLAUDE, engine: 'claude:abc123@laptop' })
      const first = all.slice(0, cut).flatMap((o) => b.line(o))
      const second = read(b, all.slice(cut))
      expect(brief(journal([...first, ...second], b))).toEqual(brief(events))
    }
  })

  it('takes up a session where the journal left it (restore)', () => {
    const all = lines(CLAUDE)
    // Cut after the usage limit: the turn is failed in the journal, the next message retries it.
    const cut = all.findIndex((o) => (o as { isApiErrorMessage?: boolean })?.isApiErrorMessage) + 1
    const b = new ClaudeAdapter({ file: CLAUDE, engine: 'claude:abc123@laptop' })
    const head = all.slice(0, cut).flatMap((o) => b.line(o))
    expect(b.safe).toBe(true)
    const before = journal(head, b)
    const c = new ClaudeAdapter({ file: CLAUDE, engine: 'other' })
    for (const o of all.slice(0, cut)) c.feed(o)
    c.restore(before, 'L1')
    expect(c.engine).toBe('claude:abc123@laptop')
    expect([c.turn, c.state, c.attempt]).toEqual([4, 'failed', 1])
    const j = new Journal(before)
    for (const o of read(c, all.slice(cut))) j.append({ ...o.event, leg: 'L1' } as EventDraft)
    expect(validateJournal(j.events)).toEqual([])
    expect(brief(j.events)).toEqual(brief(events))
  })

  it('a message from weevboss is the orchestrator’s', () => {
    const b = new ClaudeAdapter({ file: NOTES, engine: 'claude:abc123@laptop' })
    const ev = journal(read(b, lines(NOTES)), b)
    expect(validateJournal(ev)).toEqual([])
    expect(ev.find((e) => e.type === 'message' && e.role === 'orchestrator')).toMatchObject({ author: 'weevboss', text: 'Also list the open questions from meeting.md.', source: 'claude' })
  })
})

describe('Codex adapter', () => {
  const a = new CodexAdapter({ file: CODEX, engine: 'codex:def456@laptop' })
  a.setExternalTitle('Itinerary PDF export')
  const outs = read(a, lines(CODEX))
  const events = journal(outs, a)

  it('gives a journal that breaks no invariant', () => {
    expect(validateJournal(events)).toEqual([])
  })

  it('turns from task_started to task_complete, an error as a failed turn, an abort as done', () => {
    expect(brief(events)).toEqual([
      'user: Add a button to export the itinerary as a PDF.',
      'turn 1 accepted',
      'turn 1 assigned #1',
      'turn 1 running',
      'title Itinerary PDF export',
      'tool exec_command · rg -n "Itinerary" src',
      'tool apply_patch',
      'assistant: The export button is in the itinerary header; it prints the day list to PDF.',
      'turn 1 done',
      'user: The PDF cuts the map, see the screenshot.',
      'attachment image-1.png image/png 70',
      'turn 2 accepted',
      'turn 2 assigned #1',
      'turn 2 running',
      'tool exec_command · MAPS_API_KEY=[redacted] npm run pdf -- --day 1',
      'assistant: Fixed: the map is scaled to the page width before printing.',
      'turn 2 done',
      'orchestrator: Run the tests before you stop.',
      'turn 3 accepted',
      'turn 3 assigned #1',
      'turn 3 running',
      'turn 3 failed quota none',
      'user: Try again.',
      'turn 3 assigned #2',
      'turn 3 running',
      'tool exec_command · npm test',
      'assistant: All 42 tests pass.',
      'turn 3 done',
      'user: Also add a page break between days.',
      'turn 4 accepted',
      'turn 4 assigned #1',
      'turn 4 running',
      'tool exec_command · sed -n 1,60p src/itinerary/print.css',
      'turn 4 done',
    ])
  })

  it('names steps with the tool’s own name, untranslated: the same journal on every machine', () => {
    for (const e of events) if (e.type === 'tool') expect(e.summary.startsWith(`${e.name}`)).toBe(true)
  })

  it('retries a failed turn that had an effect with resume', () => {
    const b = new CodexAdapter({ file: CODEX, engine: 'codex:def456@laptop' })
    const t = (s: number) => new Date(Date.parse('2026-11-17T10:00:00Z') + s * 1000).toISOString()
    const ev = journal(read(b, [
      { timestamp: t(0), type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: t(1), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the file' }] } },
      { timestamp: t(2), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"git mv a b"}', call_id: 'k1' } },
      { timestamp: t(3), type: 'event_msg', payload: { type: 'error', message: 'stream disconnected before completion' } },
      { timestamp: t(9), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go on' }] } },
    ]), b)
    expect(validateJournal(ev)).toEqual([])
    expect(brief(ev)).toContain('turn 1 failed api some')
    expect(ev.filter((e) => e.type === 'checkpoint')).toHaveLength(2)
    expect(ev.find((e) => e.type === 'turn' && e.state === 'assigned' && e.attempt === 2)).toMatchObject({ resume: true })
  })
})
