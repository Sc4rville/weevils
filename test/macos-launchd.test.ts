// On a Mac, weevilsd is a launchd agent. macOS announces each agent it is handed ("Background Items Added"), named
// after the program the agent runs: an install or update that rewrote the agent's file and loaded it again (bootout
// then bootstrap) at every run made macOS say "node" again and again, all day long. Here server/install.sh and
// weevils-service run for real under bash, on a pretend Mac (uname says Darwin, a launchctl stand-in that logs every
// call and remembers what is loaded), in a temporary HOME.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'

const repo = path.join(import.meta.dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-launchd-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0
const label = 'com.github.sc4rville.weevilsd'

const home = path.join(dir, 'home')
const state = path.join(dir, 'launchd')
const stubs = path.join(dir, 'bin')
const agentFile = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`)
const wrapper = path.join(home, '.local', 'bin', 'weevilsd')
const uid = String(process.getuid?.() ?? 501)

const stub = (name: string, body: string) => fs.writeFileSync(path.join(stubs, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
beforeAll(() => {
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(path.join(state, 'loaded'), { recursive: true })
  fs.mkdirSync(stubs)
  stub('uname', 'case "${1:-}" in -m) echo arm64 ;; *) echo Darwin ;; esac')
  // launchd: gui/<uid> exists (a session on the screen); a label is loaded between bootstrap and bootout.
  stub(
    'launchctl',
    `S=${state}
echo "$*" >>"$S/calls.log"
loaded() { [ -f "$S/loaded/\${1##*/}" ]; }
case "$1" in
  print) case "$2" in gui/*/*) loaded "$2" && printf 'state = running\\n\\tpid = 4242\\n' ;; gui/*) exit 0 ;; *) exit 113 ;; esac ;;
  bootstrap) l=$(basename "$3" .plist); loaded "$l" && exit 5; [ -f "$3" ] || exit 5; : >"$S/loaded/$l" ;;
  bootout) loaded "$2" || exit 3; rm -f "$S/loaded/\${2##*/}" ;;
  kickstart) loaded "\${!#}" || exit 113 ;;
  enable | disable) ;;
  *) exit 64 ;;
esac`,
  )
  // Not Linux: no systemd --user, and a Mac's stat (BSD -f) for the settings' mode.
  stub('systemctl', 'exit 1')
  stub('loginctl', 'echo yes')
  stub('crontab', `echo "crontab $*" >>${state}/calls.log; exit 1`)
  stub('stat', '[ "${1:-}" = -f ] && { echo 600; exit 0; }; exec /usr/bin/stat "$@"')
})

const env = () => ({ HOME: home, USER: 'alex', LANG: 'C.UTF-8', PATH: `${stubs}:${process.env.PATH}` })
const calls = () => (fs.existsSync(path.join(state, 'calls.log')) ? fs.readFileSync(path.join(state, 'calls.log'), 'utf8') : '')
const resetCalls = () => fs.rmSync(path.join(state, 'calls.log'), { force: true })
function run(cmd: string, args: string[]) {
  const r = spawnSync('/bin/bash', [cmd, ...args], { cwd: repo, env: env(), encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}
const install = () => run(path.join(repo, 'server', 'install.sh'), ['main'])
// On a Linux host that runs systemd, the installer waits up to 10 s for the user's bus before going on. Where that bus
// is not visible (a container, an automation's sandbox, a shell opened without a login), the wait runs to its end.
const INSTALL_MS = 30_000
const service = (...a: string[]) => run(path.join(repo, 'server', 'weevils-service'), a)
const loads = (log: string) => log.split('\n').filter((l) => /^(bootstrap|bootout) /.test(l) && l.includes('weevilsd'))

it.skipIf(!hasJq)('a first install loads the agent once, and it runs weevilsd (its own name), not node', () => {
  install()
  expect(loads(calls())).toEqual([`bootstrap gui/${uid} ${agentFile}`])
  const plist = fs.readFileSync(agentFile, 'utf8')
  expect(plist).toContain(`<key>Label</key><string>${label}</string>`)
  const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? ''
  expect([...args.matchAll(/<string>(.*?)<\/string>/g)].map((m) => m[1])).toEqual([wrapper])
  // Nothing in the agent's file moves with node (its path, its PATH): those live in service.conf, read by weevilsd.
  expect(plist).not.toMatch(/node|<key>PATH<\/key>/)
  expect(fs.statSync(wrapper).mode & 0o777).toBe(0o755)
  expect(fs.readFileSync(path.join(home, '.config', 'weevils', 'service.conf'), 'utf8')).toMatch(/^WEEVILS_NODE=.*node/m)
}, INSTALL_MS)

it.skipIf(!hasJq)('an update that changes nothing: files left as they are, weevilsd restarted in place, nothing loaded again', () => {
  const old = new Date('2026-01-01T00:00:00Z')
  for (const f of [agentFile, wrapper, path.join(home, '.local', 'bin', 'weevils-update')]) fs.utimesSync(f, old, old)
  resetCalls()
  install()
  const log = calls()
  expect(loads(log)).toEqual([])
  expect(log).not.toMatch(/^(bootstrap|bootout) /m)
  expect(log).toContain(`kickstart -k gui/${uid}/${label}`)
  for (const f of [agentFile, wrapper, path.join(home, '.local', 'bin', 'weevils-update')]) expect(fs.statSync(f).mtime).toEqual(old)
  expect(log).not.toContain('crontab')
  // weevils-service restart alone (auto-merge, a remote added, the setup agent): the same.
  resetCalls()
  service('restart')
  expect(calls().trim()).toBe(`print gui/${uid}\nprint gui/${uid}/${label}\nkickstart -k gui/${uid}/${label}`)
}, INSTALL_MS)

it.skipIf(!hasJq)('an agent file that changed is loaded again, once; a stop then start loads it again', () => {
  fs.appendFileSync(agentFile, '<!-- changed -->\n')
  resetCalls()
  service('restart')
  expect(loads(calls())).toEqual([`bootout gui/${uid}/${label}`, `bootstrap gui/${uid} ${agentFile}`])
  resetCalls()
  service('restart')
  expect(loads(calls())).toEqual([])
  resetCalls()
  service('stop')
  service('start')
  expect(loads(calls())).toEqual([`bootout gui/${uid}/${label}`, `bootstrap gui/${uid} ${agentFile}`])
})

it('weevilsd starts node server/index.ts from the weevils folder, with the PATH of service.conf', () => {
  const h = fs.mkdtempSync(path.join(dir, 'wrap-'))
  const fakeNode = path.join(h, 'node')
  fs.writeFileSync(fakeNode, '#!/bin/sh\necho "args=$*"\necho "cwd=$(pwd)"\necho "path=$PATH"\necho "env=$NODE_ENV"\n', { mode: 0o755 })
  fs.mkdirSync(path.join(h, '.config', 'weevils'), { recursive: true })
  fs.writeFileSync(path.join(h, '.config', 'weevils', 'service.conf'), `WEEVILS_DIR=${repo}\nWEEVILS_NODE=${fakeNode}\nWEEVILS_PATH=/opt/homebrew/bin:/usr/bin:/bin\n`)
  const r = spawnSync('/bin/bash', [path.join(repo, 'server', 'weevilsd')], { env: { HOME: h, PATH: '/usr/bin:/bin' }, cwd: '/', encoding: 'utf8' })
  expect(r.stdout).toBe(`args=server/index.ts\ncwd=${repo}\npath=/opt/homebrew/bin:/usr/bin:/bin\nenv=production\n`)
  // No service.conf: launchd's "can't start" code, said in the log.
  const bare = spawnSync('/bin/bash', [path.join(repo, 'server', 'weevilsd')], { env: { HOME: fs.mkdtempSync(path.join(dir, 'bare-')), PATH: '/usr/bin:/bin' }, encoding: 'utf8' })
  expect(bare.status).toBe(78)
  expect(bare.stderr).toContain('run install.sh again')
})

// A listener on every interface makes macOS's firewall ask whether "node" may accept incoming connections: weevilsd
// and its hook receiver stay on 127.0.0.1 unless the person asked otherwise (install.sh --lan).
it('listens on 127.0.0.1 unless WEEVILS_HOST says otherwise; the hooks on 127.0.0.1 always', () => {
  const host = (extra: Record<string, string>) =>
    spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(path.join(repo, 'server', 'config.ts'))}); console.log(m.HOST)`], {
      env: { HOME: home, PATH: process.env.PATH, WEEVILS_CONFIG: '/dev/null', ...extra },
      encoding: 'utf8',
    }).stdout.trim()
  expect(host({})).toBe('127.0.0.1')
  expect(host({ WEEVILS_HOST: '0.0.0.0' })).toBe('0.0.0.0')
  expect(fs.readFileSync(path.join(repo, '.env.example'), 'utf8')).not.toMatch(/^\s*WEEVILS_HOST\s*=/m)
  expect(fs.readFileSync(path.join(repo, 'server', 'index.ts'), 'utf8')).toMatch(/\.listen\(HOOK_PORT, '127\.0\.0\.1'/)
})
