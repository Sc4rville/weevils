// @vitest-environment happy-dom
// The copy of the page leaves photos off the screen out, with no address at all (an empty picture in their place kept
// Safari waiting on a lazy photo it never loads, 3 s a picture), and puts each one back as it was.
import { afterEach, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ during: [] as (string | null)[][] }))
vi.mock('modern-screenshot', () => ({
  domToForeignObjectSvg: async () => {
    seen.during = [...document.querySelectorAll('img')].map((i) => [i.getAttribute('src'), i.getAttribute('srcset'), i.style.width])
    throw new Error('stop here')
  },
}))
import { shoot } from './camera-shoot.ts'

afterEach(() => { document.body.innerHTML = '' })

it('photos off the screen have no address during the copy, then get theirs back', async () => {
  document.body.innerHTML = '<img src="/a.png" srcset="/a2.png 2x" loading="lazy" style="border: 0"><img src="/b.png">'
  await expect(shoot()).rejects.toThrow('stop here')
  expect(seen.during).toEqual([[null, null, '0px'], [null, null, '0px']])
  const [a, b] = [...document.querySelectorAll('img')]
  expect([a.getAttribute('src'), a.getAttribute('srcset'), a.getAttribute('style')]).toEqual(['/a.png', '/a2.png 2x', 'border: 0'])
  expect([b.getAttribute('src'), b.getAttribute('style')]).toEqual(['/b.png', null])
})
