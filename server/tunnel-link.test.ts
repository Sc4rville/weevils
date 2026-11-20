import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isTunnelUrl, lastTunnelUrl, TunnelFollower, waitServed } from './tunnel-link.ts'

let dir = ''
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-link-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const banner = (host: string) => `2026-11-20T10:00:00Z INF |  https://${host}.trycloudflare.com                                 |\n`
const failed = '2026-11-20T10:00:00Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host\n'

it('reads the last address a quick tunnel announced, never the API host its errors quote', () => {
  expect(lastTunnelUrl(banner('alpha-beta-gamma') + failed + banner('delta-epsilon-zeta') + failed)).toBe('https://delta-epsilon-zeta.trycloudflare.com')
  expect(lastTunnelUrl(failed)).toBeNull()
  expect(isTunnelUrl('https://alpha-beta-gamma.trycloudflare.com/')).toBe(true)
  expect(isTunnelUrl('https://api.trycloudflare.com')).toBe(false)
  expect(isTunnelUrl('https://box.tail1234.ts.net')).toBe(false)
})

function follower(current: string) {
  const file = path.join(dir, 'link.log')
  const state = { url: current, announced: [] as string[] }
  const f = new TunnelFollower({ file, current: () => state.url, adopt: (u) => { state.url = u }, announce: (u) => { state.announced.push(u) } })
  return { file, state, f }
}

it('adopts the address of a restarted tunnel and tells the phone once', () => {
  const { file, state, f } = follower('https://alpha-beta-gamma.trycloudflare.com')
  expect(f.check()).toBeNull() // no log yet
  fs.writeFileSync(file, banner('alpha-beta-gamma'))
  expect(f.check()).toBeNull() // same address
  fs.appendFileSync(file, failed + banner('delta-epsilon-zeta'))
  expect(f.check()).toBe('https://delta-epsilon-zeta.trycloudflare.com')
  expect(state.url).toBe('https://delta-epsilon-zeta.trycloudflare.com')
  expect(f.check()).toBeNull() // log unchanged
  fs.appendFileSync(file, 'INF Registered tunnel connection\n')
  expect(f.check()).toBeNull() // changed, same address
  expect(state.announced).toEqual(['https://delta-epsilon-zeta.trycloudflare.com'])
})

it('never replaces an address that is not a quick tunnel\'s (a domain, Tailscale, none)', () => {
  for (const cur of ['https://weevils.example.com', 'https://box.tail1234.ts.net', '']) {
    const { file, state, f } = follower(cur)
    fs.writeFileSync(file, banner('delta-epsilon-zeta'))
    expect(f.check()).toBeNull()
    expect(state.url).toBe(cur)
    expect(state.announced).toEqual([])
  }
})

it('waits for the new address to serve the app before giving up', async () => {
  const get = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await waitServed('https://delta-epsilon-zeta.trycloudflare.com', 5, 1, get)).toBe(true)
  expect(get).toHaveBeenCalledWith('https://delta-epsilon-zeta.trycloudflare.com/manifest.webmanifest')
  expect(await waitServed('https://x-y.trycloudflare.com', 2, 1, async () => false)).toBe(false)
})
