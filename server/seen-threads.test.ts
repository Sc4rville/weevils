// Another machine's conversation keeps its history here (2026-11-26): what was last read from it, on disk, so it still
// opens on its messages once that machine is offline, after a restart too, and an empty answer never erases it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { SessionDetail } from '../shared/api.ts'
import { SeenThreads } from './seen-threads.ts'

let dir = ''
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-seen-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const ID = '0c3dea6a-eca6-4dac-aab1-870fdbb63208'
const detail = (texts: string[], id = ID): SessionDetail => ({
  session: { id, machineId: 'laptop', title: 'Casting to the TV' },
  messages: texts.map((text, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', text, at: i })),
}) as unknown as SessionDetail

it('gives back the last thread read, also from another instance (a restart)', () => {
  new SeenThreads(dir).remember(detail(['put the episode on the TV', 'Pairing the PC with the TV box first.']))
  const again = new SeenThreads(dir).recall(ID)
  expect(again?.messages.map((m) => m.text)).toEqual(['put the episode on the TV', 'Pairing the PC with the TV box first.'])
})

it('an empty answer never erases what was seen; a newer thread replaces it', () => {
  const seen = new SeenThreads(dir)
  seen.remember(detail(['put the episode on the TV']))
  seen.remember(detail([]))
  expect(seen.recall(ID)?.messages).toHaveLength(1)
  seen.remember(detail(['put the episode on the TV', 'Done, it is playing.']))
  expect(new SeenThreads(dir).recall(ID)?.messages).toHaveLength(2)
})

it('never reads or writes outside its folder', () => {
  const seen = new SeenThreads(dir)
  seen.remember(detail(['x'], '../../escape'))
  expect(seen.recall('../../escape')).toBeNull()
  expect(fs.readdirSync(dir)).toEqual([])
})
