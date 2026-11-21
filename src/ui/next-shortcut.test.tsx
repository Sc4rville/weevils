// @vitest-environment happy-dom
// TEMPORARY shortcut to the new interface: only when the server names its address.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLang } from '../i18n'
const state = vi.hoisted(() => ({ nextUrl: undefined as string | undefined }))
vi.mock('./app-context', () => ({ useApp: () => ({ snap: { config: { authors: [], userName: 'Y', nextUrl: state.nextUrl }, projects: [], machines: [], sessions: [] }, push: vi.fn() }) }))
import { NextShortcut } from './next-shortcut'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { setLang('en'); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setLang(null) })

it('is absent without an address, and a one-tap link with one', async () => {
  state.nextUrl = undefined
  await act(async () => root.render(<NextShortcut />))
  expect(host.textContent).toBe('')
  state.nextUrl = 'https://next.example.com'
  await act(async () => root.render(<NextShortcut key="b" />))
  const a = host.querySelector('a.next-shortcut')!
  expect(a.getAttribute('href')).toBe('https://next.example.com')
  expect(a.getAttribute('aria-label')).toBe('new interface')
})
