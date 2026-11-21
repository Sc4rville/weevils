// weevils capture: a phone-sized picture or clip of this machine's weevils, signed in with a short-lived capture
// token (never the access code). Started by `weevils capture` (server/weevils-cli), which passes the token in the
// environment. Needs playwright-core and a Chromium it can launch; says plainly what is missing otherwise.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const [out, ...args] = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const flag = (name) => args.includes(`--${name}`)
const token = process.env.WEEVILS_CAPTURE_TOKEN
const base = process.env.WEEVILS_CAPTURE_BASE || 'http://127.0.0.1:4179'
if (!out || !token) { console.error('usage: weevils capture <out.png|out.mp4> [--open "#s=<session id>"] [--theme <name>] [--seconds N] [--size 390x844] [--frame] [--wait ms]'); process.exit(2) }

/** weevils' own copy, installed here the first time a capture needs it (no root, no global install). */
const OWN = path.join(os.homedir(), '.local', 'share', 'weevils', 'capture')
function loadPlaywright() {
  const roots = [OWN, process.cwd(), path.dirname(new URL(import.meta.url).pathname), process.env.WEEVILS_PLAYWRIGHT_DIR].filter(Boolean)
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()) } catch { /* no npm */ }
  for (const r of roots) {
    try { return createRequire(path.join(r, 'x.js'))('playwright-core') } catch { /* next */ }
    try { return createRequire(path.join(r, 'playwright-core', 'x.js'))('playwright-core') } catch { /* next */ }
  }
  return null
}
/** The newest Chromium playwright already downloaded, when its own default does not match. */
function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright')
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : []
  for (const d of dirs) for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
    const p = path.join(cache, d, rel)
    if (fs.existsSync(p)) return p
  }
  return undefined
}

let pw = loadPlaywright()
if (!pw) {
  console.error('weevils capture: installing playwright-core once, in weevils\' own folder…')
  fs.mkdirSync(OWN, { recursive: true })
  spawnSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', OWN, 'playwright-core'], { stdio: ['ignore', 'ignore', 'inherit'] })
  pw = loadPlaywright()
  // Its own browser and video encoder (kept in playwright's cache, beside any other version).
  if (pw) spawnSync(process.execPath, [path.join(OWN, 'node_modules', 'playwright-core', 'cli.js'), 'install', 'chromium-headless-shell', 'ffmpeg'], { stdio: ['ignore', 'ignore', 'inherit'] })
}
if (!pw) { console.error('weevils capture: playwright-core is not installed (npm i -g playwright-core, then npx playwright-core install chromium-headless-shell)'); process.exit(3) }
const [w, h] = (opt('size', '390x844')).split('x').map(Number)
const seconds = Number(opt('seconds', '0'))
const video = /\.(mp4|webm)$/i.test(out)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-capture-'))
let browser
try { browser = await pw.chromium.launch() } catch { browser = await pw.chromium.launch({ executablePath: chromiumPath() }) }
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: video ? 2 : 3, isMobile: true, hasTouch: true, ...(video ? { recordVideo: { dir: tmp, size: { width: w, height: h } } } : {}) })
const u = new URL(base)
await ctx.addCookies([{ name: 'wv', value: token, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }])
const theme = opt('theme')
if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('wv-theme', t) } catch {} ; document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = t }) }, theme)
const page = await ctx.newPage()
await page.goto(base + '/')
const where = opt('open')
if (where) { await page.waitForTimeout(1500); await page.goto(base + '/' + (where.startsWith('#') ? where : `#${where}`)); await page.reload() }
await page.waitForTimeout(Number(opt('wait', '4000')))
if (theme) await page.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
if (video) await page.waitForTimeout(Math.max(1, seconds || 5) * 1000)
const shot = video ? null : await page.screenshot()
const rec = video ? page.video() : null
await ctx.close(); await browser.close()
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
if (rec) {
  const webm = await rec.path()
  if (/\.mp4$/i.test(out) && spawnSync('ffmpeg', ['-version']).status === 0) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' })
  else fs.copyFileSync(webm, out.replace(/\.mp4$/i, '.webm'))
} else if (flag('frame')) {
  const b2 = await (async () => { try { return await pw.chromium.launch() } catch { return pw.chromium.launch({ executablePath: chromiumPath() }) } })()
  const p2 = await b2.newPage({ deviceScaleFactor: 2 })
  await p2.setContent(`<body style="margin:0;background:#e9e6df;padding:20px;display:inline-block"><div style="padding:14px;background:#111;border-radius:58px;display:inline-block"><img src="data:image/png;base64,${shot.toString('base64')}" style="width:${w}px;height:${h}px;border-radius:44px;display:block"></div></body>`)
  await p2.locator('body > div').screenshot({ path: out })
  await b2.close()
} else fs.writeFileSync(out, shot)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(out)
