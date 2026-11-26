// weevils' side of the stable address (server/stable-link.ts): which handle it holds, claiming one, and moving an
// older install off the Cloudflare quick tunnel. Its effects (config, public address, phone, old tunnel service) come
// as deps: tested without a network in server/stable-address.test.ts.
//
//   WEEVILS_LINK_HANDLE, WEEVILS_LINK_TOKEN   the handle this weevils holds and its token (config, 0600)
//   WEEVILS_LINK_RELAY                        another relay than the official one (someone running their own)
//   WEEVILS_LINK=off                          never claim one by itself (an install on a quick tunnel stays on it)
//
// A weevils with its own domain, Tailscale or a proxy (WEEVILS_PUBLIC_URL that is not a quick tunnel) never gets one
// unless asked (weevils address claim): its own address stays the one everywhere.
import crypto from 'node:crypto'
import { isTunnelUrl } from './tunnel-link.ts'
import { DEFAULT_RELAY } from './link-proto.ts'
import { claimFirst, handleCandidates, releaseHandle, StableLink, type ClaimResult, type LinkStatus } from './stable-link.ts'

export interface AddressDeps {
  env: () => Record<string, string | undefined>
  port: number
  publicUrl: () => string
  /** Writes these keys to the config (and process.env). */
  write: (changes: Record<string, string>) => void
  /** Makes `url` weevils' public address now (links, login-link file). */
  adopt: (url: string) => void
  /** Tells the phone the new, permanent address (a push with the login link), once it answers. */
  announce?: (url: string) => void | Promise<void>
  /** Stops the old quick tunnel service, now useless (it still exposed weevils under a random name). */
  retireTunnel?: () => void
  /** Waits until the address serves the app (the relay's certificate takes a few seconds the first time). */
  served?: (url: string) => Promise<boolean>
  fetcher?: typeof fetch
  log?: (line: string) => void
  /** Something changed (the app shows the state). */
  changed?: () => void
  makeLink?: (o: ConstructorParameters<typeof StableLink>[0]) => Pick<StableLink, 'start' | 'stop' | 'status'>
}

export interface AddressStatus {
  /** 'none': no stable address (own domain, local only, or never claimed). */
  state: LinkStatus['state'] | 'none'
  handle?: string
  url?: string
  relay: string
  since?: number
  error?: string
}

const random = () => crypto.randomBytes(3).readUIntBE(0, 3).toString(36).padStart(4, '0').slice(-4)

export class StableAddress {
  private link: Pick<StableLink, 'start' | 'stop' | 'status'> | null = null
  private d: AddressDeps
  private claiming: Promise<ClaimResult> | null = null
  constructor(d: AddressDeps) {
    this.d = d
  }

  relay() {
    return (this.d.env().WEEVILS_LINK_RELAY?.trim() || DEFAULT_RELAY).replace(/\/+$/, '')
  }

  status(): AddressStatus {
    const s = this.link?.status()
    return s ? { state: s.state, handle: s.handle, url: s.url, relay: this.relay(), since: s.since, ...(s.error ? { error: s.error } : {}) } : { state: 'none', relay: this.relay() }
  }

  /** At start: connect the handle held, or move a quick-tunnel install to a stable address. */
  async start(): Promise<void> {
    const env = this.d.env()
    const handle = env.WEEVILS_LINK_HANDLE?.trim()
    const token = env.WEEVILS_LINK_TOKEN?.trim()
    if (handle && token) return void this.connect(handle, token, this.d.publicUrl())
    if (env.WEEVILS_LINK?.trim().toLowerCase() === 'off') return
    if (!isTunnelUrl(this.d.publicUrl())) return
    const r = await this.claim('')
    if (r.ok) this.d.log?.(`moved off the quick tunnel: ${r.url}`)
    else this.d.log?.(`no stable address yet (${r.error}): staying on the quick tunnel`)
  }

  private connect(handle: string, token: string, url?: string) {
    this.link?.stop()
    const o = {
      relay: this.relay(),
      handle,
      token,
      port: this.d.port,
      ...(url && /^https:\/\//.test(url) && new URL(url).hostname.startsWith(`${handle}.`) ? { url: url.replace(/\/+$/, '') } : {}),
      log: this.d.log,
      onState: () => this.d.changed?.(),
      onRevoked: () => this.d.log?.(`the relay no longer knows ${handle}: weevils address claim <name> takes a new one`),
    }
    this.link = (this.d.makeLink ?? ((x) => new StableLink(x)))(o).start()
  }

  /**
   * Claims a handle (the one asked for, else one from the person's name), makes it the public address, connects, and
   * tells the phone once it answers. A handle already held is released after the new one is up.
   */
  claim(wanted: string): Promise<ClaimResult> {
    this.claiming ??= this.doClaim(wanted).finally(() => (this.claiming = null))
    return this.claiming
  }

  private async doClaim(wanted: string): Promise<ClaimResult> {
    const env = this.d.env()
    const relay = this.relay()
    const before = { handle: env.WEEVILS_LINK_HANDLE?.trim() ?? '', token: env.WEEVILS_LINK_TOKEN?.trim() ?? '' }
    if (wanted && wanted === before.handle && before.token) {
      return { ok: true, handle: before.handle, token: before.token, url: this.status().url ?? this.d.publicUrl() }
    }
    const candidates = handleCandidates(wanted, env.WEEVILS_USER_NAME ?? '', env.USER ?? env.LOGNAME ?? '', random)
    // A name asked for is that name or nothing: no random ending the person did not choose.
    const r = await claimFirst(relay, wanted ? candidates.slice(0, 1) : candidates, this.d.fetcher)
    if (!r.ok) return r
    this.d.write({ WEEVILS_LINK_HANDLE: r.handle, WEEVILS_LINK_TOKEN: r.token, WEEVILS_PUBLIC_URL: r.url })
    this.d.adopt(r.url)
    this.connect(r.handle, r.token, r.url)
    this.d.changed?.()
    const ok = this.d.served ? await this.d.served(r.url) : true
    if (ok) {
      try {
        this.d.retireTunnel?.()
      } catch (e) {
        this.d.log?.(`old tunnel: ${(e as Error).message}`)
      }
      void Promise.resolve(this.d.announce?.(r.url)).catch(() => undefined)
    }
    if (before.handle && before.token && before.handle !== r.handle) void releaseHandle(relay, before.handle, before.token, this.d.fetcher)
    return r
  }

  /** Gives the handle back: the address stops answering, the config forgets it (the public address is left to the person). */
  async release(): Promise<boolean> {
    const env = this.d.env()
    const handle = env.WEEVILS_LINK_HANDLE?.trim()
    const token = env.WEEVILS_LINK_TOKEN?.trim()
    if (!handle || !token) return false
    const ok = await releaseHandle(this.relay(), handle, token, this.d.fetcher)
    if (!ok) return false
    this.link?.stop()
    this.link = null
    // Never claimed again by itself after a release; the public address goes too when it was that handle's.
    const url = this.d.publicUrl().replace(/\/+$/, '')
    const was = /^https:\/\//.test(url) && new URL(url).hostname.startsWith(`${handle}.`)
    this.d.write({ WEEVILS_LINK_HANDLE: '', WEEVILS_LINK_TOKEN: '', WEEVILS_LINK: 'off', ...(was ? { WEEVILS_PUBLIC_URL: '' } : {}) })
    if (was) this.d.adopt('')
    this.d.changed?.()
    return true
  }

  stop() {
    this.link?.stop()
  }
}
