// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { setLang } from '../i18n'
const state = vi.hoisted(() => ({ rows: [] as any[], copied: vi.fn(async () => true), push: vi.fn() }))
vi.mock('../outbox', () => ({ useOutbox: () => state.rows, forgetReceipt: vi.fn() }))
vi.mock('./copy', () => ({ copyText: state.copied }))
vi.mock('./app-context', () => ({ useApp: () => ({ push: state.push }) }))
import { OutboxStatus } from './outbox-status'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { setLang('en'); host = document.createElement('div'); document.body.append(host); root = createRoot(host); state.rows = []; state.copied.mockClear(); state.push.mockClear() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })
it('distinguishes acceptance from delivery and scopes the notice to the current conversation', async () => {
 state.rows = [{messageId:'a',url:'/api/main',status:'accepted'}, {messageId:'b',url:'/api/sessions/other/send',status:'delivered'}]
 await act(async () => root.render(<OutboxStatus scope="/api/main" />))
 expect(host.textContent).toContain('waiting to be forwarded'); expect(host.textContent).not.toContain('forwarded to the agent')
 state.rows = [{...state.rows[0],status:'delivered',result:{id:'target'}}]
 await act(async () => root.render(<OutboxStatus scope="/api/main" />))
 expect(host.textContent).toBe('')
 expect(host.querySelector('button')).toBeNull()
})
it('an uncertain receipt offers recovery, never a button that reinjects the message', async () => {
 state.rows = [{messageId:'a',url:'/api/main',status:'uncertain',text:'original draft'}]
 await act(async () => root.render(<OutboxStatus scope="/api/main" />))
 expect(host.textContent).toContain('no automatic resend')
 const buttons = host.querySelectorAll('button'); expect(buttons).toHaveLength(1)
 await act(async () => buttons[0].click()); expect(state.copied).toHaveBeenCalledWith('original draft')
})

it('contextual delivery hides completed and older-event receipts without forgetting their identity',async()=>{
 state.rows=[{messageId:'old',url:'/api/foryou/a/act',status:'accepted',eventId:'previous'}, {messageId:'current',url:'/api/foryou/a/act',status:'accepted',eventId:'current'}, {messageId:'elsewhere',url:'/api/foryou/b/reply',status:'uncertain'}]
 await act(async()=>root.render(<OutboxStatus scope="/api/foryou/a/" eventId="current"/>))
 expect(host.querySelectorAll('[data-delivery]')).toHaveLength(1)
 expect(host.textContent).toContain('waiting to be forwarded')
 state.rows[1]={...state.rows[1],status:'delivered',result:{id:'target'}}
 await act(async()=>root.render(<OutboxStatus scope="/api/foryou/a/" eventId="current"/>))
 expect(host.textContent).toBe('')
 expect(state.rows).toHaveLength(3)
})
