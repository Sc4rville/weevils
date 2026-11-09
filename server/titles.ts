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

/** Raccourci au mot entier (pas de phrase coupée en plein milieu) : une ligne de téléphone, ~40 caractères. */
export const shortNow = (s: string, max = 40) => {
  const t = s.replace(/\s+/g, ' ').replace(/[.。]\s*$/, '').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > max / 2 ? cut.slice(0, sp) : t.slice(0, max)).replace(/[\s,;:·–-]+$/, '')
}

export async function llmTitles(items: TitleInput[], workdir: string): Promise<{ id: string; title: string; now: string }[]> {
  fs.mkdirSync(workdir, { recursive: true })
  const schemaFile = path.join(workdir, 'schema.json')
  const outFile = path.join(workdir, `out-${Date.now()}.json`)
  fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA))
  const prompt = [
    'Tu nommes des sessions d’agents de code (Claude Code, Codex) pour que Scarville comprenne d’un coup d’œil, sur son téléphone, de quoi chacune parle. Ne lis aucun fichier, ne lance aucune commande : réponds directement.',
    '',
    'Pour chaque session, à partir de son début et de ses derniers échanges :',
    '- title : le THÈME de la session, ce sur quoi on bosse dedans, en français, 2 à 5 mots, très court, style note perso (ex. « UX de weevils », « code d’accès iPhone », « perf du jeu », « mails prospects »). Sans point final, sans guillemets, sans « session » ni « conversation », jamais le premier message mot pour mot. Un titre stable : si le thème général n’a pas changé, garde le même esprit.',
    '- now : la dernière chose faite ou en cours, ≤ 5 mots et ≤ 40 caractères (elle doit tenir sur une ligne de téléphone), en français, au présent, sans sujet (ex. « corrige le détecteur d’écran », « déploie sur le VPS »).',
    'Si les derniers échanges partent sur un autre thème que le début, c’est le nouveau thème qui compte.',
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
  return raw.items.filter((x) => x.title?.trim()).map((x) => ({ id: x.id, title: clean(x.title, 42), now: shortNow(x.now ?? '') }))
}

/** Faut-il (re)nommer cette session ? Un nouveau titre quand le fil a avancé, pas à chaque message. */
export function needsTitle(prev: Titled | undefined, messageCount: number, live: boolean, now: number): boolean {
  if (messageCount < 2) return false
  if (!prev) return true
  const grown = messageCount - prev.messageCount
  if (grown <= 0) return false
  const age = now - prev.at
  // Activité effacée par un nouveau message : à réécrire tout de suite.
  if (!prev.now && live) return true
  // Pendant le travail, l'activité suit : toutes les 2 min dès que le fil a bougé.
  if (live) return age >= 2 * 60_000
  // Session finie : un dernier titre quand le fil a bougé depuis.
  return age >= 2 * 60_000
}
