// @vitest-environment happy-dom
// The requests band of next's side bar (requests-band.tsx), as drawn: there while a request is open, with the open
// count, « N need you » only when the server counts them, and one tap to the requests page. The count itself is
// pinned in server/snapshot-asks-waiting.test.ts, the rule that shows or hides the band in scripts/side-pins.test.ts,
// its place in the side bar and its flat look in test/next-requests-band.test.ts.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Snapshot } from '../../shared/api.ts'
import type { Page } from '../../src/ui/app-context.tsx'

vi.mock('../../src/api', () => ({ api: {} }))
localStorage.setItem('weevils-language', 'en')

const { RequestsBand } = await import('./requests-band.tsx')
const { flipProject } = await import('./factory.tsx')
const { setLang } = await import('../../src/i18n/index.ts')

let root: Root
let host: HTMLElement
let pages: Page[]
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  pages = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  flipProject('drawer:requests', null)
  setLang(null)
})

const snap = (over: Partial<Snapshot>) => ({ sessions: [], projects: [], optimizers: [], sideDrawers: {}, ...over }) as unknown as Snapshot
const draw = (over: Partial<Snapshot>, color = 'p7') => act(() => root.render(<RequestsBand snap={snap(over)} color={color} page={(p) => pages.push(p)} />))
const band = () => host.querySelector<HTMLElement>('.nx-requests')
const text = (sel: string) => host.querySelector(sel)?.textContent ?? null

it('shows its name and the open count, and one tap anywhere on it opens the requests page', () => {
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(text('.nx-project-name')).toBe('requests')
  expect(text('.nx-requests-count')).toBe('95')
  // One tap target from edge to edge: the mark, the name, the count and the « > » are all inside it.
  const buttons = host.querySelectorAll('button')
  expect(buttons).toHaveLength(1)
  expect(buttons[0].contains(host.querySelector('.nx-requests-count'))).toBe(true)
  expect(buttons[0].contains(host.querySelector('.chars .ch'))).toBe(true)
  act(() => buttons[0].click())
  expect(pages).toEqual([{ kind: 'requests' }])
})

it('says how many need you under its name, only when the server counts them', () => {
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(text('.nx-row-sub')).toBe('12 need you')
  draw({ asksOpen: 95, asksWaiting: 1 })
  expect(text('.nx-row-sub')).toBe('1 needs you')
  // None waits, or an older server that does not count them: the band is there, with no sub line.
  draw({ asksOpen: 95, asksWaiting: 0 })
  expect(band()).not.toBeNull()
  expect(host.querySelector('.nx-row-sub')).toBeNull()
  draw({ asksOpen: 95 })
  expect(text('.nx-requests-count')).toBe('95')
  expect(host.querySelector('.nx-row-sub')).toBeNull()
})

it('is absent with no open request, and where the server keeps no ledger', () => {
  draw({ asksOpen: 0, asksWaiting: 0 })
  expect(host.innerHTML).toBe('')
  draw({})
  expect(host.innerHTML).toBe('')
  // Pinned in Your factory, it still has nothing to open without a ledger.
  draw({ sideDrawers: { requests: true } })
  expect(host.innerHTML).toBe('')
})

it('reads in French, singular and plural', () => {
  setLang('fr')
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(text('.nx-project-name')).toBe('demandes')
  expect(text('.nx-row-sub')).toBe('12 t’attendent')
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('demandes, 95 ouvertes, 12 t’attendent')
  draw({ asksOpen: 1, asksWaiting: 1 })
  expect(text('.nx-row-sub')).toBe('1 t’attend')
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('demandes, 1 ouverte, 1 t’attend')
})

it('says the same aloud as it shows: its name, how many are open, how many need you', () => {
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('requests, 95 open, 12 need you')
  draw({ asksOpen: 3 })
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('requests, 3 open')
})

it('wears the colour it is given (the requests page\'s own slot) and the « ! » of the settings line, in the band\'s ink', () => {
  draw({ asksOpen: 3 }, 'p9')
  expect(band()?.style.getPropertyValue('--c')).toBe('var(--p9)')
  expect(band()?.classList.contains('band')).toBe(true)
  // Never taken for a project: the tour's « your projects » stop points at the first `.nx-project` of the side bar.
  expect(band()?.matches('.nx-project')).toBe(false)
  // The same glyph as bands.tsx FootBand's requests line (G c="!"), drawn with the current ink: no colour of its own.
  const mark = host.querySelector('.nx-repo-mark svg')
  expect(mark?.getAttribute('stroke')).toBe('currentColor')
  expect(mark?.querySelector('path')?.getAttribute('d')).toBe('M12 4v10M12 18.5v1.5')
})

it('switched off in Your factory it leaves at once; pinned, it keeps its place with nothing open, wearing its pin and no number', () => {
  draw({ asksOpen: 95, asksWaiting: 12, sideDrawers: { requests: false } })
  expect(host.innerHTML).toBe('')
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(host.querySelector('.nx-pin')).toBeNull()
  act(() => flipProject('drawer:requests', false))
  draw({ asksOpen: 95, asksWaiting: 12 })
  expect(host.innerHTML).toBe('')
  flipProject('drawer:requests', null)
  draw({ asksOpen: 0, sideDrawers: { requests: true } })
  expect(text('.nx-project-name')).toBe('requests')
  expect(host.querySelector('.nx-pin')).not.toBeNull()
  expect(host.querySelector('.nx-requests-count')).toBeNull()
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('requests')
})
