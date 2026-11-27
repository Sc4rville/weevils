// Dictation in a box to write in (src/ui/bits.tsx's Composer), one per page, owned by the page and not by the box: a
// tap on the mic starts it, and it keeps recording while the person goes to another page of the app (the box it
// started in unmounts, or shows another conversation) or to another window, until a mic is tapped again, in any box.
// The text lands in the box that stopped it (the one in front of the person), or in that box's kept draft when it is
// gone by the time the words come back. Each second of audio is kept in the browser (src/voice-recordings.ts) as it is
// recorded: a page that dies mid-recording (closed, crashed) leaves its audio there, and the next box with a mic that
// shows transcribes it into the draft it belongs to. Nothing is ever sent by itself. While it records or transcribes,
// the app never reloads itself onto a new build (src/update-guard.ts reads `data-dictation` on the page). Before
// 2026-11-27 the recorder lived in the box: a new build landed while someone dictated from another window, the page
// reloaded when they came back, and the whole message was gone; a tap to another page lost it too.
import { useSyncExternalStore } from 'react'
import { api } from '../api'
import { getLang, tr } from '../i18n'
import M from '../i18n/bits'
import { allVoiceRecordings, recordedChunks, saveRecording, saveVoiceChunk, type VoiceRecording } from '../voice-recordings'

export type DictationState = 'off' | 'on' | 'wait'

const MIME = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
/** A recording in this journal belongs to a box's draft (`dictation:weevils-draft:…`): the classic logo keeps its own scopes. */
const SCOPE = 'dictation:'
/** Too short or empty: not a failure, nothing is said. */
const MIN_BYTES = 800

let state: DictationState = 'off'
const listeners = new Set<() => void>()
function set(next: DictationState) {
  state = next
  if (typeof document !== 'undefined') {
    if (next === 'off') delete document.documentElement.dataset.dictation
    else document.documentElement.dataset.dictation = next
  }
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
export const dictationState = () => state
export const useDictation = () => useSyncExternalStore(subscribe, dictationState, dictationState)

/** The boxes on screen, by the key their draft is kept under (`weevils-draft:…`): where the words go back. */
type Box = { put: (text: string) => void }
const boxes = new Map<string, Box[]>()
export function mountBox(key: string, box: Box): () => void {
  boxes.set(key, [...(boxes.get(key) ?? []), box])
  void recoverOnce()
  return () => {
    const left = (boxes.get(key) ?? []).filter((b) => b !== box)
    if (left.length) boxes.set(key, left)
    else boxes.delete(key)
  }
}
const appended = (cur: string, heard: string) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${heard}` : heard)
/** A box showing this draft takes the words; none: they join the kept draft, read when the box shows again. */
function deliver(key: string, heard: string) {
  const box = boxes.get(key)?.at(-1)
  if (box) return box.put(heard)
  try { sessionStorage.setItem(key, appended(sessionStorage.getItem(key) ?? '', heard)) } catch { /* no storage: lost to the draft, kept in the journal */ }
}

const blobToB64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error(tr(M).audioRead))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(b)
  })

async function transcribe(item: VoiceRecording, parts: Blob[]): Promise<string> {
  const blob = new Blob(parts, { type: item.type })
  if (blob.size < MIN_BYTES) return ''
  return (await api.transcribe(blob.type, await blobToB64(blob), item.lang)).text.trim()
}

let current: { r: MediaRecorder; stop?: { key: string; fail: (m: string) => void } } | null = null

/** Starts recording. Throws when the mic is refused or missing (the box says it). */
export async function startDictation(key: string): Promise<void> {
  if (state !== 'off') return
  set('on')
  let stream: MediaStream | undefined
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const type = MIME.find((t) => MediaRecorder.isTypeSupported(t))
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const tracks = stream
    let item: VoiceRecording = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, scope: SCOPE + key, type: r.mimeType || type || 'audio/mp4', lang: getLang(), startedAt: Date.now(), count: 0 }
    const parts: Blob[] = []
    try { sessionStorage.setItem(MINE, item.id) } catch { /* no storage: another page finds it once it has been quiet a while */ }
    // Kept in order, each in its own write; a browser that cannot keep it still records (RAM), as before.
    let kept: Promise<unknown> = saveRecording(item).catch(() => undefined)
    r.ondataavailable = (ev) => {
      if (!ev.data.size) return
      const n = parts.length
      parts.push(ev.data)
      item = { ...item, count: parts.length, heardAt: Date.now() }
      const snapshot = item
      kept = kept.then(() => saveVoiceChunk(snapshot, n, ev.data)).catch(() => undefined)
    }
    const me: NonNullable<typeof current> = { r }
    current = me
    // Stopped by a tap, or on its own (the mic unplugged, the phone took it back): what was heard goes back all the same.
    r.onstop = async () => {
      tracks.getTracks().forEach((t) => t.stop())
      if (current === me) current = null
      try { if (sessionStorage.getItem(MINE) === item.id) sessionStorage.removeItem(MINE) } catch { /* no storage */ }
      const to = me.stop?.key ?? key
      set('wait')
      item = { ...item, scope: SCOPE + to, stoppedAt: Date.now() }
      try {
        await kept
        await saveRecording(item).catch(() => undefined)
        const heard = await transcribe(item, parts)
        item = { ...item, text: heard }
        if (heard) deliver(to, heard)
        await saveRecording({ ...item, insertedAt: Date.now() }).catch(() => undefined)
      } catch (e) {
        // The audio stays in the journal: the next page's first box tries again.
        me.stop?.fail((e as Error).message)
      } finally {
        set('off')
      }
    }
    // A slice every second: what was said is in the browser's storage within a second, whatever happens to the page.
    r.start(1000)
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop())
    current = null
    set('off')
    throw e
  }
}

/** Stops it from the box with this draft key: the words go there. `fail` says a failed transcription in that box. */
export function stopDictation(key: string, fail: (m: string) => void) {
  if (!current || current.r.state === 'inactive') return
  current.stop = { key, fail }
  current.r.stop()
}

// ---- What a page that died mid-recording left behind, into the draft it belongs to.
/** The recording this tab is making: found at load, this very tab died making it (reloaded, crashed). */
const MINE = 'weevils-dictating'
/** One made in another tab writes a slice every second: one quiet this long was left behind. */
const LEFT_MS = 15_000
const recovered = new Set<string>()
let recovering = false
async function recoverOnce() {
  if (recovering) return
  recovering = true
  let mine: string | null = null
  try { mine = sessionStorage.getItem(MINE) } catch { /* no storage */ }
  try {
    const now = Date.now()
    const open = (await allVoiceRecordings()).filter((r) => r.scope.startsWith(SCOPE) && !r.insertedAt && r.count > 0 && !recovered.has(r.id))
    const left = (r: VoiceRecording) => r.id === mine || (now - (r.heardAt ?? r.startedAt) > LEFT_MS && (!r.stoppedAt || now - r.stoppedAt > 5 * 60_000))
    for (const item of open.filter(left)) {
      recovered.add(item.id)
      try {
        const heard = await transcribe(item, await recordedChunks(item))
        if (heard) deliver(item.scope.slice(SCOPE.length), heard)
        await saveRecording({ ...item, stoppedAt: item.stoppedAt ?? Date.now(), text: heard, insertedAt: Date.now() })
        if (item.id === mine) sessionStorage.removeItem(MINE)
      } catch { /* kept: another page tries again */ }
    }
    // Still being written a moment ago (another tab, or one that just died): looked at again once it has been quiet.
    if (open.some((r) => !left(r) && !r.stoppedAt)) setTimeout(() => { recovering = false; void recoverOnce() }, LEFT_MS + 1000)
  } catch { /* no storage */ }
}
/** Tests only. */
export function resetDictation() {
  current = null
  recovered.clear()
  recovering = false
  boxes.clear()
  set('off')
}
