// Nothing in weevils is underlined (2026-11-21): links and actions read by weight and colour, focus by its halo.
// Every style source of the app (CSS and inline styles) is scanned; the base reset in src/styles.css must stay.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.join(import.meta.dirname, '..', 'src')
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])
const sources = files(root).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f))

it('no style anywhere draws an underline', () => {
  const found = sources.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => [f, i + 1, line] as const))
    .filter(([, , line]) => /text-decoration(-line)?\s*:\s*[^;}]*underline|textDecoration\s*:\s*['"][^'"]*underline|text-underline-offset|<u>/.test(line))
    .map(([f, n, line]) => `${path.relative(root, f)}:${n}: ${line.trim()}`)
  expect(found).toEqual([])
})

it('the base reset keeps links and buttons free of the browser underline, and focus keeps its halo', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
  expect(css).toMatch(/a, a:hover, a:focus, a:active, a:visited, button, \[role='link'\] \{\s*text-decoration-line: none;/)
  expect(css).toMatch(/:focus-visible \{\s*outline: var\(--focus-halo\)/)
})
