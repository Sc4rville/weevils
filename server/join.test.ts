// Another computer plugged in from one line: the one-time code, the key it authorizes (held to one tunnel port and one
// forced command), and that forced command refusing anything but registering that same machine.
import { execFileSync } from 'node:child_process'
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
