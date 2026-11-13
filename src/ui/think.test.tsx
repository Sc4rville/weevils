// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {emptyBoard,type ThinkBoard} from '../../shared/think'
const state=vi.hoisted(()=>({saved:null as ThinkBoard|null, payloads:new Map<string,unknown>(),sends:[] as unknown[],failSend:false,failRead:false}))
vi.mock('../api',()=>({ApiError:class extends Error{status:number;constructor(status:number,m:string){super(m);this.status=status}},api:{think:async()=>{if(state.failRead)throw Error('offline');return structuredClone(state.saved)},saveThink:async(b:ThinkBoard)=>{state.saved={...structuredClone(b),revision:b.revision+1};return structuredClone(state.saved)},session:async()=>({messages:[]}),send:async(...args:unknown[])=>{state.sends.push(args);if(state.failSend)throw Error('offline')}}}))
vi.mock('../outbox-payload',()=>({loadPayload:async(k:string)=>state.payloads.get(k),storePayload:async(k:string,b:unknown)=>{state.payloads.set(k,structuredClone(b))},removePayload:async(k:string)=>{state.payloads.delete(k)}}))
vi.mock('./app-context',()=>({useApp:()=>({back:()=>{},snap:{config:{},sessions:[{id:'existing-session',title:'Existing session',tool:'codex'}]},push:()=>{},theme:'light'})}))
vi.mock('./shell',()=>({usePageChrome:()=>{}}))
vi.mock('./outbox-status',()=>({OutboxStatus:()=>null}))
import {ThinkPage} from './think'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:Root,host:HTMLElement
beforeEach(()=>{state.saved=emptyBoard();state.payloads.clear();state.sends=[];state.failSend=false;state.failRead=false;localStorage.clear();sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.useFakeTimers()})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers()})
const render=async()=>{await act(async()=>{root.render(<ThinkPage/>);await Promise.resolve()})}
const click=async(text:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(b).toBeTruthy();await act(async()=>b.click())}
it('creates, saves, reloads and undoes a note without sending an action',async()=>{
 await render();await click('＋');let input=host.querySelector('textarea')!;expect(input).toBeTruthy()
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'A durable thought');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(async()=>{await vi.advanceTimersByTimeAsync(900)})
 expect(state.saved?.objects[0].content).toBe('A durable thought');expect(state.saved?.objects).toHaveLength(1);expect(state.payloads.size).toBe(0);expect(state.sends).toEqual([])
 await click('Undo');await click('Undo');await act(async()=>{await vi.advanceTimersByTimeAsync(900)});expect(state.saved?.objects).toHaveLength(0)
 await click('Redo');await act(async()=>{await vi.advanceTimersByTimeAsync(900)});expect(state.saved?.objects).toHaveLength(1)
 act(()=>root.unmount());root=createRoot(host);await render();expect(host.querySelectorAll('.think-object')).toHaveLength(1);expect(state.sends).toEqual([])
})
it('previews layout without moving originals and restores positions in one undo',async()=>{
 state.saved={...emptyBoard(),objects:[{id:'a',type:'text',x:-400,y:200,width:280,height:150,content:'Original text',source:'https://example.com',updatedAt:1}]};await render();await click('Preview layout');expect(host.querySelector('.think-ghost')).toBeTruthy();expect(host.querySelector<HTMLElement>('.think-object')!.style.left).toBe('-400px');await click('Apply layout');expect(host.querySelector<HTMLElement>('.think-object')!.style.left).not.toBe('-400px');await click('Undo');expect(host.querySelector<HTMLElement>('.think-object')!.style.left).toBe('-400px');expect(host.textContent).toContain('Original text')
})
it('opens an existing note after pointer capture and pinches without creating another note',async()=>{
 state.saved={...emptyBoard(),objects:[{id:'a',type:'text',x:0,y:0,width:280,height:150,content:'Tap to edit',source:'',updatedAt:1}]};await render()
 const canvas=host.querySelector<HTMLElement>('.think-canvas')!;canvas.setPointerCapture=()=>{}
 const text=host.querySelector('.think-text')!
 await act(async()=>{text.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,button:0,clientX:100,clientY:100}));canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0,clientX:100,clientY:100}))})
 expect(host.querySelector('textarea')?.value).toBe('Tap to edit')
 await act(async()=>{canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,button:0,clientX:10,clientY:10}));canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3,button:0,clientX:110,clientY:10}));canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:3,clientX:210,clientY:10}));canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2}));canvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3}))})
 expect(host.textContent).toContain('200%');expect(host.querySelectorAll('.think-object')).toHaveLength(1);expect(state.sends).toEqual([])
})
it('uses the normal composer and freezes the destination and viewport across a failed send',async()=>{
 state.saved={...emptyBoard(),objects:[{id:'memory',type:'text',x:0,y:0,width:280,height:150,content:'Keep this decision',source:'',updatedAt:1}]};await render();host.querySelector<HTMLElement>('.think-canvas')!.getBoundingClientRect=()=>new DOMRect(0,0,800,600);await click('Ask about this view');expect(state.sends).toEqual([])
 const select=host.querySelector('select')!;await act(async()=>{select.value='existing-session';select.dispatchEvent(new Event('change',{bubbles:true}))})
 const input=host.querySelector<HTMLInputElement>('input[aria-label="Send request"]')!;expect(input).toBeTruthy()
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Explain these notes');input.dispatchEvent(new Event('input',{bubbles:true}))})
 state.failSend=true
 await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve()})
 expect(state.sends).toHaveLength(1);const original=state.sends[0] as string[];expect(original[0]).toBe('existing-session');expect(original[1]).toContain('Keep this decision');expect(original[1]).toContain('No viewport screenshot supplied');expect([...state.payloads.keys()].some(k=>k.endsWith(':request'))).toBe(true)
 await click('−');state.failSend=false
 await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await Promise.resolve();await Promise.resolve()})
 expect(state.sends).toHaveLength(2);expect(state.sends[1]).toEqual(original);expect([...state.payloads.keys()].some(k=>k.endsWith(':request'))).toBe(false)
})
it('recovers the local draft when reload happens offline',async()=>{
 sessionStorage.setItem('think-client','recovery');state.failRead=true
 state.payloads.set('think-draft-v1:recovery',{...emptyBoard(),objects:[{id:'offline',type:'text',x:0,y:0,width:280,height:150,content:'Do not lose this draft',source:'',updatedAt:1}]})
 await render();expect(host.textContent).toContain('Do not lose this draft');expect(host.querySelectorAll('.think-object')).toHaveLength(1);expect(state.sends).toEqual([])
})
it('keeps a stale recovered draft without overwriting the remote revision',async()=>{
 sessionStorage.setItem('think-client','conflict');state.saved={...emptyBoard(),revision:4}
 state.payloads.set('think-draft-v1:conflict',{...emptyBoard(),revision:2,objects:[{id:'local',type:'text',x:0,y:0,width:280,height:150,content:'Local concurrent edit',source:'',updatedAt:1}]})
 await render();await act(async()=>{await vi.advanceTimersByTimeAsync(1800)});expect(host.textContent).toContain('Local concurrent edit');expect(host.textContent).toContain('Another device changed Think');expect(state.saved.revision).toBe(4);expect(state.saved.objects).toHaveLength(0);expect(state.payloads.size).toBe(1)
})
