// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Message } from '../../shared/api'
import { Messages } from './bits'
import { setLang } from '../i18n'
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { config: { authors: [], userName: 'Scarville' }, projects: [], machines: [], sessions: [] }, push: vi.fn() }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const m = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({ id, role, text, at: 1, ...extra })
beforeEach(() => { setLang('en'); MotionGlobalConfig.skipAnimations = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })
const thread = [
  m('a', 'assistant', 'I will start by looking at the checkout code to understand how payment is wired. Then I will fix the button and run everything.'),
  ...['CheckoutForm.tsx', 'PayButton.tsx', 'cart.ts'].map((f, i) => m(`r${i}`, 'event', `Read · /home/alex/projects/shop/src/${f}`)),
  m('g', 'event', 'Grep · handlePay --include=*.ts'),
  m('e', 'event', 'Edit · /home/alex/projects/shop/src/PayButton.tsx'),
  m('t', 'event', 'Bash · npx vitest run --reporter=dot', { toolDetails: { commands: ['npx vitest run --reporter=dot'], output: '3 failed' } }),
]
const FORBIDDEN = /\/home|src\/|\.tsx|\.ts\b|--|npx|vitest|\bBash\b|\bRead\b|\bGrep\b|\bEdit ·/
it('collapsed session thread: plain sentences only, no path, command, flag or tool name', async () => {
  await act(async () => root.render(<Messages session plain messages={thread} author="claude" />))
  const head = host.querySelector('.steps-head')!
  expect(head.getAttribute('aria-expanded')).toBe('false')
  expect(head.textContent).toMatch(/Looks through the code/)
  expect(head.textContent).not.toMatch(FORBIDDEN)
  expect(host.querySelector('.steps-list')).toBeNull()
  expect(host.querySelector('.chatter summary')!.textContent!.length).toBeLessThan(112)
  expect(host.textContent).not.toMatch(/\/home|\.tsx|npx vitest|--reporter/)
})
it('expanded: one plain line per goal; raw commands and results only inside closed details; missing evidence said', async () => {
  await act(async () => root.render(<Messages session plain messages={thread} author="claude" />))
  await act(async () => host.querySelector<HTMLButtonElement>('.steps-head')!.click())
  const lines = [...host.querySelectorAll('.steps-list .step-head .text')].map((e) => e.textContent)
  expect(lines).toEqual(['Looks through the code · 3', 'Searches the code', 'Edits the pay button code', 'Runs the tests'])
  for (const l of lines) expect(l).not.toMatch(FORBIDDEN)
  for (const d of host.querySelectorAll('.step-detail')) expect((d as HTMLDetailsElement).open).toBe(false)
  expect(host.querySelector('.step-content')!.textContent).toContain('CheckoutForm.tsx')
  expect(host.querySelector('.step-content')!.textContent).toContain('No result recorded')
  expect(host.textContent).toContain('3 failed')
})
it('French mode speaks French, and the weevboss thread (not plain) is untouched', async () => {
  setLang('fr')
  await act(async () => root.render(<Messages session plain messages={thread} author="claude" />))
  expect(host.querySelector('.steps-head')!.textContent).toMatch(/Parcourt le code/)
  await act(async () => root.render(<Messages messages={thread} author="weevboss" />))
  expect(host.querySelector('.steps-head')!.textContent).toMatch(/6 étapes/)
  expect(host.querySelector('.chatter')).toBeNull()
})
