// weevilsd : API + flux temps réel pour l'app, et récepteur local des hooks Claude Code.
// Lancer : node server/index.ts (Node 22, TypeScript natif).

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { CONFIG_DIR, DATA_DIR, DIST_DIR, HOOK_PORT, PORT } from './config.ts'
import { openaiKey, transcribe } from './transcribe.ts'
import { Weevils } from './core.ts'

const w = new Weevils()
w.start()

// ---------------------------------------------------------------- secret partagé (ce soir) → passkey (demain)

fs.mkdirSync(CONFIG_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
const SECRET_FILE = path.join(CONFIG_DIR, 'secret')
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(9).toString('base64url'), { mode: 0o600 })
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim()
/** Saisie tolérante : majuscules, espaces et caractères qui se confondent (0/O, 1/l/I) ne font pas échouer. */
const foldCode = (c: string) => c.replace(/\s+/g, '').toLowerCase().replace(/o/g, '0').replace(/[il]/g, '1')
const sameCode = (a: string, b: string) => {
  const x = crypto.createHash('sha256').update(foldCode(a)).digest()
  const y = crypto.createHash('sha256').update(foldCode(b)).digest()
  return crypto.timingSafeEqual(x, y)
}
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json')
let tokens = new Set<string>()
try {
  tokens = new Set(JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')))
} catch {
  /* aucun appareil connecté */
}
const saveTokens = () => fs.writeFileSync(TOKENS_FILE, JSON.stringify([...tokens]), { mode: 0o600 })

const cookieToken = (req: http.IncomingMessage) => /(?:^|;\s*)wv=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1]
/** Requête née sur le VPS même (tunnel SSH, outils locaux) : jamais passée par Caddy, donc sans en-têtes de proxy. */
const isLocal = (req: http.IncomingMessage) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'] && !req.headers['x-forwarded-proto']
const authed = (req: http.IncomingMessage) => {
  if (isLocal(req)) return true
  const t = cookieToken(req)
  return !!t && tokens.has(t)
}

// ---------------------------------------------------------------- utilitaires

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readBody = (req: http.IncomingMessage, limit = 1 << 20) =>
  new Promise<any>((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) {
        reject(new Error('corps trop grand'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('JSON invalide'))
      }
    })
    req.on('error', reject)
  })

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let file = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST_DIR, 'index.html')
  if (!fs.existsSync(file)) return json(res, 503, { error: 'app non construite : npm run build' })
  const ext = path.extname(file)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

// ---------------------------------------------------------------- flux temps réel

const sseClients = new Set<http.ServerResponse>()
w.onChange(() => {
  const data = `event: version\ndata: ${w.version}\n\n`
  for (const res of sseClients) res.write(data)
})
setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n')
}, 25_000)

// ---------------------------------------------------------------- API

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void

const routes: [string, RegExp, Handler][] = [
  ['POST', /^\/api\/login$/, async (req, res) => {
    const body = await readBody(req)
    if (typeof body.secret !== 'string' || !sameCode(body.secret, SECRET)) {
      await new Promise((r) => setTimeout(r, 800))
      return json(res, 401, { error: 'code incorrect' })
    }
    const t = crypto.randomBytes(24).toString('base64url')
    tokens.add(t)
    saveTokens()
    res.setHeader('set-cookie', `wv=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`)
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/me$/, (req, res) => json(res, 200, { authed: authed(req) })],
  ['POST', /^\/api\/logout$/, (req, res) => {
    const t = cookieToken(req)
    if (t) {
      tokens.delete(t)
      saveTokens()
    }
    res.setHeader('set-cookie', 'wv=; Path=/; Max-Age=0')
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/snapshot$/, (_req, res) => json(res, 200, w.snapshot())],
  ['GET', /^\/api\/events$/, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.write(`event: version\ndata: ${w.version}\n\n`)
    sseClients.add(res)
    _req.on('close', () => sseClients.delete(res))
  }],
  ['GET', /^\/api\/sessions\/([^/]+)$/, async (_req, res, _u, [id]) => {
    const d = await w.detailAny(decodeURIComponent(id))
    d ? json(res, 200, d) : json(res, 404, { error: 'session introuvable' })
  }],
  ['GET', /^\/api\/sessions\/([^/]+)\/screen$/, async (_req, res, _u, [id]) => json(res, 200, { screen: await w.screen(decodeURIComponent(id)) })],
  ['POST', /^\/api\/sessions\/([^/]+)\/send$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    json(res, 200, await w.send(decodeURIComponent(id), String(body.text ?? '')))
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/attach$/, async (req, res, _u, [id]) => {
    const body = await readBody(req, 24 << 20)
    const files = Array.isArray(body.files) ? body.files.filter((f: any) => typeof f?.data === 'string').map((f: any) => ({ name: String(f.name ?? 'photo'), type: String(f.type ?? 'image/jpeg'), data: String(f.data) })) : []
    json(res, 200, await w.attach(decodeURIComponent(id), String(body.text ?? ''), files))
  }],
  ['GET', /^\/api\/transcribe$/, (_req, res) => json(res, 200, { enabled: !!openaiKey() })],
  ['POST', /^\/api\/transcribe$/, async (req, res) => {
    const body = await readBody(req, 24 << 20)
    if (typeof body.data !== 'string' || !body.data) return json(res, 400, { error: 'audio manquant' })
    json(res, 200, { text: await transcribe(Buffer.from(body.data, 'base64'), String(body.type ?? 'audio/mp4')) })
  }],
  ['POST', /^\/api\/sessions\/([^/]+)\/key$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    await w.key(decodeURIComponent(id), String(body.key ?? ''))
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/sessions$/, async (req, res) => {
    const body = await readBody(req)
    const tool = body.tool === 'codex' ? 'codex' : 'claude'
    json(
      res,
      200,
      await w.create({
        projectId: String(body.projectId ?? ''),
        repo: body.repo ? String(body.repo) : undefined,
        tool,
        text: String(body.text ?? ''),
        machineId: body.machineId ? String(body.machineId) : undefined,
      }),
    )
  }],
  ['POST', /^\/api\/main$/, async (req, res) => {
    const body = await readBody(req)
    json(res, 200, await w.sendMain(String(body.text ?? '').trim()))
  }],
  ['POST', /^\/api\/main\/choose$/, async (req, res) => {
    const body = await readBody(req)
    const r = await w.chooseMain(String(body.mainId ?? ''), { sessionId: body.sessionId ? String(body.sessionId) : undefined, suggestionId: body.suggestionId ? String(body.suggestionId) : undefined })
    json(res, 200, { ok: true, id: r.id })
  }],
  ['POST', /^\/api\/import$/, (req, res) => receiveImport(req, res)],
  ['GET', /^\/api\/push$/, (_req, res) => json(res, 200, { enabled: w.push.enabled, publicKey: w.push.publicKey, devices: w.push.count })],
  ['POST', /^\/api\/push\/subscribe$/, async (req, res) => {
    w.push.subscribe((await readBody(req)) as any)
    json(res, 200, { ok: true, devices: w.push.count })
  }],
  ['POST', /^\/api\/push\/test$/, async (_req, res) => {
    await w.push.send({ title: 'weevils', body: 'Les notifications marchent. Je te préviens quand une session t’attend ou a fini.', url: '/', tag: 'test' })
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/conversations$/, (_req, res, url) =>
    json(res, 200, { conversations: w.conversationList({ projectId: url.searchParams.get('project') ?? undefined, q: url.searchParams.get('q') ?? undefined }) })],
  ['GET', /^\/api\/conversations\/([^/]+)$/, (_req, res, _u, [id]) => {
    const d = w.conversationDetail(decodeURIComponent(id))
    d ? json(res, 200, d) : json(res, 404, { error: 'conversation introuvable' })
  }],
  ['POST', /^\/api\/conversations\/([^/]+)\/classify$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    w.classifyManually(decodeURIComponent(id), { projectId: body.projectId ? String(body.projectId) : undefined, newCategory: body.newCategory ? String(body.newCategory) : undefined })
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/conversations\/([^/]+)\/continue$/, async (req, res, _u, [id]) => {
    const body = await readBody(req)
    json(res, 200, await w.continueConversation(decodeURIComponent(id), body.tool === 'codex' ? 'codex' : 'claude', String(body.text ?? '')))
  }],
  ['POST', /^\/api\/classify$/, (_req, res) => {
    void w.classify()
    json(res, 200, { ok: true })
  }],
  ['POST', /^\/api\/h24\/([^/]+)\/toggle$/, async (_req, res, _u, [id]) => {
    await w.toggleH24(decodeURIComponent(id))
    json(res, 200, { ok: true })
  }],
  ['GET', /^\/api\/repos$/, async (_req, res, url) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    json(res, 200, remote ? await remote.call('GET', '/api/repos') : { repos: w.allRepos() })
  }],
  ['GET', /^\/api\/repos\/([^/]+)\/files$/, async (_req, res, url, [repo]) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    json(res, 200, remote ? await remote.call('GET', `/api/repos/${repo}/files`) : { files: await w.files(decodeURIComponent(repo)) })
  }],
  ['GET', /^\/api\/repos\/([^/]+)\/file$/, async (_req, res, url, [repo]) => {
    const remote = w.remoteById(url.searchParams.get('machine') ?? undefined)
    const p = url.searchParams.get('path') ?? ''
    json(res, 200, remote ? await remote.call('GET', `/api/repos/${repo}/file?path=${encodeURIComponent(p)}`) : w.file(decodeURIComponent(repo), p))
  }],
]

const PUBLIC = new Set(['/api/login', '/api/me'])

/** Envoi d'un export (zip ou JSON, jusqu'à 1 Go) : écrit tel quel sur disque, puis importé. */
async function receiveImport(req: http.IncomingMessage, res: http.ServerResponse) {
  const dir = path.join(DATA_DIR, 'uploads')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `export-${Date.now()}`)
  const out = fs.createWriteStream(file)
  let size = 0
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 1 << 30) {
        req.destroy()
        reject(new Error('fichier trop gros (1 Go max)'))
      }
    })
    req.pipe(out)
    out.on('finish', resolve)
    req.on('error', reject)
  })
  try {
    json(res, 200, await w.importFile(file))
  } finally {
    fs.rmSync(file, { force: true })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local')
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname)
    if (!PUBLIC.has(url.pathname) && !authed(req)) return json(res, 401, { error: 'connexion requise' })
    for (const [method, re, handler] of routes) {
      const m = re.exec(url.pathname)
      if (m && req.method === method) return await handler(req, res, url, m.slice(1))
    }
    json(res, 404, { error: 'route inconnue' })
  } catch (e) {
    json(res, 400, { error: (e as Error).message })
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`weevilsd → http://127.0.0.1:${PORT}`))

// Hooks Claude Code : port séparé, local uniquement, pas d'authentification nécessaire.
http
  .createServer(async (req, res) => {
    try {
      const body = await readBody(req, 256 << 10)
      w.hook(body, req.headers['x-pid'] as string | undefined)
      console.log(`[hook] ${body?.hook_event_name ?? '?'} ${String(body?.session_id ?? '').slice(0, 8)}`)
      res.writeHead(200).end('ok')
    } catch {
      res.writeHead(400).end()
    }
  })
  .listen(HOOK_PORT, '127.0.0.1', () => console.log(`hooks → http://127.0.0.1:${HOOK_PORT}`))

process.on('uncaughtException', (e) => console.error('[weevilsd]', e))
process.on('unhandledRejection', (e) => console.error('[weevilsd]', e))
