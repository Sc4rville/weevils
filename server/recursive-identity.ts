import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { WorkstreamIdentity } from '../shared/api.ts'

/** Git identity includes linked worktrees, but not unrelated repositories sharing a name or remote. */
export function repositoryIdentity(directory:string):string|null {
  let dir:string
  try{dir=fs.realpathSync(directory)}catch{return null}
  for(;;){
    const dot=path.join(dir,'.git')
    try{
      let git=fs.statSync(dot).isDirectory()?dot:path.resolve(dir,/^gitdir: (.+)\s*$/m.exec(fs.readFileSync(dot,'utf8'))?.[1]?.trim() ?? '')
      if(git===dir)return null
      const common=path.join(git,'commondir')
      if(fs.existsSync(common))git=path.resolve(git,fs.readFileSync(common,'utf8').trim())
      return fs.realpathSync(git)
    }catch{/* Ascend only filesystem parents; never inspect prose or remote URLs. */}
    const parent=path.dirname(dir);if(parent===dir)return null;dir=parent
  }
}
export class InstallationIdentity {
  private identity:string|null
  private cache=new Map<string,{at:number;identity:string|null}>()
  readonly installationId:string
  private machineId:string
  constructor(directory:string,machineId:string){
    this.machineId=machineId;this.identity=repositoryIdentity(directory)
    this.installationId=crypto.createHash('sha256').update(machineId+'\0'+(this.identity??path.resolve(directory))).digest('hex').slice(0,24)
  }
  classify(directory:string,projectId:string,repo:string|null,evidence:WorkstreamIdentity['evidence']='repository-identity'):WorkstreamIdentity|undefined {
    if(!this.identity||!repo)return undefined
    let cached=this.cache.get(directory)
    if(!cached||Date.now()-cached.at>30000){cached={at:Date.now(),identity:repositoryIdentity(directory)};this.cache.set(directory,cached)}
    return cached.identity===this.identity?{kind:'self-improvement',installationId:this.installationId,target:{machineId:this.machineId,projectId,repo},evidence}:undefined
  }
}
