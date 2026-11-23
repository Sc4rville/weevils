// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { fullHeight, trackViewport } from './viewport'
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

it('resamples after keyboard dismissal and page restore even without a viewport event', () => {
  vi.useFakeTimers()
  const vv = Object.assign(new EventTarget(), { height: 350, offsetTop: 120 })
  vi.stubGlobal('visualViewport', vv)
  vi.stubGlobal('innerHeight', 844)
  const stop = trackViewport()!
  document.dispatchEvent(new Event('focusout'))
  vv.height = 844
  vv.offsetTop = 0
  vi.advanceTimersByTime(350)
  expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('844px')
  expect(document.documentElement.style.getPropertyValue('--vvt')).toBe('0px')
  expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false)
  vv.height = 700
  window.dispatchEvent(new Event('pageshow'))
  expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('700px')
  stop()
  vi.useRealTimers()
})

it('an installed app whose viewport comes out a status bar short gets the whole screen height, nothing else does', () => {
  const win = (standalone: boolean, inner: number, landscape = false) => ({
    innerHeight: inner, screen: { width: 390, height: 844 } as Screen, navigator: { standalone } as unknown as Navigator,
    matchMedia: (q: string) => ({ matches: q.includes('landscape') ? landscape : false }) as MediaQueryList,
  })
  expect(fullHeight(win(true, 797), 797)).toBe(844)
  expect(fullHeight(win(true, 844), 844)).toBe(0)
  expect(fullHeight(win(false, 797), 797)).toBe(0)
  // A desktop window much smaller than its screen is not that bug.
  expect(fullHeight(win(true, 500), 500)).toBe(0)
  expect(fullHeight(win(true, 343, true), 343)).toBe(390)
})
