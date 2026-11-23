// @vitest-environment happy-dom
// weevils next loads itself again when another build is live: which build a page runs, which one the server serves,
// and what a reload would lose.
import { afterEach, expect, it } from 'vitest'
import { busy, ownBuild, servedBuild } from './fresh.ts'

afterEach(() => { document.body.innerHTML = '' })

it('knows its own build, and none out of a build', () => {
  expect(ownBuild('https://x.test/assets/index-BnWz5SRM.js')).toBe('/assets/index-BnWz5SRM.js')
  expect(ownBuild('http://127.0.0.1:4183/src/main.tsx')).toBeNull()
})

it('reads the build the server serves now', () => {
  const html = '<head><script type="module" crossorigin src="/assets/index-BgG-6DrO.js"></script></head>'
  expect(servedBuild(html)).toBe('/assets/index-BgG-6DrO.js')
  expect(servedBuild('<html></html>')).toBeNull()
})

it('never reloads over a word being written, a capture or a send', () => {
  expect(busy()).toBe(false)
  document.body.innerHTML = '<textarea></textarea>'
  expect(busy()).toBe(false)
  ;(document.querySelector('textarea') as HTMLTextAreaElement).value = 'half a sentence'
  expect(busy()).toBe(true)
  document.body.innerHTML = '<div class="cam-freeze"></div>'
  expect(busy()).toBe(true)
  document.body.innerHTML = '<form class="composer" data-draft="true"></form>'
  expect(busy()).toBe(true)
})
