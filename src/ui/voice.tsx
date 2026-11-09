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

export function VoiceLogo({ onText, onSend, replyKey, working }: { onText: (t: string) => void; onSend: () => void; replyKey?: string; working: boolean }) {
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
            setTimeout(onSend, 30)
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

  const tap = () => {
    if (phase === 'idle') void start()
    else if (phase === 'rec') {
      setPhase('wait')
      rec.current?.stop()
    } else if (phase === 'wait') sendAfter.current = true
    else {
      onSend()
      setPhase('idle')
    }
  }

  const label = phase === 'idle' ? 'dicter à weevboss' : phase === 'rec' ? 'arrêter et transcrire' : phase === 'wait' ? 'envoyer dès que transcrit' : 'envoyer'
  return (
    <div className="voice">
      <button className={`voice-logo ${phase} ${reply ? 'reply' : ''} ${working ? 'working' : ''}`} onPointerDown={(e) => e.preventDefault()} onClick={tap} aria-label={label} aria-pressed={phase === 'rec'}>
        <WeevbossLogo className="voice-svg" />
      </button>
      {err && <div className="meta voice-err">! {err}</div>}
    </div>
  )
}
