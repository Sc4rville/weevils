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
