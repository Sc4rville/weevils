import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { guardEnv } from '../server/optimizers.ts'
import { dropPushRewrites } from './session-env.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-env-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** The git configuration an environment carries, as pairs. */
const rules = (env: NodeJS.ProcessEnv) => Array.from({ length: Number(env.GIT_CONFIG_COUNT ?? 0) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])

it('drops an automation session’s push rewrites and keeps the rest of its guard', () => {
  const { set } = guardEnv(path.join(root, 'guard'), {}, 'linux')
  const env: NodeJS.ProcessEnv = { ...set }
  expect(rules(env).some(([k]) => /pushinsteadof/i.test(k ?? ''))).toBe(true)
  dropPushRewrites(env)
  expect(rules(env)).toEqual([
    ['credential.helper', ''],
    ['credential.https://github.com.helper', ''],
    ['credential.https://gist.github.com.helper', ''],
  ])
  // No numbered variable is left behind past the new count: git would refuse the whole environment.
  expect(Object.keys(env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)).sort()).toEqual(['GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_KEY_2', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_VALUE_1', 'GIT_CONFIG_VALUE_2'])
  // The rest of the guard is untouched: no ssh for git, no prompt, no askpass.
  for (const k of ['GIT_SSH_COMMAND', 'GIT_ASKPASS', 'GIT_TERMINAL_PROMPT', 'GH_CONFIG_DIR']) expect(env[k]).toBe(set[k])
})

it('leaves an environment without git configuration alone, and removes a guard made of push rules only', () => {
  const plain: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
  dropPushRewrites(plain)
  expect(plain).toEqual({ PATH: '/usr/bin' })
  const only: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.pushDefault', GIT_CONFIG_VALUE_0: 'nowhere://' }
  dropPushRewrites(only)
  expect(only).toEqual({})
})

it('a push between two folders of a test’s own works under the guard once the rewrites are dropped, and only then', () => {
  const { set } = guardEnv(path.join(root, 'guard'), {}, 'linux')
  const base = { PATH: process.env.PATH ?? '', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }
  const guarded: NodeJS.ProcessEnv = { ...base, ...set }
  const git = (env: NodeJS.ProcessEnv, cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const bare = path.join(root, 'bare.git')
  const work = path.join(root, 'work')
  git(base, root, 'init', '-q', '--bare', '-b', 'main', bare)
  git(base, root, 'init', '-q', '-b', 'main', work)
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n')
  git(base, work, 'add', 'a.txt')
  git(base, work, 'commit', '-q', '-m', 'a')
  expect(() => git(guarded, work, 'push', '-q', bare, 'main')).toThrow()
  const freed = { ...guarded }
  dropPushRewrites(freed)
  git(freed, work, 'push', '-q', bare, 'main')
  expect(git(base, bare, 'rev-parse', 'main').trim()).toBe(git(base, work, 'rev-parse', 'HEAD').trim())
})
