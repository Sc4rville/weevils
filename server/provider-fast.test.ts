import fs from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
const failure = vi.hoisted(() => ({ enabled: false }))
const commands=vi.hoisted(()=>[] as string[])
vi.mock('./provider.ts',()=>({preferredTool:()=>process.env.WEEVILS_PROVIDER==='codex'?'codex':'claude',providerStatus:()=>({installed:true,logged:true})}))
vi.mock('node:child_process',()=>({execFile:(command:string,args:string[],_options:unknown,cb:(err:null,out:string)=>void)=>{
 commands.push(command)
 if(command==='codex')fs.writeFileSync(args[args.indexOf('-o')+1],'Codex answer')
 queueMicrotask(()=>cb(failure.enabled ? Object.assign(new Error('private command'), {code:1}) as never : null,'Claude answer'))
 return {stdin:{end(){}}}
}}))
import {haiku,smart,quick} from './fast.ts'
afterEach(()=>{vi.unstubAllEnvs();commands.length=0;failure.enabled=false})
it('routes every text helper to the explicitly selected subscription',async()=>{
 vi.stubEnv('WEEVILS_PROVIDER','codex')
 expect(await haiku('brief')).toBe('Codex answer')
 expect(await smart('plan')).toBe('Codex answer')
 expect(await quick('question')).toBe('Codex answer')
 expect(commands).toEqual(['codex','codex','codex'])
})
it('preserves Claude helpers by default',async()=>{
 vi.stubEnv('WEEVILS_PROVIDER','claude')
 expect(await haiku('brief')).toBe('Claude answer')
 expect(await smart('plan')).toBe('Claude answer')
 expect(commands).toEqual(['claude','claude'])
})

it('rejects a failed Codex process even when it wrote a partial answer',async()=>{
 vi.stubEnv('WEEVILS_PROVIDER','codex');failure.enabled=true
 await expect(smart('private prompt')).rejects.toThrow('model provider failure')
})
