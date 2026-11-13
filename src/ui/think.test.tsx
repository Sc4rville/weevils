// @vitest-environment happy-dom
import {act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {emptyBoard,type ThinkBoard} from '../../shared/think'
const state=vi.hoisted(()=>({saved:null as ThinkBoard|null, payloads:new Map<string,unknown>(),sends:[] as unknown[]}))
vi.mock('../api',()=>({ApiError:class extends Error{status:number;constructor(status:number,m:string){super(m);this.status=status}},api:{think:async()=>structuredClone(state.saved),saveThink:async(b:ThinkBoard)=>{state.saved={...structuredClone(b),revision:b.revision+1};return structuredClone(state.saved)},send:async(...args:unknown[])=>{state.sends.push(args)}}}))
vi.mock('../outbox-payload',()=>({loadPayload:async(k:string)=>state.payloads.get(k),storePayload:async(k:string,b:unknown)=>{state.payloads.set(k,structuredClone(b))},removePayload:async(k:string)=>{state.payloads.delete(k)}}))
vi.mock('./app-context',()=>({useApp:()=>({back:()=>{},snap:{sessions:[]},push:()=>{},theme:'light'})}))
vi.mock('./shell',()=>({usePageChrome:()=>{}}))
import {ThinkPage} from './think'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:Root,host:HTMLElement
beforeEach(()=>{state.saved=emptyBoard();state.payloads.clear();state.sends=[];localStorage.clear();sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.useFakeTimers()})
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
