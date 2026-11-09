import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import type { Message, Session } from '../../shared/api.ts'
import { useApp } from './app-context'
import { dur, plain, segments, status, step, userText } from './format'

/** Ressort commun : léger dépassement, pour que les bandes aient de l'inertie. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }

/** Dépliage en hauteur : ce qui est en dessous est poussé en douceur. */
export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c"
          id={id}
          className="clip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Apparition d'un élément ajouté à une liste (nouvelle session, nouveau message). */
export function Appear({ children }: { children: ReactNode }) {
  return (
    <motion.div className="clip" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
      {children}
    </motion.div>
  )
}

export function StatusChar({ s }: { s: Session['status'] }) {
  return <span className={s === 'working' ? 'spin fluo' : undefined}>{status[s].ch}</span>
}

/** Long message de Scarville : replié au-delà de quelques lignes, un geste pour tout lire. */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 420
  return (
    <>
      <div className={`text ${long && !open ? 'clamp' : ''}`}>{text}</div>
      {long && (
        <button className="link small" onClick={() => setOpen((v) => !v)}>
          {open ? '− replier' : '+ tout lire'}
        </button>
      )}
    </>
  )
}

/** Le pictogramme de l'outil, monochrome (currentColor : noir en light, blanc en dark), à la taille d'un glyphe. */
export function ToolIcon({ tool, size = 15 }: { tool: string; size?: number }) {
  if (tool === 'claude') {
    // Le soleil Claude : douze rayons de longueurs inégales autour d'un centre vide.
    const rays = [1, 0.72, 0.88, 0.66, 1, 0.7, 0.9, 0.68, 1, 0.74, 0.86, 0.7]
    return (
      <svg className="tool-svg" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden focusable="false">
        {rays.map((r, i) => {
          const a = (i / rays.length) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(a)
          const y = Math.sin(a)
          return <line key={i} x1={x * 3.2} y1={y * 3.2} x2={x * 10.5 * r} y2={y * 10.5 * r} stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
        })}
      </svg>
    )
  }
  if (tool === 'codex') {
    // Codex : le nœud OpenAI simplifié en trois arcs entrelacés.
    return (
      <svg className="tool-svg" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden focusable="false">
        {[0, 120, 240].map((deg) => (
          <path key={deg} d="M -6.5 3.75 A 7.5 7.5 0 0 1 6.5 3.75" transform={`rotate(${deg})`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
        ))}
        <circle r={2.2} fill="currentColor" />
      </svg>
    )
  }
  return <span className="tool-svg">{tool.slice(0, 2)}</span>
}

export function SessionRow({ session }: { session: Session }) {
  const { push, now } = useApp()
  const st = status[session.status]
  const waiting = session.status === 'needs_user'
  const ref = session.status === 'working' && session.workStartedAt ? session.workStartedAt : session.lastActivityAt
  // À droite : ce que la session fait (question qui t'attend, sinon son activité), puis la durée.
  const act = waiting && session.attention ? session.attention : (session.now ?? st.label)
  const when = dur(now - (session.status === 'done' ? session.lastActivityAt : ref))
  return (
    <button
      className={`row ${waiting ? 'tone' : ''} ${session.status === 'working' ? 'live' : ''}`}
      onClick={() => push({ kind: 'session', id: session.id })}
      aria-label={`${session.tool}, ${session.title}, ${st.label}${act ? ` : ${act}` : ''}, ${when}`}
    >
      <span className="in line" aria-hidden>
        <span className="st">
          <StatusChar s={session.status} />
        </span>
        <span className="tool-ic">
          <ToolIcon tool={session.tool} />
          {session.machineId !== 'vps' && <span className="tag">{session.machineId}</span>}
        </span>
        <span className="title">{session.title}</span>
        <span className="act">
          {act} · {when}
        </span>
      </span>
    </button>
  )
}

/** Ligne pleine largeur : un caractère-icône, un texte, une flèche. */
export function Line({
  ch,
  children,
  meta,
  onClick,
  className = '',
  label,
  disabled,
  go = '→',
}: {
  ch?: ReactNode
  children: ReactNode
  meta?: ReactNode
  onClick?: () => void
  className?: string
  label?: string
  disabled?: boolean
  go?: string | null
}) {
  return (
    <button className={`row ${className}`} onClick={onClick} aria-label={label} disabled={disabled}>
      <span className="in">
        {ch != null && (
          <span className="st" aria-hidden>
            {ch}
          </span>
        )}
        <span className="stack-text">
          <span className="ellipsis">{children}</span>
          {meta && <span className="meta ellipsis">{meta}</span>}
        </span>
        {go && !disabled && (
          <span className="go" aria-hidden>
            {go}
          </span>
        )}
      </span>
    </button>
  )
}

export interface Attachment {
  name: string
  type: string
  /** Base64 sans préfixe, image déjà réduite. */
  data: string
}

/** Photo du téléphone réduite (côté long ≤ 1600 px, JPEG) : légère à envoyer, lisible par l'agent. */
const MAX_FILE = 32 * 1024 * 1024

/** Fichier envoyé tel quel (PDF, zip, doc…). */
async function raw(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} dépasse 32 Mo`)
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { name: file.name, type: file.type || 'application/octet-stream', data: btoa(bin) }
}

async function shrink(file: File): Promise<Attachment> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * k)
    canvas.height = Math.round(bmp.height * k)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.85)
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
  } catch {
    // Format que le navigateur ne décode pas : on envoie tel quel.
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { name: file.name, type: file.type || 'image/jpeg', data: btoa(bin) }
  }
}

const blobToB64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('lecture audio'))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(b)
  })

export function Composer({
  placeholder,
  label,
  onSend,
  onAttach,
  onFocus,
  prompt = '>',
  className = 'tone',
  disabled,
  voice = false,
  anyFile = false,
}: {
  placeholder: string
  label: string
  onSend: (text: string) => void | Promise<void>
  /** Envoi avec des photos ; sans lui, pas de bouton photo. */
  onAttach?: (text: string, files: Attachment[]) => void | Promise<void>
  onFocus?: () => void
  prompt?: string
  className?: string
  disabled?: boolean
  /** Dictée : un appui pour enregistrer, un appui pour transcrire dans le champ. */
  voice?: boolean
  /** Toute pièce jointe (PDF, zip…), pas seulement des photos. */
  anyFile?: boolean
}) {
  const [text, setText] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  const [rec, setRec] = useState<'off' | 'on' | 'wait'>('off')
  const [err, setErr] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const picker = useRef<HTMLInputElement>(null)
  const canVoice = voice && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if ((!t && !files.length) || busy) return
    const sent = files
    setFiles([])
    setBusy(true)
    setErr(null)
    // Le clavier se range tout seul : les barres système d'iOS disparaissent avec lui.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // Vidé après le blur : iOS peut renvoyer le texte en cours de composition au moment où le champ perd le focus.
    const clear = () => {
      setText('')
      if (field.current) field.current.value = ''
    }
    clear()
    setTimeout(clear, 0)
    try {
      if (sent.length && onAttach) await onAttach(t, sent)
      else await onSend(t)
    } catch {
      setText(t) // on rend le texte en cas d'échec, rien n'est perdu
      setFiles(sent)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    try {
      const got = await Promise.all([...list].slice(0, 6).map((f) => (anyFile && !f.type.startsWith('image/') ? raw(f) : shrink(f))))
      setFiles((f) => [...f, ...got].slice(0, 6))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ''
    }
  }

  const toggleRec = async () => {
    if (rec === 'wait') return
    if (rec === 'on') {
      recorder.current?.stop()
      return
    }
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      chunks.current = []
      r.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data)
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop())
        setRec('wait')
        try {
          const blob = new Blob(chunks.current, { type: r.mimeType || type || 'audio/mp4' })
          if (blob.size < 800) throw new Error('rien d’enregistré')
          const { text: heard } = await api.transcribe(blob.type, await blobToB64(blob))
          if (heard) setText((cur) => (cur ? `${cur.replace(/\s+$/, '')} ${heard}` : heard))
        } catch (e) {
          setErr((e as Error).message)
        } finally {
          setRec('off')
        }
      }
      r.start()
      recorder.current = r
      setRec('on')
    } catch (e) {
      setErr(/denied|permission|NotAllowed/i.test((e as Error).message + (e as Error).name) ? 'micro refusé : autorise-le dans les réglages' : (e as Error).message)
      setRec('off')
    }
  }

  return (
    <form className={`composer band ${className}`} onSubmit={submit}>
      {(files.length > 0 || err) && (
        <div className="in meta attach-line">
          {files.length > 0 && (
            <>
              <span className="strong">
                {files.length} {files.every((f) => f.type.startsWith('image/')) ? (files.length > 1 ? 'photos' : 'photo') : files.length > 1 ? 'fichiers' : 'fichier'}
              </span>
              <button type="button" className="link small" onClick={() => setFiles([])}>
                retirer
              </button>
            </>
          )}
          {err && <span>! {err}</span>}
        </div>
      )}
      <div className="in">
        <span className="prompt" aria-hidden>
          {busy ? <span className="spin">*</span> : prompt}
        </span>
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={onFocus}
          placeholder={rec === 'on' ? 'j’écoute…' : rec === 'wait' ? 'je transcris…' : placeholder}
          aria-label={label}
          enterKeyHint="send"
          autoComplete="off"
          disabled={disabled}
        />
        {onAttach && !disabled && (
          <>
            <input ref={picker} type="file" accept={anyFile ? undefined : 'image/*'} multiple hidden onChange={(e) => void pick(e.target.files)} />
            <button type="button" className="tool-btn" onClick={() => picker.current?.click()} aria-label={anyFile ? 'joindre un fichier ou une photo' : 'joindre une photo'}>
              +
            </button>
          </>
        )}
        {canVoice && !disabled && (
          <button type="button" className={`tool-btn ${rec === 'on' ? 'rec' : ''}`} onClick={() => void toggleRec()} aria-label={rec === 'on' ? 'arrêter et transcrire' : 'dicter'} aria-pressed={rec === 'on'}>
            {rec === 'wait' ? <span className="spin">*</span> : 'o'}
          </button>
        )}
        <button className="send" type="submit" disabled={(!text.trim() && !files.length) || busy || disabled} aria-label="envoyer">
          ↑
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Le fil : la vraie conversation, simplifiée. Toi, l'agent, et ce qu'il fait entre deux réponses.

/** Prose d'agent sans markdown ; les blocs de code sont repliés derrière « code · n lignes ». */
export function Prose({ text }: { text: string }) {
  const parts = useMemo(() => segments(text), [text])
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <div key={i} className="text">
            {plain(p.body)}
          </div>
        ) : (
          <Snippet key={i} code={p.body} />
        ),
      )}
    </>
  )
}

function Snippet({ code }: { code: string }) {
  const [open, setOpen] = useState(false)
  const n = code.split('\n').length
  return (
    <div className="snippet">
      <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? '−' : '+'} code · {n} {n > 1 ? 'lignes' : 'ligne'}
      </button>
      <Collapse open={open}>
        <pre className="code mono small">{code}</pre>
      </Collapse>
    </div>
  )
}

type Group = { kind: 'msg'; m: Message } | { kind: 'steps'; id: string; steps: Message[] }

/** Les actions consécutives de l'agent (lire, modifier, lancer…) forment un seul bloc replié. */
function group(messages: Message[]): Group[] {
  const out: Group[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (m.role === 'event') {
      if (last?.kind === 'steps') last.steps.push(m)
      else out.push({ kind: 'steps', id: m.id, steps: [m] })
    } else out.push({ kind: 'msg', m })
  }
  return out
}

function Steps({ steps, live }: { steps: Message[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  const last = step(steps[steps.length - 1].text)
  if (steps.length === 1) {
    return (
      <div className="msg band event">
        <div className="in">
          <div className="text">→ {last}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="msg band event">
      <button className="in steps-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text">
          {live ? <span className="spin fluo">*</span> : '→'} {steps.length} étapes · <span key={last} className="fade-in">{last}</span>
        </span>
        <span className="go" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      <Collapse open={open}>
        <div className="in steps-list">
          {steps.map((s) => (
            <div key={s.id} className="text">
              → {step(s.text)}
            </div>
          ))}
        </div>
      </Collapse>
    </div>
  )
}

const WINDOW = 60

export function Messages({ messages, author, working = false }: { messages: Message[]; author: string; working?: boolean }) {
  const [all, setAll] = useState(false)
  const hidden = all ? 0 : Math.max(0, messages.length - WINDOW)
  const groups = useMemo(() => group(messages.slice(hidden)), [messages, hidden])
  return (
    <AnimatePresence initial={false}>
      {hidden > 0 && (
        <Line key="older" ch="↑" go={null} onClick={() => setAll(true)}>
          <span className="meta">{hidden} messages plus anciens</span>
        </Line>
      )}
      {groups.map((g, i) =>
        g.kind === 'steps' ? (
          <Appear key={g.id}>
            <Steps steps={g.steps} live={working && i === groups.length - 1} />
          </Appear>
        ) : (
          <Appear key={g.m.id}>
            <div className={`msg band ${g.m.role === 'user' ? 'tone' : g.m.role === 'orchestrator' ? 'tone orch' : ''}`}>
              <div className="in">
                <span className="who">
                  {g.m.role === 'orchestrator' && (
                    <span className="orch-ic" aria-hidden>
                      ◆{' '}
                    </span>
                  )}
                  {g.m.role === 'user' ? 'toi' : g.m.role === 'orchestrator' ? 'weevils' : author}
                </span>
                {g.m.role === 'user' ? <Clamp text={userText(g.m.text)} /> : g.m.role === 'orchestrator' ? <Clamp text={g.m.text} /> : <Prose text={g.m.text} />}
              </div>
            </div>
          </Appear>
        ),
      )}
    </AnimatePresence>
  )
}

/** L'agent travaille : une ligne vivante en bas du fil. */
export function Working({ author, since }: { author: string; since?: number | null }) {
  const { now } = useApp()
  return (
    <motion.div className="msg band working" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring}>
      <div className="in">
        <span className="who">
          <span className="spin fluo">*</span> {author} travaille{since ? ` · ${dur(now - since)}` : ''}
          <span className="dots" aria-hidden>
            <i>·</i>
            <i>·</i>
            <i>·</i>
          </span>
        </span>
      </div>
    </motion.div>
  )
}
