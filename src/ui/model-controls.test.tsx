// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
const api=vi.hoisted(()=>({modelControls:vi.fn(),setModelControls:vi.fn()}))
vi.mock('../api',()=>({api}))
vi.mock('./shell',()=>({Shell:({children}:any)=>children}))
import { ModelPicker } from './model-controls'
import { interceptModelControl, MODEL_CONTROL_EVENT } from '../model-controls'
const data={threadId:'existing',tool:'codex',models:[{id:'real',label:'Real model',efforts:['low','high']}],selected:{model:'real',effort:'low'},active:true,appliesTo:'next-turn'}
it('opens controls for bare commands without submitting chat or intercepting ordinary text',()=>{
 const listener=vi.fn();window.addEventListener(MODEL_CONTROL_EVENT,listener)
 expect(interceptModelControl('existing',' /model ')).toBe(true)
 expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({id:'existing'})
 expect(interceptModelControl('existing','Explain /model')).toBe(false)
 expect(interceptModelControl('existing','/model',1)).toBe(false)
 window.removeEventListener(MODEL_CONTROL_EVENT,listener)
})
it('shows daemon choices, preserves confirmed setting on failure and supports retry',async()=>{
 api.modelControls.mockResolvedValue(data)
 api.setModelControls.mockRejectedValueOnce(new Error('Not confirmed')).mockResolvedValueOnce({...data,selected:{model:'real',effort:'high'}})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<ModelPicker id="existing"/>))
  const selects=host.querySelectorAll('select');expect(selects[0].textContent).toContain('Real model')
  await act(async()=>{selects[1].value='high';selects[1].dispatchEvent(new Event('change',{bubbles:true}))})
  await act(async()=>host.querySelector('button')!.click())
  expect(api.setModelControls).toHaveBeenLastCalledWith('existing',{model:'real',effort:'high'})
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Not confirmed')
  expect(host.querySelector('p')?.textContent).not.toContain('high')
  await act(async()=>host.querySelector('button')!.click())
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.querySelector('[role=status]')).not.toBeNull()
 }finally{await act(async()=>root.unmount());host.remove()}
})
