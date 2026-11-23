import http from 'node:http'
import zlib from 'node:zlib'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { GZIP_FROM, sendJson } from './http-json.ts'

let server: http.Server
let base = ''
const big = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: `request number ${i}` })) }
beforeAll(async () => {
  server = http.createServer((req, res) => sendJson(res, 200, req.url === '/big' ? big : { ok: true }))
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

const raw = (path: string, encoding?: string) => new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
  http.get(base + path, { headers: encoding ? { 'accept-encoding': encoding } : {} }, (res) => {
    const parts: Buffer[] = []
    res.on('data', (c) => parts.push(c)).on('end', () => ok({ headers: res.headers, body: Buffer.concat(parts) })).on('error', fail)
  }).on('error', fail)
})

it('gzips a big answer for a browser that accepts it, and the same JSON comes out', async () => {
  const r = await raw('/big', 'gzip, deflate, br')
  expect(r.headers['content-encoding']).toBe('gzip')
  expect(r.body.length).toBeLessThan(JSON.stringify(big).length / 4)
  expect(JSON.parse(zlib.gunzipSync(r.body).toString())).toEqual(big)
})

it('leaves small answers, and clients that ask for no compression, as they are', async () => {
  expect(JSON.stringify(big).length).toBeGreaterThan(GZIP_FROM)
  const small = await raw('/small', 'gzip')
  expect(small.headers['content-encoding']).toBeUndefined()
  expect(JSON.parse(small.body.toString())).toEqual({ ok: true })
  const plain = await raw('/big')
  expect(plain.headers['content-encoding']).toBeUndefined()
  expect(JSON.parse(plain.body.toString())).toEqual(big)
})
