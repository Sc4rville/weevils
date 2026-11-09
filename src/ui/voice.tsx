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

export async function say(text: string, onEnd: () => void, oral = false, voice?: string) {
  if (!player) return onEnd()
  try {
    const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, oral, voice }), credentials: 'same-origin' })
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
  // Jamais de voix pendant que l'utilisateur parle : une seule réponse en attente (la dernière), lue 1 s après l'arrêt du micro.
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const micStopped = useRef(0)
  const pending = useRef<{ text: string; oral: boolean } | null>(null)
  const flushTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = () => {
    clearTimeout(flushTimer.current)
    const p = pending.current
    if (!p) return
    const quiet = Date.now() - micStopped.current
    if (phaseRef.current === 'rec' || phaseRef.current === 'wait' || quiet < 1000) {
      flushTimer.current = setTimeout(flush, Math.max(250, 1000 - quiet))
      return
    }
    pending.current = null
    setSpeaking(true)
    setReply(true)
    void say(p.text, () => {
      setSpeaking(false)
      setReply(false)
    }, p.oral)
  }
  const queueSay = (text: string, oral: boolean) => {
    pending.current = { text, oral } // la plus récente remplace les précédentes : jamais de rafale
    flush()
  }

  // weevboss vient de répondre : une vague de couleur sur le logo.
  useEffect(() => {
    if (!replyKey || replyKey === lastReply.current) return
    lastReply.current = replyKey
    setReply(false)
    requestAnimationFrame(() => setReply(true))
    if (spoken.current && replyText) {
      spoken.current = false
      queueSay(replyText, false)
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
  // Le message part à weevboss comme un message écrit ; sa vraie réponse sera résumée à l'oral puis lue.
  const send = () => {
    spoken.current = true
    onSend()
    take()
  }
  const tap = () => {
    unlockAudio()
    // La voix se tait dès que l'utilisateur reprend la parole (le tap enchaîne sur l'enregistrement).
    if (speaking) {
      hush()
      setSpeaking(false)
      setReply(false)
      if (phase !== 'idle') return
    }
    if (phase === 'idle') void start()
    else if (phase === 'rec') {
      setPhase('wait')
      micStopped.current = Date.now()
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

/** Les voix de weevboss : un tap fait dire une phrase d'essai et garde la voix. */
export function VoicePicker({ userName }: { userName: string }) {
  const [list, setList] = useState<{ id: string; name: string }[] | null>(null)
  const [cur, setCur] = useState<string | undefined>()
  useEffect(() => {
    api
      .voices()
      .then((r) => {
        setList(r.voices)
        setCur(r.current)
      })
      .catch(() => setList([]))
  }, [])
  if (!list?.length) return null
  const pick = (id: string) => {
    unlockAudio()
    setCur(id)
    void api.setVoice(id).catch(() => undefined)
    void say(`Salut${userName ? ` ${userName}` : ''}, c’est moi, weevboss.`, () => undefined, true, id)
  }
  return (
    <div className="in words" role="group" aria-label="voix">
      {list.map((v) => (
        <button key={v.id} className={`word ${cur === v.id ? 'on' : ''}`} aria-pressed={cur === v.id} onClick={() => pick(v.id)}>
          {v.name}
        </button>
      ))}
    </div>
  )
}
