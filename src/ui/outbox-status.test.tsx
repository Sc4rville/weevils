// @vitest-environment happy-dom
// A message that did not arrive: the person's own bubble is marked calmly with its cause, in the theme's colours, and « Notify weevboss » (outbox-status.tsx).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { setLang } from '../i18n'
const state = vi.hoisted(() => ({ rows: [] as any[], retry: vi.fn(async () => undefined), main: vi.fn(async () => ({ id: 'boss' })), handed: vi.fn() }))
vi.mock('../outbox', () => ({ useOutbox: () => state.rows, retryReceipt: state.retry, markHandedOver: (id: string) => { state.handed(id); state.rows = state.rows.map(r => r.messageId === id ? { ...r, handedOver: true } : r) } }))
vi.mock('../api', () => ({ api: { main: state.main } }))
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { sessions: [{ id: 'tux', title: 'architecture vision' }] } }) }))
import { OutboxStatus } from './outbox-status'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { setLang('en'); host = document.createElement('div'); document.body.append(host); root = createRoot(host); state.rows = []; state.retry.mockClear(); state.main.mockClear(); state.handed.mockClear() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })
const scope = '/api/sessions/tux/'
const render = (seen: { text: string; at: number; role?: string }[] = []) => act(async () => root.render(<OutboxStatus scope={scope} seen={seen} />))
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent?.trim())

it('failed → a calm bubble with its cause and « Notify weevboss » → weevboss is on it → delivered → back to normal', async () => {
 state.rows = [{ messageId: 'm1', url: '/api/sessions/tux/send', status: 'failed', cause: 'unreachable', text: 'les 4 decisions quoi', acceptedAt: 1000, updatedAt: 1000 }]
 await render()
 const bubble = host.querySelector('.msg.delivery-failed')!
 expect(bubble.textContent).toContain('les 4 decisions quoi')
 expect(bubble.querySelector('.delivery-cause')?.textContent).toBe('the session isn’t answering right now')
 expect(buttons()).toEqual(['Notify weevboss'])
 await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
 expect(state.main).toHaveBeenCalledTimes(1)
 const note = (state.main.mock.calls[0] as unknown as string[])[0]
 expect(note).toContain('[architecture vision](/#s=tux)')
 expect(note).toContain('> les 4 decisions quoi')
 expect(note).toContain('m1')
 expect(state.handed).toHaveBeenCalledWith('m1')
 await render()
 expect(host.querySelector('.delivery-cause')?.textContent).toBe('weevboss is on it')
 expect(buttons()).toEqual([])
 // The text reaches the thread (weevboss got it there): the bubble is back to normal.
 await render([{ text: '[from:weevboss] They asked: les 4 decisions quoi', at: 2000 }])
 expect(host.textContent).toBe('')
})

it('says nothing for a slow, unconfirmed or delivered message, nor for one sent elsewhere', async () => {
 state.rows = [
  { messageId: 'a', url: '/api/sessions/tux/send', status: 'accepted', text: 'a' },
  { messageId: 'd', url: '/api/sessions/tux/send', status: 'delivering', text: 'd' },
  { messageId: 'u', url: '/api/sessions/tux/send', status: 'uncertain', text: 'u', error: 'unconfirmed' },
  { messageId: 's', url: '/api/sessions/tux/send', status: 'sending', trackingLost: true, text: 's' },
  { messageId: 'ok', url: '/api/sessions/tux/send', status: 'delivered' },
  { messageId: 'x', url: '/api/sessions/other/send', status: 'failed', text: 'x' },
 ]
 await render()
 expect(host.textContent).toBe('')
 expect(host.textContent).not.toMatch(/not sure it arrived/)
})

it('a failure without a known cause reads « Not there yet »; a later identical delivered send clears it', async () => {
 state.rows = [{ messageId: 'f', url: '/api/sessions/tux/send', fingerprint: 'same', status: 'failed', text: 'hello', updatedAt: 1 }]
 await render()
 expect(host.querySelector('.delivery-cause')?.textContent).toBe('Not there yet')
 state.rows.push({ messageId: 'g', url: '/api/sessions/tux/send', fingerprint: 'same', status: 'delivered', updatedAt: 2 })
 await render()
 expect(host.textContent).toBe('')
})

it('to weevboss itself, or never taken by the server, the way round is « try again », not weevboss', async () => {
 state.rows = [{ messageId: 'w', url: '/api/main', status: 'failed', text: 'hi' }]
 await act(async () => root.render(<OutboxStatus scope="/api/main" />))
 expect(buttons()).toEqual(['try again'])
 state.rows = [{ messageId: 'n', url: '/api/sessions/tux/send', status: 'sending', stuck: true, trackingLost: true, text: 'hey' }]
 await render()
 expect(host.querySelector('.delivery-cause')?.textContent).toBe('it goes out as soon as the connection is back')
 await act(async () => (host.querySelector('button') as HTMLButtonElement).click())
 expect(state.retry).toHaveBeenCalledWith('n')
})

it('a short text is not « arrived » because an agent reply happens to contain it', async () => {
 state.rows = [{ messageId: 'q', url: '/api/sessions/tux/send', status: 'failed', text: '??', acceptedAt: 1000, updatedAt: 1000 }]
 await render([{ text: 'What do you mean ?? Here are the 4 decisions', at: 2000, role: 'assistant' }, { text: 'not this ?? either', at: 2000, role: 'user' }])
 expect(host.querySelector('.delivery-failed')).not.toBeNull()
 await render([{ text: '??', at: 2000, role: 'user' }])
 expect(host.textContent).toBe('')
})
