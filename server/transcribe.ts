// Dictée depuis le téléphone : l'audio enregistré dans l'app est transcrit par OpenAI (le même moteur que la dictée du PC).
// Pas de « prompt » de transcription : il est recraché mot pour mot à la place de la voix (prouvé le 2026-08-02).

import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_DIR, HOME } from './config.ts'

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

/** Voix de weevboss : la réponse lue en français par la synthèse d'OpenAI (bien meilleure que celle d'iOS). MP3. */
export async function speak(text: string): Promise<Buffer> {
  const key = openaiKey()
  if (!key) throw new Error('voix non configurée sur le serveur')
  const input = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/https?:\/\/\S+/g, 'un lien')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500)
  const oral = await toOral(input, key).catch(() => input.slice(0, 300))
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'sage', input: oral, speed: 1.25, response_format: 'mp3', instructions: 'Parle en français, voix décontractée et chaleureuse, comme un pote, débit vif.' }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `voix : erreur ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * La version à dire : une ou deux phrases, comme à un pote, sans ids, chemins, fichiers ni listes.
 * Faite par un modèle rapide (claude haiku en ligne de commande, sinon le mini d'OpenAI).
 */
async function toOral(text: string, key: string): Promise<string> {
  const ask = `Résume ce message pour le dire à voix haute à Scarville, en une ou deux phrases courtes en français, parlé, comme un pote. Aucun identifiant, chemin, nom de fichier, commande, chiffre technique ni liste. Réponds seulement avec la phrase à dire.\n\n${text}`
  try {
    const { execFile } = await import('node:child_process')
    const out = await new Promise<string>((resolve, reject) => {
      const c = execFile('claude', ['-p', '--model', 'haiku', ask], { timeout: 20_000, maxBuffer: 1 << 20, cwd: '/tmp' }, (err, stdout) => (err ? reject(err) : resolve(stdout.toString())))
      c.stdin?.end()
    })
    if (out.trim()) return out.trim().slice(0, 400)
  } catch {
    /* claude indisponible : OpenAI */
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: ask }], max_tokens: 120 }),
    signal: AbortSignal.timeout(15_000),
  })
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (j.choices?.[0]?.message?.content ?? '').trim().slice(0, 400) || text.slice(0, 300)
}
