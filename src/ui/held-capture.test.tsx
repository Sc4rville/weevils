// @vitest-environment happy-dom
// A capture from next's camera waits in the box to write in, a small square with its cross, and goes with the next
// message: kept in the library first, then its path (here) or the picture itself (a conversation on another machine).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const capture = vi.hoisted(() => vi.fn())
vi.mock('../api', () => ({ api: { capture } }))
import { Composer, type Attachment } from './bits'
import { heldNow, hold } from './held-capture'
import { setLang } from '../i18n'

let root: Root
let host: HTMLDivElement
let send = vi.fn<(text: string) => void>()
let attach = vi.fn<(text: string, files: Attachment[]) => void>()
const pic = { url: 'data:image/png;base64,UElD', context: { screen: 'for you' }, at: Date.now() }
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en'); sessionStorage.clear(); hold(null)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  send = vi.fn(); attach = vi.fn(); capture.mockReset()
})
afterEach(() => { act(() => root.unmount()); host.remove(); setLang(null) })
const render = (to = 'weevboss') => act(() => root.render(<Composer label="m" placeholder="m" onSend={send} onAttach={attach} captureTo={{ to, feedback: to === 'weevboss' }} />))

it('shows the held capture in the box and sends it with the words, through the library', async () => {
  render()
  expect(host.querySelector('.held-capture')).toBeNull()
  act(() => hold(pic))
  expect(host.querySelector<HTMLImageElement>('.held-capture img')?.src).toBe(pic.url)
  expect(host.querySelector<HTMLButtonElement>('.send')!.disabled).toBe(false)
  capture.mockResolvedValue({ message: '(photo: /lib/a.png) too far ⟦weevils — …⟧', note: '…', here: true })
  const field = host.querySelector('textarea, input') as HTMLTextAreaElement
  await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, 'too far'); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => host.querySelector('form')!.requestSubmit())
  expect(capture).toHaveBeenCalledWith({ data: pic.url, context: pic.context, text: 'too far', to: 'weevboss', feedback: true })
  expect(send).toHaveBeenCalledWith('(photo: /lib/a.png) too far ⟦weevils — …⟧')
  expect(heldNow()).toBeNull()
  expect(host.querySelector('.held-capture')).toBeNull()
})

it('sends the picture itself to a conversation on another machine', async () => {
  render('s-remote')
  act(() => hold(pic))
  capture.mockResolvedValue({ message: 'x', note: 'screen: for you', here: false })
  await act(async () => host.querySelector('form')!.requestSubmit())
  expect(attach).toHaveBeenCalledWith('⟦weevils — screen: for you⟧', [{ name: 'capture.png', type: 'image/png', data: 'UElD' }])
})

it('keeps the capture when sending fails, and its cross removes it', async () => {
  render()
  act(() => hold(pic))
  capture.mockRejectedValue(new Error('offline'))
  await act(async () => host.querySelector('form')!.requestSubmit())
  expect(heldNow()).toBe(pic)
  act(() => host.querySelector<HTMLButtonElement>('.held-off')!.click())
  expect(heldNow()).toBeNull()
  expect(host.querySelector('.held-capture')).toBeNull()
})

it('is never shown in a box that has no place to send it', () => {
  act(() => root.render(<Composer label="m" placeholder="m" onSend={send} />))
  act(() => hold(pic))
  expect(host.querySelector('.held-capture')).toBeNull()
})
