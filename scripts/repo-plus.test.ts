// A repo's « + » (2026-11-26): on its last line, the « N done » one, right under the head's « > » (the same
// .nx-project-line and .chars, so the same column), on every repo drawer (weevils and misc too). A tap opens a new
// conversation in that repo, its box focused, the heading not taking the focus back.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

it('sits on every repo drawer’s last line, in the column of its « > »', () => {
  const main = read('next/src/main.tsx')
  const group = main.slice(main.indexOf('function ProjectGroup'), main.indexOf('function SideBar'))
  const foot = group.slice(group.indexOf('nx-project-foot'))
  expect(group).toMatch(/<div className="nx-project-line nx-project-foot">/)
  // « N done » comes from the catalog since 2026-11-26 (src/i18n/side-rows.ts).
  expect(foot).toMatch(/done\.length > 0 \?[\s\S]*?t\.done\(done\.length\)[\s\S]*?<div className="chars">[\s\S]*?<Icon name="plus" \/>/)
  expect(foot).toMatch(/page\(\{ kind: 'new', projectId: project\.id \}\)/)
})

it('opens with the box ready to write in', () => {
  expect(read('src/ui/pages.tsx')).toMatch(/onSend=\{create\} disabled=\{!!sourceIssue\} autoFocus=\{!sourceIssue\}/)
  expect(read('src/ui/bits.tsx')).toMatch(/if \(autoFocus\) field\.current\?\.focus/)
  expect(read('src/ui/shell.tsx')).toMatch(/if \(!lateral && !writing\) heading\.current\?\.focus/)
})
