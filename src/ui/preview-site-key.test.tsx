// @vitest-environment happy-dom
// weevils' own site pages: their key changes every hour. An address saved earlier takes today's key, and a page open
// in a frame is not reloaded when only the key changes.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { freshSite, useSteadyUrl } from './preview'

const OLD = 'a'.repeat(22)
const NEW = 'b'.repeat(22)

it('an address saved with an old site key takes the current one; any other address stays as it is', () => {
  expect(freshSite(`${location.origin}/api/site/${OLD}/game/index.html`, NEW)).toBe(`${location.origin}/api/site/${NEW}/game/index.html`)
  expect(freshSite(`/api/site/${OLD}/game/`, NEW)).toBe(`/api/site/${NEW}/game/`)
  expect(freshSite(`https://elsewhere.example/api/site/${OLD}/game/`, NEW)).toBe(`https://elsewhere.example/api/site/${OLD}/game/`)
  expect(freshSite('https://game.example.com/', NEW)).toBe('https://game.example.com/')
  expect(freshSite(`/api/site/${OLD}/game/`, undefined)).toBe(`/api/site/${OLD}/game/`)
})

let root: Root
let host: HTMLElement
const seen: string[] = []
function Frame({ url, reload }: { url: string; reload: number }) {
  seen.push(useSteadyUrl(url, reload))
  return null
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  seen.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

it('a frame keeps its page when only the key changes; another page, or a reload, takes the new address', () => {
  act(() => root.render(<Frame url={`/api/site/${OLD}/game/`} reload={0} />))
  act(() => root.render(<Frame url={`/api/site/${NEW}/game/`} reload={0} />))
  expect(seen.at(-1)).toBe(`/api/site/${OLD}/game/`)
  act(() => root.render(<Frame url={`/api/site/${NEW}/game/`} reload={1} />))
  expect(seen.at(-1)).toBe(`/api/site/${NEW}/game/`)
  act(() => root.render(<Frame url={`/api/site/${NEW}/other/`} reload={1} />))
  expect(seen.at(-1)).toBe(`/api/site/${NEW}/other/`)
})
