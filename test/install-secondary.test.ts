// A secondary machine stays one when its installer runs again without --secondary (weevils-update does that after every
// new version): install.sh reads its role, main machine and tunnel port back from service.conf, and so does
// server/install.sh run without arguments. Before, such a re-run made it a main machine of its own and took its tunnel
// down (a PC, 23/11: off the main machine from its first update on). The blocks alone, run under bash.
// (test/docker/run.sh systemd runs the whole thing: an update on a joined machine keeps it online.)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const root = path.join(import.meta.dirname, '..')
const installSh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8')
const serverSh = fs.readFileSync(path.join(root, 'server', 'install.sh'), 'utf8')
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b + to.length) : ''
}
const keepRole = between(installSh, '# A re-run on a machine that joined another one', 'unset _svc _tp\nfi\n')
const serverRole = between(serverSh, 'role=${1:-}', '  [ -n "$main_host" ] || role=main\nfi\n')
const serverPort = between(serverSh, 'tunnel_port=${WEEVILS_TUNNEL_PORT:-}', "  [[ \"$tunnel_port\" =~ ^[0-9]+$ ]] || tunnel_port=''\nfi\n")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-secondary-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function home(conf: string | null) {
  const h = fs.mkdtempSync(path.join(dir, 'home-'))
  if (conf !== null) {
    fs.mkdirSync(path.join(h, '.config', 'weevils'), { recursive: true })
    fs.writeFileSync(path.join(h, '.config', 'weevils', 'service.conf'), conf)
  }
  return h
}
const bash = (h: string, script: string, env: Record<string, string> = {}) =>
  spawnSync('/bin/bash', ['-c', script], { env: { PATH: process.env.PATH, HOME: h, ...env }, encoding: 'utf8' }).stdout.trim()
const SECONDARY = '# Written by server/install.sh — read by weevils-service.\nWEEVILS_ROLE=secondary\nWEEVILS_DIR=/home/me/weevils\nWEEVILS_MAIN_HOST=weevils-vps\nWEEVILS_TUNNEL_PORT=4196\n'

it('finds the blocks', () => {
  expect(keepRole).toContain('SECONDARY=')
  expect(serverRole).toContain('WEEVILS_ROLE')
  expect(serverPort).toContain('WEEVILS_TUNNEL_PORT')
})

it('install.sh run again on a secondary machine stays secondary, on the same main machine and tunnel port', () => {
  const run = (h: string, pre = "SECONDARY='' UNINSTALL=0", env = {}) => bash(h, `set -euo pipefail\n${pre}\n${keepRole}\nprintf '%s|%s' "$SECONDARY" "\${WEEVILS_TUNNEL_PORT:-}"`, env)
  expect(run(home(SECONDARY))).toBe('weevils-vps|4196')
  // What the person or the join line says wins.
  expect(run(home(SECONDARY), "SECONDARY=other UNINSTALL=0")).toBe('other|')
  expect(run(home(SECONDARY), "SECONDARY='' UNINSTALL=0", { WEEVILS_TUNNEL_PORT: '4200' })).toBe('weevils-vps|4200')
  // A main machine, no service.conf yet, an uninstall: nothing changes.
  expect(run(home(SECONDARY.replace('=secondary', '=main')))).toBe('|')
  expect(run(home(null))).toBe('|')
  expect(run(home(SECONDARY), "SECONDARY='' UNINSTALL=1")).toBe('|')
})

it('server/install.sh without arguments keeps the role; a re-run keeps the tunnel port its key may open', () => {
  const role = (h: string, args: string[] = []) => bash(h, `set -euo pipefail\nset -- ${args.join(' ')}\n${serverRole}\nprintf '%s|%s' "$role" "$main_host"`)
  expect(role(home(SECONDARY))).toBe('secondary|weevils-vps')
  expect(role(home(SECONDARY), ['main'])).toBe('main|')
  expect(role(home(null))).toBe('main|')
  expect(role(home(SECONDARY.replace('WEEVILS_MAIN_HOST=weevils-vps', 'WEEVILS_MAIN_HOST=')))).toBe('main|')
  // « end »: the block never stops the installer (set -e), whatever service.conf holds.
  const port = (h: string, mainHost: string, env = {}) => bash(h, `set -euo pipefail\nrole=secondary main_host=${mainHost}\n${serverPort}\nprintf '%s|end' "$tunnel_port"`, env).replace(/\|end$/, '')
  expect(port(home(SECONDARY), 'weevils-vps')).toBe('4196')
  expect(port(home(SECONDARY), 'weevils-vps', { WEEVILS_TUNNEL_PORT: '4300' })).toBe('4300')
  // Another main machine: its own port, asked to it.
  expect(port(home(SECONDARY), 'another-box')).toBe('')
  // A machine an old update made main (the heal below): no port kept, and the installer goes on.
  expect(port(home(SECONDARY.replace('=secondary', '=main')), 'weevils-vps')).toBe('')
  expect(bash(home(SECONDARY.replace('=secondary', '=main')), `set -euo pipefail\nrole=secondary main_host=weevils-vps\n${serverPort}\necho on`)).toBe('on')
})

// A machine that already lost its role (its first update ran an installer without this fix: WEEVILS_ROLE=main, no
// tunnel, a PC on 23/11) comes back by itself at its next update: join.sh's key and alias are still there, and the
// main machine still lets that key in. A stub ssh plays the main machine.
const heal = between(installSh, '# A machine that joined and lost its role before that fix', 'unset _alias\nfi\n')
const JOIN_CONF = '\n# weevils (join.sh): the main machine\nHost weevils-vps\n  HostName vps.example\n  User me\n  IdentityFile ~/.ssh/weevils_ed25519\n  IdentitiesOnly yes\n'

function joined(h: string, sshConfig: string | null, key = true) {
  fs.mkdirSync(path.join(h, '.ssh'), { recursive: true })
  if (key) fs.writeFileSync(path.join(h, '.ssh', 'weevils_ed25519'), 'key')
  if (sshConfig !== null) fs.writeFileSync(path.join(h, '.ssh', 'config'), `Host github.com\n  User git\n${sshConfig}`)
  // ssh <alias> true: the main machine answers 0 while it accepts the key (its forced command), 255 once revoked.
  const bin = path.join(h, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/bash\necho "$*" >>"$HOME/ssh.log"\nfor a; do last=$a; done\n[ "$last" = true ] || exit 2\n[ -f "$HOME/accepted" ] && exit 0 || exit 255\n', { mode: 0o755 })
  return h
}

it('a machine that already lost its role becomes secondary again while the main machine accepts its key', () => {
  const run = (h: string, pre = "SECONDARY='' UNINSTALL=0") =>
    bash(h, `set -euo pipefail\n${pre}\n${keepRole}\n${heal}\nprintf '%s|%s' "$SECONDARY" "\${WEEVILS_TUNNEL_PORT:-}"`, { PATH: `${h}/bin:${process.env.PATH}` })
  expect(heal).toContain('SECONDARY=$_alias')
  const lost = joined(home(SECONDARY.replace('=secondary', '=main').replace('weevils-vps', '')), JOIN_CONF)
  fs.writeFileSync(path.join(lost, 'accepted'), '')
  // Its port is not guessed: server/install.sh asks the main machine for it (the only one that key may open).
  expect(run(lost)).toBe('weevils-vps|')
  expect(fs.readFileSync(path.join(lost, 'ssh.log'), 'utf8')).toContain('BatchMode=yes')
  // The key revoked on the main machine (removed there): a main machine of its own, as it is.
  const revoked = joined(home(SECONDARY.replace('=secondary', '=main')), JOIN_CONF)
  expect(run(revoked)).toBe('|')
  // No join.sh alias, or no key: never asked.
  const plain = joined(home(null), 'Host weevils-vps\n  HostName vps.example\n')
  fs.writeFileSync(path.join(plain, 'accepted'), '')
  expect(run(plain)).toBe('|')
  expect(fs.existsSync(path.join(plain, 'ssh.log'))).toBe(false)
  const nokey = joined(home(null), JOIN_CONF, false)
  fs.writeFileSync(path.join(nokey, 'accepted'), '')
  expect(run(nokey)).toBe('|')
  // Still secondary (service.conf says so): its own main machine, no question asked.
  const fine = joined(home(SECONDARY), JOIN_CONF)
  expect(run(fine)).toBe('weevils-vps|4196')
  expect(fs.existsSync(path.join(fine, 'ssh.log'))).toBe(false)
  // What the person says wins, and an uninstall never rejoins.
  expect(run(lost, "SECONDARY=other UNINSTALL=0")).toBe('other|')
  expect(run(lost, "SECONDARY='' UNINSTALL=1")).toBe('|')
})
