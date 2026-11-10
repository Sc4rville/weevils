import fs from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { HOME, CODEX_DIR } from './config.ts'
import { preferredTool, providerStatus, providerReady } from './provider.ts'
afterEach(()=>vi.unstubAllEnvs())
it('requires the selected CLI and credentials, never substitutes another provider',()=>{
 const bin=path.join(HOME,'bin');fs.mkdirSync(bin,{recursive:true});vi.stubEnv('PATH',bin);vi.stubEnv('WEEVILS_PROVIDER','codex')
 expect(preferredTool()).toBe('codex');expect(providerReady()).toBe(false)
 fs.writeFileSync(path.join(bin,'codex'),'#!/bin/sh\nexit 0\n',{mode:0o700})
 const auth=path.join(path.dirname(CODEX_DIR),'auth.json');fs.mkdirSync(path.dirname(auth),{recursive:true});fs.writeFileSync(auth,'{}')
 expect(providerStatus()).toEqual({installed:true,logged:false})
 fs.writeFileSync(auth,JSON.stringify({tokens:{access_token:'fixture'}}))
 expect(providerReady()).toBe(true)
 vi.stubEnv('WEEVILS_PROVIDER','claude');expect(preferredTool()).toBe('claude');expect(providerReady()).toBe(false)
})
