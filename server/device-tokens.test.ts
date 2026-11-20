// Signed-in browsers keep a cookie for a year: a new access code (the « lost a phone » steps) signs every one out.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadTokens, saveTokens } from './device-tokens.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weevils-devices-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const file = path.join(dir, 'tokens.json')

describe('device tokens', () => {
  it('kept across restarts with the same code, private', () => {
    saveTokens(file, 'code-1', new Set(['phone', 'laptop']))
    expect([...loadTokens(file, 'code-1')]).toEqual(['phone', 'laptop'])
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('code-1')
  })
  it('a new access code signs every device out, even when tokens.json stays', () => {
    saveTokens(file, 'code-1', new Set(['phone']))
    expect(loadTokens(file, 'code-2').size).toBe(0)
  })
  it('a list written before the code was noted is kept (an update signs nobody out), nothing readable is none', () => {
    fs.writeFileSync(file, JSON.stringify(['phone']))
    expect([...loadTokens(file, 'code-1')]).toEqual(['phone'])
    fs.writeFileSync(file, '{"code": ')
    expect(loadTokens(file, 'code-1').size).toBe(0)
    fs.rmSync(file)
    expect(loadTokens(file, 'code-1').size).toBe(0)
  })
})
