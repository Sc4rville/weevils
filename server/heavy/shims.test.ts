import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { installShims, launcherScript, shimScript, TOOLS, withShims } from './shims.ts'

let root: string
let shims: string
let bin: string
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-shims-'))
  bin = path.join(root, 'bin')
  shims = path.join(root, 'shims')
  fs.mkdirSync(bin)
  fs.mkdirSync(shims)
  // Fake tools that say who ran them, and a fake weevils-heavy that says it queued.
  for (const t of TOOLS) fs.writeFileSync(path.join(bin, t), `#!/bin/sh\necho "real ${t} $*"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'weevils-heavy'), '#!/bin/sh\nshift\necho "queued $*"\n', { mode: 0o755 })
  for (const t of TOOLS) fs.writeFileSync(path.join(shims, t), shimScript(t, shims, path.join(bin, 'weevils-heavy')), { mode: 0o755 })
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const run = (cmd: string, env: Record<string, string> = {}, sh = '/bin/sh') =>
  execFileSync(sh, ['-c', cmd], { env: { PATH: `${shims}:${bin}:/usr/bin:/bin`, ...env }, encoding: 'utf8' }).trim()

describe('the stand-ins in front of npm, npx, cargo…', () => {
  const queued = [
    'npm test', 'npm t', 'npm run check', 'npm run build', 'npm run test:unit', 'npm run typecheck', 'npm ci',
    'npm exec vitest run', 'npx vitest run', 'npx vitest run --retry 2', 'npx vitest', 'npx tsc --noEmit -p server',
    'npx vite build', 'npx -y playwright test', 'npx eslint .', 'pnpm build', 'pnpm test', 'pnpm vitest run',
    'yarn build', 'yarn run lint', 'bun test', 'bun run build', 'bunx vitest run', 'cargo test', 'cargo build --release',
    'go test ./...', 'pytest',
  ]
  const direct = [
    'npm install', 'npm i left-pad', 'npm run dev', 'npm run build:watch', 'npm run sandbox --port 4176', 'npm run start',
    'npm --version', 'npx vitest --watch', 'npx tsc -w', 'npx vite', 'npx prettier --write .', 'pnpm install', 'pnpm dev',
    'yarn', 'cargo run', 'cargo fmt', 'go run .', 'go mod tidy',
  ]
  // Narrowed to some files: no queue, a lower priority (the real tool runs, under nice).
  const narrowed = ['npm test -- server/a.test.ts', 'npx vitest run server/a.test.ts', 'npx vitest run -t name', 'pytest tests/a.py']

  it.each(queued)('%s goes through the queue', (cmd) => {
    expect(run(cmd)).toBe(`queued ${cmd}`)
  })
  it.each([...direct, ...narrowed])('%s runs at once', (cmd) => {
    const [tool, ...rest] = cmd.split(' ')
    expect(run(cmd)).toBe(`real ${tool} ${rest.join(' ')}`.trim())
  })

  it('runs the real tool inside a job, when the queue is off, or without weevils-heavy', () => {
    expect(run('npm test', { WEEVILS_HEAVY: '1' })).toBe('real npm test')
    expect(run('npm test', { WEEVILS_HEAVY_QUEUE: '0' })).toBe('real npm test')
    const lone = path.join(root, 'lone')
    fs.mkdirSync(lone)
    fs.writeFileSync(path.join(lone, 'npm'), shimScript('npm', lone, '/nowhere/weevils-heavy'), { mode: 0o755 })
    expect(execFileSync('/bin/sh', ['-c', 'npm test'], { env: { PATH: `${lone}:${bin}:/usr/bin:/bin` }, encoding: 'utf8' }).trim()).toBe('real npm test')
  })

  it('takes itself out of the PATH of what it runs (no loop, nested calls see the real tools)', () => {
    fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "$PATH"\n', { mode: 0o755 })
    try {
      expect(run('npm install')).toBe(`${bin}:/usr/bin:/bin`)
    } finally {
      fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "real npm $*"\n', { mode: 0o755 })
    }
  })

  it('parses under bash too (macOS has bash 3.2 and no dash)', () => {
    for (const t of TOOLS) execFileSync('bash', ['-n', path.join(shims, t)])
    expect(run('npm run check', {}, 'bash')).toBe('queued npm run check')
  })

  it('writes weevils-heavy and stand-ins only for the tools present, and puts them first in a PATH once', async () => {
    const home = path.join(root, 'home')
    const dir = await installShims({ dataDir: path.join(home, 'data'), repo: '/opt/weevils', port: 4321, binDir: path.join(home, 'bin'), env: { HOME: home }, tools: new Set(['npm', 'npx'] as const) })
    expect(fs.readdirSync(dir).sort()).toEqual(['npm', 'npx'])
    const launcher = fs.readFileSync(path.join(home, 'bin', 'weevils-heavy'), 'utf8')
    expect(launcher).toBe(launcherScript('/opt/weevils', 4321))
    expect(launcher).toContain("'/opt/weevils/server/heavy/cli.ts'")
    expect(launcher).toContain('WEEVILS_PORT:-4321')
    expect(withShims(dir, `/usr/bin:${dir}:/bin`)).toBe(`${dir}:/usr/bin:/bin`)
    // A tool gone: its stand-in goes too. Queue off: none at all.
    await installShims({ dataDir: path.join(home, 'data'), repo: '/opt/weevils', port: 4321, binDir: path.join(home, 'bin'), env: { HOME: home }, tools: new Set(['npm'] as const) })
    expect(fs.readdirSync(dir)).toEqual(['npm'])
    expect(await installShims({ dataDir: path.join(home, 'data'), repo: '/opt/weevils', port: 4321, binDir: path.join(home, 'bin'), env: { HOME: home, WEEVILS_HEAVY_QUEUE: '0' } })).toBe('')
    expect(fs.existsSync(dir)).toBe(false)
  })
})
