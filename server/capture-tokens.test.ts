// A capture's sign-in lasts minutes, is unguessable, and is never a device that speaks as the user.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { CaptureTokens, CAPTURE_TTL_MS } from './capture-tokens.ts'

it('a minted token works for ten minutes, then never again', () => {
  let now = 1000
  const c = new CaptureTokens(() => now)
  const t = c.mint()
  expect(t).toMatch(/^cap-[\w-]{30,}$/)
  expect(c.mint()).not.toBe(t)
  expect(c.valid(t)).toBe(true)
  expect(c.valid('cap-guess')).toBe(false)
  now += CAPTURE_TTL_MS
  expect(c.valid(t)).toBe(false)
})

it('the boss door only knows browsers signed in with the access code; the route is local only', () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8')
  expect(src).toMatch(/bossDoor\(\{ hasDevice: hasRealDevice,/)
  expect(src).toMatch(/\/api\\\/capture\\\/token\$\/, async \(req, res\) => \{\n\s+if \(!isLocal\(req\)\) return json\(res, 403/)
})
