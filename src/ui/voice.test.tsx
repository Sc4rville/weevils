// @vitest-environment happy-dom
import { act } from 'react'
import { MotionGlobalConfig } from 'motion/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api=vi.hoisted(()=>({voiceChunk:vi.fn(),voiceFinish:vi.fn(),transcribe:vi.fn()}))
vi.mock('../api',()=>({api}))
vi.mock('./app-context',()=>({useApp:()=>({snap:{setup:{voice:true,dictation:true}}})}))
vi.mock('./hints',()=>({tapHint:()=>false}))
vi.mock('./setup',()=>({askSetup:vi.fn()}))
import { VoiceLogo } from './voice'
import { setLang } from '../i18n'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let root:Root,host:HTMLDivElement,permission:ReturnType<typeof vi.fn>,stopTrack:ReturnType<typeof vi.fn>,onText:ReturnType<typeof vi.fn<(text:string)=>void>>,onSend:ReturnType<typeof vi.fn<()=>void>>
let recorder:Recorder
class Recorder {
 static isTypeSupported(){return true}
 stream:MediaStream;state='inactive';mimeType='audio/mp4'
 ondataavailable:((event:{data:Blob})=>void)|null=null
 onstop:(()=>Promise<void>)|null=null
 constructor(stream:MediaStream){this.stream=stream;recorder=this}
 start(){this.state='recording'}
 stop(){this.state='inactive';void this.onstop?.()}
}
beforeEach(()=>{
 setLang('en');vi.clearAllMocks();MotionGlobalConfig.skipAnimations=true
 permission=vi.fn();stopTrack=vi.fn();onText=vi.fn();onSend=vi.fn()
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:permission}})
 vi.stubGlobal('MediaRecorder',Recorder)
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue()
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:404}))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{
 await act(async()=>root.unmount());host.remove();document.documentElement.removeAttribute('data-theme')
 vi.restoreAllMocks();vi.unstubAllGlobals();MotionGlobalConfig.skipAnimations=false;setLang(null)
})
const stream=()=>({getTracks:()=>[{stop:stopTrack}]} as unknown as MediaStream)
const render=()=>act(async()=>root.render(<VoiceLogo take={()=>''} onText={onText} onSend={onSend} working={false}/>))
const click=()=>act(async()=>host.querySelector<HTMLButtonElement>('.voice-logo')!.click())
const coloured=()=>!!host.querySelector('feFlood[result="recordingColour"]')
it.each(['light','dark','zen','graphite'])('uses recording colour only after microphone acceptance and clears it on stop in %s',async theme=>{
 document.documentElement.dataset.theme=theme
 let accept!:(stream:MediaStream)=>void
 permission.mockReturnValue(new Promise(resolve=>{accept=resolve}))
 await render();await click()
 expect(coloured()).toBe(false)
 expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('false')
 await act(async()=>accept(stream()))
 expect(coloured()).toBe(true)
 expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('stop and transcribe')
 expect(host.querySelector('button')!.classList.contains('rec')).toBe(true)
 await click()
 expect(coloured()).toBe(false)
 expect(stopTrack).toHaveBeenCalledOnce()
 expect(onSend).not.toHaveBeenCalled()
})
it('does not colour the logo when permission is denied',async()=>{
 permission.mockRejectedValue(new DOMException('Permission denied','NotAllowedError'))
 await render();await click()
 expect(coloured()).toBe(false)
 expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('false')
 expect(host.textContent).toContain('mic blocked')
 expect(onText).not.toHaveBeenCalled();expect(onSend).not.toHaveBeenCalled()
})
it('returns to normal during transcription and sends only on the existing third tap',async()=>{
 let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now)
 permission.mockResolvedValue(stream());api.voiceChunk.mockResolvedValue({})
 let finish!:(value:{text:string})=>void
 api.voiceFinish.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await render();await click()
 await act(async()=>{recorder.ondataavailable?.({data:new Blob(['a'.repeat(1024)])});await new Promise(resolve=>setTimeout(resolve,10))})
 now=2000
 await click()
 expect(coloured()).toBe(false)
 expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('send once transcribed')
 await act(async()=>finish({text:'A real transcript fixture'}))
 expect(onText).toHaveBeenCalledWith('A real transcript fixture')
 expect(onSend).not.toHaveBeenCalled()
 await click()
 expect(onSend).toHaveBeenCalledOnce()
 expect(coloured()).toBe(false)
})
it('clears recording on a recorder stop outside the button and releases tracks on unmount',async()=>{
 permission.mockResolvedValue(stream())
 await render();await click()
 expect(coloured()).toBe(true)
 await act(async()=>recorder.stop())
 expect(coloured()).toBe(false)
 await click()
 expect(coloured()).toBe(true)
 await act(async()=>root.render(null))
 expect(stopTrack).toHaveBeenCalledTimes(2)
})
