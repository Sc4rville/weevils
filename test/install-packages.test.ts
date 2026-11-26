// install.sh's pkg_install: only the packages asked for, never an upgrade of the whole system, on every package
// manager it knows; when one cannot be installed, one plain sentence and the one command that installs it by hand
// (FAIL_WHY, FAIL_FIX), never the package manager's raw output. The functions alone, run under bash with stand-ins for
// the package managers that log every call. (test/docker/pkg-managers.sh runs the real ones in containers.)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'install.sh'), 'utf8')
const fn = (name: string) => new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(src)?.[0] ?? ''
const strings = src.split('\n').filter((l) => /^(EN|FR)_(installing|pm_failed|fix_it|step_failed)=/.test(l)).join('\n')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-pkg-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** A package manager's stand-in: logs its arguments, then runs `body` (sh) with them. */
type Tools = Record<string, string>

function run(pm: string, pkgs: string[], tools: Tools, o: { sudo?: string; failFile?: boolean } = {}) {
  const bin = fs.mkdtempSync(path.join(dir, 'bin-'))
  const home = fs.mkdtempSync(path.join(dir, 'home-'))
  const calls = path.join(bin, 'calls')
  fs.writeFileSync(calls, '')
  for (const [name, body] of Object.entries(tools)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >>"${calls}"\n${body}\n`, { mode: 0o755 })
  }
  // sudo runs the command as is (the stand-ins log it).
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\n[ "$1" != -n ] || shift\nexec "$@"\n', { mode: 0o755 })
  const failFile = path.join(home, 'fail')
  const script = [
    'set -euo pipefail',
    strings,
    'L=en E= B= R= D= O= AGENT=0',
    `t() { local k=EN_$1; printf '%s' "\${!k}"; }`,
    `info() { printf '  · %s\\n' "$*"; }`,
    'summary() { :; }',
    "APT_KEEP='' APT_UPDATED=0 FAIL_WHY='' FAIL_FIX='' FAIL_DONE=0",
    `PM=${pm} SUDO='${o.sudo ?? 'sudo'}'`,
    fn('pkg_install'),
    fn('pkg_has'),
    fn('fail_report'),
    `if pkg_install ${pkgs.join(' ')}; then echo RESULT=ok; else echo RESULT=failed; printf 'WHY=%s\\nFIX=%s\\n' "$FAIL_WHY" "$FAIL_FIX"; fail_report; fi`,
  ].join('\n')
  const r = spawnSync('/bin/bash', ['-c', script], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ...(o.failFile ? { WEEVILS_FAIL_FILE: failFile } : {}) },
    encoding: 'utf8',
  })
  const out = r.stdout + r.stderr
  const field = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout)?.[1] ?? ''
  return {
    ok: field('RESULT') === 'ok',
    why: field('WHY'),
    fix: field('FIX'),
    out,
    calls: fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    failFile: fs.existsSync(failFile) ? fs.readFileSync(failFile, 'utf8') : null,
    log: fs.existsSync(path.join(home, '.cache/weevils/packages.log')) ? fs.readFileSync(path.join(home, '.cache/weevils/packages.log'), 'utf8') : '',
  }
}

// The CachyOS case: hyprland is held back and its library moves on. Anything that upgrades the system (-Syu, -Su)
// fails exactly like that; installing the one package works.
const HELD = `case "$1" in
  -S*u*) echo "warning: hyprland: ignoring package upgrade (0.56.2-3.2 => 0.57.2-1.1)"
    echo "error: failed to prepare transaction (could not satisfy dependencies)"
    echo ":: installing aquamarine (0.16.0-1.1) breaks dependency 'libaquamarine.so=14-64' required by hyprland"; exit 1 ;;
  -T) shift; for p in "$@"; do echo "$p"; done; exit 127 ;;
esac
exit 0`

it('finds the functions in install.sh', () => {
  for (const f of ['pkg_install', 'pkg_has', 'fail_report']) expect(fn(f)).toContain(`${f}() {`)
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  expect(code).not.toMatch(/pacman -S[a-z]*u|-Syu|apt-get (dist-)?upgrade|dnf (-y )?upgrade|zypper (dup|up|update)\b|apk upgrade|brew upgrade/)
})

describe('pacman (Arch, CachyOS, Manjaro, EndeavourOS)', () => {
  it('a held-back package elsewhere stops nothing: only tmux, never a system upgrade', () => {
    const r = run('pacman', ['tmux'], { pacman: HELD })
    expect(r.ok).toBe(true)
    expect(r.calls).toEqual(['pacman -S --noconfirm --needed tmux'])
    expect(r.out).not.toMatch(/hyprland|aquamarine/)
  })

  it('a database too old for the mirrors (404): refreshed once, for these packages only, never -u', () => {
    const r = run('pacman', ['tmux', 'jq'], {
      pacman: `case "$1" in
  -S) echo "error: failed retrieving file 'tmux-3.5-1-x86_64.pkg.tar.zst' from mirror : The requested URL returned error: 404"; exit 1 ;;
  -Sy) exit 0 ;;
  *) exit 1 ;;
esac`,
    })
    expect(r.ok).toBe(true)
    expect(r.calls).toEqual(['pacman -S --noconfirm --needed tmux jq', 'pacman -Sy --noconfirm --needed tmux jq'])
  })

  it('still failing: one plain sentence naming what is missing and the command, no pacman dump', () => {
    const r = run('pacman', ['git', 'tmux'], {
      pacman: `case "$1" in
  -S) echo "error: target not found: tmux"; exit 1 ;;
  -Sy) echo "error: failed to prepare transaction (could not satisfy dependencies)"; exit 1 ;;
  -T) shift; for p in "$@"; do [ "$p" = git ] || echo "$p"; done; [ "$*" = git ] && exit 0; exit 127 ;;
esac`,
    }, { failFile: true })
    expect(r.ok).toBe(false)
    expect(r.why).toBe('one tool weevils needs didn’t install on this computer: tmux.')
    expect(r.fix).toBe('sudo pacman -S --needed tmux')
    expect(r.out).not.toMatch(/error:|transaction/)
    // join.sh's file: the sentence, then the command; the raw output kept aside.
    expect(r.failFile).toBe('one tool weevils needs didn’t install on this computer: tmux.\nsudo pacman -S --needed tmux\n')
    expect(r.out).toContain('This should sort it out:')
    expect(r.log).toContain('could not satisfy dependencies')
  })

  it('a dependency conflict is not a stale database: no refresh, said at once', () => {
    const r = run('pacman', ['tmux'], { pacman: HELD.replace('-S*u*)', '-S*)') })
    expect(r.ok).toBe(false)
    expect(r.calls.filter((c) => c.startsWith('pacman -S'))).toEqual(['pacman -S --noconfirm --needed tmux'])
    expect(r.fix).toBe('sudo pacman -S --needed tmux')
  })

  it('as root: the command has no sudo', () => {
    const r = run('pacman', ['tmux'], { pacman: 'case "$1" in -T) echo tmux; exit 127 ;; esac\nexit 1' }, { sudo: '' })
    expect(r.fix).toBe('pacman -S --needed tmux')
  })
})

describe('the other package managers: install, never upgrade', () => {
  const never = /\b(upgrade|dist-upgrade|full-upgrade|dup|distro-sync)\b|-Su|apk add -u|--upgrade/

  it('apt: update (a broken extra source stops nothing), then install only these', () => {
    const r = run('apt', ['tmux', 'jq'], { 'apt-get': '[ "$1" = update ] && exit 100\nexit 0' })
    expect(r.ok).toBe(true)
    expect(r.calls).toEqual(['apt-get update -qq', 'apt-get install -y -qq --no-install-recommends tmux jq'])
    expect(r.calls.join('\n')).not.toMatch(never)
  })

  it('apt failing: the packages still missing and apt-get install', () => {
    const r = run('apt', ['git', 'tmux'], {
      'apt-get': '[ "$1" = update ] && exit 0\necho "E: Unable to locate package tmux"; exit 100',
      'dpkg-query': '[ "$3" = git ] && printf "install ok installed" || exit 1',
    })
    expect([r.ok, r.why, r.fix]).toEqual([false, 'one tool weevils needs didn’t install on this computer: tmux.', 'sudo apt-get install -y tmux'])
    expect(r.out).not.toContain('E: Unable')
  })

  it('dnf', () => {
    const r = run('dnf', ['tmux'], { dnf: 'exit 0' })
    expect([r.ok, r.calls]).toEqual([true, ['dnf install -y -q tmux']])
    const f = run('dnf', ['tmux'], { dnf: 'echo "Error: Unable to find a match: tmux"; exit 1', rpm: 'exit 1' })
    expect([f.ok, f.fix]).toEqual([false, 'sudo dnf install -y tmux'])
    expect(f.out).not.toContain('Unable to find')
  })

  it('zypper (openSUSE)', () => {
    const r = run('zypper', ['tmux'], { zypper: 'exit 0' })
    expect([r.ok, r.calls]).toEqual([true, ['zypper --non-interactive --quiet install --no-recommends tmux']])
    const f = run('zypper', ['tmux'], { zypper: 'echo "No provider of tmux found."; exit 104', rpm: 'exit 1' })
    expect([f.ok, f.fix]).toEqual([false, 'sudo zypper install tmux'])
  })

  it('apk (Alpine): no index yet → apk update (reads the index, upgrades nothing), then add once more', () => {
    const r = run('apk', ['tmux', 'jq'], {
      apk: `case "$1" in
  add) [ -f "$HOME/indexed" ] && exit 0; echo "ERROR: unable to select packages:"; exit 1 ;;
  update) touch "$HOME/indexed"; exit 0 ;;
esac`,
    })
    expect(r.ok).toBe(true)
    expect(r.calls).toEqual(['apk add --quiet tmux jq', 'apk update --quiet', 'apk add --quiet tmux jq'])
    const f = run('apk', ['tmux'], { apk: '[ "$1" = info ] && exit 1\necho "ERROR: tmux (no such package)"; exit 1' })
    expect([f.ok, f.fix]).toEqual([false, 'sudo apk add tmux'])
  })

  it('Homebrew (macOS): as the person, no sudo, other formulae left as they are', () => {
    const r = run('brew', ['tmux', 'jq'], { brew: 'env | grep -q "^HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1$" || exit 9\nexit 0' }, { sudo: '' })
    expect(r.ok).toBe(true)
    expect(r.calls).toEqual(['brew install tmux jq'])
    const f = run('brew', ['tmux'], { brew: '[ "$1" = list ] && exit 1\necho "Error: No available formula"; exit 1' }, { sudo: '' })
    expect([f.ok, f.fix]).toEqual([false, 'brew install tmux'])
    expect(f.out).not.toContain('No available formula')
  })
})
