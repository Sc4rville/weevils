// npm/ (the `weevils` npm package): `npx weevils …` picks the script the curl line would run, downloads it whole and
// hands it to bash on its standard input, with the same arguments. Nothing else.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { curlLine as joinCurl, maskPasteCode, npxLine } from '../shared/paste-line.ts'

const BIN = path.join(import.meta.dirname, '..', 'npm', 'bin', 'weevils.js')
const { plan, base, curlLine } = createRequire(import.meta.url)(BIN) as {
  plan: (argv: string[]) => { url?: string; args?: string[]; sid?: string; error?: string; help?: boolean }
  base: (a: string) => string | null
  curlLine: (p: { url: string; args: string[] }) => string
}
const CODE = 'Kq3x9_aZ-0123456789abcd'

describe('which script, with which arguments', () => {
  it('no arguments, or install.sh options: the installer from GitHub', () => {
    expect(plan([])).toEqual({ url: 'https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh', args: [] })
    expect(plan(['--agent', '--lang', 'fr'])).toMatchObject({ args: ['--agent', '--lang', 'fr'] })
  })
  it('a setup id from the site: its install.sh, the id first, then the options (--no-link)', () => {
    expect(plan(['ab2cd3ef4g', '--no-link'])).toEqual({ url: 'https://get.scarville.tech/install.sh', args: ['ab2cd3ef4g', '--no-link'], sid: 'ab2cd3ef4g' })
  })
  it('join and bring: the address as the line shows it, https by default', () => {
    expect(plan(['join', 'weevils.example.com', CODE, '--since', '2026-10-01'])).toEqual({ url: 'https://weevils.example.com/api/join.sh', args: [CODE, '--since', '2026-10-01'] })
    expect(plan(['bring', 'http://192.168.1.4:4179', CODE, 'extra'])).toEqual({ url: 'http://192.168.1.4:4179/api/bring.sh', args: [CODE] })
    expect(base('https://w.example/')).toBe('https://w.example')
  })
  it('refuses what is not a whole line: no code, a bad code, an address with credentials or a query', () => {
    for (const argv of [['join'], ['join', 'w.example'], ['join', 'w.example', 'short'], ['join', 'w.example', `${CODE};id`], ['bring', 'u:p@w.example', CODE], ['join', 'w.example/?x=1', CODE], ['join', 'w.example/sub', CODE], ['join', 'ftp://w.example', CODE], ['nope']]) {
      expect(plan(argv).error, argv.join(' ')).toBeTruthy()
    }
    expect(plan(['--help'])).toEqual({ help: true })
  })
  it('the curl line it stands for, quoted for a shell', () => {
    expect(curlLine({ url: 'https://w.example/api/join.sh', args: [CODE, '--match', 'invoice exporter'] })).toBe(`curl -fsSL https://w.example/api/join.sh | bash -s -- ${CODE} --match 'invoice exporter'`)
  })
})

describe('the lines weevils shows', () => {
  it('npx first with the host alone over https, the curl line for no Node.js, both masked for the model', () => {
    expect(npxLine('join', 'https://w.example/', CODE, ' --since 2026-10-01')).toBe(`npx weevils join w.example ${CODE} --since 2026-10-01`)
    expect(npxLine('bring', 'http://192.168.1.4:4179', CODE)).toBe(`npx weevils bring http://192.168.1.4:4179 ${CODE}`)
    expect(joinCurl('join', 'https://w.example/', CODE)).toBe(`curl -fsSL https://w.example/api/join.sh | bash -s ${CODE}`)
    // What npx runs from the npx line is what the curl line runs.
    const p = plan(npxLine('join', 'https://w.example', CODE, ' --since 2026-10-01').split(' ').slice(2))
    expect(`curl -fsSL ${p.url} | bash -s ${p.args!.join(' ')}`).toBe(joinCurl('join', 'https://w.example', CODE, ' --since 2026-10-01'))
    expect(maskPasteCode(`\`${npxLine('join', 'https://w.example', CODE)}\` or \`${joinCurl('join', 'https://w.example', CODE)}\``)).not.toContain(CODE)
  })
})

describe('the real package, against a real server', () => {
  const serve = async (body: string, status = 200) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/api/join.sh') return res.writeHead(302, { location: '/real/join.sh' }).end()
      res.writeHead(req.url === '/real/join.sh' ? status : 404).end(req.url === '/real/join.sh' ? body : '')
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    return { srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }
  }
  const run = (args: string[]) =>
    new Promise<{ code: number; out: string; err: string }>((resolve) => {
      execFile(process.execPath, [BIN, ...args], { env: { ...process.env, LANG: 'C' } }, (e, out, err) => resolve({ code: e ? Number(e.code) : 0, out, err }))
    })

  it('runs the script with bash -s and its arguments, the script on stdin like curl | bash, its exit code kept', async () => {
    // As join.sh is written: everything in a function, so that reading the rest of stdin cannot eat the script.
    const script = '#!/usr/bin/env bash\nmain() { printf "args=%s|" "$@"; [ -t 0 ] || printf "stdin=pipe|"; printf "rest=%s" "$(cat)"; exit 7; }\nmain "$@"\n'
    const { srv, url } = await serve(script)
    try {
        // (through a redirect on the same scheme)
      const r = await run(['join', url, CODE, '--since', '2026-10-01'])
      expect(r.out).toBe(`args=${CODE}|args=--since|args=2026-10-01|stdin=pipe|rest=`)
      expect(r.code).toBe(7)
      expect(r.err).toContain(`running ${url}/api/join.sh`)
    } finally {
      srv.close()
    }
  })

  it('runs nothing when the answer is not a whole script', async () => {
    for (const [body, status] of [['<html>oops</html>', 200], ['#!/bin/bash\necho ran', 403]] as const) {
      const { srv, url } = await serve(body, status)
      try {
        const r = await run(['join', url, CODE])
        expect(r.code).toBe(1)
        expect(r.out).toBe('')
      } finally {
        srv.close()
      }
    }
  })

  it('ships one file, no dependencies, the bin named weevils', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'npm', 'package.json'), 'utf8'))
    expect(pkg).toMatchObject({ name: 'weevils', bin: { weevils: 'bin/weevils.js' } })
    expect(pkg.dependencies).toBeUndefined()
    expect(fs.readFileSync(BIN, 'utf8')).not.toMatch(/require\('(?!http|https|child_process)/)
  })
})
