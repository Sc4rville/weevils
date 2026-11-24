import { afterEach, expect, it, vi } from 'vitest'
import { Remote } from './remotes.ts'
import { MACHINE } from './config.ts'
import type { Snapshot } from '../shared/api.ts'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('rejects a reverse tunnel returning this machine, including repeated polls', async () => {
  vi.useFakeTimers()
  const snapshot = { version: 1, machines: [{ id: MACHINE.id }], sessions: [], h24: [] }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot)))
  const r = new Remote('pc', 'http://127.0.0.1:4192', vi.fn())
  r.start()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(r.online).toBe(false)
  expect(r.snap).toBeNull()
  expect(r.has('anything')).toBe(false)
})
it('accepts only peer-owned records and removes duplicate identities from a federated peer', async () => {
  vi.useFakeTimers()
  const own = { id: 'pc-session', machineId: 'pc' }
  const echo = { id: 'vps-session', machineId: MACHINE.id }
  const snapshot = { version: 1, machines: [{ id: 'pc' }, { id: MACHINE.id }], sessions: [own, echo, own], h24: [{ id: 'job' }, { id: 'job' }], relay: { plans: [{ sessionId: own.id }, { sessionId: echo.id }] } } as unknown as Snapshot
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot)))
  const r = new Remote('pc', 'http://peer', vi.fn())
  r.start()
  await vi.advanceTimersByTimeAsync(1)
  expect(r.online).toBe(true)
  expect(r.snap?.sessions).toEqual([own])
  expect(r.snap?.machines).toHaveLength(1)
  expect(r.snap?.h24).toEqual([{ id: 'job' }])
  expect(r.snap?.relay?.plans).toEqual([{ sessionId: own.id }])
})

// The main machine calls a secondary one through the tunnel with that machine's local token (server/http.ts isLocal),
// handed over by weevils-service add-remote (WEEVILS_TOKEN_STDIN=1) and kept in ~/.config/weevils/remotes/<id>.token.
it('sends the remote machine\'s local token with every call, read from its file', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { remoteTokenFile } = await import('./remotes.ts')
  const token = 'c3'.repeat(32)
  const f = remoteTokenFile('laptop')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, `X-Weevils-Local: ${token}\n`, { mode: 0o600 })
  const seen: (string | null)[] = []
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('x-weevils-local'))
    return Response.json({ version: 1, machines: [{ id: 'laptop' }], sessions: [], h24: [] })
  }))
  const r = new Remote('laptop', 'http://127.0.0.1:4192', vi.fn())
  r.start()
  await vi.advanceTimersByTimeAsync(1)
  await r.call('POST', '/api/prefs', { lang: 'en' })
  expect(seen.length).toBeGreaterThanOrEqual(2)
  expect(seen.every((t) => t === token)).toBe(true)
  // No token kept for a machine: no header (that machine then answers 401, local_token_missing).
  expect(new Remote('other', 'http://x', vi.fn()).headers()).toEqual({})
  fs.rmSync(f)
})

it('weevils-service add-remote keeps a secondary machine\'s token (0600), and refuses anything else', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-home-'))
  const script = path.join(import.meta.dirname, 'weevils-service')
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, WEEVILS_CONFIG: path.join(home, 'env'), WEEVILS_TOKEN_STDIN: '1' }
  const line = `X-Weevils-Local: ${'d4'.repeat(32)}`
  const port = execFileSync('bash', [script, 'add-remote', 'laptop', 'http://127.0.0.1:4193'], { env, input: line + '\n', encoding: 'utf8' }).trim()
  expect(port).toBe('4193')
  const f = path.join(home, '.config', 'weevils', 'remotes', 'laptop.token')
  expect(fs.readFileSync(f, 'utf8')).toBe(line + '\n')
  expect(fs.statSync(f).mode & 0o777).toBe(0o600)
  expect(fs.readFileSync(path.join(home, 'env'), 'utf8')).toContain('WEEVILS_REMOTES=laptop=http://127.0.0.1:4193')
  expect(() => execFileSync('bash', [script, 'add-remote', 'laptop', 'http://127.0.0.1:4193'], { env, input: 'rm -rf /\n', stdio: 'pipe' })).toThrow()
  expect(fs.readFileSync(f, 'utf8')).toBe(line + '\n')
  // Without the variable (an older secondary machine): the token is left as it is, nothing read.
  execFileSync('bash', [script, 'add-remote', 'laptop', 'http://127.0.0.1:4193'], { env: { ...env, WEEVILS_TOKEN_STDIN: '' }, input: 'X-Weevils-Local: ' + 'ee'.repeat(32) + '\n' })
  expect(fs.readFileSync(f, 'utf8')).toBe(line + '\n')
  fs.rmSync(home, { recursive: true, force: true })
})

// A machine that does not answer is never a bare « offline » (src/ui/away.tsx): why, as seen from here, and since when,
// kept on disk so a restart here still says « since 15:03 ».
it('says why a machine does not answer, and since when, across a restart', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { awayWhy } = await import('./remotes.ts')
  // What fetch throws through the reverse tunnel (checked against node's own errors).
  expect(awayWhy(new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }))).toBe('link')
  expect(awayWhy(new DOMException('timeout', 'TimeoutError'))).toBe('link')
  expect(awayWhy(new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }))).toBe('stopped')
  expect(awayWhy(Object.assign(new Error('502'), { status: 502 }))).toBe('stopped')
  expect(awayWhy(Object.assign(new Error('401'), { status: 401 }))).toBe('key')

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-away-'))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-23T15:00:00Z'))
  let answer: 'ok' | 'refused' | 'closed' | 401 = 'ok'
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (answer === 'ok') return Response.json({ version: 1, machines: [{ id: 'laptop' }], sessions: [], h24: [] })
    if (answer === 401) return new Response('{}', { status: 401 })
    throw new TypeError('fetch failed', { cause: { code: answer === 'refused' ? 'ECONNREFUSED' : 'UND_ERR_SOCKET' } })
  }))
  const changed = vi.fn()
  const r = new Remote('laptop', 'http://127.0.0.1:4196', changed, { dataDir, weevbookDir: dataDir })
  expect(r.away()).toEqual({ why: 'link', since: null })
  r.start()
  await vi.advanceTimersByTimeAsync(3 * 60_000)
  const last = Date.now() - (Date.now() % 2000)
  expect(r.online).toBe(true)
  answer = 'refused'
  await vi.advanceTimersByTimeAsync(10_000)
  expect(r.online).toBe(false)
  const since = r.away().since!
  expect(r.away().why).toBe('link')
  expect(Math.abs(since - last)).toBeLessThanOrEqual(2000)
  // Its link comes back but weevils there does not answer; then it no longer lets this machine in.
  answer = 'closed'
  await vi.advanceTimersByTimeAsync(2000)
  expect(r.away()).toEqual({ why: 'stopped', since })
  answer = 401
  await vi.advanceTimersByTimeAsync(2000)
  expect(r.away()).toEqual({ why: 'key', since })
  // weevilsd restarts here: the same « since », read back.
  const again = new Remote('laptop', 'http://127.0.0.1:4196', vi.fn(), { dataDir, weevbookDir: dataDir })
  expect(again.away().since).toBe(since)
  fs.rmSync(dataDir, { recursive: true, force: true })
})

// A machine plugged in from its line is listed at once, as installing; why its install stopped, if it did; and a port
// another program holds here (it answers, but not as weevils).
it('a machine just plugged in says installing, then why its install stopped; a foreign program on its port says so', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { awayWhy } = await import('./remotes.ts')
  expect(awayWhy(Object.assign(new Error('404'), { status: 404 }))).toBe('port')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-join-'))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-23T18:40:00Z'))
  let answer: 'none' | 'foreign' | 'ok' = 'none'
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (answer === 'ok') return Response.json({ version: 1, machines: [{ id: 'studio' }], sessions: [], h24: [] })
    if (answer === 'foreign') return new Response('<html>Directory listing</html>', { status: 200 })
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
  }))
  const r = new Remote('studio', 'http://127.0.0.1:4195', vi.fn(), { dataDir, weevbookDir: dataDir })
  r.joined()
  const at = Date.now()
  r.start()
  await vi.advanceTimersByTimeAsync(4000)
  expect(r.away()).toEqual({ why: 'joining', since: at })
  // Known across a restart here.
  expect(new Remote('studio', 'http://127.0.0.1:4195', vi.fn(), { dataDir, weevbookDir: dataDir }).away().why).toBe('joining')
  r.failed('weevils could not install a package it needs on this computer: tmux', 'sudo pacman -S --needed tmux')
  expect(r.away()).toEqual({ why: 'failed', since: at, detail: 'weevils could not install a package it needs on this computer: tmux', fix: 'sudo pacman -S --needed tmux' })
  // A fresh line pasted again: installing again.
  r.joined()
  expect(r.away().why).toBe('joining')
  answer = 'ok'
  await vi.advanceTimersByTimeAsync(2000)
  expect(r.online).toBe(true)
  answer = 'foreign'
  await vi.advanceTimersByTimeAsync(2000)
  expect(r.online).toBe(false)
  expect(r.away().why).toBe('port')
  r.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

// One permission choice for the whole weevils (server/ask-follow.ts): the main machine tells the others over the link.
it('tells a secondary machine the main one\'s permission choice: at once, again when it changes, again after it comes back', async () => {
  vi.useFakeTimers()
  const asks: unknown[] = []
  let up = true
  let oldWeevils = true
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    if (!up) throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } })
    if (String(u).endsWith('/api/machine/ask')) {
      if (oldWeevils) return Response.json({ error: 'not found' }, { status: 404 })
      asks.push(JSON.parse(String(init?.body)).ask)
      return Response.json({ ok: true })
    }
    return Response.json({ version: 1, machines: [{ id: 'kusaila' }], sessions: [], h24: [] })
  }))
  let ask = false
  const r = new Remote('kusaila', 'http://127.0.0.1:4193', vi.fn(), { askChoice: () => ask })
  r.start()
  await vi.advanceTimersByTimeAsync(10)
  expect(asks).toEqual([]) // an older weevils there: no route yet…
  oldWeevils = false
  await vi.advanceTimersByTimeAsync(30_000)
  expect(asks).toEqual([]) // …tried again a minute later, not on every look
  await vi.advanceTimersByTimeAsync(31_000)
  expect(asks).toEqual([false]) // updated there: it takes it, without a line pasted again
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(asks).toEqual([false])
  ask = true
  await vi.advanceTimersByTimeAsync(61_000)
  expect(asks).toEqual([false, true])
  up = false
  await vi.advanceTimersByTimeAsync(4_000)
  up = true
  await vi.advanceTimersByTimeAsync(61_000)
  expect(asks).toEqual([false, true, true]) // back from a restart: told again
  r.stop()
})

it('a machine that is not the main one sends no permission choice', async () => {
  vi.useFakeTimers()
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return Response.json({ version: 1, machines: [{ id: 'pc' }], sessions: [], h24: [] }) }))
  const r = new Remote('pc', 'http://127.0.0.1:4192', vi.fn(), { askChoice: () => undefined })
  r.start()
  await vi.advanceTimersByTimeAsync(20_000)
  expect(urls.some((u) => u.endsWith('/api/machine/ask'))).toBe(false)
  r.stop()
})
