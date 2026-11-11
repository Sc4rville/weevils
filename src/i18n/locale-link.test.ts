// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
afterEach(()=>{history.replaceState(null,'','/');localStorage.clear();vi.resetModules()})
it('an explicit English link persists on this device and preserves the recording route',async()=>{
 localStorage.setItem('weevils-language','fr')
 history.replaceState({keep:true},'', '/?appLocale=en#formats')
 vi.resetModules()
 const {getLang}=await import('./index')
 expect(getLang()).toBe('en')
 expect(localStorage.getItem('weevils-language')).toBe('en')
 expect(location.hash).toBe('#formats')
 expect(location.search).toBe('')
 expect(history.state).toEqual({keep:true})
})
it('ordinary entry keeps an explicit French preference',async()=>{
 localStorage.setItem('weevils-language','fr')
 vi.resetModules()
 const {getLang}=await import('./index')
 expect(getLang()).toBe('fr')
})
