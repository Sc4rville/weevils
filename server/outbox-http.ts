import { Readable } from 'node:stream'
import type http from 'node:http'
import { OutboxError, type OutboxTask } from './outbox.ts'
import { tr } from './i18n.ts'
import M from './i18n/outbox.ts'
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
export const outboxRoute = (pathname: string) => /^\/api\/(?:main(?:\/attach)?|sessions\/[^/]+\/(?:send|attach)|foryou\/[^/]+\/(?:reply|act))$/.test(pathname)
/** Replay a persisted, authenticated intent through the same handlers, never through the network. */
export async function executeOutbox(task: OutboxTask, routes: [string, RegExp, Handler][]) {
  const url = new URL(task.url, 'http://local')
  if (!outboxRoute(url.pathname)) throw new OutboxError(400, tr(M).invalid)
  const route = routes.find(([method, re]) => method === 'POST' && re.test(url.pathname))
  if (!route) throw new OutboxError(404, tr(M).missing)
  const req = Readable.from([JSON.stringify(task.body)]) as unknown as http.IncomingMessage
  req.method = 'POST'; req.url = task.url
  // `from` was resolved by trustedFrom on the authenticated original request, never trusted from the client body.
  req.headers = { host: 'localhost', 'content-type': 'application/json' }
  Object.assign(req, { socket: { remoteAddress: '127.0.0.1' } })
  let status = 200, result: any = {}, ended = false
  const res = {
    writeHead(code: number) { status = code; return this },
    end(body?: string) { ended = true; result = body ? JSON.parse(body) : {}; return this },
  } as unknown as http.ServerResponse
  await route[2](req, res, url, route[1].exec(url.pathname)!.slice(1))
  // A handler may report an error after injecting into a terminal: 400 alone does not prove rejection.
  if (!ended || status >= 400) throw new Error(tr(M).uncertain)
  return result
}
