// What weevils puts in Claude Code's way: its hook, called on every event (PostToolUse after each tool call), and its
// writes to ~/.claude/settings.json (server/install.sh).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = path.join(import.meta.dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-hook-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('server/hook.sh', () => {
  /** A weevilsd that takes `delay` ms to answer, and what reached it. */
  async function slowServer(delay: number) {
    const got: { body: string; pid: string }[] = []
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        got.push({ body, pid: String(req.headers['x-pid'] ?? '') })
        setTimeout(() => res.end('{}'), delay)
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    return { got, port: (srv.address() as AddressInfo).port, close: () => srv.closeAllConnections() || srv.close() }
  }
  /** Runs the hook as Claude Code does (event on stdin, waits for it and for its output to close); ms taken. */
  const run = (port: number, event: object) =>
    new Promise<number>((resolve) => {
      const t0 = Date.now()
      const p = spawn('/bin/sh', [path.join(root, 'server', 'hook.sh')], { env: { ...process.env, WEEVILS_HOOK_PORT: String(port) } })
      p.stdin.end(JSON.stringify(event))
      p.on('close', () => resolve(Date.now() - t0))
    })
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20))
  }

  it('after a tool call, returns at once even when weevilsd is slow, and the event still arrives', async () => {
    const s = await slowServer(3000)
    try {
      const ms = await run(s.port, { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'x'.repeat(200_000) } })
      expect(ms).toBeLessThan(600)
      await until(() => s.got.length === 1)
      expect(JSON.parse(s.got[0].body)).toMatchObject({ session_id: 's1', hook_event_name: 'PostToolUse' })
      expect(JSON.parse(s.got[0].body).tool_response.stdout).toHaveLength(200_000)
      expect(Number(s.got[0].pid)).toBeGreaterThan(1)
    } finally {
      s.close()
    }
  })

  it('the other events are sent before it returns, one second at most', async () => {
    const s = await slowServer(3000)
    try {
      const ms = await run(s.port, { session_id: 's1', hook_event_name: 'Stop' })
      expect(s.got.map((g) => JSON.parse(g.body).hook_event_name)).toEqual(['Stop'])
      expect(ms).toBeLessThan(2000)
    } finally {
      s.close()
    }
  })

  it('no weevilsd at all: nothing waits, nothing fails', async () => {
    const s = await slowServer(0)
    s.close()
    expect(await run(s.port, { session_id: 's1', hook_event_name: 'PostToolUse' })).toBeLessThan(600)
    expect(await run(s.port, { session_id: 's1', hook_event_name: 'Stop' })).toBeLessThan(1500)
  })
})

describe('server/install.sh: ~/.claude/settings.json', () => {
  const src = fs.readFileSync(path.join(root, 'server', 'install.sh'), 'utf8')
  // From « settings=~/.claude/settings.json » to the end of put_settings.
  const start = src.indexOf('settings=~/.claude/settings.json\n')
  const block = src.slice(start, src.indexOf('\n}\n', src.indexOf('put_settings() {', start)) + 3)
  const hasJq = spawnSync('sh', ['-c', 'command -v jq']).status === 0
  const write = (home: string, filter: string) =>
    spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${block}\ntmp=$(mktemp)\njq '${filter}' "$settings" >"$tmp" && put_settings "$tmp"`], { env: { ...process.env, HOME: home }, encoding: 'utf8' })

  it('finds the block', () => expect(block).toMatch(/^settings=[\s\S]*put_settings\(\) \{[\s\S]*\n\}\n$/))

  it.skipIf(!hasJq)('keeps the file’s mode', () => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'))
    fs.mkdirSync(path.join(home, '.claude'))
    const f = path.join(home, '.claude', 'settings.json')
    fs.writeFileSync(f, '{"model":"opus"}', { mode: 0o644 })
    fs.chmodSync(f, 0o644)
    expect(write(home, '.x = 1').status).toBe(0)
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ model: 'opus', x: 1 })
    expect(fs.statSync(f).mode & 0o777).toBe(0o644)
    expect(fs.readdirSync(path.join(home, '.claude'))).toEqual(['settings.json'])
  })

  it.skipIf(!hasJq)('a settings.json that is a symlink stays one: the file it points to gets the change', () => {
    const home = fs.mkdtempSync(path.join(dir, 'home-'))
    fs.mkdirSync(path.join(home, '.claude'))
    fs.mkdirSync(path.join(home, 'dotfiles'))
    const real = path.join(home, 'dotfiles', 'claude-settings.json')
    fs.writeFileSync(real, '{"model":"opus"}')
    fs.chmodSync(real, 0o640)
    fs.symlinkSync('../dotfiles/claude-settings.json', path.join(home, '.claude', 'settings.json'))
    expect(write(home, '.x = 1').status).toBe(0)
    expect(fs.lstatSync(path.join(home, '.claude', 'settings.json')).isSymbolicLink()).toBe(true)
    expect(JSON.parse(fs.readFileSync(real, 'utf8'))).toEqual({ model: 'opus', x: 1 })
    expect(fs.statSync(real).mode & 0o777).toBe(0o640)
  })

  it('every rewrite goes through it', () => {
    expect(src).not.toMatch(/mv "\$tmp" "\$settings"/)
    expect(src.match(/put_settings "\$tmp"/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
