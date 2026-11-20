// A repo's static pages in the app's browser: only the repo's own files, by a key that does not last.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SITE_KEY_MS, siteFile, siteKey, siteKeyOk } from './site.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weevils-site-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const repo = path.join(tmp, 'projects', 'game')
const other = path.join(tmp, 'projects', 'other')
const outside = path.join(tmp, 'config')
fs.mkdirSync(path.join(repo, 'dist'), { recursive: true })
fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
fs.mkdirSync(other, { recursive: true })
fs.mkdirSync(outside, { recursive: true })
fs.writeFileSync(path.join(repo, 'index.html'), '<h1>game</h1>')
fs.writeFileSync(path.join(repo, 'dist', 'index.html'), '<h1>built</h1>')
fs.writeFileSync(path.join(repo, 'app.js'), 'go()')
fs.writeFileSync(path.join(repo, '.env'), 'TOKEN=x')
fs.writeFileSync(path.join(repo, '.git', 'config'), '[remote]')
fs.writeFileSync(path.join(other, 'notes.md'), 'other repo')
fs.writeFileSync(path.join(outside, 'secret'), 'the access code')
// What a repo cloned from anywhere may hold: links out of it, or into its own hidden files.
fs.symlinkSync(path.join(outside, 'secret'), path.join(repo, 'readme.txt'))
fs.symlinkSync(outside, path.join(repo, 'docs'))
fs.symlinkSync(path.join(other, 'notes.md'), path.join(repo, 'notes.md'))
fs.symlinkSync(path.join(repo, '.env'), path.join(repo, 'env.txt'))
fs.symlinkSync(path.join(repo, '.git'), path.join(repo, 'git'))
fs.symlinkSync(path.join(repo, 'app.js'), path.join(repo, 'main.js'))

describe('site files', () => {
  it('serves the repo\'s own files, a folder by its index.html', () => {
    expect(siteFile(repo, '/')).toBe(fs.realpathSync(path.join(repo, 'index.html')))
    expect(siteFile(repo, '/app.js')).toBe(fs.realpathSync(path.join(repo, 'app.js')))
    expect(siteFile(repo, '/dist/')).toBe(fs.realpathSync(path.join(repo, 'dist', 'index.html')))
    // A link that stays inside the repo is fine.
    expect(siteFile(repo, '/main.js')).toBe(fs.realpathSync(path.join(repo, 'app.js')))
  })
  it('never a symbolic link out of the repo, to a file or a folder', () => {
    expect(siteFile(repo, '/readme.txt')).toBeUndefined()
    expect(siteFile(repo, '/docs/secret')).toBeUndefined()
    expect(siteFile(repo, '/docs/')).toBeUndefined()
    expect(siteFile(repo, '/notes.md')).toBeUndefined()
  })
  it('never .. nor a hidden file, even through a link', () => {
    expect(siteFile(repo, '/../other/notes.md')).toBeUndefined()
    expect(siteFile(repo, '/dist/../../config/secret')).toBeUndefined()
    expect(siteFile(repo, '/../../config/secret')).toBeUndefined()
    expect(siteFile(repo, '/.env')).toBeUndefined()
    expect(siteFile(repo, '/.git/config')).toBeUndefined()
    expect(siteFile(repo, '/env.txt')).toBeUndefined()
    expect(siteFile(repo, '/git/config')).toBeUndefined()
  })
  it('nothing for what is missing', () => {
    expect(siteFile(repo, '/nope.html')).toBeUndefined()
    expect(siteFile(path.join(tmp, 'gone'), '/')).toBeUndefined()
  })
})

describe('site key', () => {
  const secret = 'abc123'
  const t = 1_800_000_000_000
  it('changes every period; the one before still opens pages for one more', () => {
    const k = siteKey(secret, t)
    expect(k).toMatch(/^[\w-]{22}$/)
    expect(siteKeyOk(secret, k, t)).toBe(true)
    expect(siteKeyOk(secret, k, t + SITE_KEY_MS)).toBe(true)
    expect(siteKeyOk(secret, k, t + 2 * SITE_KEY_MS)).toBe(false)
    expect(siteKey(secret, t + 2 * SITE_KEY_MS)).not.toBe(k)
  })
  it('belongs to this installation only', () => {
    expect(siteKeyOk('other', siteKey(secret, t), t)).toBe(false)
    expect(siteKeyOk(secret, 'x'.repeat(22), t)).toBe(false)
    expect(siteKeyOk(secret, '', t)).toBe(false)
  })
})
