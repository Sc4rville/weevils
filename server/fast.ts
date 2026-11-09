// Modèle rapide et voix, sans API payante : claude -p --model haiku sur l'abonnement, edge-tts pour la voix.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Une réponse courte de haiku : sans outils, sans session gardée. ~1,6 s mesuré sur le VPS. */
export function haiku(prompt: string, timeout = 20_000): Promise<string> {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const c = execFile('claude', ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', prompt], { timeout, maxBuffer: 1 << 20, cwd: os.tmpdir() }, (err, stdout) => {
      console.log(`[rapide] haiku ${Date.now() - t0} ms${err ? ' · échec' : ''}`)
      if (err) reject(err)
      else resolve(stdout.toString().trim())
    })
    c.stdin?.end()
  })
}

/** Voix française gratuite (voix neuronales Microsoft via edge-tts), débit +25 %. MP3. */
export function tts(text: string, voice = 'fr-FR-RemyMultilingualNeural'): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `wv-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`)
  const bin = path.join(os.homedir(), '.local', 'bin', 'edge-tts')
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    execFile(bin, ['--voice', voice, '--rate=+25%', '--text', text, '--write-media', out], { timeout: 20_000 }, (err) => {
      console.log(`[rapide] voix ${Date.now() - t0} ms${err ? ' · échec' : ''}`)
      if (err) return reject(err)
      try {
        resolve(fs.readFileSync(out))
      } finally {
        fs.rmSync(out, { force: true })
      }
    })
  })
}

// ---------------------------------------------------------------- Cartesia (Sonic, streaming)

/** Clé et réglages lus dans l'environnement du service (EnvironmentFile ~/.config/weevils/env). */
export const cartesia = () => (process.env.CARTESIA_API_KEY ? { key: process.env.CARTESIA_API_KEY, model: process.env.CARTESIA_MODEL ?? 'sonic-2', voice: process.env.CARTESIA_VOICE_ID } : null)

let frVoice: string | undefined
async function frenchVoice(key: string): Promise<string> {
  if (frVoice) return frVoice
  const res = await fetch('https://api.cartesia.ai/voices?language=fr&limit=20', { headers: { 'X-API-Key': key, 'Cartesia-Version': '2025-04-16' } })
  const j = (await res.json()) as { data?: { id: string; language?: string }[] } | { id: string; language?: string }[]
  const list = Array.isArray(j) ? j : (j.data ?? [])
  frVoice = list.find((v) => v.language === 'fr')?.id ?? list[0]?.id
  if (!frVoice) throw new Error('aucune voix française Cartesia')
  return frVoice
}

/** Voix choisie par Scarville dans l'app (persistée par le daemon). */
let chosenVoice: string | undefined
export const setCartesiaVoice = (id: string | undefined) => (chosenVoice = id)

export interface VoiceChoice {
  id: string
  name: string
  gender?: string
}

/** 6 à 8 voix françaises variées : on alterne femmes et hommes, dans l'ordre de l'API. */
export async function frenchVoices(): Promise<VoiceChoice[]> {
  const c = cartesia()
  if (!c) throw new Error('clé Cartesia absente')
  const res = await fetch('https://api.cartesia.ai/voices?language=fr&limit=100', { headers: { 'X-API-Key': c.key, 'Cartesia-Version': '2025-04-16' } })
  if (!res.ok) throw new Error(`cartesia : ${res.status}`)
  const j = (await res.json()) as any
  const all = ((Array.isArray(j) ? j : (j.data ?? [])) as any[]).filter((v) => !v.language || v.language === 'fr')
  const pick = (g: string) => all.filter((v) => (v.gender ?? '').toLowerCase().startsWith(g))
  const f = pick('f'), m = pick('m'), other = all.filter((v) => !f.includes(v) && !m.includes(v))
  const out: any[] = []
  for (let i = 0; out.length < 8 && (i < f.length || i < m.length || i < other.length); i++) for (const list of [f, m, other]) if (list[i] && out.length < 8) out.push(list[i])
  return out.map((v) => ({ id: v.id, name: String(v.name ?? v.id).split(/[-–(]/)[0].trim(), gender: v.gender }))
}

/** Flux MP3 de Cartesia : les premiers octets arrivent en quelques centaines de ms, on les relaie tels quels. */
export async function cartesiaStream(text: string, voiceId?: string): Promise<ReadableStream<Uint8Array>> {
  const c = cartesia()
  if (!c) throw new Error('CARTESIA_API_KEY absente')
  const t0 = Date.now()
  const res = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: { 'X-API-Key': c.key, 'Cartesia-Version': '2025-04-16', 'content-type': 'application/json' },
    body: JSON.stringify({
      model_id: c.model,
      transcript: text,
      voice: { mode: 'id', id: voiceId ?? chosenVoice ?? c.voice ?? (await frenchVoice(c.key)) },
      language: 'fr',
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    }),
  })
  if (!res.ok || !res.body) throw new Error(`cartesia : ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
  console.log(`[rapide] cartesia premiers octets ${Date.now() - t0} ms`)
  return res.body
}
