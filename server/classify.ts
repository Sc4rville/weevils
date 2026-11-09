// Classement des conversations, en trois étages :
// 1. règles (gratuit, instantané) : un nom de projet ou de repo apparaît dans l'échange ;
// 2. juge LLM sur l'abonnement (codex exec éphémère) pour le reste, par lots, avec les corrections de l'utilisateur en exemples ;
// 3. rien de sûr → « à ranger », c'est l'utilisateur qui tranche.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { USER } from './config.ts'

export interface CatalogEntry {
  id: string
  name: string
  repos: string[]
  about?: string
}

export interface Verdict {
  id: string
  project: string | null
  confidence: number
  reason: string
}

const norm = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

/** Mots trop courants pour désigner un projet à eux seuls. */
const STOP = new Set(['ok', 'oss', 'app', 'web', 'api', 'test', 'demo', 'site', 'new', 'the', 'les', 'des', 'pour', 'dev', 'main', 'general', 'divers', 'life', 'maman', 'obs'])

export function ruleMatch(text: string, catalog: CatalogEntry[]): { id: string; confidence: number; reason: string } | null {
  const n = norm(text)
  let best: { id: string; score: number; term: string } | null = null
  for (const p of catalog) {
    for (const term of new Set([p.name, ...p.repos])) {
      const t = norm(term).trim()
      if (t.length < 3 || STOP.has(t)) continue
      if (n.includes(` ${t} `) && (!best || t.length > best.score)) best = { id: p.id, score: t.length, term }
    }
  }
  return best ? { id: best.id, confidence: 0.8, reason: `« ${best.term} » apparaît dans l’échange` } : null
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
        required: ['id', 'project', 'confidence', 'reason'],
        properties: {
          id: { type: 'string' },
          project: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

export async function llmClassify(
  items: { id: string; title: string; excerpt: string }[],
  catalog: CatalogEntry[],
  examples: { title: string; projectId: string }[],
  workdir: string,
): Promise<Verdict[]> {
  fs.mkdirSync(workdir, { recursive: true })
  const schemaFile = path.join(workdir, 'schema.json')
  const outFile = path.join(workdir, `out-${Date.now()}.json`)
  fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA))
  const prompt = [
    `Tu ranges des conversations (ChatGPT, Claude) dans les projets de ${USER}. Ne lis aucun fichier, ne lance aucune commande : réponds directement.`,
    '',
    'Les seules destinations possibles sont les projets ci-dessous (id : nom · repos · description). Un thème (« design », « argent », « santé ») n’est pas un projet : n’invente jamais de catégorie.',
    ...catalog.map((p) => `- ${p.id} : ${p.name}${p.repos.length ? ` · ${p.repos.slice(0, 8).join(', ')}` : ''}${p.about ? ` · ${p.about}` : ''}`),
    examples.length ? `\nRangements validés par ${USER} (à imiter) :\n${examples.map((e) => `- « ${e.title} » → ${e.projectId}`).join('\n')}` : '',
    '',
    `Pour chaque conversation, lis l’extrait (premiers messages de ${USER}, puis la fin) et juge de quoi elle parle vraiment :`,
    `- project = l’id d’un projet de la liste dont la conversation relève clairement, sinon null. Dans le doute, null : ${USER} tranchera.`,
    '- confidence entre 0 et 1 (≥ 0.7 seulement si c’est évident) ; reason = une phrase courte en français qui cite l’indice décisif.',
    '',
    'Conversations :',
    JSON.stringify(items.map((i) => ({ id: i.id, titre: i.title, extrait: i.excerpt }))),
  ].join('\n')
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'codex',
      ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--output-schema', schemaFile, '-o', outFile, '-c', 'model_reasoning_effort="low"', prompt],
      { cwd: workdir, timeout: 240_000, maxBuffer: 16 << 20 },
      (err, _out, stderr) => (err ? reject(new Error(stderr?.toString().slice(-300) || err.message)) : resolve()),
    )
    // Sans entrée fermée, codex exec attend la suite du prompt sur stdin.
    child.stdin?.end()
  })
  const raw = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { items: { id: string; project: string | null; confidence: number; reason: string }[] }
  fs.rmSync(outFile, { force: true })
  return raw.items.map((x) => ({ id: x.id, project: x.project, confidence: x.confidence, reason: x.reason }))
}
