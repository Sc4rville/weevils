import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { WeevbossLogo } from './logo'

/**
 * Le logo de weevboss est le bouton vocal, en trois taps qui s'enchaînent vite :
 * 1. enregistre ; 2. arrête et transcrit dans le champ ; 3. envoie.
 * Un tap pendant la transcription est retenu : le message part dès que le texte est là.
 */

type Phase = 'idle' | 'rec' | 'wait' | 'ready'

const blobToB64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('lecture audio'))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(b)
  })

const MIME = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']

// Un seul élément audio, déverrouillé par le premier tap (iOS refuse de jouer sans geste).
let player: HTMLAudioElement | null = null
const SILENCE = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae9XFz280948NMBWInljyzsNRFLPWdnZGWrddDsjK1unuSrVN9jJsK8KuQtQCtMBjCEtImISdNKJOopIpBFpNSMbIHCSRpRR5iakjTiyzLhchUUBwCgyKiweBv/7UsQbg8isVNoMPMjAAAA0gAAABEVFGmgqK////9bP/6XCykxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
export function unlockAudio() {
  if (player) return
  player = new Audio()
  player.src = SILENCE
  void player.play().catch(() => undefined)
}

export async function say(text: string, onEnd: () => void, oral = false) {
  if (!player) return onEnd()
  try {
    const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, oral }), credentials: 'same-origin' })
    if (!res.ok) throw new Error('voix')
    const url = URL.createObjectURL(await res.blob())
    player.src = url
    player.onended = () => {
      URL.revokeObjectURL(url)
      onEnd()
    }
    await player.play()
  } catch {
    onEnd()
  }
}
const hush = () => {
  if (player) {
    player.pause()
    player.onended = null
  }
}

export function VoiceLogo({ onText, onSend, replyKey, replyText, working, take }: { onText: (t: string) => void; onSend: () => void; replyKey?: string; replyText?: string; working: boolean; take: () => string }) {
  const [speaking, setSpeaking] = useState(false)
  /** Le dernier message est parti à la voix : sa réponse sera lue. */
  const spoken = useRef(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [reply, setReply] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const sendAfter = useRef(false)
  const lastReply = useRef(replyKey)

  // weevboss vient de répondre : une vague de couleur sur le logo.
  useEffect(() => {
    if (!replyKey || replyKey === lastReply.current) return
    lastReply.current = replyKey
    setReply(false)
    requestAnimationFrame(() => setReply(true))
    if (spoken.current && replyText) {
      spoken.current = false
      setSpeaking(true)
      void say(replyText, () => {
        setSpeaking(false)
        setReply(false)
      })
      return
    }
    const t = setTimeout(() => setReply(false), 1800)
    return () => clearTimeout(t)
  }, [replyKey])

  const start = async () => {
    setErr(null)
    sendAfter.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = MIME.find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      chunks.current = []
      r.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data)
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop())
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || type || 'audio/mp4' })
          if (blob.size < 800) throw new Error('rien entendu')
          const { text } = await api.transcribe(blob.type, await blobToB64(blob))
          if (!text.trim()) throw new Error('rien entendu')
          onText(text.trim())
          if (sendAfter.current) {
            // Le troisième tap est arrivé pendant la transcription : on envoie dès que le champ est rempli.
            setTimeout(send, 30)
            setPhase('idle')
          } else setPhase('ready')
        } catch (e) {
          setErr((e as Error).message)
          setPhase('idle')
        }
      }
      // Petites tranches : l'arrêt est instantané, rien n'attend la fin d'un gros bloc.
      r.start(250)
      rec.current = r
      setPhase('rec')
    } catch (e) {
      setErr(/denied|permission|NotAllowed/i.test((e as Error).message + (e as Error).name) ? 'micro refusé' : (e as Error).message)
      setPhase('idle')
    }
  }

  // Envoi vocal : la couche rapide répond tout de suite à voix haute ; une action part aussi à weevboss.
  const send = () => {
    const text = take()
    if (!text) return onSend()
    setSpeaking(true)
    setReply(true)
    const done = () => {
      setSpeaking(false)
      setReply(false)
    }
    api
      .voice(text)
      .then((v) => say(v.say, done, true))
      .catch((e) => {
        setErr((e as Error).message)
        done()
      })
  }
  const tap = () => {
    unlockAudio()
    if (speaking) {
      hush()
      setSpeaking(false)
      setReply(false)
      return
    }
    if (phase === 'idle') void start()
    else if (phase === 'rec') {
      setPhase('wait')
      rec.current?.stop()
    } else if (phase === 'wait') sendAfter.current = true
    else {
      send()
      setPhase('idle')
    }
  }

  const label = phase === 'idle' ? 'dicter à weevboss' : phase === 'rec' ? 'arrêter et transcrire' : phase === 'wait' ? 'envoyer dès que transcrit' : 'envoyer'
  return (
    <div className="voice">
      <button className={`voice-logo ${phase} ${reply ? 'reply' : ''} ${working ? 'working' : ''} ${speaking ? 'speaking' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={tap} aria-label={label} aria-pressed={phase === 'rec'}>
        <WeevbossLogo className="voice-svg" />
      </button>
      {err && <div className="meta voice-err">! {err}</div>}
    </div>
  )
}
