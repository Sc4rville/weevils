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
