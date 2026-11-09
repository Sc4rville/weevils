// Renommage des sessions : le titre dit de quoi la session parle MAINTENANT (son dernier bloc), pas son premier message.
// Juge LLM sur l'abonnement (codex exec éphémère, comme le classement), par lots, sans coût d'API.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface TitleInput {
  id: string
  tool: string
  /** Repo ou dossier, pour le contexte. */
  where: string
  debut: string
  recents: string[]
}

export interface Titled {
  title: string
  now: string
  /** Quand le titre a été écrit, et sur combien de messages : pour savoir quand renommer à nouveau. */
  at: number
  messageCount: number
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'now'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          now: { type: 'string' },
        },
      },
    },
  },
}

const clean = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').replace(/[.。]\s*$/, '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export async function llmTitles(items: TitleInput[], workdir: string): Promise<{ id: string; title: string; now: string }[]> {
  fs.mkdirSync(workdir, { recursive: true })
  const schemaFile = path.join(workdir, 'schema.json')
  const outFile = path.join(workdir, `out-${Date.now()}.json`)
  fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA))
  const prompt = [
    'Tu nommes des sessions d’agents de code (Claude Code, Codex) pour que Scarville comprenne d’un coup d’œil, sur son téléphone, de quoi chacune parle. Ne lis aucun fichier, ne lance aucune commande : réponds directement.',
    '',
    'Pour chaque session, à partir de son début et surtout de ses DERNIERS échanges :',
    '- title : de quoi la session parle maintenant, en français, 3 à 6 mots, concret, sans point final, pas de guillemets, pas de « session » ni de « conversation ». Nomme le sujet réel (ex. « faux à toi dans weevils », « code d’accès iPhone », « bande ordre vivant »), jamais le premier message mot pour mot.',
    '- now : ce que la session fait ou vient de faire en ce moment, une phrase courte (≤ 12 mots), en français, au présent, sans sujet redondant (ex. « corrige le détecteur d’écran, tests en cours »).',
    'Si les derniers échanges changent de sujet par rapport au début, c’est le dernier sujet qui compte.',
    '',
    'Sessions :',
    JSON.stringify(items.map((i) => ({ id: i.id, outil: i.tool, ou: i.where, debut: i.debut, derniers_echanges: i.recents }))),
  ].join('\n')
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'codex',
      ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--output-schema', schemaFile, '-o', outFile, '-c', 'model_reasoning_effort="low"', prompt],
      { cwd: workdir, timeout: 180_000, maxBuffer: 16 << 20 },
      (err, _out, stderr) => (err ? reject(new Error(stderr?.toString().slice(-300) || err.message)) : resolve()),
    )
    child.stdin?.end()
  })
  const raw = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { items: { id: string; title: string; now: string }[] }
  fs.rmSync(outFile, { force: true })
  return raw.items.filter((x) => x.title?.trim()).map((x) => ({ id: x.id, title: clean(x.title, 60), now: clean(x.now ?? '', 110) }))
}

/** Faut-il (re)nommer cette session ? Un nouveau titre quand le fil a avancé, pas à chaque message. */
export function needsTitle(prev: Titled | undefined, messageCount: number, live: boolean, now: number): boolean {
  if (messageCount < 2) return false
  if (!prev) return true
  const grown = messageCount - prev.messageCount
  if (grown <= 0) return false
  const age = now - prev.at
  if (live) return grown >= 4 && age >= 4 * 60_000
  // Session finie : un dernier titre quand le fil a bougé depuis.
  return age >= 2 * 60_000
}
