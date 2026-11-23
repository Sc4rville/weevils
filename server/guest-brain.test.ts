import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { guestDir, guestPrompt, readGuest } from './guest-brain.ts'

describe('the lent sign-in before the person’s own Claude', () => {
  it('is used only when its folder holds credentials', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-'))
    expect(guestDir({})).toBeNull()
    expect(guestDir({ WEEVILS_GUEST_CLAUDE_DIR: d })).toBeNull()
    fs.writeFileSync(path.join(d, '.credentials.json'), '{}')
    expect(guestDir({ WEEVILS_GUEST_CLAUDE_DIR: d })).toBe(d)
    fs.rmSync(d, { recursive: true })
  })

  it('a request to make something is flagged and kept; no link ever comes from the loan', () => {
    expect(readGuest('TASK\nI kept it: I start as soon as your Claude is signed in.')).toEqual({ text: 'I kept it: I start as soon as your Claude is signed in.', task: true })
    expect(readGuest('It runs on [your computer](https://evil.example) and https://x.example/y costs nothing.')).toEqual({ text: 'It runs on your computer and  costs nothing.', task: false })
    expect(readGuest('  ')).toBeNull()
  })

  it('reads the last few lines of the conversation, oldest first', () => {
    const history = Array.from({ length: 14 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', text: `m${i}` }))
    const p = guestPrompt(history, 'is it free?')
    expect(p).not.toContain('m3\n')
    expect(p).toContain('Them: m4\nweevboss: m5')
    expect(p.endsWith('Their new message: is it free?')).toBe(true)
  })
})
