// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLive } from './api'
import { setLang } from './i18n'

// A link that holds server-sent events back (a Cloudflare quick tunnel): the stream opens and says nothing. The app
// falls back to the version alone, then the snapshot, and never shows itself offline while the server answers.
let root: Root, host: HTMLDivElement, version: number, paths: string[], streams: { readyState: number; dispatchEvent: (e: Event) => boolean; onerror?: () => void }[]
function Live() {
  const live = useLive()
  return <output data-offline={String(live.offline)}>{live.snap ? String(live.snap.version) : 'connecting'}</output>
}
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)))
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  setLang('en'); history.replaceState(null, '', '/')
  version = 1; paths = []; streams = []
  vi.stubGlobal('EventSource', class extends EventTarget { readyState = 0; constructor() { super(); streams.push(this as never) } close() { this.readyState = 2 } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url)
    paths.push(path)
    const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    if (path === '/api/me') return response({ authed: true })
    if (path === '/api/snapshot') return response({ version, now: 1, sessions: [], projects: [], machines: [], main: [], config: { userName: '', publicHost: '' } })
    if (path === '/api/version') return response({ version })
    throw new Error(`Unexpected route: ${path}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLang(null) })

it('asks for the version while the stream stays silent, and loads what changed', async () => {
  await act(async () => root.render(<Live />)); await flush()
  const out = host.querySelector('output')!
  expect(out.textContent).toBe('1')
  await act(async () => { vi.advanceTimersByTime(20_000) }); await flush()
  expect(paths).not.toContain('/api/version') // the stream may still speak
  version = 2
  await act(async () => { vi.advanceTimersByTime(20_000) }); await flush(); await flush()
  expect(paths).toContain('/api/version')
  expect(out.textContent).toBe('2')
  expect(out.dataset.offline).toBe('false')
})

it('stays quiet while the stream speaks, and a cut stream is not shown as offline', async () => {
  await act(async () => root.render(<Live />)); await flush()
  for (let i = 0; i < 4; i++) {
    await act(async () => { vi.advanceTimersByTime(25_000); streams[0].dispatchEvent(new MessageEvent('version', { data: '1' })) }); await flush()
  }
  expect(paths).not.toContain('/api/version')
  await act(async () => { streams[0].readyState = 2; streams[0].onerror?.() }); await flush()
  expect(host.querySelector('output')!.dataset.offline).toBe('false')
  await act(async () => { vi.advanceTimersByTime(40_000) }); await flush()
  expect(streams.length).toBe(2) // opened again
})
