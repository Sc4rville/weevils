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
  const port = (h: string, mainHost: string, env = {}) => bash(h, `set -euo pipefail\nrole=secondary main_host=${mainHost}\n${serverPort}\nprintf '%s' "$tunnel_port"`, env)
  expect(port(home(SECONDARY), 'weevils-vps')).toBe('4196')
  expect(port(home(SECONDARY), 'weevils-vps', { WEEVILS_TUNNEL_PORT: '4300' })).toBe('4300')
  // Another main machine: its own port, asked to it.
  expect(port(home(SECONDARY), 'another-box')).toBe('')
})
