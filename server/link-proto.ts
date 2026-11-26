// The stable address's wire rules, shared by the relay (server/link-relay.ts, on the server that owns the domain) and
// the link of each weevils (server/stable-link.ts). No side effect: tested with both ends in server/stable-link.test.ts.
//
// How it works: weevils opens ONE outgoing HTTPS connection to the relay (GET /v1/connect, `Upgrade: weevils-link`,
// its handle and its token). The relay answers 101 and the connection becomes an HTTP/2 connection the other way
// round: the relay is the client, weevils the server. Each request that reaches https://<handle>.<domain> becomes one
// HTTP/2 stream on it, which weevils replays to its own port on 127.0.0.1. A WebSocket (or any HTTP upgrade) becomes one
// stream too (UPGRADE_PATH), raw bytes both ways. Nothing is opened on the computer: no port, no router, no firewall.

/** The protocol named in `Upgrade:` when weevils connects. */
export const LINK_PROTOCOL = 'weevils-link'
/** The path of a stream that carries an HTTP upgrade (a WebSocket), raw, its original request in UPGRADE_HEAD. */
export const UPGRADE_PATH = '/.weevils-link/upgrade'
export const UPGRADE_HEAD = 'x-weevils-link-head'
/** The official relay: every weevils without a domain of its own gets https://<handle>.tryweevils.scarville.tech. */
export const DEFAULT_RELAY = 'https://relay.tryweevils.scarville.tech'

/** 3 to 30 letters, digits and dashes, a letter or digit at each end, never two dashes in a row (punycode's « xn-- »). */
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/
/** Names a handle can never take: the relay's own, the usual service names, names that look official. */
export const RESERVED = new Set(
  ('relay www api admin get try tryweevils weevils weevboss scarville mail smtp imap pop ftp ns1 ns2 dns root support help ' +
    'status static cdn assets app apps login signin auth oauth mcp security abuse postmaster hostmaster webmaster test ' +
    'demo docs doc blog link links dashboard account accounts billing pay official update updates install setup').split(' '),
)

export function handleProblem(h: string): 'length' | 'characters' | 'reserved' | null {
  if (h.length < 3 || h.length > 30) return 'length'
  if (!HANDLE.test(h) || h.includes('--')) return 'characters'
  if (RESERVED.has(h)) return 'reserved'
  return null
}
export const validHandle = (h: string) => handleProblem(h) === null

/** A handle from a name: « Alex Martin » → « alex-martin », accents dropped; '' when nothing usable is left. */
export function handleFrom(name: string): string {
  const h = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return h.length >= 3 ? h : ''
}

/** Headers that belong to one connection (RFC 9113 §8.2.2 forbids them in HTTP/2), and the ones each end sets itself. */
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'host', 'http2-settings', 'trailer'])
/** What a client could send to pass as the relay or the machine itself: never forwarded as it came. */
const SPOOFABLE = new Set(['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'x-weevils-local', 'cf-connecting-ip'])

type Headers = Record<string, string | string[] | number | undefined>

/** The end-to-end headers of a message, without pseudo-headers, hop-by-hop ones and (with `fromClient`) spoofable ones. */
export function endToEnd(h: Headers, fromClient = false): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase()
    if (v === undefined || key.startsWith(':') || HOP.has(key)) continue
    if (fromClient && SPOOFABLE.has(key)) continue
    if (key === UPGRADE_HEAD) continue
    out[key] = Array.isArray(v) ? v.map(String) : String(v)
  }
  return out
}

/** A header line that would end the head early (a CR or LF): refused, never written to a socket. */
export const safeHeader = (k: string, v: string) => /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(k) && !/[\r\n\0]/.test(v)

/** The original request of an upgrade, as it travels in UPGRADE_HEAD (base64 of JSON). */
export interface UpgradeHead {
  method: string
  path: string
  headers: [string, string][]
}
export const packHead = (h: UpgradeHead) => Buffer.from(JSON.stringify(h)).toString('base64')
export function unpackHead(s: string): UpgradeHead | null {
  try {
    const h = JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as UpgradeHead
    if (!/^[A-Z]{3,10}$/.test(h.method) || typeof h.path !== 'string' || !h.path.startsWith('/') || /[\s\0]/.test(h.path)) return null
    if (!Array.isArray(h.headers) || !h.headers.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string' && safeHeader(p[0], p[1]))) return null
    return h
  } catch {
    return null
  }
}
