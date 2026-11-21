// `weevils weevbook vault setup | push | restore | status | summary` (docs/spec/07-vault.md, steps 1 and 2), run from cli.ts.
//
//   setup [--remote <url>]   with gh logged in: the private repository <user>/weevbook-vault (made when missing), this
//                            machine's deploy key on it, the vault key and its recovery code (printed once, here
//                            only), and the remote saved in CONFIG_DIR/vault.json. --remote: any git URL, no GitHub.
//   push                     seals what is new and pushes it: journals, then the raw lines (slim) and the checkpoints
//                            of the code, in batches (step 3); --progress prints a line per batch
//   restore [--code "<24 words>"]   fetches the vault and decrypts every journal into this machine's weevbook; on a
//                            machine with no remote saved yet (a new install), finds the person's vault on GitHub first
//   status                   what is waiting, and the last push
//   summary [--json]         what weevboss says once the history is in: how many conversations, from which machines
//                            and accounts, since when, where they live (reads the vault, writes nothing to the weevbook)
//
// --data-dir and --config-dir point at a copy (tests). The key itself is never printed.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, HOME, MACHINE, VAULT_CONF, VAULT_DEPLOY_KEY, VAULT_KEY_FILE, VAULT_STAGING, vaultRemote } from '../config.ts'
import { tr } from '../i18n.ts'
import { which } from '../platform.ts'
import V from '../i18n/weevbook-vault.ts'
import { backfillMarker } from './backfill.ts'
import { VaultError, keyFromCode, newKey, pushVault, readKey, recoveryCode, remoteHasVault, restoreVault, vaultSsh, vaultStatus, vaultSummary, writeKey, type VaultOptions } from './vault.ts'
import { VAULT_REPO, addDeployKey, ghLogin, ghRunner, withoutVault } from './vault-github.ts'

/** Where a command finds this machine's vault: the real places, or a copy's (--data-dir, --config-dir: tests). */
function vaultFiles(args: string[]) {
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const data = opt('--data-dir') ?? DATA_DIR
  const config = opt('--config-dir')
  return {
    data,
    config,
    key: config ? path.join(config, 'vault.key') : VAULT_KEY_FILE,
    deploy: config ? path.join(config, 'vault-deploy') : VAULT_DEPLOY_KEY,
    conf: config ? path.join(config, 'vault.json') : VAULT_CONF,
    staging: opt('--data-dir') ? path.join(data, 'vault.git') : VAULT_STAGING,
    remote(): string | null {
      if (!config) return vaultRemote()
      try {
        return (JSON.parse(fs.readFileSync(path.join(config, 'vault.json'), 'utf8')) as { remote?: string }).remote ?? null
      } catch {
        return null
      }
    },
  }
}

/** This machine's vault as a command uses it (null: no vault set up here, or no key yet). */
export function vaultHere(args: string[]): VaultOptions | null {
  const f = vaultFiles(args)
  const remote = f.remote()
  let key: Buffer | null = null
  try {
    key = remote ? readKey(f.key) : null
  } catch {
    /* not a key */
  }
  if (!remote || !key) return null
  return { dir: path.join(f.data, 'weevbook'), staging: f.staging, remote, key, machine: MACHINE.id, ssh: vaultSsh(f.deploy), keyDir: path.dirname(f.deploy), gh: ghRunner(which('gh') ?? 'gh') }
}

/** Claude Code's `cleanupPeriodDays` on this machine (30 when it is not set). */
function claudeWindow(): number {
  try {
    const n = (JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'settings.json'), 'utf8')) as { cleanupPeriodDays?: unknown }).cleanupPeriodDays
    return typeof n === 'number' && n > 0 ? n : 30
  } catch {
    return 30
  }
}

export async function vaultMain(args: string[], out: (line: string) => void): Promise<number> {
  const t = tr(V)
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const files = vaultFiles(args)
  const data = files.data
  const dir = path.join(data, 'weevbook')
  const savedRemote = () => files.remote()
  const ssh = vaultSsh(files.deploy)
  // gh where weevilsd installs it when the machine has none (~/.local/bin), whatever this shell's PATH says.
  const gh = ghRunner(which('gh') ?? 'gh')
  try {
    switch (args[1]) {
      case 'setup':
        return await setup(opt('--remote'))
      case 'push': {
        const remote = savedRemote()
        if (!remote) return fail(t.noRemote)
        const key = readKey(files.key)
        if (!key) return fail(t.noKey(files.key))
        const r = await pushVault({ dir, staging: files.staging, remote, key, machine: MACHINE.id, ssh, keyDir: path.dirname(files.deploy), gh, ...(args.includes('--progress') ? { progress: out } : {}) })
        out(r.sealed || r.pushed ? t.pushed(r.threads, r.sealed, r.chunks, r.attachments, r.pushed) : r.raw?.pushed || r.checkpoints?.pushed ? t.journalsSame : t.nothing)
        if (r.differ.length) out(t.differ(r.differ.length))
        for (const f of r.failed) out(t.error(`${f.thread}: ${f.error}`))
        // Step 3: the raw lines and the checkpoints.
        const raw = r.raw
        const cks = r.checkpoints
        if (raw?.pushed) out(t.rawPushed(raw.pushed, raw.pushes, (raw.bytes / 1e6).toFixed(1), raw.repos))
        if (raw?.noRepo) out(t.rawNoRepo(raw.noRepo))
        if (raw?.differ.length) out(t.differ(raw.differ.length))
        if (cks?.pushed) out(t.checkpointsPushed(cks.pushed, cks.sent, (cks.bytes / 1e6).toFixed(1)))
        for (const k of cks?.skipped ?? []) out(t.checkpointSkipped(k.thread, Math.round(k.bytes / 1e6)))
        const late = [...(raw?.failed ?? []), ...(cks?.failed ?? [])].map((f) => `${f.thread}: ${f.error}`).concat([raw?.error, cks?.error].filter((e): e is string => !!e))
        for (const e of late) out(t.error(e))
        return r.failed.length || late.length ? 1 : 0
      }
      case 'restore': {
        // The words are checked before anything is asked of GitHub.
        const code = opt('--code')
        const typed = code ? keyFromCode(code) : null
        // A new install: the person's vault on GitHub, and this machine's deploy key on it (never a new repository).
        const remote = opt('--remote') ?? savedRemote() ?? (await github(false))
        if (!remote) return 1
        const fresh = !!typed && !readKey(files.key)
        if (typed) {
          writeKey(files.key, typed)
          out(t.keySaved)
        }
        const key = readKey(files.key)
        if (!key) return fail(t.noKey(files.key))
        if (!savedRemote()) saveRemote(remote)
        const r = await restoreVault({ dir, staging: files.staging, remote, key, machine: MACHINE.id, ssh: vaultSsh(files.deploy) }).catch((e: Error) => {
          // Words of another vault: not kept, so the right ones can be given next.
          if (fresh && /cannot decrypt/.test(e.message)) fs.rmSync(files.key, { force: true })
          throw e
        })
        out(t.restored(r.threads, r.restored, r.same, r.ahead))
        if (r.differ.length) out(t.differ(r.differ.length))
        return 0
      }
      case 'status': {
        const remote = savedRemote()
        if (!remote) return fail(t.noRemote)
        const s = await vaultStatus({ dir, staging: files.staging, remote, key: !!readKey(files.key) })
        out(t.remote(s.remote))
        out(t.key(s.key))
        out(t.status(s.threads, s.pending, s.remoteThreads))
        out(t.rawStatus(s.rawPending, s.checkpointsPending))
        out(t.pushedAt(s.pushedAt))
        if (s.error) out(t.error(s.error))
        return s.error || !s.key ? 1 : 0
      }
      case 'summary': {
        const remote = savedRemote()
        const key = readKey(files.key)
        const s = await vaultSummary({ dir, staging: files.staging, remote, key, machine: MACHINE.id, ssh, imported: fs.existsSync(backfillMarker(data)), windowDays: claudeWindow() })
        // Machines that joined without the vault (no vault then, or GitHub not signed in here): their line again fixes it.
        const missing = withoutVault(path.join(data, 'vault-machines.json'))
        if (args.includes('--json')) out(JSON.stringify({ ...s, missing }))
        else {
          out(t.summary(s.conversations, s.machines, s.oldest?.slice(0, 10) ?? null))
          out(s.vault ? t.remote(s.remote ?? '') : t.noRemote)
          if (s.claude_window) out(t.window)
        }
        return 0
      }
      default:
        out(t.usage)
        return 2
    }
  } catch (e) {
    out(t.error((e as Error).message))
    return 1
  }

  function fail(line: string) {
    out(line)
    return 1
  }
  function saveRemote(remote: string) {
    fs.mkdirSync(path.dirname(files.conf), { recursive: true, mode: 0o700 })
    fs.writeFileSync(files.conf, `${JSON.stringify({ remote }, null, 2)}\n`, { mode: 0o600 })
  }

  /** The person's vault repository on GitHub (made when `create`), with this machine's deploy key: its remote, or null
   *  (said why). */
  async function github(create: boolean): Promise<string | null> {
    const login = await ghLogin(gh)
    if (!login) return out(t.noGh), null
    const repo = `${login}/${VAULT_REPO}`
    if ((await gh(['repo', 'view', repo, '--json', 'name'])).code === 0) out(t.repoThere(repo))
    else if (!create) return out(t.noVaultThere(repo)), null
    else {
      const made = await gh(['repo', 'create', repo, '--private', '--description', 'Encrypted copy kept by weevils'])
      if (made.code) throw new VaultError(`gh repo create: ${(made.err || made.out).trim()}`) // i18n-ignore: gh's own error
      out(t.repoCreated(repo))
    }
    // This machine's deploy key, write access, this repository only.
    if (!fs.existsSync(files.deploy)) {
      fs.mkdirSync(path.dirname(files.deploy), { recursive: true, mode: 0o700 })
      const kg = await new Promise<string>((resolve) => execFile('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'weevils-vault', '-f', files.deploy], (e, _out, err) => resolve(e ? String(err).trim() || e.message : '')))
      if (kg) throw new VaultError(`ssh-keygen: ${kg}`) // i18n-ignore: ssh-keygen's own error
    }
    out(t.deployKey(await addDeployKey(gh, repo, MACHINE.id, fs.readFileSync(`${files.deploy}.pub`, 'utf8'))))
    return `git@github.com:${repo}.git`
  }

  async function setup(given: string | undefined): Promise<number> {
    const remote = given ?? (await github(true))
    if (!remote) return 1
    saveRemote(remote)
    out(t.remote(remote))
    if (readKey(files.key)) out(t.keyThere)
    else {
      if (await remoteHasVault(files.staging, remote, vaultSsh(files.deploy))) return fail(t.existing)
      const key = newKey()
      writeKey(files.key, key)
      out(t.code)
      out('')
      out(recoveryCode(key))
      out('')
    }
    out(t.next)
    return 0
  }
}
