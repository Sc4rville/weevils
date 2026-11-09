// Qui parle au serveur : une requête « locale » (outil de cette machine, tunnel de fédération) est de confiance,
// sans code. Module sans effet de bord (aucune lecture de config) : testable seul (server/http.test.ts).
import type http from 'node:http'
import { normalizeFrom } from './authors.ts'

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const LOOPBACK_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i
/** En-têtes qu'ajoute un proxy (Caddy, nginx, tunnel) : leur présence veut dire que la requête vient d'ailleurs. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'x-real-ip']

const header = (req: http.IncomingMessage, name: string) => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

/** Host d'une adresse de bouclage, sur n'importe quel port (la fédération arrive par un tunnel sur un autre port). */
const loopbackHost = (host: string | undefined) => LOOPBACK_HOST_RE.test(host ?? '')

const loopbackOrigin = (origin: string) => {
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname)
  } catch {
    return false // « null » (iframe isolée, file://) ou valeur illisible
  }
}

/**
 * Contrôles côté navigateur : Host de bouclage (bloque le DNS rebinding), pas d'Origin étrangère, et pas de requête
 * cross-site sans Origin de bouclage (bloque une page web ouverte sur cette machine qui viserait 127.0.0.1).
 * Le proxy de Vite en dev transmet l'Origin http://127.0.0.1:4178 : acceptée.
 */
export function browserSafe(req: http.IncomingMessage): boolean {
  if (!loopbackHost(header(req, 'host'))) return false
  const origin = header(req, 'origin')
  if (origin !== undefined && !loopbackOrigin(origin)) return false
  const site = header(req, 'sec-fetch-site')
  if ((site === 'cross-site' || site === 'same-site') && origin === undefined) return false
  return true
}

/**
 * Requête née sur cette machine (weevils-cli, tunnel SSH de fédération, serveur de dev) : pair de bouclage, aucun
 * en-tête de proxy, et contrôles navigateur ci-dessus. Tout le reste doit présenter le code (cookie).
 */
export function isLocal(req: http.IncomingMessage): boolean {
  if (!LOOPBACK_PEERS.has(req.socket.remoteAddress ?? '')) return false
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false
  return browserSafe(req)
}

/** « from » (weevboss, un auteur déclaré) n'est accepté que d'une requête locale, jamais du téléphone. */
export function trustedFrom(req: http.IncomingMessage, body: { from?: unknown } | null | undefined): string | undefined {
  return isLocal(req) ? normalizeFrom(body?.from) : undefined
}
