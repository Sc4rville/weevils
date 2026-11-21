// Another computer plugged in from one line: the one-time code, the key it authorizes (held to one tunnel port and one
// forced command), and that forced command refusing anything but registering that same machine.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorizedLine, freePort, Join, JOIN_TTL, joinRoute, knownHosts, slugId } from './join.ts'

const KEY = `ssh-ed25519 ${'A'.repeat(68)} weevils@laptop`
const KEY2 = `ssh-ed25519 ${'B'.repeat(68)} weevils@desk`
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'join-'))

function setup(remotes = '', ids: string[] = ['box'], now = { t: 1_000_000 }) {
  const dir = tmp()
  const join = new Join({
    file: path.join(dir, 'data', 'join.json'),
    authorizedKeys: path.join(dir, '.ssh', 'authorized_keys'),
    service: '/home/user/.local/bin/weevils-service',
    remotes: () => remotes,
    machineIds: () => ids,
    now: () => now.t,
  })
  return { dir, join, now, keys: () => fs.readFileSync(path.join(dir, '.ssh', 'authorized_keys'), 'utf8') }
}

describe('a one-time code', () => {
  it('works once, and only its hash is kept', () => {
    const { dir, join, keys } = setup()
    const code = join.create('user@weevils.example.com')
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(fs.readFileSync(path.join(dir, 'data', 'join.json'), 'utf8')).not.toContain(code)
    expect(fs.statSync(path.join(dir, 'data', 'join.json')).mode & 0o777).toBe(0o600)
    expect(join.open(code)?.port).toBe(4192)
    const r = join.use(code, 'Laptop', KEY)
    expect(r).toEqual({ ok: true, id: 'laptop', port: 4192, target: 'user@weevils.example.com' })
    expect(join.use(code, 'Laptop', KEY)).toEqual({ ok: false, why: 'expired' })
    expect(join.open(code)).toBeNull()
    expect(keys()).toBe(`${authorizedLine('/home/user/.local/bin/weevils-service', 'laptop', 4192, KEY)}\n`)
    expect(fs.statSync(path.join(dir, '.ssh', 'authorized_keys')).mode & 0o777).toBe(0o600)
  })

  it('never starts with a dash, which bash would take for an option of its own (the line is « bash -s <code> »)', () => {
    const { join } = setup()
    for (let i = 0; i < 400; i++) expect(join.create('user@host')).toMatch(/^[A-Za-z0-9_][A-Za-z0-9_-]{31}$/)
  })

  it('expires after an hour; a wrong or malformed code is refused, a malformed key does not spend it', () => {
    const { join, now } = setup()
    const code = join.create('user@host')
    expect(join.use('x'.repeat(32), 'laptop', KEY)).toEqual({ ok: false, why: 'expired' })
    expect(join.use('../../etc', 'laptop', KEY)).toEqual({ ok: false, why: 'expired' })
    expect(join.use(code, 'laptop', 'ssh-ed25519 AAAA" ; rm -rf ~')).toEqual({ ok: false, why: 'bad' })
    expect(join.use(code, 'laptop', `command="sh" ${KEY}`)).toEqual({ ok: false, why: 'bad' })
    expect(join.open(code)).not.toBeNull()
    now.t += JOIN_TTL + 1
    expect(join.use(code, 'laptop', KEY)).toEqual({ ok: false, why: 'expired' })
  })

  it('reserves a tunnel port no remote and no other open code uses', () => {
    expect(freePort('', [])).toBe(4192)
    expect(freePort('laptop=http://127.0.0.1:4192,nas=http://127.0.0.1:4193', [4194])).toBe(4195)
    const { join } = setup('laptop=http://127.0.0.1:4192')
    const a = join.create('user@host')
    const b = join.create('user@host')
    expect([join.open(a)?.port, join.open(b)?.port]).toEqual([4193, 4194])
  })

  it('names the machine like install.sh, never twice the same; the same computer again keeps its id and line', () => {
    expect(slugId('My MacBook Pro')).toBe('my-macbook-pro')
    expect(slugId('---')).toBe('')
    const { join, keys } = setup('', ['box', 'laptop'])
    expect(join.use(join.create('user@host'), 'laptop', KEY)).toMatchObject({ ok: true, id: 'laptop-2' })
    expect(join.use(join.create('user@host'), 'laptop', KEY2)).toMatchObject({ ok: true, id: 'laptop-3' })
    expect(join.use(join.create('user@host'), 'whatever', KEY)).toMatchObject({ ok: true, id: 'laptop-2' })
    expect(keys().trim().split('\n')).toHaveLength(2)
  })

  it('keeps the lines it did not write', () => {
    const { dir, join, keys } = setup()
    fs.mkdirSync(path.join(dir, '.ssh'))
    fs.writeFileSync(path.join(dir, '.ssh', 'authorized_keys'), 'ssh-ed25519 CCCC user@own-laptop\n')
    join.use(join.create('user@host'), 'laptop', KEY)
    expect(keys().split('\n')[0]).toBe('ssh-ed25519 CCCC user@own-laptop')
  })
})

describe('the authorized key', () => {
  it('opens only the tunnel port and runs only remote-shell for that machine', () => {
    const line = authorizedLine('/home/user/.local/bin/weevils-service', 'laptop', 4193, KEY)
    expect(line).toBe(
      `restrict,port-forwarding,permitlisten="127.0.0.1:4193",permitopen="127.0.0.1:4193",command="/home/user/.local/bin/weevils-service remote-shell laptop 4193" ssh-ed25519 ${'A'.repeat(68)} weevils-join:laptop`,
    )
  })

  it('comes with the host keys sshd shows, under the name the other computer uses', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'ssh_host_ed25519_key.pub'), `ssh-ed25519 ${'E'.repeat(68)} root@box\n`)
    fs.writeFileSync(path.join(dir, 'ssh_host_rsa_key.pub'), 'garbage')
    expect(knownHosts('weevils.example.com', dir)).toEqual([`weevils.example.com ssh-ed25519 ${'E'.repeat(68)}`])
  })
})

describe('remote-shell, the forced command', () => {
  const script = path.join(import.meta.dirname, 'weevils-service')
  const run = (home: string, original: string, args = ['laptop', '4193'], input = '') =>
    execFileSync('bash', [script, 'remote-shell', ...args], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, WEEVILS_CONFIG: path.join(home, 'env'), SSH_ORIGINAL_COMMAND: original },
      input,
      encoding: 'utf8',
      stdio: 'pipe',
    })

  it('answers the connection check and registers that machine on that port, token on stdin', () => {
    const home = tmp()
    // Already registered on that port: no restart, only the token kept.
    fs.writeFileSync(path.join(home, 'env'), 'WEEVILS_REMOTES=laptop=http://127.0.0.1:4193\n')
    expect(run(home, 'true')).toBe('')
    const token = `X-Weevils-Local: ${'d4'.repeat(32)}`
    const asked = 'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service add-remote laptop http://127.0.0.1:4193'
    expect(run(home, asked, undefined, token + '\n').trim()).toBe('4193')
    expect(fs.readFileSync(path.join(home, '.config', 'weevils', 'remotes', 'laptop.token'), 'utf8')).toBe(token + '\n')
    expect(run(home, 'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service add-remote laptop', undefined, token + '\n').trim()).toBe('4193')
  })

  it('refuses a shell, another machine, another port, anything chained', () => {
    const home = tmp()
    fs.writeFileSync(path.join(home, 'env'), 'WEEVILS_REMOTES=laptop=http://127.0.0.1:4193\n')
    for (const cmd of [
      'bash',
      'cat ~/.config/weevils/secret',
      'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service add-remote nas http://127.0.0.1:4193',
      'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service add-remote laptop http://127.0.0.1:4179',
      'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service add-remote laptop http://127.0.0.1:4193; rm -rf ~',
      'WEEVILS_TOKEN_STDIN=1 $HOME/.local/bin/weevils-service restart',
      '$HOME/.local/bin/weevils-service add-remote laptop http://127.0.0.1:4193',
    ]) expect(() => run(home, cmd), cmd).toThrow()
    expect(() => run(home, 'true', ['../x', '4193'])).toThrow()
    expect(fs.readFileSync(path.join(home, 'env'), 'utf8')).toBe('WEEVILS_REMOTES=laptop=http://127.0.0.1:4193\n')
  })
})

describe('the routes', () => {
  async function serve(join: Join, joined: string[]) {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      if (!(await joinRoute(req, res, url.pathname, { join, machine: 'Box', lang: 'fr', hostKeys: (h) => [`${h} ssh-ed25519 KEY`], onJoined: (id) => joined.push(id) }))) {
        res.writeHead(418)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }
  }

  it('serves the script with its address, and answers a good code with where to connect', async () => {
    const { join } = setup()
    const joined: string[] = []
    const { server, base } = await serve(join, joined)
    try {
      const script = await (await fetch(`${base}/api/join.sh`, { headers: { 'x-forwarded-host': 'weevils.example.com', 'x-forwarded-proto': 'https' } })).text()
      expect(script).toContain('base="https://weevils.example.com"')
      expect(script).not.toContain('__BASE__')
      const code = join.create('user@weevils.example.com')
      const body = new URLSearchParams({ id: 'laptop', key: KEY })
      const r = await fetch(`${base}/api/join/${code}`, { method: 'POST', body })
      expect(r.status).toBe(200)
      expect((await r.text()).split('\n')).toEqual(['id=laptop', 'port=4192', 'target=user@weevils.example.com', 'alias=weevils-box', 'lang=fr', 'known=weevils.example.com ssh-ed25519 KEY', ''])
      expect(joined).toEqual(['laptop'])
      expect((await fetch(`${base}/api/join/${code}`, { method: 'POST', body })).status).toBe(404)
      expect((await fetch(`${base}/api/join/${code}`)).status).toBe(418)
    } finally {
      server.close()
    }
  })
})

it('join.sh parses as bash and never runs before it is whole', () => {
  const sh = fs.readFileSync(path.join(import.meta.dirname, 'join.sh'), 'utf8')
  execFileSync('bash', ['-n', path.join(import.meta.dirname, 'join.sh')])
  expect(sh.trimEnd().split('\n').at(-1)).toBe('main "$@"')
  expect(sh).toContain('--secondary "$alias"')
})

// docs/spec/07-vault.md, step 2: the join carries the vault. The real join.sh runs against the real route; GitHub is a
// stand-in (a `gh` that records what it is asked, and a bare repository git reaches in place of github.com).
describe('the join carries the vault', async () => {
  const { Weevbook } = await import('./weevbook/store.ts')
  const { backfill } = await import('./weevbook/backfill.ts')
  const { main: weevbook } = await import('./weevbook/cli.ts')
  const { vaultMain } = await import('./weevbook/vault-cli.ts')
  const { readKey } = await import('./weevbook/vault.ts')
  const { ghRunner, joinedNotes, shareVault, withoutVault } = await import('./weevbook/vault-github.ts')
  const FX = path.resolve(import.meta.dirname, '../test/fixtures/weevbook/home')
  const dirs = ['--claude-dir', path.join(FX, 'claude', 'projects'), '--codex-dir', path.join(FX, 'codex', 'sessions')]
  const tools = ['curl', 'ssh', 'ssh-keygen', 'git'].every((c) => {
    try {
      return !!execFileSync('sh', ['-c', `command -v ${c}`])
    } catch {
      return false
    }
  })
  const git = (gitDir: string, ...args: string[]) => execFileSync('git', ['--git-dir', gitDir, ...args], { encoding: 'utf8' }).trim()
  const GITHUB = 'git@github.com:alex/weevbook-vault.git'
  const T1 = '01M7HSBBM02XDK5FKDXG64FE62'

  /** The main machine: a weevbook with one thread, `gh` signed in as alex (or not), and a vault on « GitHub » when asked. */
  async function world(o: { vault: boolean; signedIn?: boolean }) {
    const root = tmp()
    // git reaches github.com's repositories in a folder of the test.
    const github = path.join(root, 'github')
    execFileSync('git', ['init', '-q', '--bare', path.join(github, 'alex', 'weevbook-vault.git')])
    fs.writeFileSync(path.join(root, 'gitconfig'), `[url "${github}/"]\n\tinsteadOf = git@github.com:\n`)
    process.env.GIT_CONFIG_GLOBAL = path.join(root, 'gitconfig')
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    const log = path.join(root, 'gh.log')
    const keys = path.join(root, 'gh.keys')
    fs.writeFileSync(keys, '')
    const gh = path.join(root, 'gh')
    fs.writeFileSync(gh, `#!/bin/sh
printf '%s\\n' "$*" >>"${log}"
case "$1 $2" in
  "api user") ${o.signedIn === false ? 'exit 1' : 'echo alex'} ;;
  "api repos/alex/weevbook-vault/keys") cat "${keys}" ;;
  "api -X") for a in "$@"; do case "$a" in key=*) printf '%s\\n' "\${a#key=}" >>"${keys}" ;; esac; done ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    const data = path.join(root, 'main-data')
    const cfg = path.join(root, 'main-config')
    const book = await Weevbook.open(path.join(data, 'weevbook'), 'box')
    await book.lock()
    await book.append(T1, {
      events: [
        { id: '01M7HSBBM00000000000000001', at: '2026-11-16T09:00:00.000Z', leg: null, type: 'meta', thread: T1, project: 'infra' },
        { id: '01M7HSBBM00000000000000002', at: '2026-11-16T09:00:00.000Z', leg: 'L1', type: 'leg.start', engine: 'claude:abc123@box', session: 's1', cwd: '/home/user/projects/infra', rung: 0, epoch: 1 },
        { id: '01M7HSBBM00000000000000003', at: '2026-11-16T09:00:01.000Z', leg: 'L1', type: 'meta', title: 'Rotate the backups' },
        { id: '01M7HSBBM00000000000000004', at: '2026-11-16T09:00:02.000Z', leg: 'L1', type: 'message', role: 'user', text: 'rotate them', source: 'claude' },
      ],
    })
    await book.commitThread(T1, 'turn 1')
    await book.unlock(true)
    if (o.vault) {
      expect(await vaultMain(['vault', 'setup', '--remote', GITHUB, '--data-dir', data, '--config-dir', cfg], () => undefined)).toBe(0)
      expect(await vaultMain(['vault', 'push', '--data-dir', data, '--config-dir', cfg], () => undefined)).toBe(0)
    }
    const { join, keys: authorized } = setup()
    const notes = path.join(data, 'vault-machines.json')
    const remote = () => {
      try {
        return (JSON.parse(fs.readFileSync(path.join(cfg, 'vault.json'), 'utf8')) as { remote: string }).remote
      } catch {
        return null
      }
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const ctx = { join, machine: 'Box', lang: 'en', hostKeys: (h: string) => [`${h} ssh-ed25519 KEY`], onJoined: () => undefined, vault: (id: string, pub: string) => shareVault({ remote: remote(), keyFile: path.join(cfg, 'vault.key'), id, pub, gh: ghRunner(gh, 10_000), notes }) }
      if (!(await joinRoute(req, res, url.pathname, ctx))) {
        res.writeHead(418)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    /** The line pasted on another computer: the script as this weevils serves it, run by bash with the code (and options). */
    const paste = async (home: string, ...args: string[]) => {
      const script = await (await fetch(`${base}/api/join.sh`)).text()
      const installer = path.join(root, 'install-stub.sh')
      fs.writeFileSync(installer, 'printf "%s\\n" "$@" >"$HOME/install-args"\n')
      // (Not execFileSync: the server that answers lives in this process, so bash must not block it.)
      return new Promise<{ code: number; err: string }>((resolve) => {
        const p = spawn('bash', ['-s', ...args], { env: { PATH: process.env.PATH, HOME: home, LANG: 'C', WEEVILS_INSTALL_SH: installer }, stdio: ['pipe', 'ignore', 'pipe'] })
        let err = ''
        p.stderr.on('data', (d) => (err += d))
        p.on('exit', (code) => resolve({ code: code ?? 1, err }))
        p.stdin.end(script)
      })
    }
    return { root, data, cfg, book, join, authorized, notes, log, keys, github: path.join(github, 'alex', 'weevbook-vault.git'), paste, close: () => server.close() }
  }
  const conf = (home: string, f: string) => path.join(home, '.config', 'weevils', f)
  const installed = (home: string) => fs.readFileSync(path.join(home, 'install-args'), 'utf8').trim().split('\n')

  it.skipIf(!tools)('a machine that joins gets its deploy key on the vault, the remote and the key (0600); its own history reaches the vault', async () => {
    const w = await world({ vault: true })
    try {
      const laptop = path.join(w.root, 'laptop')
      fs.mkdirSync(laptop)
      const r = await w.paste(laptop, w.join.create('user@weevils.example.com'))
      expect([r.code, r.err]).toEqual([0, expect.stringContaining('Key accepted')])
      // Nothing about the vault is said, and the installer ran as it always did.
      expect(r.err).not.toMatch(/vault|GitHub/i)
      const args = installed(laptop)
      const id = args[args.indexOf('--machine') + 1]
      expect(args).toEqual(['--yes', '--lang', 'en', '--secondary', 'weevils-box', '--machine', id])

      // What step 1 expects, where it expects it: the same key as the main machine, the remote, this machine's deploy key.
      expect(readKey(conf(laptop, 'vault.key'))!.equals(readKey(path.join(w.cfg, 'vault.key'))!)).toBe(true)
      expect(JSON.parse(fs.readFileSync(conf(laptop, 'vault.json'), 'utf8'))).toEqual({ remote: GITHUB })
      for (const f of ['vault.key', 'vault.json', 'vault-deploy']) expect([f, fs.statSync(conf(laptop, f)).mode & 0o777]).toEqual([f, 0o600])
      const pub = fs.readFileSync(conf(laptop, 'vault-deploy.pub'), 'utf8').trim().split(' ').slice(0, 2).join(' ')
      // The main machine registered that public key on the vault's repository: write access, a title like step 1's.
      const asked = fs.readFileSync(w.log, 'utf8').trim().split('\n')
      expect(asked).toEqual(['api user --jq .login', 'api repos/alex/weevbook-vault/keys --jq .[].key', `api -X POST repos/alex/weevbook-vault/keys -f title=weevils ${id.slice(0, 8)} -f key=${pub} -F read_only=false`])
      expect(fs.readFileSync(w.keys, 'utf8').trim()).toBe(pub)
      expect(joinedNotes(w.notes)[id].vault).toBe('ok')
      expect(withoutVault(w.notes)).toEqual([])
      // The join's own SSH key is what it was: one forced command, the tunnel's port, and not the vault's key.
      const ssh = fs.readFileSync(path.join(laptop, '.ssh', 'weevils_ed25519.pub'), 'utf8').trim()
      expect(w.authorized()).toBe(`${authorizedLine('/home/user/.local/bin/weevils-service', id, 4192, ssh)}\n`)
      expect(w.authorized()).not.toContain(pub.split(' ')[1])
      // The vault key never reached a log or the join's records.
      const secret = fs.readFileSync(conf(laptop, 'vault.key'), 'utf8').trim()
      for (const f of [w.log, w.notes, path.join(w.root, 'main-data', 'weevbook', 'index.json')]) if (fs.existsSync(f)) expect(fs.readFileSync(f, 'utf8')).not.toContain(secret)

      // That machine's weevilsd: its first import, then its pusher. Its history is in the vault, beside the main machine's.
      const data = path.join(laptop, '.local', 'share', 'weevils')
      const made = await backfill({ dir: path.join(data, 'weevbook'), sessions: path.join(data, 'weevbook-sessions.jsonl'), claudeDir: path.join(FX, 'claude', 'projects'), codexDir: path.join(FX, 'codex', 'sessions'), home: laptop, machine: id, roots: ['/home/alex/projects'] }, { now: Date.parse('2026-11-20T00:00:00Z') })
      expect(made.created).toBeGreaterThan(0)
      expect(await vaultMain(['vault', 'push', '--data-dir', data, '--config-dir', path.join(laptop, '.config', 'weevils')], () => undefined)).toBe(0)
      expect(git(w.github, 'for-each-ref', '--format=%(refname)', 'refs/threads/').split('\n')).toHaveLength(1 + made.created)
      // And the main machine reads it back with its own key: the laptop's conversations, by their titles.
      expect(await vaultMain(['vault', 'restore', '--data-dir', w.data, '--config-dir', w.cfg], () => undefined)).toBe(0)
      const titles = (await (await Weevbook.open(path.join(w.data, 'weevbook'), 'box')).refs()).map((x) => x.meta.title)
      expect(titles).toContain('Rotate the backups')
      expect(titles).toContain('Checkout fixes')
      expect(titles).toHaveLength(1 + made.created)

      // The same computer again (a new line): the same key, registered once.
      expect((await w.paste(laptop, w.join.create('user@weevils.example.com'))).code).toBe(0)
      expect(fs.readFileSync(w.keys, 'utf8').trim().split('\n')).toHaveLength(1)
    } finally {
      w.close()
    }
  }, 60_000)

  it.skipIf(!tools)('no vault on the main machine: the join is what it was, nothing is said, and the missing piece is recorded', async () => {
    const w = await world({ vault: false })
    try {
      const laptop = path.join(w.root, 'laptop')
      fs.mkdirSync(laptop)
      const r = await w.paste(laptop, w.join.create('user@weevils.example.com'))
      expect(r.code).toBe(0)
      expect(r.err.trim().split('\n')).toHaveLength(1) // « Key accepted… » and nothing else
      const args = installed(laptop)
      const id = args[args.indexOf('--machine') + 1]
      expect(args).toEqual(['--yes', '--lang', 'en', '--secondary', 'weevils-box', '--machine', id])
      expect(fs.existsSync(conf(laptop, 'vault.key'))).toBe(false)
      expect(fs.existsSync(conf(laptop, 'vault.json'))).toBe(false)
      expect(fs.existsSync(w.log)).toBe(false) // GitHub was not asked anything
      expect(withoutVault(w.notes)).toEqual([{ machine: id, why: 'no-vault' }])
      const ssh = fs.readFileSync(path.join(laptop, '.ssh', 'weevils_ed25519.pub'), 'utf8').trim()
      expect(w.authorized()).toBe(`${authorizedLine('/home/user/.local/bin/weevils-service', id, 4192, ssh)}\n`)
    } finally {
      w.close()
    }
  }, 30_000)

  it.skipIf(!tools)('a vault but GitHub not signed in on the main machine: joined all the same, no key handed over, recorded', async () => {
    const w = await world({ vault: true, signedIn: false })
    try {
      const laptop = path.join(w.root, 'laptop')
      fs.mkdirSync(laptop)
      expect((await w.paste(laptop, w.join.create('user@weevils.example.com'))).code).toBe(0)
      const id = installed(laptop).at(-1)!
      expect(fs.existsSync(conf(laptop, 'vault.key'))).toBe(false)
      expect(fs.readFileSync(w.keys, 'utf8')).toBe('')
      expect(withoutVault(w.notes)).toEqual([{ machine: id, why: 'no-github' }])
    } finally {
      w.close()
    }
  }, 30_000)

  it.skipIf(!tools)('the line says what to bring of that computer: --since or --match reach its first import; a bad one stops before the code is spent', async () => {
    const w = await world({ vault: true })
    try {
      const laptop = path.join(w.root, 'laptop')
      fs.mkdirSync(laptop)
      const code = w.join.create('user@weevils.example.com')
      for (const bad of [['--since', 'last week'], ['--match', 'a "quoted" word'], ['--match', 'back\\slash']]) {
        const r = await w.paste(laptop, code, ...bad)
        expect([bad, r.code]).toEqual([bad, 1])
      }
      expect(w.join.open(code)).not.toBeNull()
      expect((await w.paste(laptop, code, '--since', '2026-11-18')).code).toBe(0)
      expect(fs.readFileSync(conf(laptop, 'backfill.json'), 'utf8')).toBe('{"since":"2026-11-18"}\n')
      const data = path.join(laptop, '.local', 'share', 'weevils')
      const out: string[] = []
      expect(await weevbook(['backfill', '--once', '--data-dir', data, '--config-dir', path.join(laptop, '.config', 'weevils'), ...dirs], (l) => out.push(l))).toBe(0)
      expect(out.join('\n')).toMatch(/^3 sessions: /)

      const desk = path.join(w.root, 'desk')
      fs.mkdirSync(desk)
      expect((await w.paste(desk, w.join.create('user@weevils.example.com'), '--match', 'checkout fixes')).code).toBe(0)
      expect(JSON.parse(fs.readFileSync(conf(desk, 'backfill.json'), 'utf8'))).toEqual({ match: 'checkout fixes' })
      const out2: string[] = []
      await weevbook(['backfill', '--once', '--data-dir', path.join(desk, 'data'), '--config-dir', path.join(desk, '.config', 'weevils'), ...dirs], (l) => out2.push(l))
      expect(out2.join('\n')).toMatch(/^1 sessions: 1 threads created/)
    } finally {
      w.close()
    }
  }, 60_000)

  it('the answer carries the vault only when there is one, and only what join.sh can write safely', async () => {
    const { join } = setup()
    const joined: string[] = []
    const answers: ({ remote: string; key: string } | null)[] = [
      { remote: 'git@github.com:alex/weevbook-vault.git', key: Buffer.alloc(32, 7).toString('base64') },
      null,
      { remote: 'git@github.com:alex/x.git"; rm -rf ~', key: Buffer.alloc(32, 7).toString('base64') },
      { remote: 'git@github.com:alex/weevbook-vault.git', key: 'short' },
    ]
    const asked: string[][] = []
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      await joinRoute(req, res, url.pathname, { join, machine: 'Box', lang: 'fr', hostKeys: () => [], onJoined: (id) => joined.push(id), vault: async (id, pub) => (asked.push([id, pub]), answers.shift() ?? null) })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const post = async (name: string, vault?: string) => (await (await fetch(`${base}/api/join/${join.create('user@host')}`, { method: 'POST', body: new URLSearchParams({ id: name, key: `ssh-ed25519 ${name[0].toUpperCase().repeat(68)} weevils@${name}`, ...(vault ? { vault } : {}) }) })).text()).split('\n').filter((l) => l.startsWith('vault_'))
    try {
      const pub = `ssh-ed25519 ${'V'.repeat(68)} weevils-vault`
      expect(await post('alpha', pub)).toEqual(['vault_remote=git@github.com:alex/weevbook-vault.git', `vault_key=${Buffer.alloc(32, 7).toString('base64')}`])
      expect(asked).toEqual([['alpha', pub]])
      expect(await post('bravo', pub)).toEqual([]) // no vault on this machine
      expect(await post('charlie', pub)).toEqual([]) // a remote that is not a plain address
      expect(await post('delta', pub)).toEqual([]) // not a key
      // An older join.sh, or a key that is not one: the vault is not asked at all.
      expect(await post('echo')).toEqual([])
      expect(await post('foxtrot', 'command="sh" ssh-ed25519 AAAA')).toEqual([])
      expect(asked).toHaveLength(4)
      expect(joined).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'])
    } finally {
      server.close()
    }
  })
})

// What weevboss types (server/orchestrator.*.md) reaches weevilsd as it is: the choice for the other computer's
// history, and GitHub's sign-in by its code.
it('weevils setup ask machine --since | --match and weevils setup github, from the command to the server', async () => {
  const seen: { url: string; body: unknown }[] = []
  const server = http.createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c)).on('end', () => {
      seen.push({ url: req.url ?? '', body: data ? JSON.parse(data) : null })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.url === '/api/setup/github' ? { ok: true, state: 'posted' } : { ok: true }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const dir = path.join(process.env.HOME!, '.local', 'share', 'weevils')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'local-token'), `X-Weevils-Local: ${'ab'.repeat(32)}\n`, { mode: 0o600 })
  const cli = (...args: string[]) =>
    new Promise<string>((resolve, reject) => {
      const p = spawn('bash', [path.join(import.meta.dirname, 'weevils-cli'), ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, WEEVILS_LANG: 'en', WEEVILS_PORT: String((server.address() as { port: number }).port) }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.on('exit', (code) => (code ? reject(new Error(`exit ${code}`)) : resolve(out.trim())))
    })
  try {
    expect(await cli('setup', 'ask', 'machine')).toBe('ok')
    expect(await cli('setup', 'ask', 'machine', '--since', '2026-10-01')).toBe('ok')
    expect(await cli('setup', 'ask', 'machine', '--match', 'invoice exporter')).toBe('ok')
    expect(await cli('setup', 'mark', 'vault:summary')).toBe('ok')
    expect(await cli('setup', 'github')).toBe('posted')
    expect(seen).toEqual([
      { url: '/api/setup/ask', body: { brick: 'machine' } },
      { url: '/api/setup/ask', body: { brick: 'machine', since: '2026-10-01' } },
      { url: '/api/setup/ask', body: { brick: 'machine', match: 'invoice exporter' } },
      { url: '/api/setup/mark', body: { id: 'vault:summary' } },
      { url: '/api/setup/github', body: null },
    ])
  } finally {
    server.close()
  }
})
