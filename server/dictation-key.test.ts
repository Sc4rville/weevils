// Dictation uses the OpenAI key saved in the config file even when Your factory switched it off for the agents
// (the switch keeps it out of weevils' environment, so out of every agent it starts).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { applyKeys } from './your-factory.ts'
import { openaiKey } from './transcribe.ts'

it('a key switched off for the agents leaves their environment but still powers dictation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-dict-'))
  const file = path.join(dir, 'env')
  fs.writeFileSync(file, 'OPENAI_API_KEY=sk-test-saved-in-the-app\n')
  const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'sk-test-saved-in-the-app' }
  applyKeys(['key:OPENAI_API_KEY'], file, env)
  expect(env.OPENAI_API_KEY).toBeUndefined()
  expect(openaiKey(file, env)).toBe('sk-test-saved-in-the-app')
  fs.writeFileSync(file, '# OPENAI_API_KEY=\n')
  expect(openaiKey(file, env)).toBeUndefined()
  fs.rmSync(dir, { recursive: true, force: true })
})
