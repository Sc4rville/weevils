// A repo's static pages, shown in the app's browser (/api/site/<key>/<repo>/…, server/index.ts). The sandboxed page
// carries no cookie, so the key in its address is its access: it changes every hour (the one before stays good for an
// hour more), and it opens only the repo's own files: every path is resolved (symbolic links included) and must stay
// inside the repo, never in a hidden folder (.git, .env…). Side-effect free, tested alone (server/site.test.ts).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** How long a site key is the current one. A key also opens pages during the next period. */
export const SITE_KEY_MS = 60 * 60_000

const keyAt = (secret: string, period: number) => crypto.createHmac('sha256', secret).update(`weevils-site:${period}`).digest('base64url').slice(0, 22)

/** The key the app puts in a site's address now. */
export const siteKey = (secret: string, now = Date.now()): string => keyAt(secret, Math.floor(now / SITE_KEY_MS))

/** The current key or the one just before it (a page opened a moment before the change keeps loading). */
export function siteKeyOk(secret: string, key: string, now = Date.now()): boolean {
  const period = Math.floor(now / SITE_KEY_MS)
  const got = Buffer.from(key)
  return [period, period - 1].some((p) => {
    const want = Buffer.from(keyAt(secret, p))
    return got.length === want.length && crypto.timingSafeEqual(got, want)
  })
}

const inside = (p: string, root: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
const hidden = (rel: string) => rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))
const realOr = (p: string): string | undefined => {
  try {
    return fs.realpathSync(p)
  } catch {
    return undefined
  }
}

/**
 * The real file a site path names inside the repo, or undefined: a hidden segment or `..`, a path or a symbolic link
 * leading out of the repo (or into one of its hidden folders), something that is not a regular file. A folder gives
 * its index.html.
 */
export function siteFile(root: string, rel: string): string | undefined {
  if (hidden(rel)) return undefined
  const base = realOr(root)
  if (!base) return undefined
  let real = realOr(path.resolve(base, `.${rel.startsWith('/') ? rel : `/${rel}`}`))
  if (!real || !inside(real, base)) return undefined
  if (fs.statSync(real).isDirectory()) {
    real = realOr(path.join(real, 'index.html'))
    if (!real || !inside(real, base)) return undefined
  }
  if (hidden(path.relative(base, real)) || !fs.statSync(real).isFile()) return undefined
  return real
}

/** Opens the file siteFile returned without following a link put in its place since (O_NOFOLLOW where there is one).
 *  Throws when it is gone or became a link. */
export function openSiteFile(file: string): fs.ReadStream {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  return fs.createReadStream('', { fd })
}
