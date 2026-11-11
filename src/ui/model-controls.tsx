import { useEffect, useState } from 'react'
import type { ModelControls } from '../../shared/model-controls'
import { api } from '../api'
import { useT } from '../i18n'
import M from '../i18n/model-controls'
import { Shell } from './shell'
import './model-controls.css'

export function ModelPicker({id}:{id:string}) {
 const t=useT(M)
 const [data,setData]=useState<ModelControls|null>(null)
 const [model,setModel]=useState(''),[effort,setEffort]=useState('')
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
 const [error,setError]=useState(''),[confirmed,setConfirmed]=useState(false)
 const [reload,setReload]=useState(0)
 useEffect(()=>{
  let stale=false;setLoading(true);setError('');setConfirmed(false);setData(null)
  api.modelControls(id).then(d=>{if(stale)return;setData(d);setModel(d.selected.model??'');setEffort(d.selected.effort??'')}).catch(e=>{if(!stale)setError(e instanceof Error?e.message:t.failed)}).finally(()=>{if(!stale)setLoading(false)})
  return ()=>{stale=true}
 },[id,reload,t.failed])
 const selected=data?.models.find(m=>m.id===model)
 const valid=!!selected?.efforts.includes(effort)
 const word=(value:string)=>t[value as 'low']??value
 const apply=async()=>{
  if(!valid || saving)return
  setSaving(true);setError('');setConfirmed(false)
  try{const d=await api.setModelControls(id,{model,effort});setData(d);setModel(d.selected.model??'');setEffort(d.selected.effort??'');setConfirmed(true)}catch(e){setError(e instanceof Error?e.message:t.failed)}finally{setSaving(false)}
 }
 return <div className="in model-controls">
  {loading&&<p role="status">{t.loading}</p>}
  {data&&<>
   <p className="meta">{t.confirmed} · {data.models.find(m=>m.id===data.selected.model)?.label??data.selected.model??t.unknown}{data.selected.effort?` · ${word(data.selected.effort)}`:''}</p>
   <label>{t.model}<select value={model} disabled={saving} onChange={e=>{const m=data.models.find(x=>x.id===e.target.value);setModel(e.target.value);setEffort(m?.efforts.includes(effort)?effort:m?.defaultEffort??'');setConfirmed(false)}}><option value="" disabled>{t.model}</option>{!data.models.some(m=>m.id===model)&&model&&<option value={model} disabled>{model}</option>}{data.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
   <label>{t.effort}<select value={effort} disabled={saving||!selected} onChange={e=>{setEffort(e.target.value);setConfirmed(false)}}><option value="" disabled>{t.effort}</option>{selected?.efforts.map(e=><option value={e} key={e}>{word(e)}</option>)}</select></label>
   <p className="meta">{t.next}</p>
   <button type="button" className="link" disabled={!valid||saving} onClick={()=>void apply()}>{saving?t.saving:t.apply}</button>
  </>}
  {error&&<p role="alert">{error}</p>}
  {confirmed&&<p role="status">{t.success}</p>}
  {!loading&&<button type="button" className="link" disabled={saving} onClick={()=>setReload(n=>n+1)}>{t.reload}</button>}
 </div>
}
export function ModelControlsPage({id}:{id:string}) {
 const t=useT(M)
 return <Shell slot="agent" kicker="weevils" title={t.title}><ModelPicker key={id} id={id}/></Shell>
}
