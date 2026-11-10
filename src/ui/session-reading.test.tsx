// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MotionGlobalConfig } from 'motion/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Message } from '../../shared/api'
import { Messages } from './bits'
import { useThreadAsk } from './askthread'
import { setLang } from '../i18n'
const state = vi.hoisted(() => ({ word: true }))
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { config: { authors: [], userName: 'Scarville' }, projects: [], machines: [] }, push: vi.fn() }) }))
vi.mock('./ask', () => ({ useAsk: () => ({ reset() {} }), AskVoice: () => null, AskPanel: () => <div data-actions /> }))
vi.mock('./textpick', async original => ({ ...await original<typeof import('./textpick')>(), wordUnder: () => state.word ? { col: 0, word: [0, 5] } : null, anchorRow: () => () => {} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const message = (id: string, role: Message['role'], text: string, extra: Partial<Message> = {}): Message => ({ id, role, text, at: 1, ...extra })
beforeEach(() => { setLang('en'); MotionGlobalConfig.skipAnimations = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })
it('keeps human messages and boss briefs fully readable, folding only bridge coordination', async () => {
 const long = 'A complete paragraph. '.repeat(35)
 const msgs = [message('user', 'user', long), message('boss', 'orchestrator', long, { author: 'weevboss', coordination: true }), message('coord', 'orchestrator', 'Technical exchange', { author: 'codex', coordination: true }), message('external', 'orchestrator', long, { author: 'friend' }), message('answer', 'assistant', long)]
 await act(async () => root.render(<Messages session messages={msgs} author="codex" />))
 expect(host.querySelectorAll('.clamp')).toHaveLength(0)
 expect(host.textContent).not.toContain('read all')
 expect(host.querySelectorAll('details')).toHaveLength(1)
 const detail = host.querySelector('details')!
 expect(detail.open).toBe(false)
 expect(detail.querySelector('[data-mid="coord"]')).not.toBeNull()
 for (const id of ['user', 'boss', 'external', 'answer']) expect(host.querySelector(`[data-mid="${id}"]`)!.closest('details')).toBeNull()
 await act(async () => { detail.open = true })
 expect(detail.textContent).toContain('Technical exchange')
})
it('groups consecutive tools, stays folded on updates, and does not fold assistant prose', async () => {
 const msgs = [message('a', 'assistant', 'I am checking the result.'), message('t1', 'event', 'Read files'), message('t2', 'event', 'Run checks')]
 await act(async () => root.render(<Messages session messages={msgs} author="codex" working />))
 expect(host.querySelector('.steps-head')?.getAttribute('aria-expanded')).toBe('false')
 expect(host.querySelector('.steps-list')).toBeNull()
 await act(async () => root.render(<Messages session messages={[...msgs, message('t3', 'event', 'Inspect status')]} author="codex" working />))
 expect(host.querySelector('.steps-head')?.getAttribute('aria-expanded')).toBe('false')
 expect(host.textContent).toContain('I am checking the result.')
 await act(async () => host.querySelector<HTMLButtonElement>('.steps-head')!.click())
 expect(host.querySelectorAll('.steps-list .text')).toHaveLength(3)
})
function Selection() {
 const th = useThreadAsk([message('m', 'assistant', 'Hello there')], { title: 'session', tool: 'codex', selectionOnly: true })
 return <div ref={th.ref}><div data-mid="m">Hello there</div>{th.after('m')}</div>
}
it('does not open contextual actions on an ordinary tap, but opens them after a deliberate selection', async () => {
 await act(async () => root.render(<Selection />))
 const row = host.querySelector<HTMLElement>('[data-mid]')!
 const pointer = (type: string, x: number) => row.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0, clientX: x, clientY: 50 }))
 await act(async () => { pointer('pointerdown', 100); pointer('pointerup', 100) })
 expect(host.querySelector('[data-actions]')).toBeNull()
 vi.spyOn(document, 'elementFromPoint').mockReturnValue(row)
 await act(async () => { pointer('pointerdown', 100); pointer('pointermove', 130); pointer('pointerup', 130) })
 expect(host.querySelector('[data-actions]')).not.toBeNull()
 vi.restoreAllMocks()
})
