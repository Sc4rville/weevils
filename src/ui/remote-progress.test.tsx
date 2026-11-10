// @vitest-environment happy-dom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { SessionProgress } from '../../shared/api'
import { RemoteProgress, progressPhase } from './remote-progress'
import { useFollow } from './follow'
import { setLang } from '../i18n'
const connection = vi.hoisted(() => ({ offline: false }))
vi.mock('./app-context', () => ({ useApp: () => ({ offline: connection.offline }) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const NOW = Date.parse('2026-11-10T21:00:00Z')
let host: HTMLDivElement, root: Root
const progress = (over: Partial<SessionProgress> = {}): SessionProgress => ({ source: 'remote', label: 'Café → couloir', state: 'working', updatedAt: NOW, lastProgressAt: NOW, staleAfterMs: 60000, completed: 166, detail: '110 verified frames', ...over })
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); setLang('en'); connection.offline = false; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); setLang(null) })
it('distinguishes observed remote work from an idle agent and does not invent a total', async () => {
 await act(async () => root.render(<RemoteProgress progress={progress()} agentWorking={false} />))
 expect(host.textContent).toContain('remote work · agent idle')
 expect(host.textContent).toContain('166 reported frames'); expect(host.textContent).toContain('110 verified frames')
 expect(host.querySelector('.spin')).not.toBeNull(); expect(host.querySelector('progress')).toBeNull()
 expect(host.querySelectorAll('time')).toHaveLength(2)
})
it('stops animation when heartbeat expires without receiving another snapshot', async () => {
 await act(async () => root.render(<RemoteProgress progress={progress()} />))
 await act(async () => { await vi.advanceTimersByTimeAsync(65000) })
 expect(host.querySelector('[data-progress-state]')?.getAttribute('data-progress-state')).toBe('stale')
 expect(host.querySelector('.spin')).toBeNull()
})
it('a fresh observer heartbeat alone never proves that the remote job is advancing', () => {
 expect(progressPhase(progress({lastProgressAt:undefined}), NOW)).toBe('waiting')
 expect(progressPhase(progress({lastProgressAt:NOW-91000}), NOW)).toBe('waiting')
 expect(progressPhase(progress({state:'waiting'}), NOW)).toBe('waiting')
 expect(progressPhase(progress({updatedAt:NaN}), NOW)).toBe('stale')
})
it('disconnect and reconnect update one status block without adding transcript messages', async () => {
 connection.offline = true
 await act(async () => root.render(<RemoteProgress progress={progress()} />))
 expect(host.textContent).toContain('tracking connection interrupted'); expect(host.querySelector('.spin')).toBeNull()
 connection.offline = false
 await act(async () => root.render(<RemoteProgress progress={progress({completed:167,updatedAt:NOW+1000,lastProgressAt:NOW+1000})} />))
 expect(host.querySelectorAll('.remote-progress')).toHaveLength(1)
 expect(host.textContent).toContain('167 reported frames'); expect(host.querySelector('.spin')).not.toBeNull()
 expect(host.querySelector('[data-mid]')).toBeNull()
})
it.each(['done','error'] as const)('%s stays explicit without an animation or a fabricated success', async state => {
 connection.offline = true
 await act(async () => root.render(<RemoteProgress progress={progress({state,total:200})} />))
 expect(host.querySelector('[data-progress-state]')?.getAttribute('data-progress-state')).toBe(state)
 expect(host.querySelector('.spin')).toBeNull()
 expect(host.querySelector('progress')?.getAttribute('value')).toBe('166')
})
let height = 1000
function Following({ count }: { count: number }) {
 const ref = useRef<HTMLDivElement>(null)
 const follow = useFollow(ref, true, 80, count)
 return <><div data-scroll ref={el => { ref.current = el; if (el) { Object.defineProperty(el,'clientHeight',{configurable:true,get:()=>500}); Object.defineProperty(el,'scrollHeight',{configurable:true,get:()=>height}) } }}><RemoteProgress progress={progress({completed:count})} /></div>{follow.behind && <button onClick={follow.toEnd}>latest</button>}</>
}
it('follows real progress at the bottom but preserves rereading until the user returns', async () => {
 vi.stubGlobal('matchMedia', () => ({matches:true}))
 height = 1000
 await act(async () => root.render(<Following count={166} />))
 const scroll = host.querySelector<HTMLElement>('[data-scroll]')!
 expect(scroll.scrollTop).toBe(1000)
 height=1200; await act(async () => root.render(<Following count={167} />)); expect(scroll.scrollTop).toBe(1200)
 await act(async () => { scroll.dispatchEvent(new Event('wheel')); scroll.scrollTop=100; scroll.dispatchEvent(new Event('scroll')) })
 height=1400; await act(async () => root.render(<Following count={168} />))
 expect(scroll.scrollTop).toBe(100); expect(host.querySelector('button')).not.toBeNull()
 await act(async () => host.querySelector('button')!.click()); expect(scroll.scrollTop).toBe(1400)
})
