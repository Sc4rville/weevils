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
 expect(host.querySelector('summary')?.textContent).toBe('Rendering')
 expect(host.querySelector('details')?.open).toBe(false)
 expect(host.textContent).not.toContain('agent idle')
 expect(host.querySelector('details')?.textContent).toContain('independently of the conversation')
 expect(host.textContent).toContain('166 reported frames'); expect(host.textContent).toContain('110 frames verified and downloaded')
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
 expect(host.textContent).toContain('Tracking connection lost'); expect(host.querySelector('.spin')).toBeNull()
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

it('shows one actionable paused state, with counters and timestamps folded and fully localized',async()=>{
 const p=progress({state:'error',label:'Rendu interrompu',detail:'306 images vérifiées et récupérées',completed:306,verified:306,pauseReason:'worker-stopped'})
 await act(async()=>root.render(<RemoteProgress progress={p} agentWorking={false}/>))
 expect(host.querySelector('summary')?.textContent).toBe('Render paused')
 expect(host.querySelector('.remote-progress-reason')?.textContent).toBe('The render worker stopped. Resume with a new worker.')
 expect(host.querySelector('details')?.open).toBe(false)
 expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
 expect(host.querySelector('summary')?.textContent).not.toContain('306')
 expect(host.textContent).not.toMatch(/Rendu|images vérifiées|agent idle|error reported/)
 const details=host.querySelector('details')!;details.open=true
 await act(async()=>setLang('fr'))
 expect(host.querySelector('details')).toBe(details);expect(details.open).toBe(true)
 expect(host.querySelector('summary')?.textContent).toBe('Rendu en pause')
 expect(host.textContent).toContain('306 images vérifiées et récupérées')
 expect(host.textContent).not.toMatch(/Render paused|reported frames|Last observation/)
 await act(async()=>setLang('en'))
 expect(details.open).toBe(true)
 expect(host.querySelector('summary')?.textContent).toBe('Render paused')
})

it('keeps an old completed render as folded metadata while the agent is working, without suggesting user review', async () => {
 const p = progress({ state: 'done', updatedAt: NOW - 26 * 3600000, lastProgressAt: undefined, completed: 992, verified: 992 })
 await act(async () => root.render(<RemoteProgress progress={p} agentWorking />))
 expect(host.querySelector('summary')?.textContent).toBe('Render details')
 expect(host.querySelector('details')?.open).toBe(false)
 expect(host.querySelector('[role="status"]')).toBeNull()
 expect(host.querySelector('.spin')).toBeNull()
 expect(host.textContent).toContain('Render completed')
 expect(host.textContent).toContain('Earlier render observation')
 expect(host.textContent).not.toMatch(/ready to review|human review/)
 const details = host.querySelector('details')!; details.open = true
 await act(async () => setLang('fr'))
 expect(details.open).toBe(true)
 expect(host.querySelector('summary')?.textContent).toBe('Détails du rendu')
 expect(host.textContent).toContain('Rendu terminé')
 expect(host.textContent).not.toContain('Render completed')
})
it('keeps a fresh separate render secondary when the conversation itself is working', async () => {
 await act(async () => root.render(<RemoteProgress progress={progress()} agentWorking />))
 expect(host.querySelector('summary')?.textContent).toBe('Render details')
 expect(host.querySelector('[role="status"]')).toBeNull()
 expect(host.querySelector('.spin')).toBeNull()
 expect(host.querySelector('details')?.textContent).toContain('Rendering')
})
