// The requests band of next's side bar (next/src/requests-band.tsx), read in the source: where the side bar draws it,
// the colour it is given, and its flat look. How it behaves is pinned next to it (next/src/requests-band.test.tsx).
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8')

it("the side bar draws it right under weevboss's head, above its sessions and before the other projects, in the slot of the page it opens", () => {
  const main = read('next/src/main.tsx')
  const at = (needle: string) => { const i = main.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i }
  const band = "<RequestsBand snap={snap} color={colors.__foot ?? 'p3'} page={page} />"
  // Two mounts, one for each shape of the top block, and no third: the same band, the same colour slot.
  expect(main.split('<RequestsBand ')).toHaveLength(3)
  expect(main.split(band)).toHaveLength(3)
  // weevils' own repo is a project here: weevboss's band takes it as what sits under its head.
  const boss = at('<ProjectGroup snap={snap} project={self}')
  const under = at(`under={${band}} />`)
  // weevboss alone (any other install): right after its button, and only then.
  const alone = at('<button className={`nx-row nx-boss-row band recursive-identity')
  const lone = at(`{!self && ${band}}`)
  const others = at('{projects.filter((p) => p !== self).map((p) => (')
  expect(boss).toBeLessThan(under)
  expect(main.slice(boss, under)).not.toContain('/>')
  expect(under).toBeLessThan(alone)
  expect(alone).toBeLessThan(lone)
  expect(lone).toBeLessThan(others)
  // A project band draws what it is given between its head and its sessions, outside the part that folds (how it
  // looks is pinned in test/next-side-rows.test.tsx).
  expect(main).toMatch(/\n {6}<\/div>\n {6}\{under\}\n {6}<Collapse open=\{!folded\}>\n/)
  // The page it opens wears that same slot.
  expect(read('src/ui/requests.tsx')).toMatch(/<Shell slot=\{colors\.__foot \?\? 'p3'\} kicker="weevboss" title=\{t\.title\}>/)
})

it('wears the « ! » of the settings line, which stays where it was: a second way in, nothing removed', () => {
  expect(read('src/ui/bands.tsx')).toMatch(/<Line ch="!" value=\{snap\.asksOpen \? String\(snap\.asksOpen\) : undefined\} onClick=\{\(\) => push\(\{ kind: 'requests' \}\)\}>/)
  expect(read('next/src/requests-band.tsx')).toMatch(/<span className="nx-repo-mark" aria-hidden><G c="!" \/>/)
})

it('is calm and flat: its rules set a layout and a weight, never a colour, a radius, a line or a shadow', () => {
  const rules = read('next/src/next.css').split('\n').filter((l) => l.startsWith('.nx-requests'))
  expect(rules).toHaveLength(3)
  for (const r of rules) expect(r).not.toMatch(/color|background|radius|shadow|border/)
  // The open count in bold, as a band's count.
  expect(rules.find((r) => r.startsWith('.nx-requests-count'))).toMatch(/font-weight: 800/)
})
