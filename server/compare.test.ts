// weevils compare (server/compare.mjs) and the before/after check in `weevils show` (server/weevils-cli).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS, no types
import { checkCrop, comparePage, layoutFor, parseCrop } from './compare.mjs'

const cli = path.join(import.meta.dirname, 'weevils-cli')
const show = (file: string, caption: string) => spawnSync('bash', [cli, 'show', file, caption], { encoding: 'utf8', env: { ...process.env, WEEVILS_PORT: '1', WEEVILS_LANG: 'en' } })

describe('weevils compare', () => {
  it('reads a crop and picks the layout from its shape', () => {
    expect(parseCrop('10,20,300,400')).toEqual({ x: 10, y: 20, w: 300, h: 400 })
    expect(() => parseCrop('1,2,3')).toThrow(/bad crop/)
    expect(() => checkCrop({ x: 0, y: 700, w: 780, h: 400 }, { w: 390, h: 844 }, 'before')).toThrow(/390×844/)
    expect(layoutFor({ w: 390, h: 844 }, { w: 390, h: 844 })).toBe('side')
    expect(layoutFor({ w: 1170, h: 600 }, { w: 1170, h: 600 })).toBe('stack')
    expect(layoutFor({ w: 1170, h: 600 }, { w: 1170, h: 600 }, 'side')).toBe('side')
  })
  it('draws two framed states under big BEFORE / AFTER tags, each showing only its crop', () => {
    const html = comparePage([
      { kind: 'before', src: 'a.png', w: 1000, h: 2000, crop: { x: 100, y: 200, w: 500, h: 250 } },
      { kind: 'after', src: 'b.png', w: 1000, h: 2000, crop: { x: 100, y: 200, w: 500, h: 250 } },
    ], 'stack')
    expect(html.indexOf('BEFORE')).toBeLessThan(html.indexOf('AFTER'))
    expect(html).toContain('width:1120px;left:-112px;top:-224px') // zoomed ×1.12 to the 560 px frame, offset by the crop
    expect(html).toContain('height:280px')
  })
})

describe('weevils show and a before/after', () => {
  it('refuses a raw before/after and points to weevils compare', () => {
    for (const [file, caption] of [['/tmp/x.png', 'Before and after the fix'], ['/tmp/before-after.png', 'the card'], ['/tmp/x.png', 'avant / après']]) {
      const r = show(file, caption)
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/weevils compare/)
    }
  })
  it('lets a compare output and an ordinary picture through to the server', () => {
    expect(show('/tmp/x.compare.png', 'Before and after').stderr).not.toMatch(/weevils compare/)
    expect(show('/tmp/x.png', 'The new card').stderr).not.toMatch(/weevils compare/)
  })
})
