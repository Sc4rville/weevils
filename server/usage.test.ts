import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionTokens, usageOfLine, rate, codexQuota, claudeQuota, resetQuotaSlots, quotaBackoff } from './usage.ts'
import { CODEX_DIR, DATA_DIR, HOME } from './config.ts'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

it('retains the actual rate-limit observation time instead of presenting old rollout headers as fresh quota', async () => {
  fs.mkdirSync(CODEX_DIR, { recursive: true })
  const file = path.join(CODEX_DIR, 'quota-evidence.jsonl'), old = Date.now() - 86400000
  fs.writeFileSync(file, JSON.stringify({ timestamp: new Date(old).toISOString(), payload: { rate_limits: { primary: { window_minutes: 300, used_percent: 100, resets_at: Math.floor(old / 1000) + 3600 } } } }) + '\n')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
  try {
    const q = await codexQuota()
    expect(q.source).toBe('codex rollout rate_limits')
    expect(q.at).toBe(old)
    expect(q.windows[0].percent).toBe(100)
  } finally { vi.unstubAllGlobals(); fs.rmSync(file) }
})

const claude = (id: string, u: Record<string, number>, model = 'claude-sonnet') =>
  JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/w', timestamp: '2026-11-10T09:00:00Z', message: { id, model, usage: u } })

describe('usage — a session transcript', () => {
  it('one line: tokens, weight, the message id (claude), nothing on a line without usage', () => {
    const u = usageOfLine(JSON.parse(claude('m1', { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 4, cache_read_input_tokens: 100 })), 'claude')
    expect(u).toMatchObject({ id: 'm1', tokens: 116, weight: 10 + 10 + 5 + 10, sid: 's1', cwd: '/w' })
    expect(usageOfLine({ type: 'user', message: { content: 'hi' } }, 'claude')).toBeNull()
    expect(usageOfLine({ payload: { info: { last_token_usage: { input_tokens: 50, cached_input_tokens: 40, output_tokens: 5, total_tokens: 55 } } } }, 'codex')).toMatchObject({ tokens: 55 })
    expect(usageOfLine({ payload: { type: 'message' } }, 'codex')).toBeNull()
  })

  it('the tokens of a whole run: each message once (claude writes one response on several lines), read incrementally', () => {
    const f = path.join(dir, 's1.jsonl')
    fs.writeFileSync(
      f,
      [
        JSON.stringify({ type: 'user', message: { content: 'go' } }),
        claude('m1', { input_tokens: 100, output_tokens: 20 }),
        claude('m1', { input_tokens: 100, output_tokens: 20 }),
        claude('m2', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 1000 }),
        '{broken',
        '',
      ].join('\n'),
    )
    expect(sessionTokens(f)).toBe(1126)
    // Appended (a half-written last line waits for its end).
    fs.appendFileSync(f, `${claude('m2', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 1000 })}\n${claude('m3', { input_tokens: 4, output_tokens: 0 })}`)
    expect(sessionTokens(f)).toBe(1126)
    fs.appendFileSync(f, '\n')
    expect(sessionTokens(f)).toBe(1130)
    expect(sessionTokens(path.join(dir, 'none.jsonl'))).toBe(0)
  })

  it('codex: every token_count line', () => {
    const f = path.join(dir, 'rollout.jsonl')
    const line = (n: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n, output_tokens: 1, total_tokens: n + 1 } } } })
    fs.writeFileSync(f, `${line(10)}\n${line(20)}\n`)
    expect(sessionTokens(f, 'codex')).toBe(32)
  })
})

it('Codex cumulative snapshots: duplicates, increments, reset, truncation and separate sessions', () => {
 const f=path.join(dir,'cx.jsonl'), other=path.join(dir,'other.jsonl')
 const line=(n:number)=>JSON.stringify({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,output_tokens:0,total_tokens:n},last_token_usage:{input_tokens:100,total_tokens:100}}}})+'\n'
 fs.writeFileSync(f,line(100)+line(100)+line(160))
 expect(sessionTokens(f,'codex')).toBe(160)
 fs.appendFileSync(f,line(160)+line(200))
 expect(sessionTokens(f,'codex')).toBe(200)
 fs.appendFileSync(f,line(10)+line(25))
 expect(sessionTokens(f,'codex')).toBe(225)
 fs.writeFileSync(other,line(50));expect(sessionTokens(other,'codex')).toBe(50)
 fs.writeFileSync(f,line(5));expect(sessionTokens(f,'codex')).toBe(5)
})

it('discovers active Codex files under old year/month directories and uses deltas for the live rate', async () => {
 const { CODEX_DIR } = await import('./config.ts')
 const parent=path.join(CODEX_DIR,'2026','11','10');fs.mkdirSync(parent,{recursive:true})
 const now=new Date().toISOString()
 const event=(n:number)=>JSON.stringify({timestamp:now,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,total_tokens:n}}}})
 fs.writeFileSync(path.join(parent,'active.jsonl'),[event(100),event(100),event(150),''].join('\n'))
 for(const p of [CODEX_DIR,path.dirname(path.dirname(parent)),path.dirname(parent),parent])fs.utimesSync(p,new Date('2020-01-01'),new Date('2020-01-01'))
 const r=rate();expect(r.available).toBe(true);expect(r.buckets.reduce((a,b)=>a+b,0)).toBe(150)
})

describe('usage — the Claude quota under 429', () => {
  const answer = { five_hour: { utilization: 42, resets_at: '2026-11-13T15:00:00Z' }, seven_day: { utilization: 61, resets_at: '2026-11-17T08:00:00Z' }, seven_day_opus: { utilization: 12, resets_at: '2026-11-17T08:00:00Z' } }
  const ok = () => new Response(JSON.stringify(answer), { status: 200 })
  const tooMany = (retry?: number) => new Response('{}', { status: 429, headers: retry ? { 'retry-after': String(retry) } : {} })
  beforeEach(() => {
    fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(HOME, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 't', subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }))
    fs.rmSync(path.join(DATA_DIR, 'quota-cache.json'), { force: true })
    resetQuotaSlots()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-13T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('one call shared by every caller, at most every 5 min; a 429 keeps the last figures (with their age) and backs off', async () => {
    const fetch = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetch)
    const first = await Promise.all([claudeQuota(), claudeQuota(), claudeQuota()])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(first[0]).toMatchObject({ ok: true, plan: 'Max 20x' })
    expect(first[0].windows.map((w) => [w.kind, w.percent])).toEqual([['session', 42], ['week', 61], ['model', 12]])
    const at = first[0].at

    vi.setSystemTime(Date.now() + 4 * 60_000)
    await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(1)

    // Six minutes later: Anthropic answers 429 (Retry-After 15 min). The figures stay, marked, and nobody asks again before then.
    fetch.mockImplementation(async () => tooMany(900))
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await claudeQuota()
    await new Promise((r) => setTimeout(r, 0))
    const q = await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(q).toMatchObject({ ok: true, at, stale: true, error: 'HTTP 429' })
    expect(q.windows).toHaveLength(3)
    vi.setSystemTime(Date.now() + 14 * 60_000)
    await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockImplementation(async () => tooMany())
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(3)
    await new Promise((r) => setTimeout(r, 0))
    // Second failure in a row, no Retry-After: 10 min.
    vi.setSystemTime(Date.now() + 9 * 60_000)
    await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(3)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    fetch.mockImplementation(async () => ok())
    await claudeQuota()
    expect(fetch).toHaveBeenCalledTimes(4)
    await new Promise((r) => setTimeout(r, 0))
    expect(await claudeQuota()).not.toHaveProperty('stale')
    expect(await claudeQuota()).not.toHaveProperty('error')
  })

  it('a restart under 429 still shows the last valid answer, read from disk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    const saved = await claudeQuota()
    resetQuotaSlots()
    const fetch = vi.fn(async () => tooMany())
    vi.stubGlobal('fetch', fetch)
    // Restarted within the 5 min: not even asked.
    expect(await claudeQuota()).toMatchObject({ ok: true, at: saved.at, windows: saved.windows })
    expect(fetch).not.toHaveBeenCalled()
    resetQuotaSlots()
    vi.setSystemTime(Date.now() + 30 * 60_000)
    expect(await claudeQuota()).toMatchObject({ ok: true, at: saved.at, windows: saved.windows })
    await new Promise((r) => setTimeout(r, 0))
    expect(await claudeQuota()).toMatchObject({ ok: true, at: saved.at, error: 'HTTP 429' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('Codex too: a 429 keeps its last valid answer, marked stale', async () => {
    fs.mkdirSync(path.join(HOME, '.codex'), { recursive: true })
    fs.writeFileSync(path.join(HOME, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 't', account_id: 'a' } }))
    const fetch = vi.fn(async () => new Response(JSON.stringify({ plan_type: 'pro', rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: 30, reset_at: 1794600000 }, secondary_window: { limit_window_seconds: 604800, used_percent: 55, reset_at: 1794900000 } } })))
    vi.stubGlobal('fetch', fetch)
    const good = await codexQuota()
    expect(good).toMatchObject({ ok: true, plan: 'pro', source: 'chatgpt.com/backend-api/wham/usage' })
    fetch.mockImplementation(async () => tooMany())
    vi.setSystemTime(Date.now() + 6 * 60_000)
    await codexQuota()
    await new Promise((r) => setTimeout(r, 0))
    expect(await codexQuota()).toMatchObject({ ok: true, at: good.at, windows: good.windows, stale: true, error: 'HTTP 429' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('nothing known yet and a 429: an error, never an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tooMany()))
    expect(await claudeQuota()).toMatchObject({ ok: false, windows: [], error: 'HTTP 429' })
  })
})

it('quota back-off: 5, 10, 20 min… capped at 1 h, never under Retry-After', () => {
  expect(quotaBackoff(1)).toBe(5 * 60_000)
  expect(quotaBackoff(3)).toBe(20 * 60_000)
  expect(quotaBackoff(20)).toBe(60 * 60_000)
  expect(quotaBackoff(1, 15 * 60_000)).toBe(15 * 60_000)
})
