// The weevil while a page loads (src/ui/loading.tsx, docs/next-interaction.md): every page that waits on the server
// shows it, from the first frame, never a blank screen.
import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

it('every page that waits on the server shows the weevil, never a blank screen', () => {
  for (const f of ['src/ui/project-screen.tsx', 'src/ui/pages.tsx', 'src/ui/threads.tsx', 'src/ui/convs.tsx', 'src/ui/softwares.tsx', 'src/ui/memory.tsx', 'src/ui/repos.tsx', 'next/src/chat.tsx'])
    expect(read(f), f).toMatch(/<WeevilLoading\b/)
  // From the first frame (no delay before it shows), no spinner, square corners, and calm with reduced motion.
  const css = read('src/styles.css')
  const block = (sel: string) => css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))![1]
  expect(block('.weevil-loading')).not.toMatch(/animation-delay|\.\d+s\s+[\d.]+s/)
  expect(block('.weevil-loading-shadow')).toMatch(/border-radius:\s*0/)
  expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.weevil-loading-hop/)
})
