// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLang } from '../../src/i18n'
import { PinMark } from './pin.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { vi.useFakeTimers(); setLang('en'); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null); vi.useRealTimers() })
const pin = () => host.querySelector<HTMLElement>('.nx-pin')!
const tap = () => act(async () => pin().click())

it('one tap never unpins: it asks, and the second tap unpins; the row behind gets neither', async () => {
  const unpin = vi.fn(), row = vi.fn()
  await act(async () => root.render(<button onClick={row}><PinMark name="shop" onUnpin={unpin} /></button>))
  expect(pin().getAttribute('aria-label')).toBe('Unpin shop')
  await tap()
  expect(unpin).not.toHaveBeenCalled()
  expect(host.querySelector('.nx-pin-ask')!.textContent).toBe('unpin?')
  expect(pin().getAttribute('aria-label')).toBe('Confirm: unpin shop')
  await tap()
  expect(unpin).toHaveBeenCalledTimes(1)
  expect(host.querySelector('.nx-pin-ask')).toBeNull()
  expect(row).not.toHaveBeenCalled()
})

it('the question goes away on its own, or on a tap anywhere else: the drawer stays', async () => {
  const unpin = vi.fn()
  await act(async () => root.render(<button><PinMark name="shop" onUnpin={unpin} /></button>))
  await tap()
  await act(async () => { vi.advanceTimersByTime(4100) })
  expect(host.querySelector('.nx-pin-ask')).toBeNull()
  await tap()
  expect(host.querySelector('.nx-pin-ask')).not.toBeNull()
  await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
  expect(host.querySelector('.nx-pin-ask')).toBeNull()
  expect(unpin).not.toHaveBeenCalled()
  setLang('fr')
  await tap()
  expect(host.querySelector('.nx-pin-ask')!.textContent).toBe('retirer ?')
})

it('a pin with nothing to unpin is only a mark', async () => {
  await act(async () => root.render(<PinMark />))
  await tap()
  expect(host.querySelector('.nx-pin-ask')).toBeNull()
})
