#!/usr/bin/env node
// weevils on npm: the same installers as the `curl … | bash` lines, typed as `npx weevils …`.
//
// Nothing is installed by this package itself. It downloads the very script the curl line would, from the same address,
// over HTTPS and whole, then hands it to bash on its standard input, exactly like `curl -fsSL <url> | bash -s -- <args>`.
// The scripts are the ones you can read at those addresses (install.sh, get/bootstrap.sh, server/join.sh,
// server/bring.sh in https://github.com/Sc4rville/weevils); this file only picks which one.
//
//   npx weevils [install.sh options]       install weevils on this machine (raw.githubusercontent.com/…/install.sh)
//   npx weevils <setup id>                 the setup started on the weevils site (get.scarville.tech/install.sh)
//   npx weevils join <address> <code> […]  plug this computer into your weevils (<address>/api/join.sh)
//   npx weevils bring <address> <code>     bring this computer's conversations (<address>/api/bring.sh)
//
// Plain Node (12 and later), no dependencies, so that it reads in one sitting.
'use strict'

const http = require('http')
const https = require('https')
const { spawn } = require('child_process')

const INSTALL = process.env.WEEVILS_INSTALL_URL || 'https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh'
const SITE = (process.env.WEEVILS_SITE || 'https://get.scarville.tech').replace(/\/+$/, '')
const SID = /^[a-z2-9]{10}$/
const CODE = /^[A-Za-z0-9_-]{20,64}$/

const fr = /^fr/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '')
const say = (en, frText) => process.stderr.write(`  weevils · ${fr && frText ? frText : en}\n`)

const USAGE = `weevils: watch and drive your Claude Code and Codex sessions from your phone.

  npx weevils                          install weevils on this machine
  npx weevils <setup id>               the setup you started on the weevils site
  npx weevils join <address> <code>    plug this computer into your weevils (the line weevboss gives)
  npx weevils bring <address> <code>   bring this computer's conversations to your weevils

Each one downloads a script and runs it with bash, like the curl line it stands for. No Node.js on a machine?
The curl line does the same: curl -fsSL https://raw.githubusercontent.com/Sc4rville/weevils/main/install.sh | bash
More: https://github.com/Sc4rville/weevils
`

/** The address of a weevils, as the line gives it: `alex.example.com`, or http(s)://host[:port]. Nothing else. */
function base(address) {
  const raw = /^https?:\/\//i.test(address || '') ? address : `https://${address || ''}`
  let u
  try {
    u = new URL(raw)
  } catch (e) {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash || !u.hostname || u.pathname !== '/') return null
  return `${u.protocol}//${u.host}`
}

/** Which script, with which arguments for it; or what to say. */
function plan(argv) {
  const [first, ...rest] = argv
  if (first === '-h' || first === '--help' || first === 'help') return { help: true }
  if (first === 'join' || first === 'bring') {
    const [address, code, ...more] = rest
    const b = base(address)
    if (!b || !CODE.test(code || '')) {
      return { error: `this needs the whole line from your weevils: npx weevils ${first} <address> <code>`, errorFr: `il faut la ligne entière donnée par ton weevils : npx weevils ${first} <adresse> <code>` }
    }
    return { url: `${b}/api/${first}.sh`, args: first === 'join' ? [code, ...more] : [code] }
  }
  if (first && SID.test(first)) return { url: `${SITE}/install.sh`, args: [first, ...rest], sid: first }
  if (first && !first.startsWith('-')) return { error: `unknown command "${first}" (npx weevils --help)`, errorFr: `commande inconnue « ${first} » (npx weevils --help)` }
  return { url: INSTALL, args: argv }
}

/** The whole script, or an error: https only (http only when the address itself says so), 5 redirects, 2 MB. */
function download(url, hops) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: { 'user-agent': 'weevils-npx' }, timeout: 30000 }, (res) => {
      const { statusCode: status, headers } = res
      if (status >= 300 && status < 400 && headers.location) {
        res.resume()
        const next = new URL(headers.location, url).toString()
        if ((hops || 0) >= 5 || (url.startsWith('https:') && !next.startsWith('https:'))) return reject(new Error(`unexpected redirect from ${url}`))
        return resolve(download(next, (hops || 0) + 1))
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`${url} answered ${status}`))
      }
      const parts = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > 2e6) req.destroy(new Error(`${url} is too large to be the script`))
        else parts.push(c)
      })
      res.on('end', () => resolve(Buffer.concat(parts)))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`${url} did not answer`)))
    req.on('error', reject)
  })
}

/** The line that does the same without Node.js. */
function curlLine(p) {
  return `curl -fsSL ${p.url} | bash -s${p.args.length ? ` -- ${p.args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')}` : ''}`
}

/** Windows: a setup from the site has its PowerShell line (it hands the install to Ubuntu in WSL); the rest runs in
 *  Linux, so inside Ubuntu (WSL), where the curl line needs nothing else. */
function windows(p) {
  if (p.sid) {
    const ps = `irm '${SITE}/w/${p.sid}' | iex`
    return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' })
  }
  say('weevils runs in Linux: open Ubuntu (WSL) and paste this line there:', 'weevils tourne sous Linux : ouvre Ubuntu (WSL) et colle cette ligne dedans :')
  process.stderr.write(`\n    ${curlLine(p)}\n\n`)
  process.exit(1)
}

async function main() {
  const p = plan(process.argv.slice(2))
  if (p.help) return process.stdout.write(USAGE)
  if (p.error) {
    say(p.error, p.errorFr)
    process.exit(1)
  }
  if (process.platform === 'win32') return exit(windows(p))
  let script
  try {
    script = await download(p.url)
  } catch (e) {
    say(`could not download the installer: ${e.message}`, `impossible de télécharger l’installeur : ${e.message}`)
    process.exit(1)
  }
  if (!/^#!/.test(script.toString('utf8', 0, 2))) {
    say(`${p.url} did not answer with a script`, `${p.url} n’a pas répondu par un script`)
    process.exit(1)
  }
  say(`running ${p.url}`, `lance ${p.url}`)
  // bash -s: the script comes on bash's standard input, as from curl. Its questions read the terminal itself.
  const child = spawn('bash', ['-s', '--', ...p.args], { stdio: ['pipe', 'inherit', 'inherit'] })
  child.stdin.on('error', () => {}) // the script may end before reading all of itself
  child.stdin.end(script)
  exit(child)
}

/** Ctrl-C reaches the script (it stops on its own terms); its exit code becomes this one. */
function exit(child) {
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => child.kill('SIGTERM'))
  child.on('error', (e) => {
    say(e.code === 'ENOENT' ? `${child.spawnfile} is missing on this computer` : e.message, e.code === 'ENOENT' ? `${child.spawnfile} manque sur cet ordinateur` : e.message)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(code === null ? (signal === 'SIGINT' ? 130 : 1) : code))
}

if (require.main === module) main()
module.exports = { plan, base, curlLine }
