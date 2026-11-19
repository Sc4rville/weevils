import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { jailedAllowed, jailedPeer } from './jail-peer.ts'

const bwrapPid = process.platform === 'linux' && spawnSync('bwrap', ['--dev-bind', '/', '/', '--unshare-pid', '--proc', '/proc', 'true']).status === 0

function serve() {
  const hits: boolean[] = []
  const server = http.createServer((req, res) => {
    hits.push(jailedPeer(req.socket))
    res.end('ok')
  })
  return new Promise<{ port: number; hits: boolean[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, hits, close: () => server.close() })),
  )
}
const curl = (cmd: string[]) =>
  new Promise<number>((resolve) => spawn(cmd[0], cmd.slice(1), { stdio: 'ignore' }).on('exit', (c) => resolve(c ?? 1)))

describe('jail peer', () => {
  it('only the CLI profile routes are open to a jailed caller', () => {
    expect(jailedAllowed('GET', '/api/snapshot')).toBe(true)
    expect(jailedAllowed('POST', '/api/sessions/abc/send')).toBe(true)
    expect(jailedAllowed('POST', '/api/foryou/post')).toBe(true)
    expect(jailedAllowed('GET', '/api/fs/file')).toBe(false)
    expect(jailedAllowed('POST', '/api/setup/config')).toBe(false)
    expect(jailedAllowed('GET', '/api/memory')).toBe(false)
    expect(jailedAllowed('POST', '/api/sessions/abc/resume')).toBe(false)
  })

  it.skipIf(!bwrapPid || spawnSync('curl', ['--version']).status !== 0)('tells a jailed curl from a plain one', async () => {
    const s = await serve()
    try {
      expect(await curl(['curl', '-sf', `http://127.0.0.1:${s.port}/`])).toBe(0)
      expect(await curl(['bwrap', '--dev-bind', '/', '/', '--unshare-pid', '--proc', '/proc', '--die-with-parent', '--', 'curl', '-sf', `http://127.0.0.1:${s.port}/`])).toBe(0)
      expect(s.hits).toEqual([false, true])
    } finally {
      s.close()
    }
  })
})
