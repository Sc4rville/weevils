// The rows of a project band in the side bar (side-rows.ts): an automation that reruns is one row under its own
// name, and a session that is over but still asks something reads as waiting, not as finished.
import { expect, it } from 'vitest'
import type { AutoRun, Optimizer, Session, Snapshot } from '../../shared/api.ts'
import { at } from '../../src/ui/auto-model.ts'
import { DONE_SHOWN, asksYou, bandRows, holds, runRows, sessionState, sessionSub, type SideRow } from './side-rows.ts'

const NOW = Date.parse('2026-11-09T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

/** A session of the « shop » project; `ago` is how long ago it started, in minutes (it moved last 5 min later). */
const s = (id: string, ago: number, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'shop', title: `title of ${id}`, status: 'done', cwd: '/home/user/projects/shop-app', openedAt: NOW - ago * MIN, lastActivityAt: NOW - ago * MIN + 5 * MIN, ...over }) as Session
const run = (sessionId: string, over: Partial<AutoRun> = {}): AutoRun => ({ at: NOW, startedAt: NOW - 5 * MIN, ok: true, sessionId, ...over })
const auto = (id: string, title: string, runs: AutoRun[], over: Partial<Optimizer> = {}): Optimizer => ({ id, title, state: 'queued', runs, ...over }) as Optimizer
const snap = (sessions: Session[], optimizers: Optimizer[] = []) => ({ sessions, optimizers }) as Pick<Snapshot, 'sessions' | 'optimizers'>
const rows = (sessions: Session[], optimizers: Optimizer[] = []) => bandRows(snap(sessions, optimizers), 'shop', NOW)
const look = (r: SideRow) => [r.title, r.runs.length, r.state]

it('eight finished runs of two automations and two sessions of the person: two automation rows with their counts, two session rows', () => {
  const watch = ['s1', 's2', 's3', 's4', 's5']
  const nightly = ['n1', 'n2', 'n3']
  const { active, done } = rows(
    [
      ...watch.map((id, i) => s(id, 60 + i * 180, { title: `Checking prices, take ${i}` })),
      ...nightly.map((id, i) => s(id, 90 + i * 1440, { title: `Running the tests, night ${i}` })),
      s('mine', 30, { title: 'Fix the checkout' }),
      s('other', 400, { title: 'Notes app' }),
    ],
    [auto('a1', 'Price watch', watch.map((id) => run(id))), auto('a2', 'Nightly tests', nightly.map((id) => run(id)))],
  )
  expect(active).toEqual([])
  // Newest activity first, an automation placed by its newest run.
  expect(done.map(look)).toEqual([
    ['Fix the checkout', 1, 'done'],
    ['Price watch', 5, 'done'],
    ['Nightly tests', 3, 'done'],
    ['Notes app', 1, 'done'],
  ])
  expect(done.map((r) => r.autoId)).toEqual([undefined, 'a1', 'a2', undefined])
  expect(done.map((r) => r.key)).toEqual(['mine', 'auto:a1', 'auto:a2', 'other'])
  // What a tap unfolds: its runs, newest first, each under its own title.
  expect(runRows(done[1], NOW).map((r) => r.session.id)).toEqual(watch)
  expect(runRows(done[1], NOW)[0]).toMatchObject({ state: 'done', sub: at(NOW - 55 * MIN, NOW) })
  expect(runRows(done[1], NOW)[0].session.title).toBe('Checking prices, take 0')
})

it('an automation row says what came out of its newest run, then when', () => {
  const when = at(NOW - 55 * MIN, NOW)
  const fold = (r: AutoRun, last?: string) => rows([s('s1', 60, { lastMessage: last }), s('s0', 240)], [auto('a1', 'Price watch', [r, run('s0', { note: '**Done:** older news.' })])]).done[0]
  // The run's own note; « Done: » is dropped when it went well, the check already says so.
  expect(fold(run('s1', { note: '**Done:** 3 prices updated in the sheet. - **Why:** two shops moved.' })).sub).toBe(`3 prices updated in the sheet. · ${when}`)
  // It stopped short: its label is the news.
  expect(fold(run('s1', { ok: false, note: '**Stopped:** the budget is spent.' })).sub).toBe(`Stopped: the budget is spent. · ${when}`)
  // No note kept: the session's last words.
  expect(fold(run('s1'), 'Done: nothing new tonight. See the report.').sub).toBe(`Nothing new tonight. · ${when}`)
  // Nothing said at all: when, alone.
  expect(fold(run('s1')).sub).toBe(when)
})

it('a fold whose newest run asks is « asks you », with its question; one whose only an older run asked is plain done', () => {
  const jobs = [auto('a1', 'Price watch', [run('new'), run('old')])]
  const asking = rows([s('new', 60, { asksYou: 'Tap Yes to resume, or Keep it stopped.' }), s('old', 240, { asksYou: 'An older question.' })], jobs)
  expect(asking.done).toEqual([])
  expect(asking.active.map(look)).toEqual([['Price watch', 2, 'asks']])
  expect(asking.active[0].sub).toBe('Tap Yes to resume, or Keep it stopped.')
  // Unfolded, each run keeps its own mark.
  expect(runRows(asking.active[0], NOW).map((r) => r.state)).toEqual(['asks', 'asks'])

  const answered = rows([s('new', 60), s('old', 240, { asksYou: 'An older question.' })], jobs)
  expect(answered.active).toEqual([])
  expect(answered.done.map(look)).toEqual([['Price watch', 2, 'done']])
  expect(answered.done[0].sub).not.toContain('An older question.')
  expect(runRows(answered.done[0], NOW).map((r) => r.state)).toEqual(['done', 'asks'])
})

it('the person answered the newest run (it is theirs now): the older runs left in the fold do not ask in its place', () => {
  const job = (handedOver?: number) => [auto('a1', 'Price watch', [run('new', handedOver ? { handedOver } : {}), run('old'), run('older')])]
  const sessions = [s('new', 60, { cwd: '/home/user/projects/.auto/shop-app/a1' }), s('old', 240, { asksYou: 'Pause me, or build the new setup.' }), s('older', 420, { asksYou: 'Pause me, or build the new setup.' })]
  // Taken over: out of the fold, and the fold is plainly done.
  const answered = rows(sessions, job(NOW - 10 * MIN))
  expect(answered.active).toEqual([])
  expect(answered.done.map(look)).toEqual([['title of new', 1, 'done'], ['Price watch', 2, 'done']])
  // Unfolded, each old run still says what it asked.
  expect(runRows(answered.done[1], NOW).map((r) => r.state)).toEqual(['asks', 'asks'])
  // The run taken over still asks itself: its own row says so.
  const still = rows([{ ...sessions[0], asksYou: 'Which shop next?' }, ...sessions.slice(1)], job(NOW - 10 * MIN))
  expect(still.active.map(look)).toEqual([['title of new', 1, 'asks']])
  // Known only by the automation's own list of take-overs (its line left the list of runs): the same.
  expect(rows(sessions, [auto('a1', 'Price watch', [run('old'), run('older')], { handedOver: ['new'] })]).active).toEqual([])
  // A run that started after the one taken over asks for itself.
  const later = rows([...sessions, s('latest', 20, { asksYou: 'A new question.' })], [auto('a1', 'Price watch', [run('latest'), run('new', { handedOver: NOW - 30 * MIN }), run('old'), run('older')])])
  expect(later.active.map(look)).toEqual([['Price watch', 3, 'asks']])
  expect(later.active[0].sub).toBe('A new question.')
  // And an older run taken over answers nothing of a newer one.
  const older = rows([s('new', 60, { asksYou: 'A new question.' }), s('old', 240)], [auto('a1', 'Price watch', [run('new'), run('old', { handedOver: NOW - 10 * MIN })])])
  expect(older.active.map(look)).toEqual([['Price watch', 1, 'asks']])
})

it('a run the person took over stays an ordinary row of theirs', () => {
  const { done } = rows(
    [s('s1', 60), s('taken', 120, { title: 'Prices, then my own questions', cwd: '/home/user/projects/.auto/shop-app/a1' }), s('s3', 300)],
    [auto('a1', 'Price watch', [run('s1'), run('taken', { handedOver: NOW - HOUR }), run('s3')], { sessionId: 'taken' })],
  )
  expect(done.map(look)).toEqual([
    ['Price watch', 2, 'done'],
    ['Prices, then my own questions', 1, 'done'],
  ])
  expect(done[1].autoId).toBeUndefined()
})

it('a run the person took over long ago stays theirs once its line has left the list of runs: the automation names it', () => {
  // The list keeps 30 runs. The one taken over is older than all of them: no line says « handed over » any more, and
  // the folder it worked in is still the automation's. The automation's own list of take-overs is what tells.
  const listed = Array.from({ length: 30 }, (_, i) => `r${i}`)
  const sessions = [...listed.map((id, i) => s(id, 60 + i * 180)), s('taken', 9000, { title: 'Prices, then my own questions', cwd: '/home/user/projects/.auto/shop-app/a1' })]
  const { done } = rows(sessions, [auto('a1', 'Price watch', listed.map((id) => run(id)), { handedOver: ['taken'] })])
  expect(done.map(look)).toEqual([
    ['Price watch', 30, 'done'],
    ['Prices, then my own questions', 1, 'done'],
  ])
  expect(done[1]).toMatchObject({ key: 'taken', title: 'Prices, then my own questions' })
  expect(done[1].autoId).toBeUndefined()
  expect(done[0].runs.map((x) => x.id)).not.toContain('taken')
  // An older server names no take-over: the folder is all there is, and the session reads as a run.
  expect(rows(sessions, [auto('a1', 'Price watch', listed.map((id) => run(id)))]).done.map(look)).toEqual([['Price watch', 31, 'done']])
})

it('a run at work makes its row working, with what it is doing; a run that waits live comes before everything', () => {
  const jobs = [auto('a1', 'Price watch', [run('old')], { state: 'running', sessionId: 'now' })]
  const working = rows([s('now', 2, { status: 'working', now: 'Reading two shops' }), s('old', 240, { asksYou: 'An older question.' })], jobs)
  expect(working.active.map(look)).toEqual([['Price watch', 2, 'working']])
  expect(working.active[0].sub).toBe('Reading two shops')
  expect(working.done).toEqual([])

  const waiting = rows([s('now', 2, { status: 'working', now: 'Reading two shops' }), s('old', 240, { status: 'needs_user', attention: 'Allow the push?' })], jobs)
  expect(waiting.active.map(look)).toEqual([['Price watch', 2, 'needs_user']])
  expect(waiting.active[0].sub).toBe('Allow the push?')
})

it('an automation whose newest run was cut is interrupted; an older cut does not show', () => {
  const jobs = [auto('a1', 'Price watch', [run('new', { ok: false, note: 'Stopped: usage limit reached.' }), run('old')])]
  const cut = rows([s('new', 60, { status: 'interrupted' }), s('old', 240)], jobs)
  expect(cut.active.map(look)).toEqual([['Price watch', 2, 'interrupted']])
  expect(cut.active[0].sub).toBe(`Stopped: usage limit reached. · ${at(NOW - 55 * MIN, NOW)}`)
  expect(rows([s('new', 60), s('old', 240, { status: 'interrupted' })], jobs).done.map(look)).toEqual([['Price watch', 2, 'done']])
})

it('the active part: what needs you, what works, what still asks, what was cut, what rests', () => {
  const { active, done } = rows(
    [
      s('idle', 1, { status: 'idle' }),
      s('cut', 2, { status: 'interrupted' }),
      s('asks', 300, { asksYou: 'Pick one of the two names.' }),
      s('asks-idle', 3, { status: 'idle', asksYou: 'Open the report and say go.' }),
      s('works', 5, { status: 'working', now: 'Running the tests' }),
      s('waits', 500, { status: 'needs_user', attention: 'Allow the push?' }),
      s('run', 20, { asksYou: 'Tap Yes to resume.' }),
      s('finished', 10),
    ],
    [auto('a1', 'Price watch', [run('run')])],
  )
  expect(active.map((r) => [r.key, r.state])).toEqual([
    ['waits', 'needs_user'],
    ['works', 'working'],
    // Among those that ask, the newest first, an automation among the sessions.
    ['asks-idle', 'asks'],
    ['auto:a1', 'asks'],
    ['asks', 'asks'],
    ['cut', 'interrupted'],
    ['idle', 'idle'],
  ])
  expect(active.map((r) => r.sub)).toEqual(['Allow the push?', 'Running the tests', 'Open the report and say go.', 'Tap Yes to resume.', 'Pick one of the two names.', undefined, undefined])
  expect(done.map((r) => r.key)).toEqual(['finished'])
})

it('a run found by the folder it worked in only: with a repo, and without one', () => {
  const { done } = rows(
    [
      s('listed', 60),
      s('forgotten', 5000, { cwd: '/home/user/projects/.auto/shop-app/a1' }),
      s('bare', 90, { cwd: '/home/user/projects/.auto/.a2/' }),
      // A folder that only looks like one, an automation nobody accepted, one that no longer exists: ordinary rows.
      s('proposal', 100, { title: 'A proposal', cwd: '/home/user/projects/.auto/shop-app/a3' }),
      s('gone', 110, { title: 'Its automation is gone', cwd: '/home/user/projects/.auto/shop-app/a9' }),
      s('deeper', 120, { title: 'Deeper in the tree', cwd: '/home/user/projects/.auto/shop-app/a1/docs' }),
    ],
    [auto('a1', 'Price watch', [run('listed')]), auto('a2', 'Nightly tests', []), auto('a3', 'Not accepted', [], { state: 'proposed' })],
  )
  expect(done.map(look)).toEqual([
    ['Price watch', 2, 'done'],
    ['Nightly tests', 1, 'done'],
    ['A proposal', 1, 'done'],
    ['Its automation is gone', 1, 'done'],
    ['Deeper in the tree', 1, 'done'],
  ])
})

it('proposed and refused automations fold nothing, even when their list names a session', () => {
  const { done } = rows([s('s1', 60), s('s2', 120)], [auto('a1', 'Not accepted', [run('s1')], { state: 'proposed' }), auto('a2', 'Refused', [run('s2')], { state: 'refused' })])
  expect(done.map(look)).toEqual([['title of s1', 1, 'done'], ['title of s2', 1, 'done']])
})

it('only this band, and never what is archived: an automation with one run left is a row that opens it', () => {
  const { done } = rows(
    [s('here', 60), s('archived', 120, { archived: true }), s('elsewhere', 30, { projectId: 'notes' }), s('hidden', 20, { archived: true })],
    [auto('a1', 'Price watch', [run('here'), run('archived'), run('elsewhere')])],
  )
  expect(done.map(look)).toEqual([['Price watch', 1, 'done']])
  expect(done[0].runs[0].id).toBe('here')
  expect(holds(done[0], 'here')).toBe(true)
  expect(holds(done[0], 'archived')).toBe(false)
  expect(holds(done[0], null)).toBe(false)
})

it('« N done » counts rows after folding, the newest eight: twenty runs of one automation take one place', () => {
  const runs = Array.from({ length: 20 }, (_, i) => `r${i}`)
  const mine = Array.from({ length: 10 }, (_, i) => `m${i}`)
  const { done } = rows([...runs.map((id, i) => s(id, 100 + i * 180)), ...mine.map((id, i) => s(id, 10 + i * 10))], [auto('a1', 'Price watch', runs.map((id) => run(id)))])
  expect(done).toHaveLength(DONE_SHOWN)
  expect(done.map((r) => r.key)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
  const fewer = rows([...runs.map((id, i) => s(id, 100 + i * 180)), ...mine.slice(0, 3).map((id, i) => s(id, 10 + i * 10))], [auto('a1', 'Price watch', runs.map((id) => run(id)))]).done
  expect(fewer.map((r) => [r.key, r.runs.length])).toEqual([['m0', 1], ['m1', 1], ['m2', 1], ['auto:a1', 20]])
})

it('a session of the person: over and still asking reads as asking, never while it works, waits live or was cut', () => {
  expect(sessionState({ status: 'done', asksYou: 'Pick one.' })).toBe('asks')
  expect(sessionState({ status: 'idle', asksYou: 'Pick one.' })).toBe('asks')
  expect(sessionState({ status: 'done' })).toBe('done')
  for (const status of ['working', 'needs_user', 'interrupted'] as const) {
    expect(sessionState({ status, asksYou: 'Pick one.' })).toBe(status)
    expect(asksYou({ status, asksYou: 'Pick one.' })).toBeUndefined()
  }
  expect(sessionSub({ status: 'done', asksYou: 'Pick one.' })).toBe('Pick one.')
  expect(sessionSub({ status: 'needs_user', asksYou: 'Pick one.', attention: 'Allow the push?' })).toBe('Allow the push?')
  expect(sessionSub({ status: 'working', now: 'Running the tests' })).toBe('Running the tests')
  expect(sessionSub({ status: 'done' })).toBeUndefined()
})
