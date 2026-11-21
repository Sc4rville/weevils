// @vitest-environment happy-dom
// Inline markdown nests (Scarville, 2026-11-21: « **[Sign in to Claude](#)** » showed raw): a link inside bold or italic is
// a link, italic inside bold is italic, and a markdown link whose target is no address keeps only its words.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Prose } from './bits'
import { inline } from './format'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const show = async (text: string) => { await act(async () => root.render(<Prose text={text} />)); return host }

it('a link inside bold is a link, in bold', async () => {
  const h = await show('Then **see [the docs](https://weevils.example.com/docs)** today.')
  const a = h.querySelector('strong a.url')!
  expect(a.textContent).toBe('the docs')
  expect(a.getAttribute('href')).toBe('https://weevils.example.com/docs')
  expect(h.textContent).not.toContain('](')
})

it('« **[Sign in to Claude](#)** »: its words, in bold, never the raw markdown', async () => {
  const h = await show('The sign-in link is below.\n\n**[Sign in to Claude](#)**\n\nNo Claude?')
  expect(h.textContent).toContain('Sign in to Claude')
  expect(h.textContent).not.toMatch(/\[|\]\(|\(#\)/)
})

it('italic inside bold, a link inside italic', async () => {
  const h = await show('**very _important_ thing** and _read [this](https://example.com/a)_')
  expect(h.querySelector('strong em')?.textContent).toBe('important')
  expect(h.querySelector('em a.url')?.textContent).toBe('this')
})

it('an app address in a markdown link stays a link; any other target keeps only the label', () => {
  expect(inline('[open](/p/report/x)')).toEqual([{ kind: 'url', href: '/p/report/x', label: 'open' }])
  expect(inline('go [here](#) now')).toEqual([{ kind: 'text', s: 'go here now' }])
  expect(inline('[notes](notes.md)')).toEqual([{ kind: 'text', s: 'notes' }])
})
