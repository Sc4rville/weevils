// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { trackViewport } from './viewport'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('keeps navigation below the iOS status bar as the keyboard shrinks and pans the visible viewport', () => {
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 })
  vi.stubGlobal('visualViewport', vv)
  vi.stubGlobal('innerHeight', 844)
  let inset = '47px'
  vi.stubGlobal('getComputedStyle', () => ({ paddingTop: inset }))
  const stop = trackViewport()!
  const root = document.documentElement
  expect(root.hasAttribute('data-keyboard')).toBe(false)
  inset = '0px'
  vv.height = 350
  vv.offsetTop = 120
  vv.dispatchEvent(new Event('resize'))
  expect(root.style.getPropertyValue('--safe-t')).toBe('47px')
  expect(root.style.getPropertyValue('--vvt')).toBe('120px')
  expect(root.style.getPropertyValue('--vvh')).toBe('350px')
  expect(root.hasAttribute('data-keyboard')).toBe(true)
  vv.height = 844
  vv.offsetTop = 0
  vv.dispatchEvent(new Event('resize'))
  expect(root.hasAttribute('data-keyboard')).toBe(false)
  stop()
  expect(root.style.getPropertyValue('--safe-t')).toBe('')
})
