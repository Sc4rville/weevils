import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addedThemesIn, builtThemes, liveThemesReader } from './live-themes.ts'

// Which themes the running app has (server/live-themes.ts): temp folders only, never the real build.
let top: string
const built = (name: string, css: string | null) => {
  const dist = path.join(top, name)
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
  if (css !== null) {
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc.css'), css)
    fs.writeFileSync(path.join(dist, 'index.html'), `<script type="module" src="/assets/index-${css.length}.js"></script>`)
  }
  return dist
}

beforeEach(() => { top = fs.mkdtempSync(path.join(os.tmpdir(), 'live-themes-')) })
afterEach(() => fs.rmSync(top, { recursive: true, force: true }))

describe('live themes', () => {
  it('reads the themes a built app carries from its styles, minified or not; null when it is not built', () => {
    const dist = built('dist', `:root[data-theme=zen]{--ink:#000}:root[data-theme='dark'] {--ink:#fff}[data-theme="crt"] .x{color:red}`)
    expect([...builtThemes(dist)!].sort()).toEqual(['crt', 'dark', 'zen'])
    expect(builtThemes(path.join(top, 'nowhere'))).toBeNull()
    expect(builtThemes(built('empty', null))).toBeNull()
  })

  it('a theme is live when every built app has it; read again only after a new build', () => {
    const classic = built('dist', '[data-theme=zen]{}[data-theme=dark]{}[data-theme=crt]{}')
    const next = built('next', '[data-theme=zen]{}[data-theme=dark]{}')
    let reads = 0
    const live = liveThemesReader([classic, next], (d) => (reads++, builtThemes(d)))
    expect([...live()!].sort()).toEqual(['dark', 'zen'])
    live()
    expect(reads).toBe(2)
    // The default app is rebuilt with the new theme: it is live now.
    fs.writeFileSync(path.join(next, 'assets', 'index-abc.css'), '[data-theme=zen]{}[data-theme=dark]{}[data-theme=crt]{}')
    fs.utimesSync(path.join(next, 'index.html'), new Date(), new Date(Date.now() + 5000))
    expect([...live()!].sort()).toEqual(['crt', 'dark', 'zen'])
    // Only one app built here: it alone decides. None: nothing can be said.
    expect([...liveThemesReader([classic, path.join(top, 'nowhere')])()!].sort()).toEqual(['crt', 'dark', 'zen'])
    expect(liveThemesReader([path.join(top, 'nowhere')])()).toBeNull()
  })

  it('the themes a checkout adds over main: the blocks its styles have and origin/main has not', () => {
    const cwd = path.join(top, 'wt')
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'src', 'styles.css'), '')
    const diff = ['+++ b/src/styles.css', "+:root[data-theme='departures'] {", '+  --ink: #fff;', "-:root[data-theme='gone'] {", "+:root[data-theme='newsprint'] {", "+[data-theme='dark'] .x { color: red }"].join('\n')
    const asked: string[][] = []
    expect(addedThemesIn(cwd, (_c, args) => (asked.push(args), diff))).toEqual(['departures', 'newsprint'])
    expect(asked[0]).toEqual(['diff', '--unified=0', '--no-color', 'origin/main', '--', 'src/styles.css'])
    expect(addedThemesIn(cwd, () => { throw new Error('not a repository') })).toEqual([])
    // Not a checkout of weevils: nothing, and git is never asked.
    expect(addedThemesIn(path.join(top, 'elsewhere'), () => { throw new Error('asked') })).toEqual([])
  })
})
