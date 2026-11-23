// @vitest-environment happy-dom
// The camera on a touch screen, finger by finger: the mark freezes, a double tap or a drawn part attaches the capture
// to the box to write in, a single tap lets go, and a picture that never comes never leaves the screen frozen.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const made = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>), Slow: class extends Error {} }))
vi.mock('./camera-shoot.ts', () => ({
  SlowShot: made.Slow,
  shoot: () => (made.next ? made.next() : Promise.resolve({ width: 780, toDataURL: () => 'data:image/png;base64,V0hPTEU=' })),
  crop: (c: { toDataURL: () => string }, box: unknown) => (box ? { toDataURL: () => 'data:image/png;base64,UEFSVA==' } : c),
}))
vi.mock('../../src/api.ts', () => ({ api: {} }))
import { Camera } from './camera.tsx'
import { heldNow, hold } from '../../src/ui/held-capture.ts'
import { TAP_MS } from './camera-geometry.ts'
import { setLang } from '../../src/i18n/index.ts'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  sessionStorage.clear(); localStorage.clear()
  hold(null); made.next = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Camera spot={() => ({ context: { screen: 'weevboss', theme: 'light' } })} />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); setLang(null) })

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const touch = (el: Element, type: string, x: number, y: number) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
const tap = async (el: Element, x: number, y: number) => {
  await act(async () => { touch(el, 'pointerdown', x, y) })
  await act(async () => { touch(el, 'pointerup', x, y) })
}
const markEl = () => host.querySelector('.cam-mark')!
const frozenEl = () => host.querySelector('.cam-freeze')
async function freeze() {
  await tap(markEl(), 380, 480)
  await wait(10)
  expect(frozenEl()).not.toBeNull()
}

it('a double tap attaches the whole screen and unfreezes', async () => {
  await freeze()
  expect(host.querySelector('.cam-hint')).not.toBeNull()
  await tap(frozenEl()!, 200, 500)
  await tap(frozenEl()!, 203, 498)
  await wait(120)
  expect(frozenEl()).toBeNull()
  expect(heldNow()?.url).toBe('data:image/png;base64,V0hPTEU=')
  expect(heldNow()?.context).toMatchObject({ screen: 'weevboss', theme: 'light', camera: { ms: expect.any(Number), build: null } })
})

it('a thumb\'s slower double tap still attaches, never lets go', async () => {
  await freeze()
  await tap(frozenEl()!, 200, 500)
  await wait(300)
  expect(frozenEl()).not.toBeNull()
  await tap(frozenEl()!, 210, 492)
  await wait(120)
  expect(frozenEl()).toBeNull()
  expect(heldNow()?.url).toBe('data:image/png;base64,V0hPTEU=')
})

it('the second finger down is enough: its lift lost by the phone, the capture is still attached', async () => {
  await freeze()
  await tap(frozenEl()!, 200, 500)
  await act(async () => { touch(frozenEl()!, 'pointerdown', 200, 500) })
  await wait(20)
  expect(heldNow()?.url).toBe('data:image/png;base64,V0hPTEU=')
  // The frozen screen stays under the finger, so the tap never lands on the app; it goes all the same.
  await wait(1700)
  expect(frozenEl()).toBeNull()
})

it('lifting the finger after drawing a part attaches that part', async () => {
  await freeze()
  const el = frozenEl()!
  await act(async () => { touch(el, 'pointerdown', 40, 160) })
  for (let i = 1; i <= 8; i++) await act(async () => { touch(el, 'pointermove', 40 + i * 30, 160 + i * 25) })
  expect(host.querySelector('.cam-picking')).not.toBeNull()
  await act(async () => { touch(el, 'pointerup', 280, 360) })
  await wait(120)
  expect(frozenEl()).toBeNull()
  expect(heldNow()?.url).toBe('data:image/png;base64,UEFSVA==')
  expect(heldNow()?.context.region).toEqual({ x: 40, y: 160, w: 240, h: 200 })
})

it('a part drawn then taken away by the phone (pointercancel) is still attached, as drawn', async () => {
  await freeze()
  const el = frozenEl()!
  await act(async () => { touch(el, 'pointerdown', 40, 160) })
  for (let i = 1; i <= 8; i++) await act(async () => { touch(el, 'pointermove', 40 + i * 30, 160 + i * 25) })
  await act(async () => { touch(el, 'pointercancel', 0, 0) })
  await wait(120)
  expect(frozenEl()).toBeNull()
  expect(heldNow()?.context.region).toEqual({ x: 40, y: 160, w: 240, h: 200 })
})

it('the cross at the top lets go at any time, even while the picture is made', async () => {
  made.next = () => new Promise(() => {})
  await freeze()
  await act(async () => { (host.querySelector('.cam-close') as HTMLButtonElement).click() })
  expect(frozenEl()).toBeNull()
  expect(heldNow()).toBeNull()
})

it('a single tap lets go of the frozen screen, nothing attached', async () => {
  await freeze()
  await tap(frozenEl()!, 200, 500)
  expect(frozenEl()).not.toBeNull()
  await wait(TAP_MS + 60)
  expect(frozenEl()).toBeNull()
  expect(heldNow()).toBeNull()
})

it('a picture still being made: the double tap waits for it with a star, the mark lets go', async () => {
  let done: (c: unknown) => void = () => {}
  made.next = () => new Promise((r) => { done = r })
  await freeze()
  await tap(frozenEl()!, 200, 500)
  await tap(frozenEl()!, 200, 500)
  expect(host.querySelector('.cam-wait')).not.toBeNull()
  await tap(markEl(), 380, 480)
  expect(frozenEl()).toBeNull()
  await act(async () => { done({ width: 780, toDataURL: () => 'data:image/png;base64,TEFURQ==' }) })
  expect(heldNow()).toBeNull()
})

it('a step that fails unfreezes the screen and says which, on a line with a cross', async () => {
  made.next = () => Promise.reject(new Error('svg'))
  await tap(markEl(), 380, 480)
  await wait(10)
  expect(frozenEl()).toBeNull()
  expect(host.querySelector('.cam-error')?.textContent).toBe('The picture of the screen could not be made. Try again.')
  await act(async () => { (host.querySelector('.cam-error-off') as HTMLButtonElement).click() })
  expect(host.querySelector('.cam-error')).toBeNull()
  made.next = () => Promise.reject(new made.Slow('slow'))
  await tap(markEl(), 380, 480)
  await wait(10)
  expect(host.querySelector('.cam-error')?.textContent).toBe('The picture of the screen took too long. Try again.')
})
