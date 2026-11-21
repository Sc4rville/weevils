// @vitest-environment happy-dom
// A long brief weevboss sends into a session reads as one spoken line; the whole brief is one deliberate tap away.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Message } from '../../shared/api'
import { Messages } from './bits'
import { setLang } from '../i18n'
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { config: { authors: [], userName: 'Alex' }, projects: [], machines: [], sessions: [] }, push: vi.fn() }) }))
vi.mock('./ask', () => ({ useAsk: () => ({ reset() {} }), AskVoice: () => null, AskPanel: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const brief = 'Asks from Alex (medium effort, usual weevils conventions so every weevils user gets it, English UI labels). The two sessions that got these (ae539719 themes, d5369050 UX check) are background automation runs. Merge auto/creative-weevils-themes-* into main after tests.'
const msg = (extra: Partial<Message> = {}): Message => ({ id: 'b', role: 'orchestrator', author: 'weevboss', text: brief, at: 1, ...extra })
beforeEach(() => { setLang('en'); MotionGlobalConfig.skipAnimations = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })

it('shows the spoken line, never the brief, until a tap opens it', async () => {
  await act(async () => root.render(<Messages session plain messages={[msg({ say: 'Merge the new themes and clean up the little status texts' })]} author="claude" />))
  expect(host.textContent).toContain('Merge the new themes and clean up the little status texts')
  expect(host.textContent).not.toContain('ae539719')
  const open = [...host.querySelectorAll('button')].find((b) => b.textContent === 'full message')!
  expect(open.getAttribute('aria-expanded')).toBe('false')
  await act(async () => open.click())
  expect(host.textContent).toContain('ae539719')
  expect(host.textContent).not.toContain('Merge the new themes')
})

it('without a line yet, only the first sentence, cut to one phone line', async () => {
  await act(async () => root.render(<Messages session plain messages={[msg()]} author="claude" />))
  expect(host.textContent).toContain('Asks from Alex')
  expect(host.textContent).not.toContain('background automation runs')
  expect(host.textContent).toContain('full message')
})

it('a short brief stays as it is, with nothing to open', async () => {
  await act(async () => root.render(<Messages session plain messages={[msg({ text: 'Run the tests again please.' })]} author="claude" />))
  expect(host.textContent).toContain('Run the tests again please.')
  expect(host.textContent).not.toContain('full message')
})
