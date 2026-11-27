// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLang } from '../../src/i18n'

const app = { snap: { main: [] } }
vi.mock('../../src/ui/app-context', () => ({ useApp: () => app }))
const explain = vi.fn(async (_body: unknown) => ({ text: 'It opens the post.' }))
vi.mock('../../src/api', () => ({ api: { explain: (b: unknown) => explain(b) } }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); setLang('en'); explain.mockClear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { window.getSelection()!.removeAllRanges(); await act(async () => root.unmount()); host.remove(); setLang(null); vi.useRealTimers() })

const { Select } = await import('./select.tsx')
const select = async (el: Element) => {
  const r = document.createRange(); r.selectNodeContents(el)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(r)
  await act(async () => { document.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(300) })
}
const pill = () => host.querySelector<HTMLButtonElement>('.pick-pill')

function Page({ go }: { go: () => void }) {
  return (
    <section>
      <h2>For you</h2>
      <p className="txt">Night lens found three ideas</p>
      <button className="act" onClick={go}>Try this theme</button>
      <input className="field" defaultValue="my draft" />
    </section>
  )
}

it('a real selection anywhere gets one small Explain pill; a tap explains it with what is around it', async () => {
  const go = vi.fn()
  await act(async () => root.render(<><Page go={go} /><Select /></>))
  expect(pill()).toBeNull()
  await select(host.querySelector('.txt')!)
  expect(pill()!.textContent).toBe('Explain')
  // The pill never takes the selection away.
  expect(String(window.getSelection())).toBe('Night lens found three ideas')
  await act(async () => { pill()!.click(); vi.useRealTimers(); await new Promise((ok) => setTimeout(ok, 0)) })
  expect(explain).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ui', mode: 'explain', selection: 'Night lens found three ideas', title: 'For you' }))
  expect(host.querySelector('.pick-bar')!.textContent).toContain('It opens the post.')
})

it('no selection, no pill: taps and buttons are the page\'s own; a field\'s selection is never explained', async () => {
  const go = vi.fn()
  await act(async () => root.render(<><Page go={go} /><Select /></>))
  await act(async () => host.querySelector<HTMLButtonElement>('.act')!.click())
  expect(go).toHaveBeenCalledTimes(1)
  expect(pill()).toBeNull()
  await select(host.querySelector('.field')!)
  expect(pill()).toBeNull()
})

it('the pill goes when the selection does', async () => {
  await act(async () => root.render(<><Page go={() => {}} /><Select /></>))
  await select(host.querySelector('.txt')!)
  expect(pill()).not.toBeNull()
  window.getSelection()!.removeAllRanges()
  await act(async () => { document.dispatchEvent(new Event('selectionchange')); vi.advanceTimersByTime(300) })
  expect(pill()).toBeNull()
})
