import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ForYouItem } from '../shared/foryou.ts'
import type { Lang } from '../shared/i18n.ts'
import { detectLang } from '../shared/detect-lang.ts'

type Entry = { source: Record<string,string>; target: Lang; protected: string[]; variant?: Record<string,string>; failedAt?: number }
/** Only presentation fields cross the translation boundary. IDs, action instructions, URLs and state never do. */
export function presentation(item: ForYouItem): Record<string,string> {
  const out: Record<string,string> = {}
  const add = (key: string, value: unknown) => { if (typeof value === 'string' && value.trim()) out[key] = value }
  for (const key of ['title','text','lead','moreText'] as const) add(key,item[key])
  // A mail body is an attributed original, never silently rewritten.
  if (item.kind !== 'mail') add('body',item.body)
  item.actions?.forEach((v,n)=>add(`actions.${n}.label`,v.label))
  item.cards?.forEach((v,n)=>{for(const k of ['title','why','accept'] as const)add(`cards.${n}.${k}`,v[k])})
  item.gauges?.forEach((v,n)=>{add(`gauges.${n}.label`,v.label);add(`gauges.${n}.shown`,v.shown)})
  if(item.visualProposal){
    for(const k of ['question','recommendation','caveat'] as const)add(`visualProposal.${k}`,item.visualProposal[k])
    item.visualProposal.frames.forEach((v,n)=>{add(`visualProposal.frames.${n}.title`,v.title);add(`visualProposal.frames.${n}.description`,v.description)})
    item.visualProposal.options.forEach((v,n)=>{for(const k of ['label','description','instruction'] as const)add(`visualProposal.options.${n}.${k}`,v[k])})
  }
  return out
}
const protect = (s: string, names: string[]) => [...new Set([...names.filter(n=>n && s.includes(n)), ...s.matchAll(/«[^»]+»|“[^”]+”|"[^"\n]+"|`[^`]+`|https?:\/\/[^\s]+/g)].map(v=>typeof v==='string'?v:v[0]))]
export class FeedLocalization {
  private entries: Record<string,Entry> = {}
  private wanted = new Set<string>()
  private file: string
  private now: () => number
  constructor(file: string, now = Date.now){this.file=file;this.now=now;try{this.entries=JSON.parse(fs.readFileSync(file,'utf8'))}catch{/* first start */}}
  private save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.entries),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file)}
  project(item: ForYouItem,target: Lang, sourceLang?: Lang, names: string[]=[]): ForYouItem {
    const source=presentation(item)
    const combined = Object.values(source).join('\n')
    const original=sourceLang??(combined.trim().split(/\s+/).length >= 5 ? detectLang(combined) : null)
    if(!original || original===target || !Object.keys(source).length) return item
    const protectedWords=protect(Object.values(source).join('\n'),names)
    const revision=crypto.createHash('sha256').update(JSON.stringify([source,protectedWords])).digest('hex')
    const key=revision+':'+target
    let entry=this.entries[key]
    if(!entry){entry=this.entries[key]={source,target,protected:protectedWords};this.save()}
    if(!entry.variant) this.wanted.add(key)
    const result=structuredClone(item)
    result.localization={target,source:original??'unknown',revision,status:entry.variant?'translated':entry.failedAt?'failed':'pending',original:source}
    if(entry.variant)for(const [key,value] of Object.entries(entry.variant)){
      const bits=key.split('.');let parent:any=result
      for(const bit of bits.slice(0,-1))parent=parent[bit]
      parent[bits.at(-1)!]=value
    }
    return result
  }
  job(): { key:string; entry:Entry } | null {
    for(const key of this.wanted){const e=this.entries[key];if(!e.variant&&(!e.failedAt||this.now()-e.failedAt>=300_000))return {key,entry:e}}
    return null
  }
  async translate(run:(source:Record<string,string>,target:Lang,protectedWords:string[])=>Promise<Record<string,string>>):Promise<boolean>{
    const job=this.job();if(!job)return false
    const jobs: {key:string;entry:Entry}[]=[]
    let size=0
    for(const key of this.wanted){
      const entry=this.entries[key]
      if(entry.target!==job.entry.target||entry.variant||(entry.failedAt&&this.now()-entry.failedAt<300_000))continue
      const bytes=JSON.stringify(entry.source).length
      if(jobs.length && (jobs.length>=8 || size+bytes>14000))break
      jobs.push({key,entry});size+=bytes
    }
    const source=Object.fromEntries(jobs.flatMap(({entry},n)=>Object.entries(entry.source).map(([k,v])=>[`${n}/${k}`,v])))
    try{
      const combined=await run(source,job.entry.target,[...new Set(jobs.flatMap(j=>j.entry.protected))])
          // i18n-ignore: internal validation code, never presented to the user
      if(!combined||Object.keys(combined).length!==Object.keys(source).length)throw new Error('translation shape')
      const variants=jobs.map(({entry},n)=>{
        const variant:Record<string,string>={}
        for(const [k,source] of Object.entries(entry.source)){
          const v=combined[`${n}/${k}`]
          // i18n-ignore: internal validation code, never presented to the user
          if(typeof v!=='string'||!v.trim()||v.length>Math.max(2000,source.length*4))throw new Error('translation field')
          // i18n-ignore: internal validation code, never presented to the user
          for(const word of entry.protected)if(source.includes(word)&&!v.includes(word))throw new Error('translation changed protected text')
          // Numeric facts are presentation, never creative copy.
          const numbers=(s:string)=>s.match(/\d+(?:[.,]\d+)?/g)?.map(n=>n.replace(',','.')).sort().join('|')??''
          // i18n-ignore: internal validation code, never presented to the user
          if(numbers(source)!==numbers(v))throw new Error('translation changed numbers')
          variant[k]=v
        }
        const sample=Object.values(variant).join(' ').replace(/«[^»]+»|“[^”]+”|"[^"\n]+"|`[^`]+`/g,'')
        const detected=detectLang(sample)
          // i18n-ignore: internal validation code, never presented to the user
        if(detected && detected!==entry.target)throw new Error('translation language')
        return variant
      })
      jobs.forEach(({key,entry},n)=>{entry.variant=variants[n];delete entry.failedAt;this.wanted.delete(key)})
    }catch{jobs.forEach(({entry})=>{entry.failedAt=this.now()})}
    this.save();return jobs.every(j=>!!j.entry.variant)
  }
}
