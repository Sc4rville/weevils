// @vitest-environment happy-dom
// The session rows of a project band in next's side bar (next/src/main.tsx ProjectGroup, LooseStrip), as drawn: an
// automation that reruns is one row that unfolds its runs, and a session that is over but still asks something wears
// the mark of one that waits, with its question, among the active rows; the coloured band and the bold stay for a
// live wait. The rules themselves are pinned in next/src/side-rows.test.ts.
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AutoRun, Optimizer, Project, Session, Snapshot } from '../shared/api.ts'

// main.tsx is next's entry: it starts the app on #root. No #root here, so nothing starts; the bands are drawn alone.
vi.mock('react-dom/client', async (orig) => {
  const real = await orig<typeof import('react-dom/client')>()
  return { ...real, createRoot: (el: Element | null, ...rest: []) => (el ? real.createRoot(el, ...rest) : { render() {}, unmount() {} }) }
})
vi.mock('../next/src/worker.ts', () => ({ registerWorker() {}, useWorker: () => null }))
vi.mock('../next/src/fresh.ts', () => ({ keepFresh() {}, freshNow() {} }))
vi.mock('../src/api', () => ({ api: {} }))

localStorage.setItem('weevils-language', 'en')
const { MotionGlobalConfig } = await import('motion/react')
MotionGlobalConfig.skipAnimations = true
const { ProjectGroup, LooseStrip } = await import('../next/src/main.tsx')
const { setLang } = await import('../src/i18n/index.ts')

const NOW = Date.now()
const MIN = 60_000
const project: Project = { id: 'shop', name: 'shop', kind: 'repo', repos: ['shop-app'], where: {}, lastActivityAt: NOW }
const s = (id: string, ago: number, over: Partial<Session> = {}): Session =>
  ({ id, projectId: 'shop', title: `title of ${id}`, status: 'done', cwd: '/home/user/projects/shop-app', openedAt: NOW - ago * MIN, lastActivityAt: NOW - ago * MIN, subagents: [], ...over }) as Session
const run = (sessionId: string, over: Partial<AutoRun> = {}): AutoRun => ({ at: NOW, startedAt: NOW - 5 * MIN, ok: true, sessionId, ...over })
const auto = (id: string, title: string, runs: AutoRun[], over: Partial<Optimizer> = {}): Optimizer => ({ id, title, state: 'queued', runs, ...over }) as Optimizer

let root: Root
let host: HTMLElement
let opened: (string | null)[]
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  opened = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
})

function band(sessions: Session[], optimizers: Optimizer[] = [], current: string | null = null, under?: ReactNode, of: Project = project) {
  const snap = { now: NOW, projects: [of], sessions, optimizers } as unknown as Snapshot
  act(() => root.render(<ProjectGroup snap={snap} project={of} color="p1" current={current} open={(id) => opened.push(id)} page={() => {}} under={under} />))
}
/** The rows under the band's head, in order: [title, sub line, classes that matter, aria-expanded]. */
const rows = () => [...host.querySelectorAll<HTMLElement>('.nx-row.nx-sub:not(.nx-more)')]
const look = (r: HTMLElement) => ({
  title: r.querySelector('.nx-row-title')?.textContent ?? '',
  sub: r.querySelector('.nx-row-sub')?.textContent ?? '',
  cls: ['tone', 'nx-active', 'nx-current', 'nx-run'].filter((c) => r.classList.contains(c)).join(' '),
  expanded: r.getAttribute('aria-expanded'),
  mark: r.querySelector('.nx-mark')?.innerHTML ?? '',
})
const tap = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click() })
const more = () => host.querySelector<HTMLElement>('.nx-more')

it('a finished session that still asks sits with the active rows, with the mark of one that waits and its question; the coloured band stays for a live wait', () => {
  band([
    s('waits', 9, { status: 'needs_user', attention: 'Allow the push?' }),
    s('asks', 30, { title: 'Checking prices', asksYou: 'Tap Yes to resume, or Keep it stopped.' }),
    s('plain', 5, { title: 'Fix the checkout' }),
  ])
  const [waits, asks, ...rest] = rows().map(look)
  expect(rest).toEqual([])
  // Nothing is alive behind it: no tone, no bold. Its mark and its line say it.
  expect(asks).toMatchObject({ title: 'Checking prices', sub: 'Tap Yes to resume, or Keep it stopped.', cls: '', expanded: null })
  expect(asks.mark).toBe(waits.mark)
  expect(waits).toMatchObject({ sub: 'Allow the push?', cls: 'tone nx-active' })
  // The plain finished one stays behind « 1 done », under its check.
  expect(more()?.textContent).toBe('1 done')
  tap(more())
  const plain = look(rows()[2])
  expect(plain).toMatchObject({ title: 'Fix the checkout', sub: '', cls: '' })
  expect(plain.mark).not.toBe(asks.mark)
  expect(more()?.textContent).toBe('Hide done')
  tap(rows()[1])
  expect(opened).toEqual(['asks'])
})

it('an automation that reran is one row under its name; a tap unfolds its runs, each opening its own session', async () => {
  const ids = ['r0', 'r1', 'r2']
  const sessions = [...ids.map((id, i) => s(id, 60 + i * 180, { title: `Checking prices, take ${i}`, ...(i === 1 ? { asksYou: 'An older question.' } : {}) })), s('mine', 5, { title: 'Fix the checkout' })]
  const jobs = [auto('a1', 'Price watch', ids.map((id, i) => run(id, i === 0 ? { note: '**Done:** 3 prices updated.' } : {})))]
  band(sessions, jobs, 'r2')
  // Its older run asked, its newest did not: plain done, behind « 2 done » with the person's own session.
  expect(rows()).toHaveLength(0)
  expect(more()?.textContent).toBe('2 done')
  tap(more())
  const fold = () => rows().find((r) => r.hasAttribute('aria-expanded'))!
  expect(look(fold())).toMatchObject({ title: 'Price watch · 3 runs', cls: 'nx-current', expanded: 'false' })
  expect(look(fold()).sub.startsWith('3 prices updated. · ')).toBe(true)
  // Shut, it draws no row for its runs.
  expect(rows().map((r) => look(r).title)).toEqual(['Fix the checkout', 'Price watch · 3 runs'])
  expect(host.querySelectorAll('.nx-run')).toHaveLength(0)

  tap(fold())
  expect(opened).toEqual([])
  expect(fold().getAttribute('aria-expanded')).toBe('true')
  const runs = rows().filter((r) => r.classList.contains('nx-run'))
  expect(runs.map((r) => look(r).title)).toEqual(['Checking prices, take 0', 'Checking prices, take 1', 'Checking prices, take 2'])
  expect(runs.map((r) => look(r).cls)).toEqual(['nx-run', 'nx-run', 'nx-current nx-run'])
  // The run that asked says so here; the others wear their check.
  expect(look(runs[1]).mark).not.toBe(look(runs[0]).mark)
  expect(look(runs[2]).mark).toBe(look(runs[0]).mark)
  expect(look(runs[0]).sub).not.toBe('')
  tap(runs[1])
  expect(opened).toEqual(['r1'])

  // A fresh snapshot (a new run started) keeps it unfolded, and the row turns to working.
  band([s('r3', 1, { title: 'Checking prices, take 3', status: 'working', now: 'Reading two shops' }), ...sessions], [auto('a1', 'Price watch', jobs[0].runs!, { state: 'running', sessionId: 'r3' })], 'r2')
  expect(look(fold())).toMatchObject({ title: 'Price watch · 4 runs', sub: 'Reading two shops', cls: 'nx-active nx-current', expanded: 'true' })
  expect(rows().filter((r) => r.classList.contains('nx-run'))).toHaveLength(4)
  tap(fold())
  expect(fold().getAttribute('aria-expanded')).toBe('false')
  // Folded back: its runs leave once their fold has closed.
  await act(async () => new Promise((r) => setTimeout(r, 30)))
  expect(rows().filter((r) => r.classList.contains('nx-run'))).toHaveLength(0)
})

it('an automation with a single run here is a row that opens it, under the automation\'s name', () => {
  band([s('only', 20, { title: 'Checking prices, take 0', asksYou: 'Tap Yes to resume.' })], [auto('a1', 'Price watch', [run('only')])])
  expect(rows().map(look)).toMatchObject([{ title: 'Price watch', sub: 'Tap Yes to resume.', cls: '', expanded: null }])
  tap(rows()[0])
  expect(opened).toEqual(['only'])
})

it('an automation holding a run that waits live: one tap on its row opens that run, and leaves its runs unfolded', () => {
  // Its own automation id: the unfolded choice is kept per automation for the whole visit.
  const jobs = [auto('a2', 'Price watch', [run('old1'), run('old2')], { state: 'running', sessionId: 'live' })]
  band([s('old1', 200), s('old2', 400), s('live', 2, { title: 'Checking prices, take 2', status: 'needs_user', attention: 'Allow the push?' })], jobs)
  const fold = () => rows().find((r) => r.hasAttribute('aria-expanded'))!
  // A live wait: the row wears the tone band, with what the run asks.
  expect(rows().map(look)).toMatchObject([{ title: 'Price watch · 3 runs', sub: 'Allow the push?', cls: 'tone nx-active', expanded: 'false' }])
  tap(fold())
  expect(opened).toEqual(['live'])
  expect(fold().getAttribute('aria-expanded')).toBe('true')
  const runs = rows().filter((r) => r.classList.contains('nx-run'))
  expect(runs.map((r) => look(r).title)).toEqual(['Checking prices, take 2', 'title of old1', 'title of old2'])
  expect(runs.map((r) => look(r).cls)).toEqual(['tone nx-active nx-run', 'nx-run', 'nx-run'])
})

it('what is passed as « under » is drawn in the band, right under its head and above its sessions, folded or not', async () => {
  // A band of its own: folding it is kept on the device, and the other bands of this file stay open.
  const notes: Project = { ...project, id: 'notes', name: 'notes' }
  const draw = () => band([s('n1', 5, { projectId: 'notes', status: 'working', now: 'Reading two shops' })], [], null, <div className="probe">under the head</div>, notes)
  draw()
  const section = host.querySelector('section.nx-project')!
  const probe = section.querySelector('.probe')!
  const head = section.querySelector('.nx-project-head')!
  expect(probe.textContent).toBe('under the head')
  expect(rows()).toHaveLength(1)
  expect(head.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(probe.compareDocumentPosition(rows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  // Folded: its sessions go, what sits under its head stays.
  tap(head)
  await act(async () => new Promise((r) => setTimeout(r, 30)))
  expect(rows()).toHaveLength(0)
  expect(host.querySelector('section.nx-project .probe')).not.toBeNull()
  tap(head)
  expect(rows()).toHaveLength(1)
  // Nothing passed: nothing drawn there.
  band([s('n1', 5, { projectId: 'notes' })], [], null, undefined, notes)
  expect(host.querySelector('.probe')).toBeNull()
})

it('in French, the count and the fold of finished rows are French', () => {
  act(() => setLang('fr'))
  band([s('r0', 60), s('r1', 240), s('mine', 5)], [auto('a1', 'Veille des prix', [run('r0'), run('r1')])])
  expect(more()?.textContent).toBe('2 terminées')
  tap(more())
  expect(rows().map((r) => look(r).title)).toContain('Veille des prix · 2 passages')
  expect(more()?.textContent).toBe('Masquer les terminées')
})

it('a conversation with no repo that is over and still asks: its question under its title, the mark of one that waits', () => {
  const draw = (x: Session) => {
    const snap = { now: NOW, projects: [], sessions: [{ ...x, projectId: 'divers', messageCount: 4, origin: 'terminal' }], optimizers: [] } as unknown as Snapshot
    act(() => root.render(<LooseStrip snap={snap} current={null} open={(id) => opened.push(id)} />))
    return { sub: host.querySelector('.nx-loose-strip .nx-row-sub')?.textContent ?? '', mark: host.querySelector('.nx-loose-strip .nx-mark')!.innerHTML }
  }
  const waits = draw(s('w', 5, { status: 'needs_user', attention: 'Allow the push?' }))
  const plain = draw(s('p', 5))
  const asks = draw(s('a', 5, { asksYou: 'Pick one of the two names.' }))
  expect(asks.sub).toBe('Pick one of the two names.')
  expect(asks.mark).toBe(waits.mark)
  expect(plain).toMatchObject({ sub: '' })
  expect(plain.mark).not.toBe(waits.mark)
})

it('the strip of conversations with no repo: one label, plain rows, never a test run nor an old one', () => {
  const snap = { now: NOW, projects: [], optimizers: [], sessions: [
    s('mine', 5, { projectId: 'divers', messageCount: 4, origin: 'terminal' }),
    s('test', 5, { projectId: 'divers', messageCount: 4, origin: 'terminal', cwd: '/tmp/warmtest' }),
    s('old', 60 * 30, { projectId: 'divers', messageCount: 4, origin: 'terminal' }),
  ] } as unknown as Snapshot
  act(() => root.render(<LooseStrip snap={snap} current={null} open={(id) => opened.push(id)} />))
  expect(host.querySelector('.nx-loose-head')?.textContent).toBeTruthy()
  expect([...host.querySelectorAll('.nx-loose-strip .nx-row-title')].map((e) => e.textContent)).toEqual(['title of mine'])
  expect(host.querySelector('.nx-project, .band')).toBeNull()
})
