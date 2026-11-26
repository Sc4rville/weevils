import { describe, expect, it } from 'vitest'
import { StableAddress, type AddressDeps } from './stable-address.ts'
import type { LinkStatus } from './stable-link.ts'

const TUNNEL = 'https://calm-river-blue-sky.trycloudflare.com'

/** A relay that knows `taken` handles, and a link that is online at once. */
function setup(o: { env?: Record<string, string>; publicUrl?: string; taken?: string[]; down?: boolean } = {}) {
  const env: Record<string, string | undefined> = { USER: 'tux', ...o.env }
  let pub = o.publicUrl ?? ''
  const taken = new Set(o.taken ?? [])
  const calls: string[] = []
  const links: { handle: string; token: string; url?: string; stopped: boolean }[] = []
  const fetcher = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url))
    calls.push(`${u.pathname} ${init?.body ?? ''}`)
    if (o.down) throw new Error('offline')
    if (u.pathname === '/v1/claim') {
      const h = JSON.parse(String(init?.body)).handle
      if (taken.has(h)) return new Response(JSON.stringify({ error: 'taken' }), { status: 409 })
      taken.add(h)
      return new Response(JSON.stringify({ handle: h, token: `wvl_${h}`, url: `https://${h}.tryweevils.example.com` }), { status: 201 })
    }
    if (u.pathname === '/v1/release') return new Response('{}', { status: 200 })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const events: string[] = []
  const deps: AddressDeps = {
    env: () => env,
    port: 4179,
    publicUrl: () => pub,
    write: (c) => {
      for (const [k, v] of Object.entries(c)) env[k] = v || undefined
    },
    adopt: (url) => {
      pub = url
      events.push(`adopt ${url}`)
    },
    announce: (url) => void events.push(`announce ${url}`),
    retireTunnel: () => void events.push('retire'),
    served: async () => true,
    fetcher,
    makeLink: (x) => {
      const l = { handle: x.handle, token: x.token, url: x.url, stopped: false }
      links.push(l)
      const st: LinkStatus = { handle: x.handle, url: x.url ?? `https://${x.handle}.tryweevils.example.com`, state: 'online', since: 1 }
      const api = { start: () => api as never, stop: () => void (l.stopped = true), status: () => st }
      return api
    },
  }
  return { a: new StableAddress(deps), env, calls, links, events, pub: () => pub }
}

describe('the stable address in weevils', () => {
  it('moves a computer off its quick tunnel to a handle from its name, once, and tells the phone', async () => {
    const t = setup({ publicUrl: TUNNEL, env: { WEEVILS_USER_NAME: 'Alex' } })
    await t.a.start()
    expect(t.env.WEEVILS_LINK_HANDLE).toBe('alex')
    expect(t.env.WEEVILS_LINK_TOKEN).toBe('wvl_alex')
    expect(t.pub()).toBe('https://alex.tryweevils.example.com')
    expect(t.env.WEEVILS_PUBLIC_URL).toBe('https://alex.tryweevils.example.com')
    expect(t.events).toEqual(['adopt https://alex.tryweevils.example.com', 'retire', 'announce https://alex.tryweevils.example.com'])
    expect(t.a.status()).toMatchObject({ state: 'online', handle: 'alex' })
  })

  it('takes a free variant when the name is taken', async () => {
    const t = setup({ publicUrl: TUNNEL, env: { WEEVILS_USER_NAME: 'Alex' }, taken: ['alex'] })
    await t.a.start()
    expect(t.env.WEEVILS_LINK_HANDLE).toMatch(/^alex-[a-z0-9]{4}$/)
  })

  it('reconnects the handle it holds, and never claims for its own domain, a local install or WEEVILS_LINK=off', async () => {
    const held = setup({ env: { WEEVILS_LINK_HANDLE: 'alex', WEEVILS_LINK_TOKEN: 'wvl_alex' }, publicUrl: 'https://alex.tryweevils.example.com' })
    await held.a.start()
    expect(held.calls).toEqual([])
    expect(held.links[0]).toMatchObject({ handle: 'alex', token: 'wvl_alex', url: 'https://alex.tryweevils.example.com' })
    for (const t of [setup({ publicUrl: 'https://weevils.example.com' }), setup({ publicUrl: '' }), setup({ publicUrl: TUNNEL, env: { WEEVILS_LINK: 'off' } })]) {
      await t.a.start()
      expect(t.calls).toEqual([])
      expect(t.a.status().state).toBe('none')
    }
  })

  it('stays on the quick tunnel when the relay cannot be reached', async () => {
    const t = setup({ publicUrl: TUNNEL, down: true })
    await t.a.start()
    expect(t.pub()).toBe(TUNNEL)
    expect(t.env.WEEVILS_LINK_TOKEN).toBeUndefined()
    expect(t.events).toEqual([])
  })

  it('a name asked for is that name or nothing, and the old handle is given back after the move', async () => {
    const t = setup({ env: { WEEVILS_LINK_HANDLE: 'alex', WEEVILS_LINK_TOKEN: 'wvl_alex' }, publicUrl: 'https://alex.tryweevils.example.com', taken: ['myshop'] })
    await t.a.start()
    expect(await t.a.claim('myshop')).toMatchObject({ ok: false, error: 'taken' })
    expect(t.env.WEEVILS_LINK_HANDLE).toBe('alex')
    const r = await t.a.claim('my-shop')
    expect(r).toMatchObject({ ok: true, handle: 'my-shop' })
    await new Promise((res) => setTimeout(res, 0))
    expect(t.calls.some((c) => c.startsWith('/v1/release') && c.includes('"alex"'))).toBe(true)
    expect(t.links[0].stopped).toBe(true)
    expect(t.pub()).toBe('https://my-shop.tryweevils.example.com')
  })

  it('a release forgets the handle and its address, and never claims again by itself', async () => {
    const t = setup({ env: { WEEVILS_LINK_HANDLE: 'alex', WEEVILS_LINK_TOKEN: 'wvl_alex' }, publicUrl: 'https://alex.tryweevils.example.com' })
    await t.a.start()
    expect(await t.a.release()).toBe(true)
    expect(t.env.WEEVILS_LINK_HANDLE).toBeUndefined()
    expect(t.env.WEEVILS_LINK).toBe('off')
    expect(t.pub()).toBe('')
    expect(t.a.status().state).toBe('none')
  })
})
