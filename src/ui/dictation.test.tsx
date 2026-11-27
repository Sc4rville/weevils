// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ transcribe: vi.fn(async () => ({ text: 'the whole long message' })) }))
const journal = vi.hoisted(() => {
  const rows = new Map<string, { id: string; scope: string; count: number; insertedAt?: number; heardAt?: number; startedAt: number; stoppedAt?: number; type: string; lang: string }>()
  const chunks = new Map<string, Blob>()
  return {
    rows, chunks,
    saveRecording: vi.fn(async (r: { id: string }) => void rows.set(r.id, { ...(r as object) } as never)),
    saveVoiceChunk: vi.fn(async (r: { id: string }, n: number, b: Blob) => { rows.set(r.id, { ...(r as object) } as never); chunks.set(`${r.id}:${n}`, b) }),
    allVoiceRecordings: vi.fn(async () => [...rows.values()]),
    recordedChunks: vi.fn(async (r: { id: string; count: number }) => Array.from({ length: r.count }, (_, n) => chunks.get(`${r.id}:${n}`)!)),
  }
})
vi.mock('../api', () => ({ api }))
vi.mock('../voice-recordings', () => journal)
import { Composer } from './bits'
import { resetDictation } from './dictation'
import { updateIsBusy } from '../update-guard'
import { setLang } from '../i18n'

class Recorder {
  static last: Recorder
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: { getTracks: () => { stop: () => void }[] }) { Recorder.last = this }
  static isTypeSupported = (t: string) => t === 'audio/webm'
  start() { this.state = 'recording' }
  /** A second of speech. */
  slice() { this.ondataavailable?.({ data: new Blob([new Uint8Array(600)], { type: 'audio/webm' }) }) }
  stop() { this.state = 'inactive'; this.slice(); this.onstop?.() }
}
const stopTrack = vi.fn()

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  sessionStorage.clear()
  journal.rows.clear(); journal.chunks.clear()
  api.transcribe.mockClear()
  resetDictation()
  vi.stubGlobal('MediaRecorder', Recorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  vi.unstubAllGlobals(); setLang(null)
})
const box = (key: string) => <Composer key={key} label="message" placeholder="message" multiline draftKey={key} onSend={() => {}} />
const mic = () => host.querySelector<HTMLButtonElement>('button[aria-pressed]')!
/** Waits for the async work, letting React render between looks. */
const settle = (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() }, { timeout: 2000 })

it('keeps recording when its box goes away, and the words land in the box that stops it', async () => {
  act(() => root.render(box('session:__main')))
  await act(async () => mic().click())
  expect(mic().getAttribute('aria-pressed')).toBe('true')
  Recorder.last.slice()
  // Another page of the app: no box at all, then another conversation's box.
  act(() => root.render(<p>For you</p>))
  expect(Recorder.last.state).toBe('recording')
  expect(stopTrack).not.toHaveBeenCalled()
  expect(updateIsBusy()).toBe(true) // the app never reloads onto a new build meanwhile
  Recorder.last.slice()
  act(() => root.render(box('session:abc')))
  expect(mic().getAttribute('aria-pressed')).toBe('true') // the mic there shows it still records
  await act(async () => mic().click())
  await settle(() => expect(host.querySelector('textarea')!.value).toBe('the whole long message'))
  expect(api.transcribe).toHaveBeenCalledOnce()
  expect(stopTrack).toHaveBeenCalled()
  expect(document.documentElement.dataset.dictation).toBeUndefined()
  // Every slice was kept in the browser as it came.
  expect(journal.saveVoiceChunk).toHaveBeenCalledTimes(3)
})

it('puts the words in the kept draft when the box that stopped it is gone before they come back', async () => {
  act(() => root.render(box('session:__main')))
  await act(async () => mic().click())
  let release!: (v: { text: string }) => void
  api.transcribe.mockImplementationOnce(() => new Promise((r) => { release = r }))
  Recorder.last.slice()
  await act(async () => mic().click())
  act(() => root.render(<p>elsewhere</p>))
  await settle(() => expect(release).toBeTypeOf('function'))
  await act(async () => release({ text: 'said while away' }))
  await settle(() => expect(sessionStorage.getItem('weevils-draft:session:__main')).toBe('said while away'))
})

it('transcribes what a page that died mid-recording left behind, into the draft it belongs to, once', async () => {
  const old = Date.now() - 60_000
  journal.rows.set('dead', { id: 'dead', scope: 'dictation:weevils-draft:session:__main', type: 'audio/webm', lang: 'fr', startedAt: old, heardAt: old, count: 2 })
  journal.chunks.set('dead:0', new Blob([new Uint8Array(600)])); journal.chunks.set('dead:1', new Blob([new Uint8Array(600)]))
  // Another tab still recording: written a second ago, never touched.
  journal.rows.set('live', { id: 'live', scope: 'dictation:weevils-draft:session:__main', type: 'audio/webm', lang: 'fr', startedAt: old, heardAt: Date.now(), count: 1 })
  act(() => root.render(box('session:__main')))
  await settle(() => expect(journal.rows.get('dead')!.insertedAt).toBeTruthy())
  expect(api.transcribe).toHaveBeenCalledOnce()
  expect(host.querySelector('textarea')!.value).toBe('the whole long message')
  expect(journal.rows.get('dead')!.insertedAt).toBeTruthy()
  expect(journal.rows.get('live')!.insertedAt).toBeUndefined()
})

it('takes back at once what this very tab was recording when it reloaded', async () => {
  const now = Date.now()
  journal.rows.set('mine', { id: 'mine', scope: 'dictation:weevils-draft:session:__main', type: 'audio/webm', lang: 'fr', startedAt: now - 5000, heardAt: now, count: 1 })
  journal.chunks.set('mine:0', new Blob([new Uint8Array(900)]))
  sessionStorage.setItem('weevils-dictating', 'mine')
  act(() => root.render(box('session:__main')))
  await settle(() => expect(host.querySelector('textarea')!.value).toBe('the whole long message'))
  expect(sessionStorage.getItem('weevils-dictating')).toBeNull()
})
