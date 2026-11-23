// A JSON answer, gzipped when it is big and the browser accepts it (2026-11-23): the list of every request was 708 KB
// sent raw, seconds of blank page on a phone network; gzipped it is a small fraction of that. Small answers go as they
// are (compressing them costs more than it saves).
import type http from 'node:http'
import zlib from 'node:zlib'

export const GZIP_FROM = 16 << 10

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  const head: http.OutgoingHttpHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  const accepts = /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''))
  if (text.length >= GZIP_FROM && accepts) {
    const packed = zlib.gzipSync(text, { level: 5 })
    res.writeHead(status, { ...head, 'content-encoding': 'gzip', vary: 'accept-encoding', 'content-length': packed.length })
    res.end(packed)
    return
  }
  res.writeHead(status, head)
  res.end(text)
}
