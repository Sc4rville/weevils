// What weevils' picture scripts share (server/compare.mjs, server/diagram.mjs): the neutral ground that reads on every
// theme's band, and a headless browser from the same playwright-core as `weevils capture` (server/capture.mjs).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

/** The ground of every picture: neutral, high contrast on every theme's band (light, dark, purple). */
export const GROUND = '#e9e6df'

const OWN = path.join(os.homedir(), '.local', 'share', 'weevils', 'capture')
function loadPlaywright() {
  const roots = [OWN, process.cwd(), process.env.WEEVILS_PLAYWRIGHT_DIR].filter(Boolean)
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()) } catch { /* no npm */ }
  for (const r of roots) {
    try { return createRequire(path.join(r, 'x.js'))('playwright-core') } catch { /* next */ }
  }
  return null
}
function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright')
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : []
  for (const d of dirs) for (const rel of ['chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
    const p = path.join(cache, d, rel)
    if (fs.existsSync(p)) return p
  }
  return undefined
}
export async function browser() {
  const pw = loadPlaywright()
  if (!pw) throw new Error('playwright-core is missing: run « weevils capture » once, it installs it')
  try { return await pw.chromium.launch() } catch { return pw.chromium.launch({ executablePath: chromiumPath() }) }
}
