// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { WeevilLoading } from './loading'
import { setLang } from '../i18n'

const root = path.resolve(import.meta.dirname, '../..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

it('a page on its way shows the weevil itself, jumping, announced to screen readers', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setLang('en')
  const host = document.createElement('div'); document.body.append(host)
  const r = createRoot(host)
  act(() => r.render(<WeevilLoading />))
  expect(host.querySelector('.weevil-loading[role=status] svg.weevboss-logo')).not.toBeNull()
  expect(host.textContent).toContain('Loading')
  act(() => r.unmount()); host.remove(); setLang(null)
})

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
