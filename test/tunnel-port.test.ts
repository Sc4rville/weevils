// The main machine's side of a secondary machine's tunnel (server/weevils-service, run by that machine's key):
// « hold » before each connection waits while the machine is switched off in the app and answers within a second of
// « on »; a port another program took is changed for a free one, in the key and in WEEVILS_REMOTES, so the tunnel
// binds instead of being refused every few seconds with nothing said (a PC, 23/11: a preview server held 4193).
// Real sockets, a throwaway HOME; the service is never restarted for real (no unit in that HOME).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const service = path.join(import.meta.dirname, '..', 'server', 'weevils-service')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-tport-'))
const servers: net.Server[] = []
afterAll(() => {
  for (const s of servers) s.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const listen = (port = 0) => new Promise<number>((resolve, reject) => {
  const s = net.createServer().listen(port, '0.0.0.0')
  s.once('error', reject)
  s.once('listening', () => (servers.push(s), resolve((s.address() as net.AddressInfo).port)))
})

function home(port: number) {
  const h = fs.mkdtempSync(path.join(dir, 'home-'))
  fs.mkdirSync(path.join(h, '.config', 'weevils', 'remotes'), { recursive: true })
  fs.mkdirSync(path.join(h, '.ssh'), { recursive: true })
  fs.writeFileSync(path.join(h, '.config', 'weevils', 'env'), `WEEVILS_REMOTES=laptop=http://127.0.0.1:4192,desk=http://127.0.0.1:${port}\n`)
  fs.writeFileSync(path.join(h, '.ssh', 'authorized_keys'),
    `ssh-ed25519 AAAAmine me@box\nrestrict,port-forwarding,permitlisten="127.0.0.1:${port}",permitopen="127.0.0.1:${port}",command="${service} remote-shell desk ${port}" ssh-ed25519 AAAAdesk weevils-join:desk\n`)
  return h
}
const env = (h: string) => ({ PATH: process.env.PATH, HOME: h, SSH_ORIGINAL_COMMAND: 'weevils-service hold' })

it('a port another program holds: the machine gets a free one, in its key and in the remotes, and is told', async () => {
  const taken = await listen()
  const h = home(taken)
  const r = spawnSync('bash', [service, 'remote-shell', 'desk', String(taken)], { env: env(h), encoding: 'utf8', timeout: 20_000 })
  expect(r.status).toBe(0)
  const moved = Number(/^port (\d+)$/m.exec(r.stdout)?.[1])
  expect(moved).toBeGreaterThanOrEqual(4192)
  expect(moved).not.toBe(taken)
  expect(moved).not.toBe(4192)
  const keys = fs.readFileSync(path.join(h, '.ssh', 'authorized_keys'), 'utf8')
  expect(keys).toContain(`permitlisten="127.0.0.1:${moved}",permitopen="127.0.0.1:${moved}",command="${service} remote-shell desk ${moved}" ssh-ed25519 AAAAdesk weevils-join:desk`)
  expect(keys).toContain('ssh-ed25519 AAAAmine me@box')
  expect(fs.readFileSync(path.join(h, '.config', 'weevils', 'env'), 'utf8')).toContain(`WEEVILS_REMOTES=laptop=http://127.0.0.1:4192,desk=http://127.0.0.1:${moved}`)
  expect(r.stderr).toContain(`desk moved from port ${taken} (held by another program) to ${moved}`)
  // Nothing here listens on the new one.
  await expect(listen(moved)).resolves.toBe(moved)
})

it('a free port: the same one, nothing rewritten', async () => {
  const free = await listen()
  servers.pop()!.close()
  await new Promise((r) => setTimeout(r, 50))
  const h = home(free)
  const before = fs.readFileSync(path.join(h, '.ssh', 'authorized_keys'), 'utf8')
  const r = spawnSync('bash', [service, 'remote-shell', 'desk', String(free)], { env: env(h), encoding: 'utf8', timeout: 20_000 })
  expect(r.stdout.trim()).toBe(`port ${free}`)
  expect(fs.readFileSync(path.join(h, '.ssh', 'authorized_keys'), 'utf8')).toBe(before)
})

it('switched off in the app: the machine waits there, and goes within a second of « on »', async () => {
  const h = home(4999)
  const off = path.join(h, '.config', 'weevils', 'remotes', 'desk.off')
  fs.writeFileSync(off, '')
  const t0 = Date.now()
  const child = spawn('bash', [service, 'remote-shell', 'desk', '4999'], { env: env(h) })
  let out = ''
  child.stdout.on('data', (b: Buffer) => (out += b.toString()))
  const done = new Promise<number>((r) => child.once('exit', () => r(Date.now())))
  await new Promise((r) => setTimeout(r, 1500))
  expect(out).toBe('')
  const on = Date.now()
  fs.rmSync(off)
  const end = await done
  expect(out.trim()).toBe('port 4999')
  expect(end - on).toBeLessThan(1500)
  expect(on - t0).toBeGreaterThanOrEqual(1400)
})
