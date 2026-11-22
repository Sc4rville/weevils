// @vitest-environment happy-dom
// Files from the computer the app is opened on (Scarville, 2026-11-21: « sur pc j arrive pas a paste … je dois pouvoir
// mettre les trucs de mon pc »): Ctrl/Cmd+V of an image or files, long text, and drag-and-drop onto a thread.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../api', () => ({ api: {} }))
import { Composer, type Attachment } from './bits'
import { setLang } from '../i18n'

let root: Root
let host: HTMLDivElement
let attach = vi.fn<(text: string, files: Attachment[]) => void>()
let other = vi.fn<(text: string, files: Attachment[]) => void>()
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en'); sessionStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  attach = vi.fn(); other = vi.fn()
  // happy-dom lays nothing out: every box counts as on screen.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); setLang(null) })

const data = (files: File[], text: Record<string, string> = {}) => ({
  files, items: [], types: [...(files.length ? ['Files'] : []), ...Object.keys(text)], getData: (k: string) => text[k] ?? '',
  dropEffect: 'none',
})
const fire = async (el: Element, type: string, d: ReturnType<typeof data>) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: d })
  await act(async () => { el.dispatchEvent(event) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return event
}
const box = (el = host) => el.querySelector('textarea, input:not([type=file])')!
const submit = (el = host) => act(async () => el.querySelector('form')!.requestSubmit())
const pdf = () => new File(['%PDF-1.4'], 'notes.pdf', { type: 'application/pdf' })
const shot = () => new File(['png'], 'Screenshot.png', { type: 'image/png' })

it('pastes copied files and a screenshot into the roomy box (weevils next), and sends them with the words', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" multiline onSend={vi.fn()} onAttach={attach} />))
  expect((await fire(box(), 'paste', data([shot(), pdf()]))).defaultPrevented).toBe(true)
  expect(host.textContent).toContain('2 files')
  expect(host.querySelector('.attach-thumbs img')).not.toBeNull()
  expect(host.querySelector('.attach-file')?.textContent).toBe('notes.pdf')
  act(() => { const f = box() as HTMLTextAreaElement; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(f, 'see these'); f.dispatchEvent(new Event('input', { bubbles: true })) })
  await submit()
  expect(attach).toHaveBeenCalledWith('see these', [expect.objectContaining({ name: 'Screenshot.png' }), expect.objectContaining({ name: 'notes.pdf', type: 'application/pdf' })])
})

it('pastes into the one-line box of a session too, and leaves long text to the field', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" onSend={vi.fn()} onAttach={attach} />))
  expect((await fire(box(), 'paste', data([], { 'text/plain': 'a long line '.repeat(500) }))).defaultPrevented).toBe(false)
  expect(host.querySelector('.attach-line')).toBeNull()
  await fire(box(), 'paste', data([pdf()]))
  expect(host.textContent).toContain('1 file')
})

it('says to drag files the browser only names (copied in a file manager)', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" multiline onSend={vi.fn()} onAttach={attach} />))
  const e = await fire(box(), 'paste', data([], { 'text/uri-list': 'file:///home/me/a.pdf\nfile:///home/me/b.png' }))
  expect(e.defaultPrevented).toBe(true)
  expect(host.textContent).toContain('drag them here instead')
})

it('takes no file where a box has no attachment (a text-only thread)', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" multiline onSend={vi.fn()} />))
  expect((await fire(box(), 'paste', data([shot()]))).defaultPrevented).toBe(false)
  expect(host.querySelector('.attach-line')).toBeNull()
})

it("drops files from the desktop on a thread into that thread's box, not another one on screen", async () => {
  act(() => root.render(<>
    <div className="boss-band"><Composer label="boss" placeholder="boss" horizontal onSend={vi.fn()} onAttach={other} /></div>
    <main className="session-page"><p className="msg">an agent's reply</p><Composer label="s" placeholder="s" multiline onSend={vi.fn()} onAttach={attach} /></main>
  </>))
  const page = host.querySelector('.session-page')!
  const over = await fire(host.querySelector('.msg')!, 'dragover', data([pdf()]))
  expect(over.defaultPrevented).toBe(true)
  expect(page.querySelector('form')!.hasAttribute('data-dropping')).toBe(true)
  expect(host.querySelector('.boss-band form')!.hasAttribute('data-dropping')).toBe(false)
  await fire(host.querySelector('.msg')!, 'drop', data([pdf()]))
  expect(page.querySelector('form')!.hasAttribute('data-dropping')).toBe(false)
  await submit(page as HTMLDivElement)
  expect(attach).toHaveBeenCalledWith('', [expect.objectContaining({ name: 'notes.pdf' })])
  expect(other).not.toHaveBeenCalled()
})

it('keeps the line breaks of text pasted in a one-line box: it grows into the roomy box', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" horizontal onSend={vi.fn()} onAttach={attach} />))
  const lines = 'error: one\nat two\nat three'
  expect((await fire(box(), 'paste', data([], { 'text/plain': lines }))).defaultPrevented).toBe(true)
  const field = box() as HTMLTextAreaElement
  expect(field.classList.contains('horizontal-editor')).toBe(false)
  expect(field.value).toBe(lines)
  expect(document.activeElement).toBe(field)
  await submit()
  expect(attach).not.toHaveBeenCalled()
})

it('lets one-line text paste stay native in a one-line box', async () => {
  act(() => root.render(<Composer label="m" placeholder="m" onSend={vi.fn()} />))
  expect((await fire(box(), 'paste', data([], { 'text/plain': 'just one line' }))).defaultPrevented).toBe(false)
  expect(box().tagName).toBe('INPUT')
})

it('a roomy box asked for (weevils next) starts one line tall; one made roomy by pasted lines opens on three', () => {
  act(() => root.render(<Composer label="m" placeholder="m" multiline onSend={vi.fn()} />))
  expect(host.querySelector('textarea')!.getAttribute('rows')).toBe('1')
})
