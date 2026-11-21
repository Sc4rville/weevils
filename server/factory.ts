// The split of a factory (docs/automations/PROTOCOL.md, section 9): its source repository, already independent with
// its whole history, gets a private GitHub repository of its own and is pushed there. Run only by the person's unlock.
// Never forced, never over an existing repository, never when a secret pattern shows in its files or its history.
// Pure parts and the flow with an injected `gh` and `git` are tested in factory.test.ts.

import { execFile } from 'node:child_process'

export type Exec = (args: string[], cwd?: string) => Promise<string>

const run = (bin: string, timeout: number): Exec => (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 32 << 20 }, (err, stdout, stderr) => (err ? reject(new Error(stderr?.toString().trim().split('\n').pop() || err.message)) : resolve(stdout.toString())))
  })
export const realGh: Exec = run('gh', 60_000)
/** No hook, no signing, no fsmonitor: the same guard as the source module's own git. */
export const realGit: Exec = (args, cwd) => run('git', 120_000)(['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', ...args], cwd)

/** What must never leave the machine: key blocks, the usual token shapes, credentials in a URL. */
const SECRETS: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['API key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[bpa]-[A-Za-z0-9-]{10,}\b/],
  ['Google key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['credentials in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{3,}@/i],
]
/** The kinds of secret a text shows (their names only: a value is never returned, logged or stored). */
export function secretKinds(text: string): string[] {
  return SECRETS.filter(([, re]) => re.test(text)).map(([name]) => name)
}

/** Every file name and every line the repository ever held (its whole history is what gets pushed). */
export async function scanSource(dir: string, git: Exec = realGit): Promise<string[]> {
  const names = await git(['log', '--all', '--name-only', '--format='], dir)
  const hits = new Set<string>()
  if (/(^|\/)\.env(\.|$)/m.test(names)) hits.add('.env file')
  for (const kind of secretKinds(await git(['log', '--all', '-p', '--format=%B'], dir))) hits.add(kind)
  return [...hits]
}

const NAME = /^[a-z0-9][a-z0-9-]{0,60}$/
export interface Publication { repository: string; url: string }
/** Why a factory was not published; the words are the caller's (server/i18n/optimizers.ts). */
export class FactoryError extends Error {
  readonly code: 'name' | 'secret' | 'origin' | 'taken'
  readonly detail: string
  constructor(code: FactoryError['code'], detail = '') {
    super(code)
    this.code = code
    this.detail = detail
  }
}

/**
 * Creates `<owner>/<name>` private (or `<name>-factory` when the name is taken by something else), points `origin` at
 * it and pushes `main` with its history. Resumable: an origin already pointing at one of those names is pushed again,
 * nothing is created twice. Throws with a plain reason; whatever happens the local repository is left intact.
 */
export async function publishFactory(o: { dir: string; owner: string; name: string; description: string; topics: string[]; gh?: Exec; git?: Exec }): Promise<Publication> {
  const gh = o.gh ?? realGh
  const git = o.git ?? realGit
  if (!NAME.test(o.name) || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(o.owner)) throw new FactoryError('name')
  const secrets = await scanSource(o.dir, git)
  if (secrets.length) throw new FactoryError('secret', secrets.join(', '))
  const candidates = [o.name, `${o.name}-factory`]
  const urlOf = (name: string) => `https://github.com/${o.owner}/${name}.git`
  // The address as recorded, not as a personal URL rewrite (insteadOf) would resolve it.
  const origin = await git(['config', '--get', 'remote.origin.url'], o.dir).then((s) => s.trim(), () => '')
  let name = candidates.find((n) => origin === urlOf(n))
  if (!name) {
    if (origin) throw new FactoryError('origin')
    for (const n of candidates) {
      const exists = await gh(['repo', 'view', `${o.owner}/${n}`, '--json', 'name']).then(() => true, () => false)
      if (exists) continue
      await gh(['repo', 'create', `${o.owner}/${n}`, '--private', '--description', o.description.slice(0, 300)])
      name = n
      break
    }
    if (!name) throw new FactoryError('taken', `${o.owner}/${o.name}`)
    await git(['remote', 'add', 'origin', urlOf(name)], o.dir)
  }
  const topics = [...new Set(o.topics.map((t) => t.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)).filter(Boolean))].slice(0, 8)
  if (topics.length) await gh(['repo', 'edit', `${o.owner}/${name}`, ...topics.flatMap((t) => ['--add-topic', t])]).catch(() => undefined)
  await git(['push', '-u', 'origin', 'main'], o.dir)
  return { repository: `${o.owner}/${name}`, url: `https://github.com/${o.owner}/${name}` }
}

/** A later revision of a factory: its main, pushed as it is (never forced). False when it has no origin or the push fails. */
export async function pushFactory(dir: string, git: Exec = realGit): Promise<boolean> {
  try {
    await git(['remote', 'get-url', 'origin'], dir)
    await git(['push', 'origin', 'main'], dir)
    return true
  } catch {
    return false
  }
}
