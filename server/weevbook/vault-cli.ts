// `weevils weevbook vault setup | push | restore | status` (docs/spec/07-vault.md, step 1), run from cli.ts.
//
//   setup [--remote <url>]   with gh logged in: the private repository <user>/weevbook-vault (made when missing), this
//                            machine's deploy key on it, the vault key and its recovery code (printed once, here
//                            only), and the remote saved in CONFIG_DIR/vault.json. --remote: any git URL, no GitHub.
//   push                     seals what is new and pushes it
//   restore [--code "<24 words>"]   fetches the vault and decrypts every journal into this machine's weevbook
//   status                   what is waiting, and the last push
//
// --data-dir and --config-dir point at a copy (tests). The key itself is never printed.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, MACHINE, VAULT_CONF, VAULT_DEPLOY_KEY, VAULT_KEY_FILE, VAULT_STAGING, vaultRemote } from '../config.ts'
import { tr } from '../i18n.ts'
import V from '../i18n/weevbook-vault.ts'
import { VaultError, keyFromCode, newKey, pushVault, readKey, recoveryCode, remoteHasVault, restoreVault, vaultSsh, vaultStatus, writeKey } from './vault.ts'

const REPO = 'weevbook-vault'

function run(cmd: string, args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { encoding: 'utf8', timeout: 120_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } }, (e, out, err) => {
      resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input ?? '')
  })
}

export async function vaultMain(args: string[], out: (line: string) => void): Promise<number> {
  const t = tr(V)
  const opt = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const data = opt('--data-dir') ?? DATA_DIR
  const config = opt('--config-dir')
  const files = {
    key: config ? path.join(config, 'vault.key') : VAULT_KEY_FILE,
    deploy: config ? path.join(config, 'vault-deploy') : VAULT_DEPLOY_KEY,
    conf: config ? path.join(config, 'vault.json') : VAULT_CONF,
    staging: opt('--data-dir') ? path.join(data, 'vault.git') : VAULT_STAGING,
  }
  const dir = path.join(data, 'weevbook')
  const savedRemote = () => {
    if (!config) return vaultRemote()
    try {
      return (JSON.parse(fs.readFileSync(files.conf, 'utf8')) as { remote?: string }).remote ?? null
    } catch {
      return null
    }
  }
  const ssh = vaultSsh(files.deploy)
  try {
    switch (args[1]) {
      case 'setup':
        return await setup(opt('--remote'))
      case 'push': {
        const remote = savedRemote()
        if (!remote) return fail(t.noRemote)
        const key = readKey(files.key)
        if (!key) return fail(t.noKey(files.key))
        const r = await pushVault({ dir, staging: files.staging, remote, key, machine: MACHINE.id, ssh })
        out(r.sealed || r.pushed ? t.pushed(r.threads, r.sealed, r.chunks, r.attachments, r.pushed) : t.nothing)
        if (r.differ.length) out(t.differ(r.differ.length))
        for (const f of r.failed) out(t.error(`${f.thread}: ${f.error}`))
        return r.failed.length ? 1 : 0
      }
      case 'restore': {
        const remote = opt('--remote') ?? savedRemote()
        if (!remote) return fail(t.noRemote)
        const code = opt('--code')
        if (code) {
          writeKey(files.key, keyFromCode(code))
          out(t.keySaved)
        }
        const key = readKey(files.key)
        if (!key) return fail(t.noKey(files.key))
        if (!savedRemote()) saveRemote(remote)
        const r = await restoreVault({ dir, staging: files.staging, remote, key, machine: MACHINE.id, ssh })
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
        out(t.pushedAt(s.pushedAt))
        if (s.error) out(t.error(s.error))
        return s.error || !s.key ? 1 : 0
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

  async function setup(given: string | undefined): Promise<number> {
    let remote = given
    if (!remote) {
      const user = await run('gh', ['api', 'user', '--jq', '.login'])
      const login = user.out.trim()
      if (user.code || !login) return fail(t.noGh)
      const repo = `${login}/${REPO}`
      if ((await run('gh', ['repo', 'view', repo, '--json', 'name'])).code === 0) out(t.repoThere(repo))
      else {
        const made = await run('gh', ['repo', 'create', repo, '--private', '--description', 'Encrypted copy kept by weevils'])
        if (made.code) throw new VaultError(`gh repo create: ${(made.err || made.out).trim()}`) // i18n-ignore: gh's own error
        out(t.repoCreated(repo))
      }
      // This machine's deploy key, write access, this repository only.
      if (!fs.existsSync(files.deploy)) {
        fs.mkdirSync(path.dirname(files.deploy), { recursive: true, mode: 0o700 })
        const kg = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'weevils-vault', '-f', files.deploy])
        if (kg.code) throw new VaultError(`ssh-keygen: ${kg.err.trim()}`) // i18n-ignore: ssh-keygen's own error
      }
      const pub = fs.readFileSync(`${files.deploy}.pub`, 'utf8').trim()
      const body = pub.split(' ').slice(0, 2).join(' ')
      const keys = await run('gh', ['api', `repos/${repo}/keys`, '--jq', '.[].key'])
      const added = !keys.out.split('\n').some((k) => k.trim() === body)
      if (added) {
        const r = await run('gh', ['api', '-X', 'POST', `repos/${repo}/keys`, '-f', `title=weevils ${MACHINE.id.slice(0, 8)}`, '-f', `key=${body}`, '-F', 'read_only=false'])
        if (r.code) throw new VaultError(`gh api keys: ${(r.err || r.out).trim()}`) // i18n-ignore: gh's own error
      }
      out(t.deployKey(added))
      remote = `git@github.com:${repo}.git`
    }
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
