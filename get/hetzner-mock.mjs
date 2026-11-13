// A Hetzner Cloud API double for end-to-end tests of get's "create a server for me" path, without paying.
// POST /servers "boots" a machine by running MOCK_BOOT (a shell command) with USER_DATA_FILE pointing to the
// cloud-init it received, and answers with MOCK_IP. Only the calls get makes: GET /server_types, POST /servers.
//   MOCK_PORT=4184 MOCK_TOKEN=… MOCK_IP=172.30.99.10 MOCK_BOOT='…' node get/hetzner-mock.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const TOKEN = process.env.MOCK_TOKEN || 'mocktoken0000000000000000000000000000000000000000000000000000000'
const price = (location, gross) => ({ location, price_hourly: { net: '0', gross: '0.0067' }, price_monthly: { net: (gross / 1.19).toFixed(4), gross: String(gross) } })
const TYPES = [
  { id: 1, name: 'cx23', description: 'CX23', cores: 2, memory: 4, disk: 40, architecture: 'x86', deprecated: false, prices: [price('nbg1', 4.15), price('fsn1', 4.15), price('hel1', 4.15)] },
  { id: 2, name: 'cpx22', description: 'CPX22', cores: 2, memory: 4, disk: 80, architecture: 'x86', deprecated: false, prices: [price('nbg1', 7.49)] },
  { id: 3, name: 'cax11', description: 'CAX11', cores: 2, memory: 4, disk: 40, architecture: 'arm', deprecated: false, prices: [price('nbg1', 4.49)] },
]
let n = 0
http.createServer((req, res) => {
  const reply = (status, body) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: { code: 'unauthorized', message: 'unable to authenticate' } })
  if (req.method === 'GET' && req.url.startsWith('/server_types')) return reply(200, { server_types: TYPES })
  if (req.method === 'POST' && req.url === '/servers') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const b = JSON.parse(body)
      const file = path.join(os.tmpdir(), `hetzner-mock-${process.pid}-${++n}.yaml`)
      fs.writeFileSync(file, b.user_data || '')
      console.log(`[mock] create ${b.name} ${b.server_type}@${b.location} image=${b.image}`)
      const boot = spawn('bash', ['-c', process.env.MOCK_BOOT || 'true'], { env: { ...process.env, USER_DATA_FILE: file }, stdio: 'inherit', detached: true })
      boot.unref()
      reply(201, { server: { id: 1000 + n, name: b.name, status: 'initializing', public_net: { ipv4: { ip: process.env.MOCK_IP || '203.0.113.10' }, ipv6: { ip: '2001:db8::/64' } } }, root_password: 'mock-root-password', action: { id: n, status: 'running' } })
    })
    return
  }
  reply(404, { error: { code: 'not_found', message: 'not found' } })
}).listen(Number(process.env.MOCK_PORT || 4184), '127.0.0.1', () => console.log('[mock] Hetzner API double ready'))
