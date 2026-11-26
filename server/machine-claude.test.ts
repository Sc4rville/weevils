import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as login from './claude-login.ts'
import { answer, waitingFor, fresh, type Here } from './machine-claude.ts'

// Claude's sign-in on a secondary machine, driven from the main machine's weevboss thread: what that machine answers.

function here(o: Partial<Here> & { has?: boolean; signed?: boolean } = {}) {
  const st = { has: o.has ?? true, signed: o.signed ?? false }
  const h: Here & { st: typeof st } = {
    st,
    installed: () => st.has,
    logged: () => st.signed,
    install: vi.fn(async () => ((st.has = true), { ok: true, why: '' })),
    start: vi.fn(async () => 'https://claude.com/cai/oauth/authorize?code=true&state=x'),
    why: () => 'no browser',
    submit: vi.fn(async () => ((st.signed = true), { ok: true as const })),
    ...o,
  }
  return h
}

describe('the routes of the machine that signs in', () => {
  it('starts the sign-in and gives its page; already signed in, says so and starts nothing', async () => {
    const h = here()
    expect(await answer('login', {}, h)).toEqual({ status: 200, body: { installed: true, logged: false, url: 'https://claude.com/cai/oauth/authorize?code=true&state=x' } })
    expect(h.start).toHaveBeenCalledWith(false)
    await answer('login', { fresh: true }, h)
    expect(h.start).toHaveBeenLastCalledWith(true)
    const s = here({ signed: true })
    expect(await answer('login', {}, s)).toEqual({ status: 200, body: { installed: true, logged: true } })
    expect(s.start).not.toHaveBeenCalled()
  })

  it('Claude Code missing: installed first only when asked; an install that fails says why', async () => {
    const h = here({ has: false })
    expect(await answer('login', {}, h)).toEqual({ status: 200, body: { installed: false, logged: false } })
    expect(h.install).not.toHaveBeenCalled()
    expect((await answer('login', { install: true }, h)).body).toMatchObject({ installed: true, logged: false, url: expect.stringContaining('oauth/authorize') })
    expect(h.install).toHaveBeenCalledTimes(1)
    const bad = here({ has: false, install: async () => ({ ok: false, why: 'curl: (6) Could not resolve host' }) })
    expect(await answer('login', { install: true }, bad)).toEqual({ status: 200, body: { installed: false, logged: false, why: 'curl: (6) Could not resolve host' } })
  })

  it('no page from the CLI: why, in its own words', async () => {
    expect((await answer('login', {}, here({ start: async () => '' }))).body).toEqual({ installed: true, logged: false, why: 'no browser' })
  })

  it('the code: spaces dropped, handed over; nothing to hand when signed in already; no code is a bad request', async () => {
    const h = here()
    expect(await answer('code', { code: ' abcDEF1234567890ghij#KLMN \n' }, h)).toEqual({ status: 200, body: { ok: true } })
    expect(h.submit).toHaveBeenCalledWith('abcDEF1234567890ghij#KLMN')
    expect(await answer('code', { code: 'x' }, h)).toEqual({ status: 200, body: { ok: true } })
    expect(h.submit).toHaveBeenCalledTimes(1)
    expect((await answer('code', {}, here())).status).toBe(400)
    expect((await answer('code', { code: 'a'.repeat(600) }, here())).status).toBe(400)
    expect((await answer('code', null, here())).status).toBe(400)
  })
})

describe('which machine a pasted code is for', () => {
  it('the latest sign-in still usable', () => {
    const now = 1_000_000_000
    expect(waitingFor(undefined, now)).toBeNull()
    expect(waitingFor({ desk: now - 60_000, laptop: now - 5_000 }, now)).toBe('laptop')
    expect(waitingFor({ desk: now - 60_000, laptop: now - login.LOGIN_TTL - 1 }, now)).toBe('desk')
    expect(waitingFor({ desk: now - login.LOGIN_TTL }, now)).toBeNull()
    expect(fresh({ desk: now - 1, laptop: now - login.LOGIN_TTL }, now)).toEqual({ desk: now - 1 })
  })
})

// The real sign-in (server/claude-login.ts) behind the routes, with a stand-in for « claude auth login » (as in
// claude-login.test.ts): the page comes back, a good code signs Claude Code in on that machine.
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&state=xyz'
const FAKE = `#!/bin/sh
printf 'If the browser didn'"'"'t open, visit: ${URL}\\nPaste code here if prompted > '
read code
if [ "$code" = "good#xyz" ]; then echo '{"claudeAiOauth":{}}' > "$CREDS"; echo 'Login successful.'; sleep 30
else echo "Login failed: That code wasn't accepted."; exit 1; fi
`
const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) {
    login.cancel(real(r).d)
    fs.rmSync(r, { recursive: true, force: true })
  }
})
function real(root: string) {
  const creds = path.join(root, 'creds.json')
  const d: login.LoginDeps = { dir: path.join(root, 'claude-login'), bin: path.join(root, 'claude'), env: { ...process.env, CREDS: creds }, logged: () => fs.existsSync(creds) }
  const h: Here = {
    installed: () => fs.existsSync(d.bin),
    logged: d.logged,
    install: async () => ({ ok: false, why: 'not here' }),
    start: (f) => login.start(d, f),
    why: () => login.lastLine(login.output(d)),
    submit: (code) => login.submit(d, code),
  }
  return { d, h }
}

it('end to end on that machine: its page, a wrong code says why, a new page, the good code signs it in', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-machine-claude-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'claude'), FAKE, { mode: 0o755 })
  const { h } = real(root)
  expect((await answer('login', {}, h)).body).toEqual({ installed: true, logged: false, url: URL })
  expect((await answer('code', { code: 'bad#code' }, h)).body).toEqual({ ok: false, why: "That code wasn't accepted." })
  expect((await answer('login', {}, h)).body).toEqual({ installed: true, logged: false, url: URL })
  expect((await answer('code', { code: 'good#xyz' }, h)).body).toEqual({ ok: true })
  expect((await answer('login', {}, h)).body).toEqual({ installed: true, logged: true })
}, 30_000)
