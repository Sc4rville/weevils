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
let coarse = true
beforeEach(() => {
  setLang('en')
  explain.mockClear()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') ? coarse : false, addEventListener() {}, removeEventListener() {} }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null); vi.unstubAllGlobals() })

const { Select } = await import('./select.tsx')
const mark = () => host.querySelector<HTMLButtonElement>('.pick-mark')
const fire = (el: Element, type: string, x = 5, y = 5) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }))

function Page({ go }: { go: () => void }) {
  return (
    <section>
      <h2>For you</h2>
      <button className="act" onClick={go}>Try this theme</button>
    </section>
  )
}

it('phone: the mark freezes the app; a tap takes a button whole and never presses it; the mark lets go', async () => {
  const go = vi.fn()
  await act(async () => root.render(<><Page go={go} /><Select top="60%" hideMark={false} /></>))
  expect(mark()!.getAttribute('aria-label')).toBe('Select text to explain it')
  const btn = host.querySelector('.act')!
  // Off: a tap is a tap, nothing is taken.
  await act(async () => (btn as HTMLButtonElement).click())
  expect(go).toHaveBeenCalledTimes(1)
  await act(async () => mark()!.click())
  expect(document.documentElement.classList.contains('wv-picking')).toBe(true)
  expect(host.querySelector('.pick-freeze .pick-close')).not.toBeNull()
  document.elementFromPoint = () => btn
  await act(async () => { fire(btn, 'pointerdown'); fire(btn, 'pointerup'); (btn as HTMLButtonElement).click() })
  expect(go).toHaveBeenCalledTimes(1)
  const bar = host.querySelector('.pick-bar')!
  expect(bar.textContent).toContain('explain')
  await act(async () => [...bar.querySelectorAll('button')].find((b) => b.textContent === 'explain')!.click())
  expect(explain).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ui', mode: 'explain', selection: 'Try this theme', title: 'For you' }))
  expect(host.querySelector('.pick-bar')!.textContent).toContain('It opens the post.')
  await act(async () => mark()!.click())
  expect(document.documentElement.classList.contains('wv-picking')).toBe(false)
  expect(host.querySelector('.pick-bar')).toBeNull()
  await act(async () => (btn as HTMLButtonElement).click())
  expect(go).toHaveBeenCalledTimes(2)
})

it('phone, outside select mode: a long press and the system selector are left alone', async () => {
  await act(async () => root.render(<><p className="txt">Night lens found three ideas</p><Select top="60%" hideMark={false} /></>))
  const p = host.querySelector('.txt')!
  const r = document.createRange(); r.selectNodeContents(p)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(r)
  await act(async () => { fire(p, 'pointerdown'); await new Promise((ok) => setTimeout(ok, 600)); fire(p, 'pointerup') })
  expect(host.querySelector('.pick-bar')).toBeNull()
  window.getSelection()!.removeAllRanges()
})

it('computer: no mark; a mouse selection anywhere opens the bar, but not inside a thread', async () => {
  coarse = false
  try {
    await act(async () => root.render(<><aside aria-label="Side bar"><p className="row">Repo hygienist</p></aside><div data-mid="m1"><p className="msg">in a thread</p></div><Select top="60%" hideMark={false} /></>))
    expect(mark()).toBeNull()
    const sel = async (el: Element) => {
      const r = document.createRange(); r.selectNodeContents(el)
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(r)
      await act(async () => { el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); await new Promise((ok) => setTimeout(ok, 5)) })
    }
    await sel(host.querySelector('.msg')!)
    expect(host.querySelector('.pick-bar')).toBeNull()
    await sel(host.querySelector('.row')!)
    expect(host.querySelector('.pick-bar')!.textContent).toContain('explain')
  } finally {
    coarse = true
    window.getSelection()!.removeAllRanges()
  }
})
