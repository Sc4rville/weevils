// Dictée depuis le téléphone : l'audio enregistré dans l'app est transcrit par OpenAI (le même moteur que la dictée du PC).
// Pas de « prompt » de transcription : il est recraché mot pour mot à la place de la voix (prouvé le 2026-08-02).

import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR, HOME } from './config.ts'
import { haiku, tts } from './fast.ts'

/** Clé lue dans ~/.config/weevils/env, sinon dans la config de la dictée du PC. Jamais dans le code ni dans les logs. */
export function openaiKey(): string | undefined {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  for (const file of [path.join(CONFIG_DIR, 'env'), path.join(HOME, '.config', 'dictee', 'env')]) {
    try {
      const m = /^OPENAI_API_KEY=["']?([^"'\n]+)/m.exec(fs.readFileSync(file, 'utf8'))
      if (m) return m[1].trim()
    } catch {
      /* pas de fichier */
    }
  }
  return undefined
}

const EXT: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' }

export async function transcribe(data: Buffer, mime: string): Promise<string> {
  const key = openaiKey()
  if (!key) throw new Error('transcription non configurée sur le serveur')
  const type = mime.split(';')[0].trim() || 'audio/mp4'
  const form = new FormData()
  form.append('file', new Blob([data], { type }), `voix.${EXT[type] ?? 'm4a'}`)
  form.append('model', 'gpt-4o-mini-transcribe')
  form.append('language', 'fr')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `transcription : erreur ${res.status}`)
  }
  const out = (await res.json()) as { text?: string }
  return (out.text ?? '').trim()
}

/** Voix de weevboss : version orale courte (haiku, abonnement), lue par edge-tts (gratuit). MP3. */
export async function speak(text: string, oral = false): Promise<Buffer> {
  const input = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/https?:\/\/\S+/g, 'un lien')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)
  const said = oral ? input : await toOral(input).catch(() => input.slice(0, 300))
  return tts(said)
}

/** La version à dire : une ou deux phrases, comme à un pote, sans ids, chemins, fichiers ni listes. */
async function toOral(text: string): Promise<string> {
  const out = await haiku(`Résume ce message pour le dire à voix haute à Scarville, en une ou deux phrases courtes en français, parlé, comme un pote. Aucun identifiant, chemin, nom de fichier, commande ni liste. Réponds seulement avec la phrase à dire.\n\n${text}`)
  return out.slice(0, 400) || text.slice(0, 300)
}
