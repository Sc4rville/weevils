// next's side bar (docs/next-interaction.md): a repo row's mark sits in the weevils logo's column and its name under
// the « w » of weevils; settings' name is regular weight; the Autonomous name carries nothing beside it; the side bar
// and its veil reach the bottom edge of an installed app (--full-h, src/ui/viewport.ts).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.join(root, 'next/src/next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const body = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';')
const px = (b: string, prop: string) => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(b)?.[1])

it("a repo row's mark takes the weevils logo's column and its name starts under the weevils name", () => {
  expect(px(body('.nx-repo-mark'), 'width')).toBe(px(body('.nx-boss-row .nx-boss-logo'), 'min-width'))
  expect(px(body('.nx-repo-row'), 'gap')).toBe(px(body('.nx-project-head.nx-boss-row'), 'gap'))
  expect(px(body('.nx-repo-mark .ic'), 'width')).toBe(px(body('.nx-logo'), 'width'))
  expect(body('.nx-repo-mark .ic path')).toMatch(/stroke-width:\s*1\.5/)
})

it('settings read like Autonomous; the Autonomous name carries nothing beside it', () => {
  expect(body('.nx-settings .settings-band .head .h2')).toMatch(/font-weight:\s*400/)
  const main = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')
  expect(main).toMatch(/>Autonomous<\/span>\s*<\/button>/)
})

it('the screen, the side bar and its veil reach the bottom edge of an installed app', () => {
  expect(body('.nx-side')).toMatch(/height:\s*var\(--full-h, 100%\)/)
  expect(body('.nx-scrim')).toMatch(/height:\s*var\(--full-h, 100%\)/)
  expect(body('.nx-stage')).toMatch(/height:\s*var\(--full-h, 100%\)/)
})
