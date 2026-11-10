import { useSyncExternalStore } from 'react'
import { tr } from './i18n'
import M from './i18n/outbox'

export type DeliveryState = 'sending' | 'accepted' | 'delivering' | 'delivered' | 'uncertain' | 'failed'
export interface Receipt {
  messageId: string
  status: DeliveryState
  acceptedAt?: number
  updatedAt: number
  id?: string
  result?: { id?: string; ok?: boolean }
  error?: string
}
export interface LocalReceipt extends Receipt { url: string; fingerprint: string; text?: string; trackingLost?: boolean; eventId?: string; card?: string }
const KEY = 'weevils-outbox-v1'
let rows: LocalReceipt[] = []
try { rows = JSON.parse(localStorage.getItem(KEY) ?? '[]').filter((r: LocalReceipt) => typeof r.messageId === 'string' && typeof r.url === 'string') } catch { /* unavailable storage */ }
const listeners = new Set<() => void>()
const inflight = new Map<string, Promise<Receipt>>()
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* server acceptance remains durable */ }
  listeners.forEach(fn => fn())
}
function update(receipt: LocalReceipt) {
  rows = [...rows.filter(r => r.messageId !== receipt.messageId), receipt]
  save()
}
export function forgetReceipt(id: string) { rows = rows.filter(r => r.messageId !== id); save() }
export const outboxSnapshot = () => rows
let trackers = 0
export function subscribeOutbox(fn: () => void, track = true) { listeners.add(fn); if (track) { trackers++; startTracking() } return () => { listeners.delete(fn); if (track) trackers--; if (!trackers && timer) { clearInterval(timer); timer = undefined } } }
export function awaitDelivery(receipt: Receipt): Promise<Receipt> {
  if (terminal(receipt)) return Promise.resolve(receipt)
  return new Promise(resolve => {
    const stop = subscribeOutbox(() => { const current = rows.find(r => r.messageId === receipt.messageId); if (current && terminal(current)) { stop(); resolve(current) } })
  })
}
const snapshot = outboxSnapshot
export function useOutbox() {
  return useSyncExternalStore(subscribeOutbox, snapshot)
}
const terminal = (r: Receipt) => ['delivered', 'uncertain', 'failed'].includes(r.status)
let timer: ReturnType<typeof setInterval> | undefined
let polling = false
export async function refreshReceipts() {
  if (polling) return
  polling = true
  try {
    for (const row of rows.filter(r => !terminal(r))) {
      try {
        const response = await fetch(`/api/outbox/${encodeURIComponent(row.messageId)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
        if (response.status === 404 && row.status === 'sending') continue // never POST from this reader
        if (!response.ok) throw new Error()
        const receipt = await response.json() as Receipt
        if (receipt.messageId !== row.messageId || !['accepted','delivering','delivered','uncertain','failed'].includes(receipt.status)) throw new Error()
        update({ ...row, ...receipt, trackingLost: false })
      } catch { update({ ...(rows.find(r => r.messageId === row.messageId) ?? row), trackingLost: true }) }
    }
  } finally { polling = false }
}
function startTracking() {
  if (timer) return
  void refreshReceipts()
  timer = setInterval(() => void refreshReceipts(), 5000)
}
let capability: Promise<boolean> | null = null
async function supported() {
  capability ??= fetch('/api/outbox/capabilities', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(async r => {
    if (r.status === 404) return false
    if (!r.ok) throw new Error(tr(M).unconfirmed)
    return (await r.json()).enabled === true
  })
  let enabled: boolean
  try { enabled = await capability } catch { capability = null; throw new Error(tr(M).unconfirmed) }
  if (!enabled) capability = null
  return enabled
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export type Submit = (messageId?: string, signal?: AbortSignal) => Promise<any>
/** Transport retries reuse the persisted identity. Once accepted, only GET may run. */
export async function deliver(url: string, body: unknown, submit: Submit): Promise<any> {
  if (!await supported()) return submit() // an older server cannot guarantee deduplication
  const bytes = new TextEncoder().encode(`${url.split('?')[0]}\n${JSON.stringify(body)}`)
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
  const action = /\/foryou\/[^/]+\/act(?:\?|$)/.test(url)
  const previous = rows.find(r => r.fingerprint === fingerprint && r.status !== 'failed' && (action || r.status !== 'delivered'))
  // A known acceptance is not a new request, even after a reload or a lost connection.
  if (previous && ['uncertain', 'failed'].includes(previous.status)) throw new Error(previous.error || tr(M)[previous.status as 'uncertain' | 'failed'])
  if (previous && previous.status !== 'sending') return previous
  if (inflight.has(fingerprint)) return inflight.get(fingerprint)
  const row: LocalReceipt = previous ?? { messageId: action ? `action-${fingerprint}-${rows.filter(r => r.fingerprint === fingerprint && r.status === 'failed').length}` : crypto.randomUUID(), status: 'sending', updatedAt: Date.now(), url, fingerprint, eventId: (body as any)?.eventId, card: (body as any)?.card, ...((body as any)?.text ? { text: (body as any).text } : {}) }
  update(row)
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { throw new Error(tr(M).storageFailed) }
  const run = async (): Promise<Receipt> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const known = rows.find(r => r.messageId === row.messageId)
      if (known && known.status !== 'sending') return known
      try {
        const response = await submit(row.messageId, AbortSignal.timeout(30000))
        if (response?.messageId !== row.messageId || !['accepted','delivering','delivered','uncertain','failed'].includes(response.status)) throw new TypeError(tr(M).unconfirmed)
        const receipt = response as Receipt
        update({ ...row, ...receipt, trackingLost: false })
        return receipt
      } catch (error) {
        const current = rows.find(r => r.messageId === row.messageId)
        if (current && current.status !== 'sending') return current
        const status = (error as { status?: number }).status
        // Definitive refusals are not network retries. Keep their recovery text visible.
        if (status && ![502,503,504].includes(status)) {
          update({ ...row, status: status >= 500 ? 'sending' : 'failed', error: error instanceof Error ? error.message : '', updatedAt: Date.now() })
          throw error
        }
        if (attempt < 2) await pause(attempt ? 2000 : 600)
      }
    }
    update({ ...row, trackingLost: true })
    throw new Error(tr(M).unconfirmed)
  }
  const job = run().finally(() => inflight.delete(fingerprint))
  inflight.set(fingerprint, job)
  return job
}
