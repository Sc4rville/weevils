import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FeedLocalization } from './foryou-localization.ts'
import type { ForYouItem } from '../shared/foryou.ts'
let dir:string, file:string, now:number
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'feed-loc-'));file=path.join(dir,'translations.json');now=1000})
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}))
const item=():ForYouItem=>({id:'i:one',at:42,kind:'insight',tone:'neutral',who:'weevils',text:'Le café est prêt pour TLO.',seen:true,media:[{id:'pic',name:'café.png',url:'/api/media/pic',type:'image',bytes:42}],actions:[{id:'a1',label:'Ouvrir le café'}]})
const run=async(s:Record<string,string>)=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v==='Le café est prêt pour TLO.'?'The café is ready for TLO.':v==='Ouvrir le café'?'Open the café':v]))
it('retains originals, identities, read state, media and actions through FR EN FR, reload and cache reuse',async()=>{
 const c=new FeedLocalization(file,()=>now),source=item()
 expect(c.project(source,'fr','fr')).toEqual(source)
 const pending=c.project(source,'en','fr',['TLO']);expect(pending.localization?.status).toBe('pending');expect(pending.text).toBe(source.text)
 await c.translate(run)
 const en=c.project(source,'en','fr',['TLO']);expect(en.text).toBe('The café is ready for TLO.');expect(en.actions).toEqual([{id:'a1',label:'Open the café'}]);expect(en.media).toEqual(source.media);expect(en.seen).toBe(true);expect(en.at).toBe(42);expect(en.id).toBe(source.id)
 expect(c.project(source,'fr','fr')).toEqual(source)
 expect(new FeedLocalization(file).project(source,'en','fr',['TLO'])).toEqual(en)
 expect(c.job()).toBeNull();expect(source).toEqual(item())
})
it('rejects provider failure and wrong shapes, retains original and retries after backoff',async()=>{
 const c=new FeedLocalization(file,()=>now),s=item();c.project(s,'en','fr')
 await c.translate(async()=>{throw new Error('offline')})
 expect(c.project(s,'en','fr')).toMatchObject({text:s.text,localization:{status:'failed'}});expect(c.job()).toBeNull()
 now+=300001;await c.translate(async()=>({}));expect(c.project(s,'en','fr').localization?.status).toBe('failed')
 now+=300001;await c.translate(run);expect(c.project(s,'en','fr').localization?.status).toBe('translated')
})
it('keys variants by source revision and never installs a stale answer on edited content',async()=>{
 const c=new FeedLocalization(file,()=>now),old=item();c.project(old,'en','fr')
 let resolve!:(v:Record<string,string>)=>void
 const work=c.translate(()=>new Promise(r=>resolve=r));const edited={...old,text:'Le jardin est prêt pour TLO.'}
 const next=c.project(edited,'en','fr');resolve(await run({'0/text':old.text,'0/actions.0.label':old.actions![0].label}));await work
 expect(c.project(edited,'en','fr').localization?.status).toBe('pending');expect(c.project(edited,'en','fr').localization?.revision).toBe(next.localization?.revision)
 expect(c.project(old,'fr','fr')).toEqual(old)
})
it('protects quotes, proper names, numeric facts and authoritative instructions',async()=>{
 const c=new FeedLocalization(file,()=>now),s={...item(),text:'TLO propose 3 images : « garde mon café ».',visualProposal:{question:'Quel rythme ?',recommendation:'Garder le rythme.',caveat:'Aucun rendu.',frames:[],options:[{id:'B',label:'Garder',description:'Les mêmes images.',instruction:'Ne rien publier.'}],selected:'B'}} satisfies ForYouItem
 c.project(s,'en','fr',['TLO']);await c.translate(async source=>Object.fromEntries(Object.keys(source).map(k=>[k,'The new 4 pictures are ready.'])))
 const projected=c.project(s,'en','fr',['TLO']);expect(projected.localization?.status).toBe('failed');expect(projected.visualProposal?.selected).toBe('B');expect(s.visualProposal.options[0].instruction).toBe('Ne rien publier.')
})
it('batches several cards in one budgeted call, without merging their identities',async()=>{
 const c=new FeedLocalization(file,()=>now);for(let n=0;n<5;n++)c.project({...item(),text:`Le café est prêt pour TLO. ${n}`},'en','fr')
 const provider=vi.fn(async(s:Record<string,string>)=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v.replace('Le café est prêt pour','The café is ready for').replace('Ouvrir le café','Open the café')])))
 await c.translate(provider);expect(provider).toHaveBeenCalledTimes(1);expect(c.job()).toBeNull()
})
it('protects a project name only as a name, not inside ordinary words, and accepts valid peers of a rejected card',async()=>{
 const c=new FeedLocalization(file,()=>now)
 const good={...item(),text:'Ces changements sont importants pour le café.'}
 const bad={...item(),text:'Le café contient 3 images.'}
 c.project(good,'en','fr',['ants']);c.project(bad,'en','fr')
 await c.translate(async s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v===good.text?'These changes are important for the café.':v===bad.text?'The café has 4 images.':'Open the café'])))
 expect(c.project(good,'en','fr',['ants']).localization?.status).toBe('translated')
 expect(c.project(bad,'en','fr').localization?.status).toBe('failed')
})
