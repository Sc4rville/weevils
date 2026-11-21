// A sign-in prompt in weevboss's thread is gone as soon as that sign-in works (Scarville, 2026-11-21: five « Sign in to
// Claude Code to continue with this agent » left from 11-18 showed to a signed-in person).
import { expect, it } from 'vitest'
import { staleSignIns } from './setup.ts'

const log = [
  { id: '1', role: 'assistant', text: 'Sign in to Claude Code to continue with this agent. [[setup:claude]]' },
  { id: '2', role: 'assistant', text: 'Codex too? [[setup:codex]]' },
  { id: '3', role: 'user', text: 'see [[setup:claude]]' },
  { id: '4', role: 'assistant', text: 'Voice is on. [[setup:voice]]' },
]
it('hides the prompts of a provider signed in now, keeps everything else', () => {
  expect(staleSignIns(log, { claude: true, codex: false }).map((m) => m.id)).toEqual(['2', '3', '4'])
  expect(staleSignIns(log, { claude: true, codex: true }).map((m) => m.id)).toEqual(['3', '4'])
  expect(staleSignIns(log, { claude: false, codex: false })).toHaveLength(4)
})
