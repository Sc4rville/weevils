// A computer set up from the setup page reaches the phone through a Cloudflare quick tunnel (get/bootstrap.sh: the
// weevils-link service, whose output goes to ~/.local/share/weevils/link.log). Its https://….trycloudflare.com address
// is a new one at every start of the tunnel (a restart of the computer, a network change, a crash), and the old one
// stops answering. weevilsd follows the log: a new address becomes the one of every link it makes, is written to the
// config for its next start, and is sent to the phone as a notification (push does not go through the tunnel, so it
// arrives even though the app's old address is dead).
import fs from 'node:fs'

/** A quick tunnel's own name: several words joined by dashes (never api.trycloudflare.com, which its errors quote). */
const TUNNEL = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/g

export const isTunnelUrl = (url: string): boolean => /^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\/?$/.test(url.trim())

/** The address the tunnel announced last in its log, or null. */
export function lastTunnelUrl(text: string): string | null {
  const all = text.match(TUNNEL)
  return all?.length ? all[all.length - 1] : null
}

/** The end of the log is enough: the address is printed a few lines after each start. */
const TAIL = 64 * 1024
function readTail(file: string): string {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, TAIL)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

export interface TunnelDeps {
  /** The tunnel's log. */
  file: string
  /** The public address weevils uses now (WEEVILS_PUBLIC_URL). */
  current: () => string
  /** Makes `url` the public address (links, config). */
  adopt: (url: string) => void
  /** Tells the phone (a push notification with the new login link). */
  announce: (url: string) => void | Promise<void>
  read?: (file: string) => string
}

/**
 * Follows the tunnel's log. Only an address that already was a quick tunnel's is replaced: a domain, Tailscale or a
 * proxy of the user's own (set later with --url) is never overwritten by a tunnel still running from the setup.
 */
export class TunnelFollower {
  private seen = ''
  private timer: NodeJS.Timeout | null = null
  private d: TunnelDeps
  constructor(d: TunnelDeps) {
    this.d = d
  }

  /** One look at the log; returns the address adopted, if any. */
  check(): string | null {
    let stamp = ''
    try {
      const st = fs.statSync(this.d.file)
      stamp = `${st.size}:${st.mtimeMs}`
    } catch {
      return null
    }
    if (stamp === this.seen) return null
    this.seen = stamp
    let found: string | null
    try {
      found = lastTunnelUrl((this.d.read ?? readTail)(this.d.file))
    } catch {
      return null
    }
    const cur = this.d.current().trim().replace(/\/$/, '')
    if (!found || found === cur || !isTunnelUrl(cur)) return null
    this.d.adopt(found)
    void Promise.resolve(this.d.announce(found)).catch((e) => console.error('[link] announce:', (e as Error).message))
    return found
  }

  start(everyMs = 5000) {
    if (this.timer) return
    this.check()
    this.timer = setInterval(() => {
      try {
        const url = this.check()
        if (url) console.log(`[link] new tunnel address: ${new URL(url).host}`)
      } catch (e) {
        console.error('[link]', (e as Error).message)
      }
    }, everyMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** Waits (up to `tries` × `gapMs`) until the new address serves the app: Cloudflare takes a few seconds to route it. */
export async function waitServed(url: string, tries = 30, gapMs = 2000, get: (u: string) => Promise<boolean> = served): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await get(`${url}/manifest.webmanifest`)) return true
    await new Promise((r) => setTimeout(r, gapMs))
  }
  return false
}
const served = (u: string) => fetch(u, { signal: AbortSignal.timeout(5000), redirect: 'manual' }).then((r) => r.ok, () => false)
