// The spoken line of a long brief: given by the sender, else written once by the cheap model, in the app locale.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Message } from '../shared/api.ts'
import { BriefSays, cleanSay, sayKey } from './brief-says.ts'
import { setLang } from './i18n.ts'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'says-')); setLang('en', true) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const long = 'Asks from Yann (medium effort, usual weevils conventions). ' + 'Merge the branch auto/creative-weevils-themes-91c5 after tests, restart the server, confirm in the selector. '.repeat(2)
const boss = (text: string, id = 'm1'): Message => ({ id, role: 'orchestrator', author: 'weevboss', text, at: 1 })
const flush = () => new Promise((r) => setTimeout(r, 0))

it('keys a brief by what the thread shows: signature and hidden weevils block do not matter', () => {
  expect(sayKey(`[from:weevboss] ${long}`)).toBe(sayKey(`${long}\n\n⟦weevils — Explicit app locale: English (en).⟧`))
  expect(sayKey(`[from:weevboss;thread:abc] ${long}`)).toBe(sayKey(long.replace(/ /g, '  ')))
})

it("the sender's --say wins and reaches the thread, other messages untouched", async () => {
  const write = vi.fn(async () => '{"items":[]}')
  const s = new BriefSays(path.join(dir, 'says.json'), write)
  s.given(`[from:weevboss] ${long}`, '"Merge the new themes"')
  const msgs = [boss(long), { id: 'u', role: 'user', text: long, at: 2 } as Message, boss('Short one.', 'm2')]
  const out = s.attach(msgs)
  expect(out[0].say).toBe('Merge the new themes')
  expect(out[1]).toBe(msgs[1])
  expect(out[2].say).toBeUndefined()
  await flush()
  expect(write).not.toHaveBeenCalled()
  // Kept on disk.
  expect(new BriefSays(path.join(dir, 'says.json')).get(long)).toBe('Merge the new themes')
})

it('writes a missing line once with the cheap model, in the app language, then the thread changes', async () => {
  const write = vi.fn(async (prompt: string) => { expect(prompt).toContain('in English'); expect(prompt).toContain('Merge the branch'); return '{"items":[{"id":"0","say":"Merge the themes and restart"}]}' })
  const s = new BriefSays(path.join(dir, 'says.json'), write)
  const changed = vi.fn()
  s.onChange = changed
  expect(s.attach([boss(long)])[0].say).toBeUndefined()
  await flush(); await flush()
  expect(changed).toHaveBeenCalledTimes(1)
  expect(s.attach([boss(long)])[0].say).toBe('Merge the themes and restart')
  expect(write).toHaveBeenCalledTimes(1)
  // Another app language: written again in that one.
  setLang('fr', true)
  expect(s.get(long)).toBeUndefined()
})

it('a failed call waits before trying again; a short line is never asked for', async () => {
  const write = vi.fn(async () => { throw new Error('quota') })
  const s = new BriefSays(path.join(dir, 'says.json'), write)
  s.want('Short.')
  s.want(long)
  await flush()
  s.want(long)
  await flush()
  expect(write).toHaveBeenCalledTimes(1)
})

it('cleans a line: one line, no quotes, phone length', () => {
  expect(cleanSay(' « Merge\n the themes » ')).toBe('Merge the themes')
  expect(cleanSay('x'.repeat(300)).length).toBe(160)
  expect(cleanSay(42)).toBe('')
})

it('a session row keeps its topic title over the brief-like thread title', async () => {
  const { rowTitle } = await import('./threads-app.ts')
  expect(rowTitle('weevils themes', 'Asks from Yann (medium effort, usual…', 'weevils themes')).toBe('weevils themes')
  expect(rowTitle('Asks from Yann (medium…', 'Asks from Yann (medium effort, usual…', undefined)).toBe('Asks from Yann (medium effort, usual…')
  expect(rowTitle('New session', undefined, undefined)).toBe('New session')
})
