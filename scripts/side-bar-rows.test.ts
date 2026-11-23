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
  // One icon column and one small gap for every band: the column is exactly the icon's width, the name right after it.
  expect(body('.nx-repo-mark')).toMatch(/width:\s*var\(--mark-w\)/)
  expect(body('.nx-boss-row .nx-boss-logo')).toMatch(/min-width:\s*var\(--mark-w\)/)
  for (const sel of ['.nx-repo-row', '.nx-project-head.nx-boss-row', '.nx-settings .settings-band > .in.head']) expect(body(sel)).toMatch(/gap:\s*var\(--mark-gap\)/)
  expect(px(body(':root'), '--mark-w')).toBe(px(body('.nx-logo'), 'width'))
  expect(px(body(':root'), '--mark-gap')).toBeLessThanOrEqual(12)
  expect(px(body('.nx-repo-mark .ic'), 'width')).toBe(px(body('.nx-logo'), 'width'))
  expect(body('.nx-repo-mark .ic:not(.auto-mark) path')).toMatch(/stroke-width:\s*1\.5/)
})

it('settings read like Autonomous; the Autonomous name carries nothing beside it', () => {
  expect(body('.nx-settings .settings-band .head .h2')).toMatch(/font-weight:\s*400/)
  const main = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')
  expect(main).toMatch(/>autonomous<\/span>\s*<\/button>/)
})

it('the screen, the side bar and its veil reach the bottom edge of an installed app', () => {
  expect(body('.nx-side')).toMatch(/height:\s*var\(--full-h, 100%\)/)
  expect(body('.nx-scrim')).toMatch(/height:\s*var\(--full-h, 100%\)/)
  expect(body('.nx-stage')).toMatch(/height:\s*var\(--full-h, 100%\)/)
})

it('every folded band is one height, one token; the side bar ends with its last band, nothing fills under it', () => {
  for (const sel of ['.nx-boss-row', '.nx-project-head', '.nx-project-head.nx-boss-row', '.nx-settings .settings-band > .in.head']) expect(body(sel)).toMatch(/min-height:\s*var\(--band-h\)/)
  expect(body('.nx-project-head')).toMatch(/padding-top:\s*0/)
  expect(body('.nx-project')).toMatch(/padding-bottom:\s*0/)
  expect(body('.nx-settings .settings-band')).toMatch(/padding-bottom:\s*0/)
  expect(body('.nx-side')).toMatch(/background:\s*transparent/)
  expect(css).not.toMatch(/\.nx-side-scroll > \.nx-settings\s*\{[^}]*flex:\s*1/)
})

it("next places weevboss's strip from the stage's own height, never innerHeight alone (no second jump over a session's head)", () => {
  const main = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')
  expect(main).toMatch(/useState\(\(\) => screenHeight\(\)\)/)
  expect(main).not.toMatch(/setH\(innerHeight\)/)
})

it("a project's working star sits in one column just left of its « / »: the name takes the room before it", () => {
  expect(body('.nx-project-line .nx-project-name')).toMatch(/flex:\s*1 1 auto/)
  expect(body('.nx-project-line .nx-project-name')).toMatch(/min-width:\s*0/)
  expect(body('.nx-project-line .nx-project-head')).toMatch(/flex:\s*1/)
  expect(body('.nx-boss-row .nx-fold')).toMatch(/flex:\s*1/)
})

it('Autonomous and Your factory are laid out like weevils and the repos: an icon in the logo column, the name under the « w »', () => {
  const main = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')
  const factory = fs.readFileSync(path.join(root, 'next/src/factory.tsx'), 'utf8')
  // Autonomous: its own icon works, lit and turning while something runs, at rest otherwise; no star on its row.
  expect(main).toMatch(/nx-repo-mark nx-autos-mark[^\n]*\? <AutoMark \/> : <Icon name="cycle" \/>/)
  const autosHead = /<button className="nx-row nx-project-head nx-repo-row" onClick=\{foldAutos\}[\s\S]*?<\/button>/.exec(main)![0]
  expect(autosHead).not.toMatch(/spin fluo|name="star"/)
  expect(factory).toMatch(/nx-project-head nx-repo-row[\s\S]{0,300}<Icon name="factory" \/>/)
})

it('« autonomous » and « your factory » are lowercase wherever they are drawn, like weevils, the repos and settings', () => {
  const dir = path.join(root, 'next/src')
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, '')
  // Drawn: as a band's name (JSX text) or as a page's kicker; never with a capital.
  expect(code).toMatch(/>autonomous<\/span>/)
  expect(code).toMatch(/>your factory<\/span>/)
  expect(code).toMatch(/kicker="autonomous"/)
  expect(code).toMatch(/kicker="your factory"/)
  expect(code).not.toMatch(/>\s*(Autonomous|Your factory)\s*</)
  expect(code).not.toMatch(/["'`](Autonomous|Your factory)["'`]/)
  // …and no style puts a capital back.
  expect(css).not.toMatch(/text-transform:\s*(capitalize|uppercase)/)
})

it('settings wears its own icon in the same column, through the app\'s own band', () => {
  const main = fs.readFileSync(path.join(root, 'next/src/main.tsx'), 'utf8')
  expect(main).toMatch(/<FootBand[^>]*mark=\{<span className="nx-repo-mark" aria-hidden><Icon name="settings" \/><\/span>\}/)
  const icons = fs.readFileSync(path.join(root, 'src/ui/icons.tsx'), 'utf8')
  expect(icons).toMatch(/\n  settings: '[^']+'/)
})
