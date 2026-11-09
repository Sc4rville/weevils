// Les repos GitHub du compte : liste, lecture à distance (arborescence, fichier), création. Tout passe par `gh`, déjà connecté.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GithubRepo } from '../shared/api.ts'

function gh(args: string[], cwd?: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim().split('\n').pop() || err.message))
      else resolve(stdout.toString())
    })
  })
}

let owner: string | null = process.env.WEEVILS_GH_OWNER ?? null
export async function ghOwner(): Promise<string> {
  if (!owner) owner = (await gh(['api', 'user', '-q', '.login'])).trim()
  return owner
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
export const validRepoName = (name: string) => NAME.test(name) && name !== '.' && name !== '..'

let cache: { at: number; list: GithubRepo[] } | null = null

export async function listRepos(force = false): Promise<GithubRepo[]> {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache.list
  const who = await ghOwner()
  const raw = JSON.parse(await gh(['repo', 'list', who, '--limit', '300', '--json', 'name,description,isPrivate,pushedAt,primaryLanguage'])) as any[]
  const list: GithubRepo[] = raw
    .map((r) => ({
      name: String(r.name),
      description: String(r.description ?? ''),
      isPrivate: !!r.isPrivate,
      pushedAt: r.pushedAt ? Date.parse(r.pushedAt) : 0,
      language: r.primaryLanguage?.name ?? undefined,
    }))
    .sort((a, b) => b.pushedAt - a.pushedAt)
  cache = { at: Date.now(), list }
  return list
}

export function forgetRepos() {
  cache = null
}

/** Fichiers d'un repo non cloné, lus sur GitHub. */
export async function remoteFiles(repo: string): Promise<string[]> {
  if (!validRepoName(repo)) throw new Error('repo invalide')
  const who = await ghOwner()
  const out = JSON.parse(await gh(['api', `repos/${who}/${repo}/git/trees/HEAD?recursive=1`])) as { tree?: { path: string; type: string }[] }
  return (out.tree ?? []).filter((e) => e.type === 'blob').map((e) => e.path).slice(0, 20000)
}

export async function remoteFile(repo: string, rel: string): Promise<{ path: string; size: number; binary: boolean; content: string; truncated: boolean }> {
  if (!validRepoName(repo)) throw new Error('repo invalide')
  if (!rel || rel.split('/').some((s) => !s || s === '..')) throw new Error('chemin refusé')
  const who = await ghOwner()
  const out = JSON.parse(await gh(['api', `repos/${who}/${repo}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`])) as { size?: number; content?: string; encoding?: string }
  const buf = out.encoding === 'base64' && out.content ? Buffer.from(out.content.replace(/\n/g, ''), 'base64') : Buffer.alloc(0)
  const max = 400_000
  const binary = buf.subarray(0, 8000).includes(0)
  return { path: rel, size: out.size ?? buf.length, binary, content: binary ? '' : buf.subarray(0, max).toString('utf8'), truncated: buf.length > max }
}

/** Nouveau repo privé, cloné dans `root`, avec un README qui porte le nom et la phrase. */
export async function createRepo(name: string, description: string, root: string): Promise<{ name: string; dir: string }> {
  if (!validRepoName(name)) throw new Error('nom de repo invalide')
  const dir = path.join(root, name)
  if (fs.existsSync(dir)) throw new Error(`${name} existe déjà dans ${root}`)
  const who = await ghOwner()
  const args = ['repo', 'create', `${who}/${name}`, '--private', '--clone']
  if (description.trim()) args.push('--description', description.trim().slice(0, 300))
  await gh(args, root, 90_000)
  if (!fs.existsSync(dir)) throw new Error('clone absent après création')
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n${description.trim() ? `\n${description.trim()}\n` : ''}`)
  const git = (a: string[]) =>
    new Promise<void>((resolve, reject) => execFile('git', ['-C', dir, ...a], { timeout: 60_000 }, (err, _o, stderr) => (err ? reject(new Error(stderr?.toString().trim() || err.message)) : resolve())))
  await git(['add', 'README.md'])
  await git(['commit', '-q', '-m', 'init'])
  await git(['push', '-q', '-u', 'origin', 'HEAD'])
  forgetRepos()
  return { name, dir }
}

// ---------------------------------------------------------------- une phrase humaine par repo

const BLURB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'blurb'], properties: { name: { type: 'string' }, blurb: { type: 'string' } } } } },
}

let blurbs: Record<string, string> | null = null
let blurbing = false

function blurbFile(dataDir: string) {
  return path.join(dataDir, 'repo-blurbs.json')
}

export function loadBlurbs(dataDir: string): Record<string, string> {
  if (blurbs) return blurbs
  try {
    blurbs = JSON.parse(fs.readFileSync(blurbFile(dataDir), 'utf8')) as Record<string, string>
  } catch {
    blurbs = {}
  }
  return blurbs
}

async function readmeOf(repo: string, roots: string[]): Promise<string> {
  for (const root of roots) {
    for (const f of ['README.md', 'readme.md', 'README']) {
      try {
        return fs.readFileSync(path.join(root, repo, f), 'utf8')
      } catch {
        /* pas ici */
      }
    }
  }
  try {
    return (await remoteFile(repo, 'README.md')).content
  } catch {
    return ''
  }
}

/**
 * Écrit, une fois par repo et en cache, la phrase qui dit ce que c'est (« le jeu mobile de Scarville »), à partir du README et de la
 * description. Tourne en fond ; `onDone` quand de nouvelles phrases sont là.
 */
export async function describeRepos(list: GithubRepo[], roots: string[], dataDir: string, onDone: () => void) {
  const have = loadBlurbs(dataDir)
  const todo = list.filter((r) => !have[r.name])
  if (!todo.length || blurbing) return
  blurbing = true
  try {
    const workdir = path.join(dataDir, 'blurbs')
    fs.mkdirSync(workdir, { recursive: true })
    for (let i = 0; i < todo.length; i += 12) {
      const batch = todo.slice(i, i + 12)
      const items = []
      for (const r of batch) {
        const readme = (await readmeOf(r.name, roots)).replace(/\s+/g, ' ').trim().slice(0, 1200)
        items.push({ name: r.name, description: r.description, readme, langage: r.language ?? '' })
      }
      const schemaFile = path.join(workdir, 'schema.json')
      const outFile = path.join(workdir, `out-${Date.now()}.json`)
      fs.writeFileSync(schemaFile, JSON.stringify(BLURB_SCHEMA))
      const prompt = [
        'Pour chaque repo GitHub de Scarville, écris en français UNE phrase courte (3 à 8 mots, minuscule initiale, sans point final) qui dit ce que c’est, comme on le dirait à un ami : « le jeu mobile de Scarville », « le site des cours de surf », « l’app qui pilote ses agents ».',
        'Jamais de jargon ni de liste de technologies, jamais le nom du repo recopié, jamais la description brute. Si le README ne dit rien de clair, devine d’après le nom et reste sobre (ex. « un essai mis de côté »).',
        'Ne lis aucun fichier, ne lance aucune commande : réponds directement.',
        '',
        JSON.stringify(items),
      ].join('\n')
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          'codex',
          ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--output-schema', schemaFile, '-o', outFile, '-c', 'model_reasoning_effort="low"', prompt],
          { cwd: workdir, timeout: 240_000, maxBuffer: 16 << 20 },
          (err, _o, stderr) => (err ? reject(new Error(stderr?.toString().slice(-300) || err.message)) : resolve()),
        )
        child.stdin?.end()
      })
      const raw = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { items: { name: string; blurb: string }[] }
      fs.rmSync(outFile, { force: true })
      for (const x of raw.items) if (x.blurb?.trim() && batch.some((b) => b.name === x.name)) have[x.name] = x.blurb.trim().replace(/[.。]\s*$/, '').slice(0, 90)
      fs.writeFileSync(blurbFile(dataDir), JSON.stringify(have, null, 1))
      onDone()
    }
  } catch (e) {
    console.error(`[repos] phrases : ${(e as Error).message}`)
  } finally {
    blurbing = false
  }
}
