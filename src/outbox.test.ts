// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const payloads = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./outbox-payload', () => ({ storePayload: async (id: string, body: unknown) => { payloads.set(id, body) }, loadPayload: async (id: string) => payloads.get(id), removePayload: async (id: string) => { payloads.delete(id) } }))
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => { vi.resetModules(); localStorage.clear(); payloads.clear(); vi.useFakeTimers(); fetcher = vi.fn(async () => new Response(JSON.stringify({ enabled: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const load = () => import('./outbox')
const accepted = (id: string) => ({ messageId: id, status: 'accepted', acceptedAt: Date.now(), updatedAt: Date.now() })
it('retries a lost response with one persisted identity and one durable server operation', async () => {
 const { deliver } = await load(); const acceptedIds = new Set<string>(); const keys: string[] = []
 const submit = vi.fn(async (id?: string) => { keys.push(id!); acceptedIds.add(id!); if (keys.length === 1) throw new TypeError('network'); return accepted(id!) })
 const pending = deliver('/api/main', { text: 'hello' }, submit)
 await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
 await vi.advanceTimersByTimeAsync(600)
 expect((await pending).status).toBe('accepted')
 expect(keys[0]).toBe(keys[1]); expect(acceptedIds.size).toBe(1)
 expect(JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0].messageId).toBe(keys[0])
})
it('reload resumes tracking an accepted operation without submitting it again', async () => {
 let outbox = await load()
 const submit = vi.fn(async (id?: string) => accepted(id!))
 const receipt = await outbox.deliver('/api/sessions/a/send', { text: 'hello' }, submit)
 vi.resetModules(); outbox = await load()
 const duplicate = await outbox.deliver('/api/sessions/a/send', { text: 'hello' }, submit)
 expect(duplicate.messageId).toBe(receipt.messageId); expect(submit).toHaveBeenCalledTimes(1)
 fetcher.mockResolvedValue(new Response(JSON.stringify({ ...receipt, status: 'delivered', result: { id: 'a' } })))
 await outbox.refreshReceipts()
 expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/outbox/${receipt.messageId}`)
 expect(JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0].status).toBe('delivered')
})
it('coalesces double taps while transport is pending', async () => {
 const { deliver } = await load(); let release!: () => void
 const gate = new Promise<void>(r => { release = r })
 const submit = vi.fn(async (id?: string) => { await gate; return accepted(id!) })
 const one = deliver('/api/foryou/card/act?lang=en', { action: 'go' }, submit)
 const two = deliver('/api/foryou/card/act?lang=en', { action: 'go' }, submit)
 await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1)); release()
 expect((await one).messageId).toBe((await two).messageId)
})
it('does not automatically resend an uncertain injection or erase its recovery text', async () => {
 const { deliver, refreshReceipts } = await load()
 const submit = vi.fn(async (id?: string) => accepted(id!))
 const receipt = await deliver('/api/main/attach', { text: 'photo', files: [] }, submit)
 fetcher.mockResolvedValue(new Response(JSON.stringify({ ...receipt, status: 'uncertain' })))
 await refreshReceipts()
 await expect(deliver('/api/main/attach', { text: 'photo', files: [] }, submit)).rejects.toThrow()
 expect(submit).toHaveBeenCalledTimes(1)
 expect(JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0].text).toBe('photo')
})
it('bounds network retries and preserves the identity across a later manual retry', async () => {
 const { deliver } = await load(); const submit = vi.fn(async () => { throw new TypeError('offline') })
 const pending = deliver('/api/foryou/card/reply?lang=en', { text: 'hello' }, submit).catch(e => e)
 await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(3000)
 expect(await pending).toBeInstanceOf(Error); expect(submit).toHaveBeenCalledTimes(3)
 const first = JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0]
 const retry = vi.fn(async (id?: string) => accepted(id!))
 await deliver('/api/foryou/card/reply?lang=en', { text: 'hello' }, retry)
 expect(retry.mock.calls[0][0]).toBe(first.messageId)
})
it('never retries an old server that has no idempotent outbox', async () => {
 fetcher.mockResolvedValue(new Response('{}', { status: 404 }))
 const { deliver } = await load(); const submit = vi.fn(async () => { throw new TypeError('network') })
 await expect(deliver('/api/main', { text: 'hello' }, submit)).rejects.toThrow()
 expect(submit).toHaveBeenCalledTimes(1); expect(submit.mock.calls[0]).toEqual([])
})
it('does not downgrade an offline capability check into a non-idempotent submission', async () => {
 fetcher.mockRejectedValue(new TypeError('offline'))
 const { deliver } = await load(); const submit = vi.fn()
 await expect(deliver('/api/main', { text: 'hello' }, submit)).rejects.toThrow()
 expect(submit).not.toHaveBeenCalled()
})
it('keeps the same identity if the interface language changes before manual retry', async () => {
 const { deliver } = await load(); const submit = vi.fn(async () => { throw new TypeError('offline') })
 const pending = deliver('/api/foryou/card/reply?lang=fr', { text: 'hello' }, submit).catch(e => e)
 await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(3000); await pending
 const first = JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0]
 const retry = vi.fn(async (id?: string) => accepted(id!))
 await deliver('/api/foryou/card/reply?lang=en', { text: 'hello' }, retry)
 expect(retry.mock.calls[0][0]).toBe(first.messageId)
})
it('a proved pre-injection refusal allows an explicit new attempt, never an automatic one', async () => {
 const { deliver, refreshReceipts } = await load(); const submit = vi.fn(async (id?: string) => accepted(id!))
 const receipt = await deliver('/api/main', { text: 'hello' }, submit)
 fetcher.mockResolvedValue(new Response(JSON.stringify({ ...receipt, status: 'failed', error: 'not connected' })))
 await refreshReceipts(); expect(submit).toHaveBeenCalledTimes(1)
 const retry = await deliver('/api/main', { text: 'hello' }, submit)
 expect(retry.messageId).not.toBe(receipt.messageId); expect(submit).toHaveBeenCalledTimes(2)
})
it('an action stays idempotent after delivery and reload, while a new event gets a new identity', async () => {
 let outbox = await load(); const submit = vi.fn(async (id?: string) => ({...accepted(id!),status:'delivered'}))
 const first = await outbox.deliver('/api/foryou/card/act?lang=fr',{action:'prepare',eventId:'event1'},submit)
 vi.resetModules(); outbox = await load()
 const second = await outbox.deliver('/api/foryou/card/act?lang=en',{action:'prepare',eventId:'event1'},submit)
 expect(second.messageId).toBe(first.messageId); expect(submit).toHaveBeenCalledTimes(1)
 const next = await outbox.deliver('/api/foryou/card/act?lang=en',{action:'prepare',eventId:'event2'},submit)
 expect(next.messageId).not.toBe(first.messageId); expect(submit).toHaveBeenCalledTimes(2)
})
it('persists an offline first submission and automatically resumes the same payload after reconnecting', async () => {
 fetcher.mockRejectedValue(new TypeError('offline'))
 let outbox = await load(); const submit = vi.fn()
 await expect(outbox.deliver('/api/main', {text:'offline draft'}, submit)).rejects.toThrow()
 const saved = JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0]
 expect(saved.payload).toEqual({text:'offline draft'}); expect(submit).not.toHaveBeenCalled()
 vi.resetModules(); outbox = await load()
 fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
   if (url === '/api/outbox/capabilities') return new Response(JSON.stringify({enabled:true}))
   if (init?.method === 'POST') return new Response(JSON.stringify(accepted(saved.messageId)), {status:202})
   return new Response('{}', {status:404})
 })
 await outbox.refreshReceipts()
 const posted = fetcher.mock.calls.find(c => c[1]?.method === 'POST')!
 expect(posted[1].headers['Idempotency-Key']).toBe(saved.messageId)
 expect(JSON.parse(posted[1].body)).toEqual({text:'offline draft'})
 expect(JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0].status).toBe('accepted')
})
it('stores attachments outside localStorage and resumes them without changing identity', async () => {
 fetcher.mockRejectedValue(new TypeError('offline'))
 let outbox = await load(); const body = {text:'photo',files:[{name:'image.jpg',type:'image/jpeg',data:'PRIVATE_IMAGE_BASE64'}]}
 await expect(outbox.deliver('/api/main/attach',body,vi.fn())).rejects.toThrow()
 const raw = localStorage.getItem('weevils-outbox-v1')!; const saved = JSON.parse(raw)[0]
 expect(raw).not.toContain('PRIVATE_IMAGE_BASE64'); expect(payloads.get(saved.messageId)).toEqual(body)
 vi.resetModules(); outbox = await load()
 fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
  if (url === '/api/outbox/capabilities') return new Response(JSON.stringify({enabled:true}))
  if (init?.method === 'POST') return new Response(JSON.stringify({...accepted(saved.messageId),status:'delivered'}))
  return new Response('{}',{status:404})
 })
 await outbox.refreshReceipts()
 const posted = fetcher.mock.calls.find(c => c[1]?.method === 'POST')!
 expect(JSON.parse(posted[1].body)).toEqual(body); expect(posted[1].headers['Idempotency-Key']).toBe(saved.messageId)
 // The old draft may still be on screen after recovery: tapping send acknowledges it, never duplicates it.
 const submit = vi.fn(); await outbox.deliver('/api/main/attach',body,submit)
 expect(submit).not.toHaveBeenCalled()
})

it('persists the original app locale through a switch and retry',async()=>{
 const {setLang}=await import('./i18n')
 setLang('fr')
 fetcher.mockRejectedValueOnce(new TypeError('offline'))
 const {deliver}=await load()
 await expect(deliver('/api/main',{text:'bonjour'},vi.fn())).rejects.toThrow()
 const first=JSON.parse(localStorage.getItem('weevils-outbox-v1')!)[0]
 expect(first.locale).toBe('fr')
 setLang('en')
 const retry=vi.fn(async(id?:string)=>accepted(id!))
 await deliver('/api/main',{text:'bonjour'},retry)
 expect(retry.mock.calls[0][0]).toBe(first.messageId)
 expect((retry.mock.calls[0] as unknown[])[2]).toBe('fr')
 expect((retry.mock.calls[0] as unknown[])[3]).toBe('/api/main')
})
it('a late accepted poll cannot revive a delivered and dismissed receipt',async()=>{
 const box=await load()
 let complete!: (value:unknown)=>void
 const submit=vi.fn(()=>new Promise(resolve=>{complete=resolve}))
 const pending=box.deliver('/api/main',{text:'hello'},submit)
 await vi.waitFor(()=>expect(submit).toHaveBeenCalledTimes(1))
 const row=box.outboxSnapshot()[0]
 let respond!: (response:Response)=>void
 fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{respond=resolve}))
 const polling=box.refreshReceipts()
 complete({...accepted(row.messageId),status:'delivered'})
 await pending
 box.forgetReceipt(row.messageId)
 respond(new Response(JSON.stringify(accepted(row.messageId))))
 await polling
 expect(box.outboxSnapshot()[0]).toMatchObject({messageId:row.messageId,status:'delivered',dismissed:true})
})
