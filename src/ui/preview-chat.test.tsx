// @vitest-environment happy-dom
import { act } from 'react'
import { MotionGlobalConfig } from 'motion/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '../../shared/api'
const mocks = vi.hoisted(() => ({ session: vi.fn(), send: vi.fn() }))
vi.mock('../api', () => ({ api: mocks }))
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { setup: {}, config: {}, projects: [], sessions: [] }, push: vi.fn(), colors: {} }) }))
vi.mock('./outbox-status', () => ({ OutboxStatus: () => null }))
import { Preview } from './preview'
import { PreviewChat, previewContextUrl } from './preview-chat'
import { setLang } from '../i18n'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const session = { id: 'existing', title: 'Website', projectId: 'project', tool: 'codex', controllable: true } as Session
beforeEach(() => {
 MotionGlobalConfig.skipAnimations = true
 setLang('en'); sessionStorage.clear(); vi.clearAllMocks()
 mocks.session.mockResolvedValue({ session, messages: [{ id: 'reply', role: 'assistant', text: 'The heading is updated.', at: 1 }] })
 mocks.send.mockResolvedValue({ id: session.id })
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); MotionGlobalConfig.skipAnimations = false; setLang(null) })
const render = (url = 'https://website.example/start') => act(async () => root.render(<Preview url={url} suggestions={[]} onUrl={() => {}} onClose={() => {}} session={session} />))
const toggle = () => act(async () => host.querySelector<HTMLButtonElement>('.preview-chat-toggle')!.click())
const type = async (text: string) => {
 const field = host.querySelector<HTMLInputElement>('.composer input')!
 await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })) })
 return field
}
const submit = () => act(async () => host.querySelector('.composer')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
it('keeps the browsing iframe, draft and replies through collapse, fullscreen and locale changes', async () => {
 await render(); const frame = host.querySelector('iframe')!
 await toggle(); expect(host.textContent).toContain('The heading is updated.')
 const field = await type('Make this smaller')
 await toggle(); await toggle()
 expect(host.querySelector('iframe')).toBe(frame); expect(field.value).toBe('Make this smaller')
 await act(async () => setLang('fr')); expect(field.value).toBe('Make this smaller')
 await act(async () => root.render(<Preview full url="https://website.example/start" suggestions={[]} onUrl={() => {}} onClose={() => {}} session={session}/>))
 expect(host.querySelector('iframe')).toBe(frame)
 await submit(); expect(mocks.send).toHaveBeenCalledExactlyOnceWith('existing', 'Make this smaller')
})
it('never implicitly shares the URL and freezes an opted-in context across failed retry/navigation', async () => {
 await render('https://website.example/one?token=private#secret'); await toggle()
 expect(host.querySelector('.preview-chat-url')?.textContent).toBe('https://website.example/one')
 await act(async () => host.querySelector<HTMLInputElement>('.preview-chat-context input')!.click())
 await type('Fix the layout'); mocks.send.mockRejectedValueOnce(new Error('Disconnected'))
 await submit(); expect(mocks.send).toHaveBeenLastCalledWith('existing', 'Fix the layout\n\nPreview page: https://website.example/one')
 await render('https://website.example/two'); await submit()
 expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0])
 expect(host.textContent).not.toContain('token=private')
})
it('requires an explicit existing target and never retargets when the list changes', async () => {
 const other = { ...session, id: 'other', title: 'Other session' }
 const draw = (sessions: Session[]) => act(async () => root.render(<PreviewChat sessions={sessions} project="Project" frame={{ current: null }} url="https://example.com"/>))
 await draw([session, other]); await toggle(); expect(host.querySelector('.composer')).toBeNull()
 await act(async () => { const select = host.querySelector('select')!; select.value = 'existing'; select.dispatchEvent(new Event('change', { bubbles: true })) })
 await type('First draft'); await draw([other, session]); await submit()
 expect(mocks.send).toHaveBeenLastCalledWith('existing', 'First draft')
 await draw([other]); expect(host.querySelector('.composer')).toBeNull()
})
it('removes URL credentials/query/hash and excludes static-site capability paths', () => {
 expect(previewContextUrl('https://user:secret@site.test/page?key=secret#token')).toBe('https://site.test/page')
 expect(previewContextUrl('https://app.test/api/site/private-key/repo/')).toBe('')
 expect(previewContextUrl('javascript:alert(1)')).toBe('')
})
it('reads same-origin navigation only when accessible and resets permission when the page changes', async () => {
 vi.useFakeTimers()
 await render(); await toggle()
 const frame = host.querySelector('iframe')!
 let href = 'https://website.example/current?private=yes'
 Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => ({ location: { get href() { return href } } }) })
 await act(async () => vi.advanceTimersByTimeAsync(750))
 expect(host.querySelector('.preview-chat-url')?.textContent).toBe('https://website.example/current')
 const check = host.querySelector<HTMLInputElement>('.preview-chat-context input')!
 await act(async () => check.click()); expect(check.checked).toBe(true)
 href = 'https://website.example/next'
 await act(async () => vi.advanceTimersByTimeAsync(750)); expect(check.checked).toBe(false)
 expect(host.querySelector('.preview-chat-url')?.textContent).toBe('https://website.example/next')
})
it('retains a failed contextual draft through unmount without changing its retry payload', async () => {
 await render(); await toggle(); await type('Retry this')
 await act(async () => host.querySelector<HTMLInputElement>('.preview-chat-context input')!.click())
 mocks.send.mockRejectedValueOnce(new Error('Offline')); await submit()
 const original = mocks.send.mock.calls[0]
 await act(async () => root.render(null)); await render('https://website.example/elsewhere'); await toggle()
 expect(host.querySelector<HTMLInputElement>('.composer input')!.value).toBe('Retry this')
 await submit(); expect(mocks.send.mock.calls[1]).toEqual(original)
})
it('blocks duplicate submits while acceptance is pending and respects read-only sessions', async () => {
 await render(); await toggle(); await type('Once')
 let release!: (r: unknown) => void
 mocks.send.mockReturnValue(new Promise(resolve => { release = resolve }))
 await act(async () => { const form = host.querySelector('.composer')!; for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
 expect(mocks.send).toHaveBeenCalledTimes(1)
 await act(async () => release({ id: session.id }))
 await act(async () => root.render(null))
 mocks.session.mockResolvedValue({ session: { ...session, controllable: false }, messages: [] })
 await render(); await toggle()
 expect(host.querySelector<HTMLInputElement>('.composer input')!.disabled).toBe(true)
})
it('shows a subsequent agent reply without remounting the website or stealing transcript scroll', async () => {
 vi.useFakeTimers()
 await render(); await toggle(); const frame = host.querySelector('iframe')!
 await type('Move the heading'); await submit()
 mocks.session.mockResolvedValue({ session, messages: [{ id: 'later', role: 'assistant', text: 'Moved the heading above the image.', at: 2 }] })
 await act(async () => vi.advanceTimersByTimeAsync(3000))
 expect(host.textContent).toContain('Moved the heading above the image.')
 expect(host.querySelector('iframe')).toBe(frame)
 await toggle(); expect(host.querySelector('iframe')).toBe(frame)
})
