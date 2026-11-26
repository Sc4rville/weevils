// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { LONG_WAIT_MS, Syncing, WeevilLoading } from './loading'
import { setLang } from '../i18n'

it('a page on its way shows the weevil itself, jumping, and a small turning « syncing… » line', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('fr')
  const host = document.createElement('div'); document.body.append(host)
  const r = createRoot(host)
  act(() => r.render(<WeevilLoading />))
  expect(host.querySelector('.weevil-loading svg.weevboss-logo')).not.toBeNull()
  expect(host.querySelector('.syncing[role=status] .syncing-turn')).not.toBeNull()
  expect(host.textContent).toBe('synchronisation…')
  act(() => r.unmount()); host.remove(); setLang(null)
})

it('only after a long wait does the line say so, calmly, never as an error', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  setLang('en')
  const host = document.createElement('div'); document.body.append(host)
  const r = createRoot(host)
  act(() => r.render(<Syncing />))
  expect(host.textContent).toBe('syncing…')
  act(() => void vi.advanceTimersByTime(LONG_WAIT_MS - 1000))
  expect(host.textContent).toBe('syncing…')
  act(() => void vi.advanceTimersByTime(2000))
  expect(host.textContent).toBe('taking a little longer than usual, it’s on its way')
  expect(host.querySelector('[role=alert]')).toBeNull()
  act(() => r.unmount()); host.remove(); setLang(null); vi.useRealTimers()
})
