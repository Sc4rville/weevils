// pumpForget never removes the files of a pump that still runs (21/11: a failed tmux listing looked like « every pane
// gone » and left seven live sessions unreachable). The data dir is the throwaway HOME of test/setup-env.ts.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PUMP_DIR, pumpAlive, pumpForget } from './pump.ts'

const kids: ReturnType<typeof spawn>[] = []
afterEach(() => { for (const k of kids.splice(0)) k.kill('SIGKILL') })

function files(name: string, state: object) {
  fs.mkdirSync(PUMP_DIR, { recursive: true })
  fs.writeFileSync(path.join(PUMP_DIR, `${name}.json`), JSON.stringify(state))
  fs.writeFileSync(path.join(PUMP_DIR, `${name}.sock`), '')
}
const has = (name: string) => fs.existsSync(path.join(PUMP_DIR, `${name}.json`)) || fs.existsSync(path.join(PUMP_DIR, `${name}.sock`))

test('the test never touches the real data dir', () => {
  expect(PUMP_DIR.startsWith(process.env.HOME!)).toBe(true)
  expect(process.env.HOME).not.toBe(os.userInfo().homedir)
})

test('a live pump keeps its files; a dead or exited one, or another process on its pid, loses them', async () => {
  // A stand-in whose command line names claude-pump, like the real one.
  const pump = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'claude-pump.mjs'], { stdio: 'ignore' })
  kids.push(pump)
  await new Promise((r) => setTimeout(r, 100))
  expect(pumpAlive(pump.pid)).toBe(true)
  files('wv-live', { pid: pump.pid, exited: null })
  expect(pumpForget('wv-live')).toBe(false)
  expect(has('wv-live')).toBe(true)

  files('wv-exited', { pid: pump.pid, exited: { code: 0, at: 1 } })
  expect(pumpForget('wv-exited')).toBe(true)
  expect(has('wv-exited')).toBe(false)

  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  kids.push(other)
  await new Promise((r) => setTimeout(r, 100))
  files('wv-reused', { pid: other.pid, exited: null })
  expect(pumpForget('wv-reused')).toBe(process.platform === 'linux') // no /proc to tell on a Mac: kept, the safe side
  pump.kill('SIGKILL')
  await new Promise((r) => pump.once('exit', r))
  files('wv-dead', { pid: pump.pid, exited: null })
  expect(pumpForget('wv-dead')).toBe(true)
  expect(has('wv-dead')).toBe(false)

  expect(pumpForget('wv-never')).toBe(true) // no state file: plain cleanup
})
