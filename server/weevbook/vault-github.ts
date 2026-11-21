// GitHub for the vault (docs/spec/07-vault.md, « Access to GitHub »): the person's private repository and one deploy
// key per machine (write access, that repository only), through `gh` on the machine where the person signed in. A
// machine that joins with the one line (server/join.ts) gets its deploy key registered here, then the vault's remote
// and key in the same exchange.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { VaultError, githubRepo, readKey } from './vault.ts'

export const VAULT_REPO = 'weevbook-vault'

export type Gh = (args: string[]) => Promise<{ code: number; out: string; err: string }>

/** `gh` (or another path to it), never a question, cut after `timeoutMs`. */
export const ghRunner = (bin = 'gh', timeoutMs = 120_000): Gh => (args) =>
  new Promise((resolve) => {
    const child = execFile(bin, args, { encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } }, (e, out, err) => {
      resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end('')
  })

/** The GitHub account `gh` is signed in with on this machine (null: not installed, or not signed in). */
export async function ghLogin(gh: Gh): Promise<string | null> {
  const r = await gh(['api', 'user', '--jq', '.login'])
  return r.code === 0 && r.out.trim() ? r.out.trim() : null
}

/** A machine's deploy key on a vault repository, with write access. True when it was added, false when already there. */
export async function addDeployKey(gh: Gh, repo: string, machine: string, pub: string): Promise<boolean> {
  const body = pub.trim().split(/\s+/).slice(0, 2).join(' ')
  const keys = await gh(['api', `repos/${repo}/keys`, '--paginate', '--jq', '.[].key'])
  if (keys.code) throw new VaultError(`gh api keys: ${(keys.err || keys.out).trim()}`) // i18n-ignore: gh's own error
  if (keys.out.split('\n').some((k) => k.trim() === body)) return false
  const r = await gh(['api', '-X', 'POST', `repos/${repo}/keys`, '-f', `title=weevils ${machine.slice(0, 8)}`, '-f', `key=${body}`, '-F', 'read_only=false'])
  if (r.code) throw new VaultError(`gh api keys: ${(r.err || r.out).trim()}`) // i18n-ignore: gh's own error
  return true
}

/** Why a machine that joined has no vault: recorded so weevboss can say it in one line later (`weevils setup`). */
export type JoinedVault = 'ok' | 'no-vault' | 'no-github' | 'error'
export interface JoinedNote { at: string; vault: JoinedVault; detail?: string }

export function joinedNotes(file: string): Record<string, JoinedNote> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, JoinedNote>
  } catch {
    return {}
  }
}

/** The joined machines whose conversations are not kept in the vault, and why. */
export const withoutVault = (file: string): { machine: string; why: Exclude<JoinedVault, 'ok'> }[] =>
  Object.entries(joinedNotes(file)).flatMap(([machine, n]) => (n.vault === 'ok' ? [] : [{ machine, why: n.vault }]))

export interface ShareOptions {
  /** This machine's vault remote (null: none). */
  remote: string | null
  keyFile: string
  /** The machine that joins, and the public half of the deploy key it made. */
  id: string
  pub: string
  gh: Gh
  /** DATA_DIR/vault-machines.json */
  notes: string
  now?: number
}

/**
 * The vault for a machine that joins: its deploy key registered on the vault's repository, then the remote and the
 * vault key (base64), which travel back in the join's answer. Null when this machine has no vault, when GitHub is not
 * signed in here, or when GitHub refused: the join goes on as before, and the reason is kept in `notes`.
 * (One repository today. GitHub accepts a deploy key on one repository only: the raw repositories of step 3 will
 * need a key each.)
 */
export async function shareVault(o: ShareOptions): Promise<{ remote: string; key: string } | null> {
  const note = (vault: JoinedVault, detail?: string) => {
    const all = joinedNotes(o.notes)
    all[o.id] = { at: new Date(o.now ?? Date.now()).toISOString(), vault, ...(detail ? { detail: detail.slice(0, 200) } : {}) }
    try {
      fs.mkdirSync(path.dirname(o.notes), { recursive: true })
      const tmp = `${o.notes}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 })
      fs.renameSync(tmp, o.notes)
    } catch {
      /* a full disk: the join still goes on */
    }
  }
  let key: Buffer | null = null
  try {
    key = o.remote ? readKey(o.keyFile) : null
  } catch {
    /* not a key: no vault to give */
  }
  if (!o.remote || !key) return note('no-vault'), null
  const repo = githubRepo(o.remote)
  if (repo) {
    try {
      if (!(await ghLogin(o.gh))) return note('no-github'), null
      await addDeployKey(o.gh, repo, o.id, o.pub)
    } catch (e) {
      return note('error', (e as Error).message), null
    }
  }
  note('ok')
  return { remote: o.remote, key: key.toString('base64') }
}
