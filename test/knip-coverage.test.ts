import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

// HYGIENE.md H-13: dead-code findings are only as good as what knip sees. Every folder the typecheck covers must be in
// knip's project, and every entry it names must exist, or knip calls live code unused (2026-11-24: the next app was
// missing, so knip called a dependency, three components and three scripts unused).

const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'))
const knip = read('knip.json') as { entry: string[]; project: string[] }
const pkg = read('package.json') as { scripts: Record<string, string> }

/** The folders `npm run typecheck` reads: the root tsconfig's include, and each `-p <dir>` with its own include. */
function typecheckedFolders(): string[] {
  const dirs = ['.', ...[...pkg.scripts.typecheck.matchAll(/-p\s+(\S+)/g)].map((m) => m[1])]
  const out = new Set<string>()
  for (const dir of dirs) {
    const include = (read(path.join(dir, 'tsconfig.json')) as { include?: string[] }).include ?? ['.']
    for (const inc of include) out.add(path.normalize(path.join(dir, inc)))
  }
  return [...out]
}

it('knip looks at every folder the typecheck covers', () => {
  const folders = typecheckedFolders()
  expect(folders.length).toBeGreaterThan(2)
  const missing = folders.filter((dir) => !knip.project.some((glob) => glob.startsWith(`${dir}/`)))
  expect(missing).toEqual([])
})

it('every file knip takes as an entry point exists', () => {
  const literal = knip.entry.filter((e) => !/[*{]/.test(e))
  expect(literal.filter((f) => !fs.existsSync(f))).toEqual([])
})
