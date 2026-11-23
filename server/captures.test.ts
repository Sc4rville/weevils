import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Captures, cleanContext } from './captures.ts'
import CapM from './i18n/captures.ts'

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const dirs: string[] = []
const library = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-captures-')); dirs.push(d); return new Captures(d) }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('the camera library', () => {
  it('files a capture by project, with what it shows beside it', () => {
    const lib = library()
    const c = lib.save({ data: `data:image/png;base64,${PNG}`, text: 'too much space', to: 's1', context: { ui: 'next', screen: 'session', sessionId: 's1', sessionTitle: 'Checkout', projectId: 'shop-app', project: 'shop-app', theme: 'dark', viewport: { w: 390, h: 844, dpr: 3 }, region: { x: 10, y: 20, w: 100, h: 50 } } }, Date.UTC(2026, 10, 23, 5, 6, 7))
    expect(c.group).toBe('shop-app')
    expect(path.basename(c.file)).toMatch(/^2026-11-23-050607-session-[0-9a-f]{8}\.png$/)
    expect(fs.readFileSync(c.file).subarray(1, 4).toString()).toBe('PNG')
    const side = JSON.parse(fs.readFileSync(c.file.replace(/\.png$/, '.json'), 'utf8'))
    expect(side).toMatchObject({ screen: 'session', sessionTitle: 'Checkout', theme: 'dark', text: 'too much space', to: 's1', tags: ['ui'] })
  })

  it('finds captures by words and by tag, newest first', () => {
    const lib = library()
    lib.save({ data: PNG, text: 'the side bar is too wide', context: { screen: 'side bar' } }, 1000)
    lib.save({ data: PNG, text: 'wrong colour', context: { screen: 'session', projectId: 'shop-app' }, feedback: false }, 2000)
    lib.save({ data: PNG, context: { screen: 'weevboss' } }, 3000)
    expect(lib.list().map((c) => c.at)).toEqual([3000, 2000, 1000])
    expect(lib.list({ q: 'side wide' }).map((c) => c.at)).toEqual([1000])
    expect(lib.list({ tag: 'ui' }).map((c) => c.at)).toEqual([3000, 1000])
    expect(lib.list({ group: 'shop-app' })[0].tags).toEqual(['conversation'])
  })

  it('refuses anything that is not a picture', () => {
    expect(() => library().save({ data: Buffer.from('#!/bin/sh\necho hi\n'.repeat(10)).toString('base64') })).toThrow()
  })

  it('keeps only known context fields, at sane sizes', () => {
    const c = cleanContext({ screen: 'x'.repeat(500), evil: 'no', page: { kind: 'files', id: '/a/b', extra: 1 }, viewport: { w: '1', h: 844, dpr: 2 } })
    expect(c.screen).toHaveLength(80)
    expect(c).not.toHaveProperty('evil')
    expect(c.page).toEqual({ kind: 'files', id: '/a/b' })
    expect(c.viewport).toEqual({ w: 0, h: 844, dpr: 2 })
  })

  it('tells the agent where the picture was taken, so nobody has to explain it', () => {
    const lib = library()
    const c = lib.save({ data: PNG, context: { ui: 'next', screen: 'session', sessionId: 's1', sessionTitle: 'Checkout', theme: 'light', viewport: { w: 390, h: 844, dpr: 3 } } })
    const note = CapM.en.note(c, lib.dir)
    expect(note).toContain('screen: session')
    expect(note).toContain('session "Checkout" (s1)')
    expect(note).toContain('390×844 @3x')
    expect(note).toContain('whole screen')
    expect(note).toContain('tag ui')
    expect(note).not.toContain('⟧')
  })
})
