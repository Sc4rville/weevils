// install.sh's web_busy: on a server whose ports 80/443 another web server already holds, --domain must not install
// Caddy (it could not bind them). The function alone, run under bash with stand-ins for ss, netstat and pgrep.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'install.sh'), 'utf8')
const fn = /^web_busy\(\) \{\n[\s\S]*?\n\}\n/m.exec(src)?.[0] ?? ''
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-webbusy-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function busy(o: { ss?: string; netstat?: string; caddyRuns?: boolean }): string {
  const bin = fs.mkdtempSync(path.join(dir, 'bin-'))
  const tool = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  if (o.ss !== undefined) tool('ss', `cat <<'OUT'\n${o.ss}\nOUT`)
  if (o.netstat !== undefined) tool('netstat', `cat <<'OUT'\n${o.netstat}\nOUT`)
  tool('pgrep', o.caddyRuns ? 'exit 0' : 'exit 1')
  for (const t of ['awk', 'sed', 'sort', 'grep', 'head', 'cat']) {
    const real = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim()
    if (real) fs.symlinkSync(real, path.join(bin, t))
  }
  const r = spawnSync('/bin/bash', ['-c', `OS=Linux SUDO=none\n${fn}\nweb_busy`], { env: { PATH: bin }, encoding: 'utf8' })
  return r.stdout
}

const ss = (port: number, who = '') => `LISTEN 0      511          0.0.0.0:${port}        0.0.0.0:*    ${who}`

it('finds the function in install.sh', () => expect(fn).toContain('web_busy() {'))

it('names another web server on 80 or 443, and lets Caddy be', () => {
  expect(busy({ ss: [ss(80, 'users:(("nginx",pid=812,fd=6),("nginx",pid=813,fd=6))'), ss(443, 'users:(("nginx",pid=812,fd=7))')].join('\n') })).toBe('nginx')
  expect(busy({ ss: ss(443, 'users:(("docker-proxy",pid=99,fd=4))') })).toBe('Docker')
  expect(busy({ ss: ss(80, 'users:(("apache2",pid=5,fd=3))') })).toBe('Apache')
  expect(busy({ ss: [ss(80, 'users:(("caddy",pid=7,fd=3))'), ss(443, 'users:(("caddy",pid=7,fd=4))')].join('\n') })).toBe('')
  expect(busy({ ss: [ss(22, 'users:(("sshd",pid=1,fd=3))'), ss(4179, 'users:(("node",pid=2,fd=3))'), ss(8080, '')].join('\n') })).toBe('')
  expect(busy({ ss: '' })).toBe('')
})

it('without the right to see whose a listener is: Caddy if Caddy runs, else another server', () => {
  expect(busy({ ss: ss(443), caddyRuns: true })).toBe('')
  expect(busy({ ss: ss(443), caddyRuns: false })).toBe('another web server')
})

it('reads netstat where ss is missing', () => {
  const ns = 'Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\ntcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN      812/traefik'
  expect(busy({ netstat: ns })).toBe('Traefik')
})
