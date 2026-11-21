import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { groupResult, loadReviewed, resultFinal, say, NOTHING_REVIEWED, type ResultSpec } from './foryou-results.ts'
import type { ForYouItem, ForYouMedia } from '../shared/foryou.ts'
// A person's reviewed result is their own data (<foryou.json>.reviewed.json): a neutral one here.
const ALCOVE_SOURCE = 'v:anchor0001', ALCOVE_PORTRAIT = 'portrait0001', ALCOVE_FINAL_AT = 1794337730636, SESSION = 's-render'
const spec: ResultSpec = { key:'shop-alcove', anchor:ALCOVE_SOURCE, projectId:'shop-app', sessionId:SESSION,
  title:{ en:'The alcove', fr:'L’alcôve' }, intro:'Two armchairs under the vault.',
  final:{ file:'renders/alcove_l.png', sha256:'', at:ALCOVE_FINAL_AT },
  media:{ ids:[ALCOVE_PORTRAIT], names:'^alcove_[pl]\\.(?:png|webp)$' }, otherTitles:{ 'studio_p.png':{ en:'The studio', fr:'Le studio' } } }
const groupAlcove = (items:ForYouItem[], final?:ForYouMedia, lang?:string) => groupResult(items, spec, final, lang)
const media = (id:string,name:string):ForYouMedia => ({ id,name,type:'image',url:`/media/${id}`,bytes:1 })
const portrait = media(ALCOVE_PORTRAIT,'alcove_p.png')
const studio = media('studio','studio_p.png')
const final = media('landscape','alcove_l.png')
const anchor:ForYouItem = { id:ALCOVE_SOURCE,kind:'media',tone:'result',at:ALCOVE_FINAL_AT-1000,who:'session',projectId:'shop-app',sessionId:SESSION,text:'',title:'The alcove',seen:true,media:[studio,portrait],actions:[{id:'a',label:'Keep'}] }
describe('verified alcove result projection',()=>{
 it('leads with the verified landscape, preserves every original field and separates studio',()=>{
  const sources=structuredClone([anchor]);const before=JSON.stringify(sources)
  const [result]=groupAlcove(sources,final)
  expect(JSON.stringify(sources)).toBe(before)
  expect(result.id).toBe(anchor.id);expect(result.seen).toBe(true);expect(result.actions).toEqual(anchor.actions)
  expect(result.resultGroup?.final).toEqual(final)
  expect(result.resultGroup?.history[0].media).toEqual([portrait])
  expect(result.resultGroup?.otherMedia).toEqual([studio])
 })
 it('folds a later alcove regression without promoting it or hiding another room that mentions alcove',()=>{
  const update={...anchor,id:'later',at:ALCOVE_FINAL_AT+100,text:'The lighting regressed; work in progress.',seen:false,media:[portrait]}
  const crypte={...anchor,id:'crypte',title:'Crypte leads to alcove',media:[media('crypte','crypte_p.png')]}
  const input=[update,crypte,anchor]
  const out=groupAlcove(input,final)
  expect(out.map(i=>i.id)).toEqual(['crypte',ALCOVE_SOURCE])
  const group=out[1].resultGroup!
  expect(group.final).toEqual(final);expect(group.newerUpdate).toBe(true)
  expect(group.history.map(i=>[i.id,i.seen,i.actions])).toEqual([[update.id,false,update.actions],[anchor.id,true,anchor.actions]])
  expect(groupAlcove(JSON.parse(JSON.stringify(input)),final)).toEqual(out)
 })
 it('retains history when the final or earlier media disappears',()=>{
  const [item]=groupAlcove([{...anchor,media:undefined}])
  expect(item.resultGroup?.final).toBeUndefined()
  expect(item.resultGroup?.history[0].id).toBe(anchor.id)
  expect(item.actions).toEqual(anchor.actions)
 })
 it('does not resurrect an absent anchor or infer membership from text',()=>{
  expect(groupAlcove([{...anchor,id:'other',text:'alcove'}],final)[0].resultGroup).toBeUndefined()
  expect(groupAlcove([{...anchor,projectId:'other'}],final)[0].resultGroup).toBeUndefined()
 })
 it('carries the reviewer’s title, intro and other names in the app’s language',()=>{
  expect(groupAlcove([anchor],final,'fr')[0].resultGroup).toMatchObject({ key:'shop-alcove', title:'L’alcôve', intro:'Two armchairs under the vault.', otherTitles:{ 'studio_p.png':'Le studio' } })
  expect(groupAlcove([anchor],final,'de')[0].resultGroup?.title).toBe('The alcove')
  expect(say(undefined,'en')).toBeUndefined()
 })
 it('never trusts an unavailable unverified final',()=>expect(resultFinal(spec,null,'/missing')).toBeUndefined())
 it('leads with the finished file only while its bytes are the verified ones, and never leaves the working folder',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'results-'))
  try{
   fs.mkdirSync(path.join(dir,'renders'))
   const file=path.join(dir,'renders','alcove_l.png');fs.writeFileSync(file,'final')
   const sha256=crypto.createHash('sha256').update('final').digest('hex')
   const shelf={ get:()=>undefined, add:(f:string)=>({ id:'added', file:f }), view:(e:any)=>media(e.id,path.basename(e.file)) } as any
   const ok={ ...spec, final:{ file:'renders/alcove_l.png', sha256, at:1 } }
   expect(resultFinal(ok,shelf,dir)).toMatchObject({ id:'added', name:'alcove_l.png' })
   expect(resultFinal({ ...ok, final:{ ...ok.final, sha256:'0'.repeat(64) } },shelf,dir)).toBeUndefined()
   fs.writeFileSync(path.join(dir,'outside.png'),'final')
   expect(resultFinal({ ...ok, final:{ ...ok.final, file:'../outside.png' } },shelf,path.join(dir,'renders'))).toBeUndefined()
   fs.writeFileSync(file,'regressed')
   expect(resultFinal(ok,shelf,dir)).toBeUndefined()
  }finally{ fs.rmSync(dir,{ recursive:true, force:true }) }
 })
})
describe('what one person reviewed, from their own data',()=>{
 it('reviews nothing without a file or with a broken one, and reads a changed file again',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-'))
  try{
   const file=path.join(dir,'foryou.json.reviewed.json')
   expect(loadReviewed(file,0)).toBe(NOTHING_REVIEWED)
   fs.writeFileSync(file,'{ not json')
   expect(loadReviewed(file,0)).toEqual(NOTHING_REVIEWED)
   fs.writeFileSync(file,JSON.stringify({ results:[spec,{ key:'no-anchor' }], captions:{ pic:{ title:'A', description:'B' } }, examples:{ result:'pic' }, editorial:[{ id:'x' }], intents:'nope' }))
   expect(loadReviewed(file)).toEqual(NOTHING_REVIEWED) // looked at a moment ago: not read again yet
   expect(loadReviewed(file,0)).toEqual({ results:[spec], captions:{ pic:{ title:'A', description:'B' } }, examples:{ result:'pic' }, editorial:[], intents:[] })
  }finally{ fs.rmSync(dir,{ recursive:true, force:true }) }
 })
})
