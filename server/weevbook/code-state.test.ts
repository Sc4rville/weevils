import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bringCode, currentFolder, readCodeState, readFiles } from './code-state.ts'

let tmp = ''
const work = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const write = (dir: string, rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  fs.writeFileSync(path.join(dir, rel), text)
}

/** An origin and two clones of it: the machine left (`a`) and the one that takes the conversation (`b`). */
function repos() {
  const seed = path.join(tmp, 'seed')
  write(seed, 'app.js', 'one\n')
  write(seed, 'lib.js', 'lib\n')
  work(seed, 'init', '-q')
  work(seed, 'add', '-A')
  work(seed, 'commit', '-qm', 'first')
  const origin = path.join(tmp, 'origin.git')
  work(tmp, 'clone', '-q', '--bare', seed, origin)
  const a = path.join(tmp, 'a')
  const b = path.join(tmp, 'b')
  work(tmp, 'clone', '-q', origin, a)
  work(tmp, 'clone', '-q', origin, b)
  return { origin, a, b }
}
const files = (top: string) => (paths: string[]) => readFiles(top, paths)

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-code-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('the code of a conversation that moves to another clone of its repository', () => {
  it('the state says origin, HEAD, branch, the commits the origin lacks, and each uncommitted file with its hash', async () => {
    const { origin, a } = repos()
    write(a, 'app.js', 'two\n')
    work(a, 'commit', '-qam', 'local only')
    write(a, 'lib.js', 'lib changed\n')
    write(a, 'new/notes.md', 'notes\n')
    fs.rmSync(path.join(a, 'app.js'))
    const s = (await readCodeState(path.join(a, 'new')))!
    expect(s).toMatchObject({ folder: a, origin, branch: 'main', head: work(a, 'rev-parse', 'HEAD') })
    expect(s.unpushed).toEqual([`${work(a, 'rev-parse', '--short', 'HEAD')} local only`])
    expect(s.dirty.map((f) => [f.path, f.state, !!f.hash]).sort()).toEqual([['app.js', 'deleted', false], ['lib.js', 'modified', true], ['new/notes.md', 'untracked', true]])
    expect(await readCodeState(tmp)).toBeNull()
  })

  it('files are given from inside the repository only', async () => {
    const { a } = repos()
    write(tmp, 'secret.txt', 'no\n')
    fs.symlinkSync(tmp, path.join(a, 'out'))
    const got = await readFiles(a, ['app.js', '../secret.txt', 'out/secret.txt', '.git/config', '/etc/hostname'])
    expect(Object.keys(got)).toEqual(['app.js'])
  })

  it('on different commits, nothing is carried and the reason is said; a commit the origin lacks is named', async () => {
    const { a, b } = repos()
    write(a, 'app.js', 'two\n')
    work(a, 'commit', '-qam', 'not pushed')
    write(a, 'lib.js', 'mine\n')
    const r = await bringCode({ state: (await readCodeState(a))!, clone: b, machine: 'kusaila', files: files(a) })
    expect(r.pulled).toBeUndefined()
    expect(r.notPulled).toMatch(/is not on the origin$/)
    expect(r.carried).toEqual([])
    expect(r.left).toEqual([{ path: 'lib.js', why: expect.stringMatching(/^kusaila stands on [0-9a-f]{7}, this clone on [0-9a-f]{7}$/) as string }])
    expect(r.line).toContain('commits only kusaila has: ')
    expect(fs.readFileSync(path.join(b, 'lib.js'), 'utf8')).toBe('lib\n')
  })

  it('a pull git refuses (it would touch a file changed here) keeps this clone as it is', async () => {
    const { a, b } = repos()
    write(a, 'app.js', 'two\n')
    work(a, 'commit', '-qam', 'pushed')
    work(a, 'push', '-q', 'origin', 'main')
    write(b, 'app.js', 'mine here\n')
    const r = await bringCode({ state: (await readCodeState(a))!, clone: b, machine: 'kusaila', files: files(a) })
    expect(r.notPulled).toMatch(/^git refused/)
    expect(fs.readFileSync(path.join(b, 'app.js'), 'utf8')).toBe('mine here\n')
  })

  it('the same files are counted as the same; a file deleted over there and untouched here is deleted here', async () => {
    const { a, b } = repos()
    write(a, 'lib.js', 'both\n')
    write(b, 'lib.js', 'both\n')
    fs.rmSync(path.join(a, 'app.js'))
    const r = await bringCode({ state: (await readCodeState(a))!, clone: b, machine: 'kusaila', files: files(a) })
    expect(r).toMatchObject({ same: ['lib.js'], carried: ['app.js'], left: [] })
    expect(fs.existsSync(path.join(b, 'app.js'))).toBe(false)
  })
})

describe('the folder a session works in now', () => {
  it('is the cwd of its newest line, whatever the folder it was opened in', () => {
    const f = path.join(tmp, 's.jsonl')
    fs.writeFileSync(f, `${JSON.stringify({ type: 'user', cwd: '/home/u' })}\n${JSON.stringify({ type: 'assistant', cwd: '/home/u/projects/pli' })}\n{"cut`)
    expect(currentFolder(f, 'claude')).toBe('/home/u/projects/pli')
    const c = path.join(tmp, 'c.jsonl')
    fs.writeFileSync(c, `${JSON.stringify({ type: 'turn_context', payload: { cwd: '/srv/app' } })}\n`)
    expect(currentFolder(c, 'codex')).toBe('/srv/app')
    expect(currentFolder(path.join(tmp, 'none.jsonl'), 'claude')).toBeNull()
  })
})
