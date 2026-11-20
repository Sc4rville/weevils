import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTranscriptText } from '../transcripts.ts'
import {
  JournalError, appendEvent, deriveMeta, extendsJournal, parseEngine, parseJournal, renderMeta, renderThread, serializeEvent, slugify, threadFolder,
  validateFolder, validateJournal, type EventDraft, type JournalEvent, type ThreadFolder, type Violation,
} from './journal.ts'

// The sample weevbook is the test data: three threads, each a folder of `main` (docs/spec/02-weevbook.md).
const BOOK = path.resolve(import.meta.dirname, '../../examples/weevbook')
function walk(dir: string, base = dir, out: Record<string, Uint8Array> = {}): Record<string, Uint8Array> {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, base, out)
    else out[path.relative(base, p)] = fs.readFileSync(p)
  }
  return out
}
function folders(): ThreadFolder[] {
  const out: ThreadFolder[] = []
  for (const project of fs.readdirSync(path.join(BOOK, 'projects'))) {
    for (const month of fs.readdirSync(path.join(BOOK, 'projects', project))) {
      for (const thread of fs.readdirSync(path.join(BOOK, 'projects', project, month))) {
        const p = `projects/${project}/${month}/${thread}`
        out.push({ path: p, files: walk(path.join(BOOK, p)) })
      }
    }
  }
  return out
}
const str = (b: Uint8Array) => Buffer.from(b).toString('utf8')
const eventsOf = (f: ThreadFolder) => parseJournal(str(f.files['events.jsonl'])).events
const named = (part: string) => folders().find((f) => f.path.includes(part))!
/** The thread that moves to another machine, the one that passes to Codex, the one that came from ChatGPT. */
const moved = () => eventsOf(named('fix-the-login-redirect'))
const passed = () => named('add-csv-export-to-orders')
const numbers = (v: Violation[]) => [...new Set(v.map((x) => x.invariant))]
const renumber = (events: JournalEvent[]) => events.map((e, i) => ({ ...e, seq: i + 1 }) as JournalEvent)
const without = (events: JournalEvent[], pick: (e: JournalEvent) => boolean) => renumber(events.filter((e) => !pick(e)))
const ULID_A = '01M7M8E6XR0000000000000000'
const ULID_B = '01M7M8E6XR0000000000000001'

describe('the sample weevbook', () => {
  it('has two projects and three threads', () => {
    expect(folders().map((f) => f.path.split('/')[1])).toEqual(['shop-app', 'shop-app', 'trip-planner'])
  })
  for (const f of folders()) {
    const name = f.path.split('/').pop()!.slice(27)
    it(`${name}: the journal breaks no THREAD invariant`, () => expect(validateJournal(eventsOf(f))).toEqual([]))
    it(`${name}: the folder breaks no BOOK invariant`, () => expect(validateFolder(f)).toEqual([]))
    it(`${name}: renderThread reproduces thread.md byte for byte`, () => expect(renderThread(eventsOf(f))).toBe(str(f.files['thread.md'])))
    it(`${name}: renderMeta reproduces meta.json byte for byte`, () => expect(renderMeta(eventsOf(f))).toBe(str(f.files['meta.json'])))
    it(`${name}: every line is in canonical form`, () => {
      const text = str(f.files['events.jsonl'])
      expect(eventsOf(f).map(serializeEvent).join('\n') + '\n').toBe(text)
    })
    it(`${name}: replaying the journal through appendEvent gives the same file`, () => {
      const events: JournalEvent[] = []
      const lines: string[] = []
      for (const e of eventsOf(f)) {
        const { v: _v, seq: _seq, ...draft } = e
        const line = appendEvent(events, draft as EventDraft)!
        lines.push(line)
        events.push(JSON.parse(line))
      }
      expect(lines.join('\n') + '\n').toBe(str(f.files['events.jsonl']))
    })
  }
  it('tells the three stories it is there for', () => {
    const legs = (part: string) => eventsOf(named(part)).filter((e) => e.type === 'leg.start').map((e) => `${e.engine} rung ${e.rung}`)
    expect(legs('fix-the-login-redirect')).toEqual(['claude:a3f9c1@laptop rung 0', 'claude:a3f9c1@server rung 2'])
    expect(legs('add-csv-export-to-orders')).toEqual(['claude:a3f9c1@laptop rung 0', 'codex:c81d2e@laptop rung 3'])
    expect(legs('offline-maps')).toEqual(['claude:a3f9c1@server rung 3'])
    const chat = eventsOf(named('offline-maps')).filter((e) => e.type === 'message' && e.source === 'connector')
    expect(chat.length).toBe(7)
  })
  it('index.json lists every thread folder, with the facts of its journal', () => {
    const index = JSON.parse(fs.readFileSync(path.join(BOOK, 'index.json'), 'utf8')) as { threads: { thread: string; path: string; title: string; project: string | null; updated: string; state: string }[] }
    expect(index.threads.map((t) => t.path)).toEqual(folders().map((f) => f.path).sort((x, y) => (x.split('/').pop()! < y.split('/').pop()! ? -1 : 1)))
    for (const t of index.threads) {
      const m = deriveMeta(eventsOf(folders().find((f) => f.path === t.path)!))
      expect([t.thread, t.title, t.project, t.updated, t.state]).toEqual([m.thread, m.title, m.project, m.updated, m.state])
    }
  })
  it('uses invented, neutral data only', () => {
    for (const f of folders()) for (const [name, body] of Object.entries(f.files)) {
      const homes = str(body).match(/\/home\/[a-z]+/g) ?? []
      expect(homes.every((h) => h === '/home/alex'), name).toBe(true)
      expect(/[\w.-]+@[\w-]+\.[a-z]{2,}/.test(str(body)), name).toBe(false)
    }
  })
})

describe('the raw files against today’s reader (server/transcripts.ts)', () => {
  // The adapter contract of docs/spec/01-thread.md: what the reader shows from the provider's lines is what the journal says.
  for (const f of folders()) {
    const events = eventsOf(f)
    for (const start of events.filter((e) => e.type === 'leg.start')) {
      const provider = parseEngine(start.engine)!.provider
      const raw = f.files[`raw/${start.leg}.${provider}.0001.jsonl`]
      it(`${f.path.split('/').pop()!.slice(27)} ${start.leg}: same replies${provider === 'claude' ? ' and steps' : ''}`, () => {
        const t = parseTranscriptText(`${provider === 'claude' ? '' : 'rollout-2026-11-18T13-53-50-'}${start.session}.jsonl`, provider, str(raw))
        const inLeg = events.filter((e) => e.leg === start.leg)
        // The line a provider writes when it refuses to go on (a usage limit) is a reply for today's reader; in the
        // journal it is the `failed` state of the turn, not a message.
        const replies = t.messages.filter((m) => m.role === 'assistant' && !(t.stopError && m.text.startsWith(t.stopError.text.slice(0, 40))))
        if (t.stopError) expect(inLeg.some((e) => e.type === 'turn' && e.state === 'failed' && e.reason === t.stopError!.reason)).toBe(true)
        expect(replies.map((m) => m.text)).toEqual(inLeg.flatMap((e) => (e.type === 'message' && e.role === 'assistant' ? [e.text] : [])))
        // A resume preface is signed « weevbook »: the engine received it, the thread does not hold it.
        const typed = t.messages.filter((m) => m.role === 'user' || (m.role === 'orchestrator' && m.author !== 'weevbook'))
        expect(t.messages.filter((m) => m.role === 'orchestrator').every((m) => m.author === 'weevbook')).toBe(true)
        expect(typed.length).toBeLessThanOrEqual(events.filter((e) => e.type === 'message' && e.role === 'user').length)
        if (provider === 'claude') {
          expect(t.messages.filter((m) => m.role === 'event').map((m) => m.text.replaceAll(`${start.cwd}/`, ''))).toEqual(inLeg.filter((e) => e.type === 'tool').map((e) => e.summary))
        } else {
          expect(t.messages.filter((m) => m.role === 'event').map((m) => m.id)).toEqual(inLeg.filter((e) => e.type === 'tool').map((e) => e.call))
        }
        expect(t.id).toBe(start.session)
      })
    }
  }
})

describe('appendEvent', () => {
  const first: EventDraft = { id: ULID_A, at: '2026-11-17T08:00:00Z', leg: null, type: 'meta', thread: ULID_A, title: 'A thread' }
  it('numbers the line after the journal and writes the fields in the order of the spec', () => {
    expect(appendEvent([], first)).toBe(`{"v":1,"seq":1,"id":"${ULID_A}","at":"2026-11-17T08:00:00Z","leg":null,"type":"meta","thread":"${ULID_A}","title":"A thread"}`)
    const events = moved()
    const line = appendEvent(events, { id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'message', role: 'user', text: 'One more thing.', source: 'weevils', key: 'msg_0123456789abcdef' })!
    expect(JSON.parse(line).seq).toBe(events.length + 1)
  })
  it('a replayed key writes nothing', () => {
    const events = moved()
    const sent = events.find((e) => e.type === 'message' && e.key)!
    const { v: _v, seq: _seq, ...again } = sent
    expect(appendEvent(events, { ...again, id: ULID_B } as EventDraft)).toBeNull()
  })
  it('refuses an event on the wrong leg, and says which invariant', () => {
    const events = moved()
    const wrong: EventDraft = { id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L1', type: 'message', role: 'user', text: 'Hello', source: 'weevils' }
    expect(() => appendEvent(events, wrong)).toThrow(JournalError)
    try {
      appendEvent(events, wrong)
    } catch (e) {
      expect(numbers((e as JournalError).violations)).toEqual(['THREAD-7'])
    }
  })
  it('refuses a second engine while a turn runs', () => {
    const events = moved().slice(0, 6)
    expect(() => appendEvent(events, { id: ULID_B, at: '2026-11-17T08:03:00Z', leg: 'L1', type: 'leg.start', engine: 'codex:c81d2e@laptop', session: 's', cwd: '/home/alex/projects/shop-app', rung: 3, epoch: 1 })).toThrow(/THREAD-5|THREAD-6/)
  })
})

describe('invariants of docs/spec/01-thread.md', () => {
  it('THREAD-1: seq counts from 1 with no gap', () => {
    const events = moved()
    events.splice(10, 1)
    expect(numbers(validateJournal(events))).toContain('THREAD-1')
    expect(numbers(validateJournal(renumber(moved()).map((e) => ({ ...e, seq: e.seq - 1 }) as JournalEvent)))).toContain('THREAD-1')
  })
  it('THREAD-2: every id is a ULID, used once', () => {
    const twice = moved()
    twice[5] = { ...twice[5], id: twice[4].id }
    expect(numbers(validateJournal(twice))).toEqual(['THREAD-2'])
    const odd = moved()
    odd[5] = { ...odd[5], id: 'not-a-ulid' }
    expect(numbers(validateJournal(odd))).toEqual(['THREAD-2'])
  })
  it('THREAD-3: the envelope and the fields of each type', () => {
    const cases: ((e: any) => void)[] = [
      (e) => (e.type = 'thought'),
      (e) => delete e.summary,
      (e) => (e.at = '2026-11-17 08:02'),
      (e) => (e.at = '2026-11-17T08:02:31+01:00'),
      (e) => (e.extra = 1),
      (e) => (e.v = 0),
    ]
    for (const change of cases) {
      const events = moved()
      const tool = { ...events.find((e) => e.type === 'tool')! }
      change(tool)
      events[tool.seq - 1] = tool
      expect(numbers(validateJournal(events))).toEqual(['THREAD-3'])
    }
    // A line of a newer format is kept and only its envelope is checked.
    const newer = moved()
    newer.push({ v: 2, seq: newer.length + 1, id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'thought', text: '…' } as unknown as JournalEvent)
    expect(validateJournal(newer)).toEqual([])
  })
  it('THREAD-4: line 1 is the meta event that names the thread, once', () => {
    const none = moved()
    none[0] = { ...none[0], thread: undefined } as JournalEvent
    expect(numbers(validateJournal(none))).toEqual(['THREAD-4'])
    const again = moved()
    again.push({ v: 1, seq: again.length + 1, id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'meta', thread: ULID_B })
    expect(numbers(validateJournal(again))).toEqual(['THREAD-4'])
    expect(numbers(validateJournal(renumber(moved().slice(1))))).toContain('THREAD-4')
  })
  it('THREAD-5: legs are L1, L2, … and each ends at most once', () => {
    const skipped = moved().map((e) => (e.leg === 'L2' && e.type !== 'note' ? ({ ...e, leg: 'L3' } as JournalEvent) : e))
    expect(numbers(validateJournal(skipped))).toContain('THREAD-5')
    const events = moved()
    const end = events.find((e) => e.type === 'leg.end')!
    const twice = renumber([...events.slice(0, end.seq), { ...end, id: ULID_B }, ...events.slice(end.seq)])
    expect(numbers(validateJournal(twice))).toContain('THREAD-5')
  })
  it('THREAD-6: at most one leg is open', () => {
    const v = validateJournal(without(moved(), (e) => e.type === 'leg.end'))
    expect(numbers(v)).toContain('THREAD-6')
    expect(v.find((x) => x.invariant === 'THREAD-6')!.info).toContain('L1 is still open')
  })
  it('THREAD-7: an event carries the open leg; a tool step never sits outside a leg', () => {
    const events = moved()
    const tool = events.find((e) => e.type === 'tool')!
    events[tool.seq - 1] = { ...tool, leg: null }
    expect(numbers(validateJournal(events))).toEqual(['THREAD-7'])
    const late = moved()
    const note = late.find((e) => e.type === 'note')!
    late[note.seq - 1] = { ...note, leg: 'L9' }
    expect(numbers(validateJournal(late))).toEqual(['THREAD-7'])
    expect(note.leg).toBe('L1') // a note may speak of a leg that is closed
  })
  it('THREAD-8: a message outside a leg says where it came from', () => {
    const events = moved()
    events[1] = { ...events[1], source: undefined } as JournalEvent
    expect(numbers(validateJournal(events))).toEqual(['THREAD-8'])
    const reply = moved()
    const said = reply.find((e) => e.type === 'message' && e.role === 'assistant')!
    reply[said.seq - 1] = { ...said, source: 'weevils' } as JournalEvent
    expect(numbers(validateJournal(reply))).toEqual(['THREAD-8'])
  })
  it('THREAD-9: an idempotency key is used once', () => {
    const events = moved()
    const sent = events.filter((e) => e.type === 'message' && e.key)
    events[sent[1].seq - 1] = { ...sent[1], key: (sent[0] as { key: string }).key } as JournalEvent
    expect(numbers(validateJournal(events))).toEqual(['THREAD-9'])
  })
  it('THREAD-10: turns are numbered in order and follow the state machine', () => {
    const noAssign = without(moved(), (e) => e.type === 'turn' && e.turn === 1 && e.state === 'assigned')
    expect(numbers(validateJournal(noAssign))).toContain('THREAD-10')
    const skipped = moved().map((e) => ((e.type === 'turn' || e.type === 'checkpoint') && e.turn === 2 ? ({ ...e, turn: 3 } as JournalEvent) : e))
    expect(numbers(validateJournal(skipped))).toContain('THREAD-10')
    const attempt = moved().map((e) => (e.type === 'turn' && e.state === 'assigned' && e.attempt === 2 ? ({ ...e, attempt: 5 } as JournalEvent) : e))
    expect(numbers(validateJournal(attempt))).toEqual(['THREAD-10'])
    const silent = moved().map((e) => (e.type === 'turn' && e.resume ? ({ ...e, resume: undefined } as JournalEvent) : e))
    expect(numbers(validateJournal(silent))).toEqual(['THREAD-10'])
    const after = moved()
    after.push({ v: 1, seq: after.length + 1, id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'turn', turn: 2, state: 'running' })
    expect(numbers(validateJournal(after))).toContain('THREAD-10')
  })
  it('THREAD-10: once an attempt has had an effect, every later attempt resumes', () => {
    let n = 0
    const at = '2026-11-17T08:00:00Z'
    const draft = (d: Record<string, unknown>) => ({ id: `01M7M8E6XR${String(++n).padStart(16, '0')}`, at, leg: 'L1', ...d }) as unknown as EventDraft
    const engine = 'claude:a3f9c1@laptop'
    const assigned = (attempt: number, resume?: boolean) => draft({ type: 'turn', turn: 1, state: 'assigned', engine, attempt, rule: 'stay', reason: 'x', ...(resume ? { resume } : {}) })
    const story = (thirdResumes: boolean) => {
      const events: JournalEvent[] = []
      const add = (d: EventDraft) => events.push(JSON.parse(appendEvent(events, d)!))
      add(draft({ leg: null, type: 'meta', thread: '01M7M8E6XR0000000000000000' }))
      add(draft({ type: 'leg.start', engine, session: 's', cwd: '/x', rung: 0, epoch: 1 }))
      add(draft({ type: 'message', role: 'user', text: 'Rename the file.', source: 'weevils' }))
      add(draft({ type: 'turn', turn: 1, state: 'accepted', message: events[2].id }))
      add(assigned(1))
      add(draft({ type: 'turn', turn: 1, state: 'running' }))
      add(draft({ type: 'tool', call: 'c1', name: 'Bash', summary: 'Bash · git mv a b' }))
      add(draft({ type: 'checkpoint', turn: 1, kind: 'none', reason: 'x' }))
      add(draft({ type: 'turn', turn: 1, state: 'failed', reason: 'api', effect: 'some' }))
      add(assigned(2, true))
      add(draft({ type: 'turn', turn: 1, state: 'running' }))
      // The second attempt fails before doing anything: the first one's effect is still there.
      add(draft({ type: 'turn', turn: 1, state: 'failed', reason: 'quota', effect: 'none' }))
      events.push({ ...assigned(3, thirdResumes), v: 1, seq: events.length + 1 } as JournalEvent)
      return events
    }
    expect(validateJournal(story(true))).toEqual([])
    expect(numbers(validateJournal(story(false)))).toEqual(['THREAD-10'])
  })
  it('THREAD-11: one turn at a time is in an engine’s hands', () => {
    const events = moved().slice(0, 6) // turn 1 is running
    const at = '2026-11-17T08:02:20Z'
    events.push({ v: 1, seq: 7, id: ULID_A, at, leg: 'L1', type: 'message', role: 'user', text: 'And another thing.', source: 'weevils' })
    events.push({ v: 1, seq: 8, id: ULID_B, at, leg: 'L1', type: 'turn', turn: 2, state: 'accepted', message: ULID_A })
    expect(validateJournal(events)).toEqual([]) // accepted while the first one runs: fine, it waits
    events.push({ v: 1, seq: 9, id: '01M7M8E6XR0000000000000002', at, leg: 'L1', type: 'turn', turn: 2, state: 'assigned', engine: 'claude:a3f9c1@laptop', attempt: 1, rule: 'stay', reason: 'x' })
    expect(numbers(validateJournal(events))).toEqual(['THREAD-11'])
  })
  it('THREAD-12: a turn runs in a leg of the engine it was assigned to', () => {
    const events = moved().map((e) => (e.type === 'turn' && e.turn === 2 && e.state === 'assigned' && e.attempt === 1 ? ({ ...e, engine: 'codex:c81d2e@laptop' } as JournalEvent) : e))
    const v = validateJournal(events)
    expect(numbers(v)).toEqual(['THREAD-12'])
    expect(v.length).toBe(2) // assigned elsewhere while L1 is open, then run in L1
  })
  it('THREAD-13: an agent speaks and acts only while a turn is running', () => {
    const events = moved()
    events.push({ v: 1, seq: events.length + 1, id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'tool', call: 'toolu_x', name: 'Bash', summary: 'Bash · ls' })
    expect(numbers(validateJournal(events))).toEqual(['THREAD-13'])
    const talk = moved()
    talk.push({ v: 1, seq: talk.length + 1, id: ULID_B, at: '2026-11-17T10:00:00Z', leg: 'L2', type: 'message', role: 'assistant', text: 'By the way…' })
    expect(numbers(validateJournal(talk))).toEqual(['THREAD-13'])
  })
  it('THREAD-14: a finished turn has its checkpoint just before', () => {
    const events = moved().map((e) => (e.type === 'checkpoint' && e.turn === 1 ? ({ v: 1, seq: e.seq, id: e.id, at: e.at, leg: e.leg, type: 'note', kind: 'debug', text: 'no checkpoint' } as JournalEvent) : e))
    expect(numbers(validateJournal(events))).toEqual(['THREAD-14'])
  })
  it('THREAD-15: a handoff covers what is behind it, and never less than the one before', () => {
    const ahead = moved().map((e) => (e.type === 'handoff' && e.seq > 20 ? ({ ...e, upTo: e.seq } as JournalEvent) : e))
    expect(numbers(validateJournal(ahead))).toEqual(['THREAD-15'])
    const back = moved().map((e) => (e.type === 'handoff' && e.seq > 20 ? ({ ...e, upTo: 3 } as JournalEvent) : e))
    expect(numbers(validateJournal(back))).toEqual(['THREAD-15'])
  })
})

describe('invariants of docs/spec/02-weevbook.md', () => {
  const change = (f: ThreadFolder, name: string, to: (text: string) => string): ThreadFolder => ({ ...f, files: { ...f.files, [name]: Buffer.from(to(str(f.files[name]))) } })
  const drop = (f: ThreadFolder, name: string): ThreadFolder => ({ ...f, files: Object.fromEntries(Object.entries(f.files).filter(([n]) => n !== name)) })
  const add = (f: ThreadFolder, name: string, body: string): ThreadFolder => ({ ...f, files: { ...f.files, [name]: Buffer.from(body) } })

  it('BOOK-1: the folder is projects/<project>/<YYYY-MM>/<id>-<slug>, from the journal', () => {
    const f = passed()
    expect(threadFolder(eventsOf(f))).toBe(f.path)
    expect(numbers(validateFolder({ ...f, path: f.path.replace('shop-app', 'other') }))).toEqual(['BOOK-1'])
    expect(numbers(validateFolder({ ...f, path: f.path.replace('2026-11', '2026-12') }))).toEqual(['BOOK-1'])
    expect(slugify('Écrire à l’équipe : « ça marche ! »')).toBe('ecrire-a-l-equipe-ca-marche')
    // No project: _unsorted. The chat thread was filed by a later meta event.
    const chat = eventsOf(named('offline-maps'))
    expect(threadFolder(chat.slice(0, 7))).toMatch(/^projects\/_unsorted\/2026-11\//)
    expect(threadFolder(chat)).toMatch(/^projects\/trip-planner\/2026-11\//)
  })
  it('BOOK-2: the journal only grows', () => {
    const text = str(passed().files['events.jsonl'])
    const lines = text.split('\n')
    expect(extendsJournal(lines.slice(0, 10).join('\n') + '\n', text)).toBe(true)
    expect(extendsJournal('', text)).toBe(true)
    expect(extendsJournal(text, lines.slice(0, 10).join('\n') + '\n')).toBe(false)
    expect(extendsJournal(text.replace('CSV', 'TSV'), text)).toBe(false)
    expect(extendsJournal(lines.slice(0, 10).join('\n'), text)).toBe(false)
  })
  it('BOOK-3: thread.md is the journal rendered, byte for byte', () => {
    expect(numbers(validateFolder(change(passed(), 'thread.md', (t) => t.replace('Agent', 'Robot'))))).toEqual(['BOOK-3'])
    expect(numbers(validateFolder(drop(passed(), 'thread.md')))).toEqual(['BOOK-3'])
  })
  it('BOOK-4: meta.json is the journal summed up, byte for byte', () => {
    expect(numbers(validateFolder(change(passed(), 'meta.json', (t) => t.replace('"waiting"', '"working"'))))).toEqual(['BOOK-4'])
  })
  it('BOOK-5: an attachment is named by its SHA-256 and belongs to one event', () => {
    const f = passed()
    const file = Object.keys(f.files).find((n) => n.startsWith('attachments/'))!
    expect(file).toMatch(/^attachments\/[0-9a-f]{64}\.csv$/)
    expect(numbers(validateFolder(change(f, file, (t) => t + 'x')))).toEqual(['BOOK-5'])
    expect(numbers(validateFolder(drop(f, file)))).toEqual(['BOOK-5'])
    expect(numbers(validateFolder(add(f, 'attachments/' + '0'.repeat(64) + '.png', 'x')))).toEqual(['BOOK-5'])
  })
  it('BOOK-6: a raw file belongs to a leg and its provider, in numbered segments of JSON lines', () => {
    const f = passed()
    expect(numbers(validateFolder(add(f, 'raw/L7.claude.0001.jsonl', '{}\n')))).toEqual(['BOOK-6'])
    expect(numbers(validateFolder(add(f, 'raw/L2.claude.0001.jsonl', '{}\n')))).toEqual(['BOOK-6'])
    expect(numbers(validateFolder(add(f, 'raw/L1.claude.0003.jsonl', '{}\n')))).toEqual(['BOOK-6'])
    expect(numbers(validateFolder(add(f, 'raw/L1.claude.0002.jsonl', '{}\n')))).toEqual([])
    expect(numbers(validateFolder(add(f, 'raw/L1.claude.0002.jsonl', '{"cut":\n')))).toEqual(['BOOK-6'])
  })
  it('BOOK-7: one canonical JSON object per line, LF, final newline', () => {
    const f = passed()
    expect(numbers(validateFolder(change(f, 'events.jsonl', (t) => t.slice(0, -1))))).toEqual(['BOOK-7'])
    expect(numbers(validateFolder(change(f, 'events.jsonl', (t) => t.replace('\n', '\n\n'))))).toEqual(['BOOK-7'])
    expect(numbers(validateFolder(change(f, 'events.jsonl', (t) => t.replace('{"v":1,"seq":2,', '{"seq":2,"v":1,'))))).toEqual(['BOOK-7'])
    expect(numbers(validateFolder(change(f, 'events.jsonl', (t) => t.replace('\n', '\r\n'))))).toContain('BOOK-7')
    expect(parseJournal('{"v":1,\n').errors.map((e) => e.invariant)).toEqual(['BOOK-7'])
  })
  it('BOOK-8: handoff.md is the one the last handoff event recorded', () => {
    const f = passed()
    expect(numbers(validateFolder(change(f, 'handoff.md', (t) => t.replace('decimals', 'cents'))))).toEqual(['BOOK-8'])
    expect(numbers(validateFolder(drop(f, 'handoff.md')))).toEqual(['BOOK-8'])
    const last = eventsOf(f).findLast((e) => e.type === 'handoff')!
    expect(str(f.files['handoff.md'])).toContain(`\nupTo: ${last.upTo}\n`)
  })
  it('BOOK-9: nothing that looks like a secret is written', () => {
    const f = passed()
    expect(str(f.files['events.jsonl'])).toContain('SHOP_API_TOKEN=[redacted]')
    expect(str(f.files['raw/L1.claude.0001.jsonl'])).toContain('SHOP_API_TOKEN=[redacted]')
    const leaked = change(f, 'events.jsonl', (t) => t.replace('SHOP_API_TOKEN=[redacted]', 'SHOP_API_TOKEN=hunter2'))
    expect(numbers(validateFolder(leaked))).toContain('BOOK-9')
    expect(numbers(validateFolder(change(f, 'raw/L1.claude.0001.jsonl', (t) => t.replace('SHOP_API_TOKEN=[redacted]', 'SHOP_API_TOKEN=hunter2'))))).toEqual(['BOOK-9'])
  })
  it('BOOK-10: a thread folder holds its own files and nothing else', () => {
    expect(numbers(validateFolder(add(passed(), 'notes.txt', 'x')))).toEqual(['BOOK-10'])
    expect(numbers(validateFolder(drop(passed(), 'events.jsonl')))).toEqual(['BOOK-10'])
  })
})
