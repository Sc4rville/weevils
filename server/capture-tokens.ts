// `weevils capture` signs a headless browser in for a few minutes, so an agent can record the authenticated app without
// ever reading the access code (~/.config/weevils/secret). Held in memory only: a restart forgets them.
import crypto from 'node:crypto'

export const CAPTURE_TTL_MS = 10 * 60_000

export class CaptureTokens {
  private live = new Map<string, number>()
  private now: () => number
  constructor(now = Date.now) { this.now = now }
  mint(): string {
    const t = `cap-${crypto.randomBytes(24).toString('base64url')}`
    this.live.set(t, this.now() + CAPTURE_TTL_MS)
    for (const [k, until] of this.live) if (until <= this.now()) this.live.delete(k)
    return t
  }
  valid(t: string): boolean {
    const until = this.live.get(t)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.live.delete(t)
    return false
  }
}
