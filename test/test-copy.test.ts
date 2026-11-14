// scripts/test-copy.sh: a throwaway weevils can never reach the real tmux server. On 2026-11-14 a hand-made script ran
// « tmux -L weevils kill-server » with a TMUX_TMPDIR that did not exist yet: tmux fell back to /tmp and closed every
// real agent session, twice. tmux is a fake here that records its arguments.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'

const SCRIPT = path.join(import.meta.dirname, '..', 'scripts', 'test-copy.sh')
let tmp: string, root: string, bin: string, log: string, checkout: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'))
  root = path.join(tmp, 'copies')
  bin = path.join(tmp, 'bin')
  log = path.join(tmp, 'tmux.log')
  checkout = path.join(tmp, 'checkout')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(checkout, 'server'), { recursive: true })
  fs.writeFileSync(path.join(checkout, 'server', 'index.ts'), 'setTimeout(() => {}, 30_000)\n')
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "$@" >> '${log}'\ncase "$*" in *list-sessions*) printf 'wv-a\\nwv-b\\n' ;; esac\n`, { mode: 0o755 })
})
afterEach(() => {
  spawnSync(SCRIPT, ['down', 'demo'], { env: env(), encoding: 'utf8' })
  fs.rmSync(tmp, { recursive: true, force: true })
})

const env = () => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, WEEVILS_TEST_COPIES: root, TMUX: '/tmp/tmux-1000/weevils,1,0' })
const run = (...args: string[]) => spawnSync(SCRIPT, args, { env: env(), encoding: 'utf8' })
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])

it('every tmux call names the copy’s own socket, by absolute path, inside a folder that exists', () => {
  expect(run('up', 'demo', '4490', checkout).status).toBe(0)
  const sock = path.join(root, 'demo', `tmux-${os.userInfo().uid}`, 'weevils')
  expect(fs.statSync(path.dirname(sock)).isDirectory()).toBe(true)
  expect(run('tmux', 'demo', 'new-session', '-d', '-s', 'wv-x', 'sleep 9').status).toBe(0)
  expect(run('down', 'demo').status).toBe(0)
  expect(calls().length).toBeGreaterThan(2)
  for (const c of calls()) {
    expect(c.startsWith(`-S ${sock} `)).toBe(true)
    expect(c).not.toMatch(/-L|kill-server/)
  }
  // down closes the copy's sessions one by one, on its own socket.
  expect(calls().filter((c) => c.includes('kill-session'))).toEqual([`-S ${sock} kill-session -t =wv-a:`, `-S ${sock} kill-session -t =wv-b:`])
})

it('refuses kill-server, -L and -S, the real ports, odd names and a second copy on the same folder', () => {
  expect(run('up', 'demo', '4490', checkout).status).toBe(0)
  for (const bad of [['kill-server'], ['-L', 'weevils', 'ls'], ['-S', '/tmp/tmux-1000/weevils', 'ls']]) {
    const r = run('tmux', 'demo', ...bad)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/not allowed/)
  }
  expect(run('up', 'demo', '4490', checkout).stderr).toMatch(/already exists/)
  expect(run('up', 'other', '4179', checkout).stderr).toMatch(/real weevils/)
  expect(run('up', '../x', '4491', checkout).status).not.toBe(0)
  expect(calls().every((c) => !/kill-server|-L/.test(c))).toBe(true)
})

it('without its folder, a copy never runs tmux at all (no fallback to the real server)', () => {
  const r = run('tmux', 'ghost', 'list-sessions')
  expect(r.status).not.toBe(0)
  expect(r.stderr).toMatch(/does not exist/)
  expect(calls()).toEqual([])
})

it('down stops only its own server', () => {
  expect(run('up', 'demo', '4490', checkout).status).toBe(0)
  const pid = Number(fs.readFileSync(path.join(root, 'demo', 'server.pid'), 'utf8'))
  expect(() => process.kill(pid, 0)).not.toThrow()
  expect(run('down', 'demo').status).toBe(0)
  execFileSync('sleep', ['0.3'])
  expect(() => process.kill(pid, 0)).toThrow()
})
