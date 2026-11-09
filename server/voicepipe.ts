// La voix de weevboss, au plus court : chaque étape mesurée, rien n'attend ce qui peut partir tout de suite.
//
//   parole ──(morceaux envoyés pendant l'enregistrement)──▶ transcription ──▶ weevboss (le vrai, mêmes outils)
//   réponse ──▶ courte ? lue telle quelle : résumé en flux, 1re phrase envoyée à Cartesia sans attendre la suite
//   audio ──(flux HTTP, la lecture démarre au premier morceau)──▶ téléphone
//
// Et pour Siri / le bouton Action : /api/voice/turn, authentifié par un jeton personnel.

import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { DATA_DIR, PUBLIC_URL, USER } from './config.ts'
import { cartesia, cartesiaStream, tts } from './fast.ts'
import { openaiKey, transcribe } from './transcribe.ts'

const log = (s: string) => console.log(`[voix] ${s}`)

// ---------------------------------------------------------------- texte à dire

const clean = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/https?:\/\/\S+/g, 'un lien')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)

/** Déjà dicible : court, sans chemin, sans identifiant ni code. Pas besoin de résumé. */
export const sayable = (text: string) => text.length <= 220 && !/[/\\]\w|\b[0-9a-f]{7,}\b|\w+\.(ts|tsx|js|md|json|sh|py)\b|\n[-*] /i.test(text)

const ORAL = `Résume ce message pour le dire à voix haute à ${USER}, en une ou deux phrases courtes en français, parlé, comme un pote. Dis ce qui a été fait ou ce qui se passe. Aucun identifiant, chemin, nom de fichier, commande ni liste. Réponds seulement avec la phrase à dire.`

/** Résumé oral en flux : la première phrase est rendue dès qu'elle est complète, puis le reste. */
async function* oralStream(text: string): AsyncGenerator<string> {
  const key = openaiKey()
  if (!key) {
    yield text.slice(0, 300)
    return
  }
  const t0 = Date.now()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', stream: true, max_tokens: 120, temperature: 0.4, messages: [{ role: 'system', content: ORAL }, { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok || !res.body) {
    yield text.slice(0, 300)
    return
  }
  let buf = ''
  let pending = ''
  let first = true
  const dec = new TextDecoder()
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = /^data: (.*)$/.exec(line.trim())
      if (!m || m[1] === '[DONE]') continue
      try {
        pending += JSON.parse(m[1]).choices?.[0]?.delta?.content ?? ''
      } catch {
        /* ligne partielle */
      }
      // Une phrase complète (assez longue pour sonner naturelle) part tout de suite.
      const cut = first ? pending.search(/[.!?…](\s|$)/) : -1
      if (cut >= 12) {
        log(`résumé : 1re phrase en ${Date.now() - t0} ms`)
        yield pending.slice(0, cut + 1).trim()
        pending = pending.slice(cut + 1)
        first = false
      }
    }
  }
  if (pending.trim()) {
    if (first) log(`résumé complet en ${Date.now() - t0} ms`)
    yield pending.trim()
  }
}

// ---------------------------------------------------------------- audio

/** Un en-tête ID3 en tête de flux MP3 : on le saute pour les morceaux suivants (un seul MP3 continu). */
function skipId3(b: Uint8Array): Uint8Array {
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
    return b.subarray(10 + size)
  }
  return b
}

async function pipeSentence(out: http.ServerResponse, sentence: string, voice: string | undefined, index: number, t0: number) {
  if (cartesia()) {
    const stream = await cartesiaStream(sentence, voice)
    let firstChunk = true
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      if (firstChunk && index === 0) log(`premiers octets envoyés au téléphone ${Date.now() - t0} ms après la demande`)
      out.write(firstChunk && index > 0 ? skipId3(chunk) : chunk)
      firstChunk = false
    }
  } else {
    const mp3 = await tts(sentence)
    out.write(index > 0 ? skipId3(mp3) : mp3)
  }
}

/** Lit la réponse en flux : la lecture démarre côté téléphone dès le premier morceau. */
export async function speakStream(res: http.ServerResponse, text: string, oral: boolean, voice?: string) {
  const t0 = Date.now()
  const input = clean(text)
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'transfer-encoding': 'chunked' })
  let i = 0
  try {
    if (oral || sayable(input)) {
      if (!oral) log('réponse déjà courte : lue sans résumé')
      await pipeSentence(res, input, voice, i++, t0)
    } else {
      for await (const sentence of oralStream(input)) await pipeSentence(res, sentence, voice, i++, t0)
    }
  } catch (e) {
    log(`lecture : ${(e as Error).message}`)
  }
  log(`son complet en ${Date.now() - t0} ms`)
  res.end()
}

/** Tout le son d'une phrase, en mémoire (Siri télécharge un fichier). */
async function synth(text: string, voice?: string): Promise<Buffer> {
  if (!cartesia()) return tts(text)
  const parts: Uint8Array[] = []
  for await (const c of (await cartesiaStream(text, voice)) as unknown as AsyncIterable<Uint8Array>) parts.push(c)
  return Buffer.concat(parts)
}

// ---------------------------------------------------------------- accroches en cache

const CUES = ['Ok.', 'Je regarde.', 'Ça marche.', 'Je m’en occupe.']
const cueDir = path.join(DATA_DIR, 'voice-cache')

/** Une accroche courte, déjà générée avec la voix choisie : jouée dès l'envoi, sans attendre personne. */
export async function cue(voice: string | undefined, n = Math.floor(Math.random() * CUES.length)): Promise<Buffer> {
  fs.mkdirSync(cueDir, { recursive: true })
  const file = path.join(cueDir, `${(voice ?? 'defaut').replace(/[^\w-]/g, '')}-${n}.mp3`)
  try {
    return fs.readFileSync(file)
  } catch {
    const mp3 = await synth(CUES[n], voice)
    fs.writeFileSync(file, mp3)
    return mp3
  }
}

/** Prépare toutes les accroches d'une voix (au choix de la voix, au démarrage). */
export function warmCues(voice: string | undefined) {
  void (async () => {
    for (let n = 0; n < CUES.length; n++) await cue(voice, n).catch(() => undefined)
  })()
}

// ---------------------------------------------------------------- enregistrement envoyé en morceaux

const uploads = new Map<string, { type: string; parts: Buffer[]; at: number }>()

export function addChunk(id: string, seq: number, type: string, data: string) {
  if (!/^[\w-]{6,64}$/.test(id)) throw new Error('enregistrement invalide')
  const u = uploads.get(id) ?? { type, parts: [], at: Date.now() }
  u.parts[seq] = Buffer.from(data, 'base64')
  uploads.set(id, u)
  for (const [k, v] of uploads) if (Date.now() - v.at > 10 * 60_000) uploads.delete(k)
}

export async function finishUpload(id: string): Promise<string> {
  const u = uploads.get(id)
  if (!u) throw new Error('enregistrement introuvable')
  uploads.delete(id)
  const audio = Buffer.concat(u.parts.filter(Boolean))
  const t0 = Date.now()
  const text = await transcribe(audio, u.type)
  log(`transcription ${Date.now() - t0} ms (${Math.round(audio.length / 1024)} Ko déjà reçus pendant la parole)`)
  return text
}

// ---------------------------------------------------------------- mesures du téléphone

/** Les temps mesurés côté téléphone, mis bout à bout dans le journal. */
export function logMarks(m: Record<string, number>) {
  const d = (a: string, b: string) => (m[a] && m[b] ? `${m[b] - m[a]} ms` : '–')
  log(
    `téléphone · fin de parole → texte ${d('stop', 'text')} · envoi → accroche ${d('send', 'cue')} · envoi → réponse de weevboss ${d('send', 'reply')} · réponse → début du son ${d('reply', 'play')} · total fin de parole → son ${d('stop', 'play')}`,
  )
}

// ---------------------------------------------------------------- connexions gardées chaudes

/** Les connexions TLS vers Cartesia et OpenAI restent ouvertes (keep-alive) : pas de poignée de main au moment de parler. */
export function keepWarm() {
  const ping = () => {
    const c = cartesia()
    if (c) void fetch('https://api.cartesia.ai/voices?limit=1', { headers: { 'X-API-Key': c.key, 'Cartesia-Version': '2025-04-16' } }).then((r) => r.arrayBuffer()).catch(() => undefined)
    const k = openaiKey()
    if (k) void fetch('https://api.openai.com/v1/models/gpt-4o-mini', { headers: { authorization: `Bearer ${k}` } }).then((r) => r.arrayBuffer()).catch(() => undefined)
  }
  ping()
  setInterval(ping, 50_000).unref()
}

// ---------------------------------------------------------------- Siri, bouton Action : un tour de parole complet

const tokenFile = path.join(DATA_DIR, 'shortcut-token')
export const shortcutToken = () => {
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim()
  } catch {
    return ''
  }
}
export function newShortcutToken() {
  const t = crypto.randomBytes(24).toString('base64url')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(tokenFile, t, { mode: 0o600 })
  return t
}
export function shortcutAuthed(req: http.IncomingMessage, url: URL) {
  const t = shortcutToken()
  if (!t) return false
  const given = url.searchParams.get('k') ?? /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
  return given.length === t.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(t))
}

const clips = new Map<string, { mp3: Buffer; at: number }>()
export const clip = (id: string) => clips.get(id)?.mp3

export interface Orchestrator {
  sendMain(text: string): Promise<unknown>
  /** Attend la réponse écrite de weevboss à un message envoyé à `since`. */
  waitMainReply(since: number, timeoutMs: number): Promise<string | null>
  voiceId?: string
}

/**
 * Un tour depuis Siri : la phrase part à weevboss exactement comme un message tapé (mêmes outils : il écrit aux sessions,
 * en ouvre, lit leur état). On attend sa vraie réponse, puis on renvoie la version orale et l'adresse du son.
 */
export async function voiceTurn(w: Orchestrator, input: { text?: string; audio?: string; type?: string }) {
  const t0 = Date.now()
  let text = (input.text ?? '').trim()
  if (!text && input.audio) text = await transcribe(Buffer.from(input.audio, 'base64'), input.type ?? 'audio/mp4')
  if (!text) throw new Error('rien entendu')
  if (/^(stop|arrête|c’est bon|c'est bon|merci)[.!]?$/i.test(text)) return { done: true, say: 'À plus.', text }
  const since = Date.now()
  await w.sendMain(text)
  const reply = await w.waitMainReply(since, 100_000)
  log(`Siri · weevboss a répondu en ${Date.now() - since} ms`)
  const said = reply ? (sayable(clean(reply)) ? clean(reply) : await collect(oralStream(clean(reply)))) : 'C’est parti, il y travaille encore.'
  const id = crypto.randomBytes(9).toString('base64url')
  clips.set(id, { mp3: await synth(said, w.voiceId), at: Date.now() })
  for (const [k, v] of clips) if (Date.now() - v.at > 15 * 60_000) clips.delete(k)
  log(`Siri · tour complet en ${Date.now() - t0} ms`)
  const base = PUBLIC_URL || ''
  return { done: false, text, reply: reply ?? '', say: said, audio: `${base}/api/voice/clip/${id}.mp3?k=${shortcutToken()}` }
}

async function collect(g: AsyncGenerator<string>) {
  let s = ''
  for await (const part of g) s += (s ? ' ' : '') + part
  return s
}
