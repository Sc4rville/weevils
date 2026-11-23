// The direct link of a For you post (docs/foryou.md): what the post shows lives at that address (a site, a preview, a
// page, an app screen), and the post opens it, from a coloured link under its title and from a tap on its media.
// Given with `weevils show / post --link <url> [--link-label "label"]` or `weevils link <post id> <url>`. Only a web
// address someone else's phone can open: never localhost, a loopback, a private network or a .local name.

export interface PostLink {
  url: string
  /** What the link says; without it, the address's host (and path). */
  label?: string
}

const LABEL_MAX = 80
const URL_MAX = 2000

/** Hosts only this machine or its own network can reach. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true
  if (!h.includes('.') && !h.includes(':')) return true // a bare machine name
  if (h === '::' || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h) || /^::ffff:/.test(h)) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/** The link as stored, or why not: 'url' (not an http(s) address), 'local' (only this machine can open it). */
export function postLink(url: unknown, label?: unknown): PostLink | 'url' | 'local' {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw || raw.length > URL_MAX) return 'url'
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'url'
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname) return 'url'
  if (privateHost(u.hostname)) return 'local'
  const words = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) : ''
  return { url: u.href, ...(words ? { label: words } : {}) }
}

/** What a link without a label says: its host, and its path when there is one (`new-site.example.com/menu`). */
export function linkText(l: PostLink): string {
  if (l.label) return l.label
  try {
    const u = new URL(l.url)
    const p = u.pathname.replace(/\/$/, '')
    const t = u.host.replace(/^www\./, '') + p
    return t.length > 48 ? t.slice(0, 47) + '…' : t
  } catch {
    return l.url
  }
}
