// Couche vocale rapide : Scarville parle au logo, une réponse humaine arrive tout de suite.
// Question d'état → répondue seule depuis l'instantané ; action → « ok je m'en occupe » et le message part à weevboss.

import type { Snapshot } from '../shared/api.ts'
import { haiku } from './fast.ts'

export interface VoiceVerdict {
  kind: 'answer' | 'action'
  say: string
}

/** L'état des sessions, compact, lisible par un petit modèle. */
export function digestSnapshot(snap: Snapshot): string {
  const names = new Map(snap.projects.map((p) => [p.id, p.name]))
  const label: Record<string, string> = { working: 'travaille', needs_user: 'attend Scarville', idle: 'disponible', done: 'terminée' }
  const lines = snap.sessions
    .filter((s) => s.status !== 'done' || Date.now() - s.lastActivityAt < 6 * 3600_000)
    .slice(0, 25)
    .map((s) => `- ${names.get(s.projectId) ?? s.projectId} · « ${s.title} » · ${label[s.status]}${s.now ? ` · en ce moment : ${s.now}` : ''}${s.attention ? ` · question : ${s.attention}` : ''}${s.lastMessage ? ` · dernier message : ${s.lastMessage.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`)
  const last = snap.main.filter((m) => m.role === 'assistant').at(-1)
  return [`weevboss (l'orchestrateur) ${snap.mainWorking ? 'travaille' : 'est disponible'}${last ? ` · sa dernière réponse : ${last.text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`, ...lines].join('\n')
}

export async function voiceTurn(text: string, snap: Snapshot): Promise<VoiceVerdict> {
  const system = [
    'Tu es la voix de weevboss, l’assistant de Scarville qui pilote ses sessions de code (Claude, Codex). Tu réponds à l’oral, en français, une seule phrase courte, comme un pote.',
    'Si Scarville pose une question sur l’état (« ça dit quoi », « mygame en est où », « qui m’attend »), réponds toi-même à partir de l’état ci-dessous : kind = answer.',
    'Si Scarville demande une action (coder, corriger, envoyer, créer, lancer, changer quelque chose), kind = action et say = une phrase du genre « ok, je m’en occupe » adaptée (ex. « ok, je lance ça sur mygame »).',
    'Jamais d’identifiant, de chemin, de nom de fichier ni de liste. Réponds en JSON : {"kind": "answer" | "action", "say": "..."}.',
    '',
    'État actuel :',
    digestSnapshot(snap),
  ].join('\n')
  const raw = await haiku(`${system}

Scarville dit : « ${text} »

Réponds uniquement avec le JSON.`)
  const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1) || '{}') as Partial<VoiceVerdict>
  const kind = out.kind === 'answer' ? 'answer' : 'action'
  return { kind, say: (out.say ?? (kind === 'action' ? 'Ok, je m’en occupe.' : '')).trim().slice(0, 300) || 'Ok, je m’en occupe.' }
}
