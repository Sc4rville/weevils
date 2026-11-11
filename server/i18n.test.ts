import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATA_DIR } from './config.ts'
import { lang, requestLang, setLang, tr, withLang } from './i18n.ts'
import M from './i18n/tips.ts'
import S from './i18n/setup.ts'

describe('withLang', () => {
  const other = lang() === 'fr' ? 'en' : 'fr'

  it('reads the catalogs in the given language, then restores the user language', () => {
    const before = lang()
    expect(withLang(other, () => tr(M).noDictation)).toBe(M[other].noDictation)
    expect(lang()).toBe(before)
    expect(tr(M).noDictation).toBe(M[before].noDictation)
  })

  it('ignores a missing or unknown language', () => {
    expect(withLang(null, () => lang())).toBe(lang())
    expect(withLang('de', () => lang())).toBe(lang())
  })

  it('keeps the caller locale unchanged while an async function runs', async () => {
    const before = lang()
    const p = withLang(other, async () => {
      const t = tr(M)
      await Promise.resolve()
      return t.noDictation
    })
    expect(lang()).toBe(before)
    expect(await p).toBe(M[other].noDictation)
  })
})

describe('the user language (prefs.json) is stable', () => {
  // HOME is a throwaway dir (test/setup-env.ts): prefs.json is written there, never in the developer's data.
  const file = path.join(DATA_DIR, 'prefs.json')
  const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')) as { lang: string; from: string }

  it("takes the first app's browser language, then ignores other browsers: weevboss keeps speaking French", () => {
    fs.rmSync(file, { force: true })
    expect(lang()).toBe('en') // WEEVILS_LANG of the tests
    expect(setLang('fr')).toBe(true)
    expect(lang()).toBe('fr')
    expect(saved()).toEqual({ lang: 'fr', from: 'browser' })
    // A test browser, an old app or a borrowed phone in English.
    expect(setLang('en')).toBe(false)
    expect(lang()).toBe('fr')
    expect(tr(S).mailAsk).toBe(S.fr.mailAsk)
    expect(tr(S).mailPitch).not.toMatch(/Plug in the e-mail bridge/)
  })

  it('changes only for a language picked in the settings', () => {
    expect(setLang('en', true)).toBe(true)
    expect(lang()).toBe('en')
    expect(setLang('fr')).toBe(false)
    expect(lang()).toBe('en')
    expect(saved()).toEqual({ lang: 'en', from: 'choice' })
    expect(setLang('fr', true)).toBe(true)
    expect(saved()).toEqual({ lang: 'fr', from: 'choice' })
  })

  it('a file written before (no « from », switched by a stray tap) gives way to the next app that opens', () => {
    fs.writeFileSync(file, JSON.stringify({ lang: 'en' }))
    expect(setLang('fr')).toBe(false) // already French in memory, but the file is fixed
    expect(saved()).toEqual({ lang: 'fr', from: 'browser' })
    expect(setLang('en')).toBe(false)
    expect(lang()).toBe('fr')
  })
})

it('isolates concurrent request locales across awaits without changing stored preferences',async()=>{
 const baseline=lang()
 const before=fs.existsSync(path.join(DATA_DIR,'prefs.json')) ? fs.readFileSync(path.join(DATA_DIR,'prefs.json'),'utf8') : ''
 const result=await Promise.all(['en','fr'].map(l=>withLang(l,async()=>{
  await new Promise(resolve=>setTimeout(resolve,l==='en'?10:1))
  return [lang(),tr(S).mailAsk]
 })))
 expect(result).toEqual([['en',S.en.mailAsk],['fr',S.fr.mailAsk]])
 expect(lang()).toBe(baseline)
 expect(fs.readFileSync(path.join(DATA_DIR,'prefs.json'),'utf8')).toBe(before)
})

it('uses only explicit app locale, with legacy query support and no browser/chat inference',()=>{
 expect(requestLang({headers:{'x-weevils-locale':'en','accept-language':'fr'},url:'/api/main?lang=fr'})).toBe('en')
 expect(requestLang({headers:{},url:'/api/foryou?lang=fr'})).toBe('fr')
 expect(withLang('en',()=>requestLang({headers:{'accept-language':'fr'},url:'/api/main?text=bonjour'}))).toBe('en')
})
