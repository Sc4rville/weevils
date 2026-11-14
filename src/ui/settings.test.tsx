// @vitest-environment happy-dom
// Session settings in plain words: no slash commands on screen, a clear on/off for fast mode, an actionable line when
// the session is asleep. Every action still sends its command.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({ api: { transcribeInfo: async () => ({ enabled: false }) } }))
for (let p: object | null = HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) if (Object.hasOwn(p, 'animate')) delete (p as { animate?: unknown }).animate

const { setLang } = await import('../i18n')
const { Settings } = await import('./settings')

let root: Root
let host: HTMLElement
const sent: string[] = []
const run = async (c: string) => void sent.push(c)
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const button = (label: string) => [...host.querySelectorAll<HTMLElement>('button, [role=button]')].find((b) => text(b) === label)!
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  sent.length = 0
  setLang('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLang(null)
})

it('shows plain actions instead of slash commands, and each still sends its command', async () => {
  act(() => root.render(<Settings id="s1" tool="claude" canCommand run={run} />))
  expect(text(host)).not.toMatch(/\/compact|\/clear|\/new|approvals|toggle|set from here/)
  act(() => button('tidy up the conversation').click())
  await flush()
  expect(sent).toEqual(['/compact'])
  act(() => button('start over').click())
  expect(button('erase this conversation')).toBeTruthy()
  act(() => button('keep it').click())
  expect(button('erase this conversation')).toBeUndefined()
  act(() => button('start over').click())
  act(() => button('erase this conversation').click())
  await flush()
  expect(sent).toEqual(['/compact', '/clear'])
})

it('fast mode: on and off chips, a chip sends /fast only when it changes the state', async () => {
  act(() => root.render(<Settings id="s1" tool="claude" canCommand run={run} />))
  const group = host.querySelector('[role=group][aria-label="fast mode"]')!
  expect([...group.querySelectorAll('button')].map((b) => [text(b), b.getAttribute('aria-pressed')])).toEqual([['on', 'false'], ['off', 'false']])
  act(() => button('off').click())
  await flush()
  expect(sent).toEqual([])
  act(() => button('on').click())
  await flush()
  expect(sent).toEqual(['/fast'])
  expect(button('on').getAttribute('aria-pressed')).toBe('true')
  act(() => button('on').click())
  await flush()
  expect(sent).toEqual(['/fast'])
  act(() => button('off').click())
  await flush()
  expect(sent).toEqual(['/fast', '/fast'])
})

it('a sleeping session says what to do, in French too', () => {
  act(() => root.render(<Settings id="s1" tool="claude" canCommand={false} run={run} />))
  expect(text(host)).toBe('send a message to resume the session, then change these')
  act(() => setLang('fr'))
  expect(text(host)).toBe('envoie un message pour reprendre la session, puis change ces réglages')
})
