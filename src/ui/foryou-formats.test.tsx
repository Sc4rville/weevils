// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { setLang } from '../i18n'
import type { ForYouItem } from '../../shared/foryou'
import type { ForYouStore } from './foryou-store'
const state = vi.hoisted(() => ({ push: vi.fn(), send: vi.fn(async () => {}), pending: false }))
vi.mock('./app-context', () => ({ useApp: () => ({ push: state.push }) }))
vi.mock('./foryou-store', () => ({ useForYou: vi.fn() }))
vi.mock('./shell', () => ({ Shell: ({ children }: any) => children }))
vi.mock('./outbox-status', () => ({ OutboxStatus: () => null }))
import { ProposalView, PictureJourney } from './foryou-formats'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
const item: ForYouItem = { id: 'visual:demo', kind: 'media', tone: 'neutral', at: 1, who: 'session', title: 'A real journey', text: 'Three existing views', media: [0,1,2].map(n => ({id: String(n), type:'image', url:`/image/${n}`,name:`View ${n}`,bytes:1})), visualProposal: {question:'Which pace?', recommendation:'Slower at the threshold',caveat:'Existing blur remains',frames:[0,1,2].map(n=>({title:`View ${n}`,description:`Description ${n}`})),options:[{id:'A',label:'Keep pace',description:'1.4 seconds',instruction:'Keep existing pace'},{id:'B',label:'Slower pace',description:'1.9 seconds',instruction:'Private preview only; no render'}]} }
const fy = { act: state.send, acting: () => state.pending, leftAs: () => undefined, error: () => undefined } as unknown as ForYouStore
beforeEach(() => {setLang('en');state.pending=false;state.push.mockClear();state.send.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();setLang(null)})
it('keeps instructions and explicit transmission separate from selection at phone and desktop widths', async()=>{
 for (const width of [320,390,1280]) {
  window.innerWidth=width
  await act(async()=>root.render(<ProposalView key={width} item={item} fy={fy}/>))
  const send=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Send my choice to TLO')!
  expect(send().disabled).toBe(true)
  expect(host.querySelectorAll('img')).toHaveLength(3)
  await act(async()=>host.querySelectorAll<HTMLInputElement>('input')[1].click())
  expect(state.send).not.toHaveBeenCalled()
  expect(host.querySelector('details')?.textContent).toContain('Private preview only; no render')
  expect(send().disabled).toBe(false)
  await act(async()=>send().click())
  expect(state.send).toHaveBeenCalledWith('visual:demo','choice:B')
  state.send.mockClear()
 }
})
it('opens complete images and changes the story without publishing or dispatching',async()=>{
 await act(async()=>root.render(<PictureJourney media={item.media!} frames={item.visualProposal!.frames}/>))
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Next image')!.click())
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/image/1')
 await act(async()=>host.querySelector<HTMLButtonElement>('.formats-image')!.click())
 expect(state.push).toHaveBeenCalledWith({kind:'media',url:'/image/1',type:'image',name:'Description 1'})
 expect(state.send).not.toHaveBeenCalled()
})
it('a completed proposal cannot be sent again after reloading',async()=>{
 await act(async()=>root.render(<ProposalView item={{...item,visualProposal:{...item.visualProposal!,selected:'B'}}} fy={fy}/>))
 expect(host.querySelector('fieldset')?.disabled).toBe(true)
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Choice sent to TLO')?.disabled).toBe(true)
})
