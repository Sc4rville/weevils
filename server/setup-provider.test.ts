import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Setup as SetupType, SetupDeps } from './setup.ts'
import { beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ codex: false, claude: false, spawn: vi.fn() }))
vi.mock('./provider.ts', () => ({
  preferredTool: () => process.env.WEEVILS_PROVIDER === 'codex' ? 'codex' : 'claude',
  providerStatus: (tool: 'claude' | 'codex' = process.env.WEEVILS_PROVIDER === 'codex' ? 'codex' : 'claude') => ({ installed: true, logged: auth[tool] }),
  providerReady: () => auth[process.env.WEEVILS_PROVIDER === 'codex' ? 'codex' : 'claude'],
  codexLogged: () => auth.codex,
}))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: auth.spawn }))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-provider-'))
process.env.WEEVILS_CONFIG = path.join(directory, 'env')
const { Setup } = await import('./setup.ts')
const { CONFIG_FILE } = await import('./config.ts')
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
let setup: SetupType
let child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; exitCode: number | null; kill: ReturnType<typeof vi.fn> }
beforeEach(() => {
  auth.codex = false; auth.claude = false; auth.spawn.mockReset(); delete process.env.WEEVILS_PROVIDER
  child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, kill: vi.fn() })
  auth.spawn.mockReturnValue(child)
  setup = new Setup({ bump() {}, feed: () => ({ machines: [], projects: 0 }), remoteFacts: async () => [], devices: () => 0, push: () => 0, shortcut: () => false, seen: () => [], hasHistory: () => false, startMail() {}, handoff: async () => {} } as SetupDeps)
  vi.spyOn(setup, 'detect').mockResolvedValue({ codex: { installed: true, logged: false }, claude: { installed: true, logged: false } } as never)
})
afterEach(() => { child.emit('exit', null); delete process.env.WEEVILS_PROVIDER; vi.restoreAllMocks() })
it('persists the choice but never marks Codex authenticated until the actual login succeeds', async () => {
  const login = setup.chooseProvider('codex')
  await vi.waitFor(() => expect(auth.spawn).toHaveBeenCalledTimes(1))
  expect(auth.spawn.mock.calls[0][1]).toEqual(['login', '--device-auth'])
  child.stdout.emit('data', Buffer.from('https://auth.openai.com/codex/device\nABCD-EFGH'))
  await login
  expect(process.env.WEEVILS_PROVIDER).toBe('codex')
  expect(fs.readFileSync(CONFIG_FILE, 'utf8')).toContain('WEEVILS_PROVIDER=codex')
  expect(setup.flags()).toMatchObject({ provider: 'codex', codex: false, ready: false })
  auth.codex = true; child.exitCode = 0; child.emit('exit', 0)
  expect(setup.flags()).toMatchObject({ codex: true, ready: true })
})
it('repeated taps share the same device login instead of killing or duplicating it', async () => {
  const one = setup.chooseProvider('codex'), two = setup.chooseProvider('codex')
  await vi.waitFor(() => expect(auth.spawn).toHaveBeenCalledTimes(1))
  child.stdout.emit('data', Buffer.from('https://auth.openai.com/codex/device\nABCD-EFGH'))
  await Promise.all([one, two]); await setup.chooseProvider('codex')
  expect(auth.spawn).toHaveBeenCalledTimes(1); expect(child.kill).not.toHaveBeenCalled()
})
it('rejects an unavailable provider before changing the configured selection', async () => {
  vi.spyOn(setup, 'providers').mockReturnValue({ claude: true, codex: false })
  await expect(setup.chooseProvider('codex')).rejects.toThrow(/not available/)
  expect(process.env.WEEVILS_PROVIDER).toBeUndefined()
  expect(auth.spawn).not.toHaveBeenCalled()
})
