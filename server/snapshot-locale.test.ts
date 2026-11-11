import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '../shared/api.ts'
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
vi.mock('./fast.ts', () => ({ setCartesiaVoice() {} }))
vi.mock('./titles.ts', async orig => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))
const { Weevils } = await import('./core.ts')
const { DATA_DIR } = await import('./config.ts')
const { lang, withLang, installationLang } = await import('./i18n.ts')
let w: InstanceType<typeof Weevils>
beforeEach(() => {
 vi.useFakeTimers()
 fs.rmSync(path.join(DATA_DIR, 'state.json'), { force:true })
 w = new Weevils()
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
it('serves titles in each explicit locale before any event invalidates the snapshot, preserving identity and source', async () => {
 const source = { id:'handoff', title:'Relais Claude ↔ Codex', now:'Le passage est prêt', projectId:'weevils', machineId:'test', tool:'codex', status:'done', lastActivityAt:1000 } as Session
 const original=structuredClone(source)
 const sessions=vi.spyOn(w,'sessions').mockImplementation(() => [{...source,title:lang()==='en'?'Claude ↔ Codex handoff':source.title,now:lang()==='en'?'The handoff is ready':source.now}])
 const pref=installationLang()
 const en=withLang('en',()=>w.snapshot())
 expect(withLang('en',()=>w.snapshot())).toBe(en)
 const fr=await withLang('fr',async()=>{ await Promise.resolve(); return w.snapshot() })
 const again=withLang('en',()=>w.snapshot())
 expect([en.sessions[0].title,fr.sessions[0].title,again.sessions[0].title]).toEqual(['Claude ↔ Codex handoff','Relais Claude ↔ Codex','Claude ↔ Codex handoff'])
 expect([en,fr,again].map(s=>[s.sessions[0].id,s.sessions[0].status,s.sessions[0].lastActivityAt])).toEqual(Array(3).fill(['handoff','done',1000]))
 expect(source).toEqual(original);expect(installationLang()).toBe(pref)
 expect(sessions).toHaveBeenCalledTimes(3)
})
it('keeps empty feeds empty across locales and invalidates cached content on a real event',()=>{
 const sessions=vi.spyOn(w,'sessions').mockReturnValue([])
 for(const l of ['en','fr','en'] as const) expect(withLang(l,()=>w.snapshot()).sessions).toEqual([])
 w.bump()
 withLang('en',()=>w.snapshot())
 expect(sessions).toHaveBeenCalledTimes(4)
})
