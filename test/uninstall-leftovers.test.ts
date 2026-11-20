// install.sh --uninstall: what weevils leaves outside its own folders goes too, and nothing of the person's. Its
// pieces alone, under bash: untrust_own on a ~/.claude.json, and the pattern that stops weevils' own tunnel only.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'install.sh'), 'utf8')
const fn = /^untrust_own\(\) \{\n[\s\S]*?\n\}\n/m.exec(src)?.[0] ?? ''
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-untrust-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0

function untrust(home: string) {
  return spawnSync('/bin/bash', ['-c', `set -euo pipefail\nOS=$(uname -s)\n${fn}\nuntrust_own "$HOME/.local/share/weevils"`], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
}
const own = (home: string) => ({
  projects: {
    [`${home}/.local/share/weevils/orchestrateur`]: { hasTrustDialogAccepted: true },
    [`${home}/.local/share/weevils/auto/abc`]: { hasTrustDialogAccepted: true },
    [`${home}/.local/share/weevils-other`]: { hasTrustDialogAccepted: true },
    [`${home}/projects/mine`]: { hasTrustDialogAccepted: true, allowedTools: ['Bash'] },
  },
  userID: 'u1',
  numStartups: 12,
})

it('finds the function in install.sh', () => expect(fn).toContain('untrust_own() {'))

it.skipIf(!hasJq)('takes weevils’ own folders out of ~/.claude.json, keeps the rest and the file’s mode', () => {
  const home = fs.mkdtempSync(path.join(dir, 'home-'))
  const f = path.join(home, '.claude.json')
  fs.writeFileSync(f, JSON.stringify(own(home)), { mode: 0o600 })
  expect(untrust(home).status).toBe(0)
  const after = JSON.parse(fs.readFileSync(f, 'utf8'))
  expect(Object.keys(after.projects).sort()).toEqual([`${home}/.local/share/weevils-other`, `${home}/projects/mine`])
  expect(after.projects[`${home}/projects/mine`].allowedTools).toEqual(['Bash'])
  expect(after.userID).toBe('u1')
  expect(fs.statSync(f).mode & 0o777).toBe(0o600)
  expect(fs.readdirSync(home)).toEqual(['.claude.json'])
})

it.skipIf(!hasJq)('follows a symlink instead of replacing it', () => {
  const home = fs.mkdtempSync(path.join(dir, 'home-'))
  fs.mkdirSync(path.join(home, 'dotfiles'))
  const real = path.join(home, 'dotfiles', 'claude.json')
  fs.writeFileSync(real, JSON.stringify(own(home)), { mode: 0o640 })
  fs.symlinkSync('dotfiles/claude.json', path.join(home, '.claude.json'))
  expect(untrust(home).status).toBe(0)
  expect(fs.lstatSync(path.join(home, '.claude.json')).isSymbolicLink()).toBe(true)
  expect(Object.keys(JSON.parse(fs.readFileSync(real, 'utf8')).projects)).toHaveLength(2)
  expect(fs.statSync(real).mode & 0o777).toBe(0o640)
})

it.skipIf(!hasJq)('leaves alone a file that does not read as JSON, or has nothing of weevils', () => {
  const home = fs.mkdtempSync(path.join(dir, 'home-'))
  const f = path.join(home, '.claude.json')
  fs.writeFileSync(f, '{"projects": {"half')
  expect(untrust(home).status).toBe(0)
  expect(fs.readFileSync(f, 'utf8')).toBe('{"projects": {"half')
  const mine = JSON.stringify({ projects: { [`${home}/projects/mine`]: {} } }, null, 7)
  fs.writeFileSync(f, mine)
  const before = fs.statSync(f).mtimeMs
  expect(untrust(home).status).toBe(0)
  expect(fs.readFileSync(f, 'utf8')).toBe(mine)
  expect(fs.statSync(f).mtimeMs).toBe(before)
  // No file at all: nothing to do.
  fs.rmSync(f)
  expect(untrust(home).status).toBe(0)
  expect(fs.existsSync(f)).toBe(false)
})

it('stops weevils’ own tunnel only: the one to its port', () => {
  // The pattern given to pkill -f (an extended regular expression, like grep -E), with the port it reads.
  const line = /^\s*pkill -u "\$\(id -u\)" -f "(cloudflared tunnel[^"]*)"/m.exec(src)?.[1] ?? ''
  expect(line).toContain('$wport')
  const pattern = spawnSync('/bin/bash', ['-c', `wport=4179; printf '%s' "${line}"`], { encoding: 'utf8' }).stdout
  const hits = (cmd: string) => spawnSync('grep', ['-qE', pattern], { input: cmd }).status === 0
  expect(hits('cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4179')).toBe(true)
  expect(hits('/opt/homebrew/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4179 --metrics x')).toBe(true)
  expect(hits('cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080')).toBe(false)
  expect(hits('cloudflared tunnel --no-autoupdate --url http://127.0.0.1:41790')).toBe(false)
  expect(hits('cloudflared tunnel --no-autoupdate --url http://127x0x0x1:4179')).toBe(false)
})

it('takes the install log, the cache, the settings copy and weevils’ Claude records', () => {
  const un = /^uninstall\(\) \{\n[\s\S]*?\n\}\n/m.exec(src)?.[0] ?? ''
  expect(un).toContain('rm -f "$HOME/weevils-install.log"')
  expect(un).toContain('rm -rf "$HOME/.cache/weevils"')
  expect(un).toContain('untrust_own "$HOME/.local/share/weevils"')
  // A tmux of the person's own, kept aside when the guard took its place (server/install.sh), comes back.
  expect(un).toContain('mv "$HOME/.local/bin/tmux.bak-weevils" "$HOME/.local/bin/tmux"')
  const purge = un.slice(un.indexOf('if [ "$PURGE" = 1 ]'))
  expect(purge).toContain('rm -f "$settings.bak-weevils"')
  expect(purge).toContain('"$HOME/.claude/projects/$enc"')
  // Claude Code's name for a folder: every character but letters and digits becomes a dash.
  const enc = /enc=\$\(printf '%s' "\$HOME\/\.local\/share\/weevils" \| (sed '[^']*')\)/.exec(un)?.[1] ?? ''
  const got = spawnSync('/bin/bash', ['-c', `printf '%s' "/Users/ana.b/.local/share/weevils" | ${enc}`], { encoding: 'utf8' }).stdout
  expect(got).toBe('-Users-ana-b--local-share-weevils')
})
