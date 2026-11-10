// The « auto » tasks against the real Weevils session list (the unit tests in optimizers.test.ts mock the snapshot):
// a task's session must show up in its project, never hidden like weevboss's (everything under DATA_DIR is), so that
// the runner follows it, holds the one-at-a-time slot with it, and the pane is reaped like any other. tmux is simulated;
// git is real (the worktree is made by weevils before the session starts).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mux = vi.hoisted(() => ({
  sendText: vi.fn(async (_name: string, _text: string) => {}),
  sendKey: vi.fn(async (_name: string, _key: string) => {}),
  capture: vi.fn(async (_name: string) => ''),
  spawnWv: vi.fn(async (..._args: unknown[]) => {}),
  killWv: vi.fn(async (_name: string) => {}),
  listWv: vi.fn(async () => [] as unknown[]),
  setOpt: vi.fn(async (..._args: unknown[]) => {}),
}))
vi.mock('./mux.ts', async (orig) => ({ ...(await orig<typeof import('./mux.ts')>()), ...mux }))
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
vi.mock('./fast.ts', async (orig) => ({ ...(await orig<typeof import('./fast.ts')>()), smart: vi.fn(), setCartesiaVoice() {} }))
vi.mock('./titles.ts', async (orig) => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))

const { Weevils } = await import('./core.ts')
const { DATA_DIR, HOME } = await import('./config.ts')
const { Memory } = await import('./memory.ts')
const { Optimizers, IDLE_MS } = await import('./optimizers.ts')
const { smart } = await import('./fast.ts')
type Transcript = import('./transcripts.ts').Transcript

const MIN = 60_000
const T0 = Date.parse('2026-11-10T03:00:00Z')
const projects = path.join(HOME, 'projects')
const repo = path.join(projects, 'mygame')
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
fs.mkdirSync(repo, { recursive: true })
git('init', '-q', '-b', 'main')
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first')

let w: InstanceType<typeof Weevils>
let tmp: string
const flush = async () => {
  // git worktree add runs for real: wait for the session to be spawned (or the launch to fail).
  for (let i = 0; i < 200 && !mux.spawnWv.mock.calls.length; i++) await new Promise((r) => setTimeout(r, 10))
  await new Promise((r) => setTimeout(r, 0))
}
const make = () => new Optimizers(w, new Memory(path.join(tmp, 'memory.json')), { file: path.join(tmp, 'optimizers.json'), sys: { load: () => 0.1, cpus: () => 4, free: () => 8 * 1024 ** 3, logged: () => true } })
async function accepted(task: Record<string, unknown>) {
  const o = make()
  vi.mocked(smart).mockResolvedValueOnce(JSON.stringify([{ why: 'w', kind: 'tests', heavy: false, priority: 1, est: 30, prompt: 'Do the thing, then stop and summarise.', ...task }]))
  await o.round(T0)
  o.accept(o.list()[0].id)
  return o
}
const transcript = (id: string, cwd: string, over: Partial<Transcript> = {}): Transcript => ({
  id,
  tool: 'claude',
  file: `/nowhere/${id}.jsonl`,
  cwd,
  openedAt: T0,
  lastActivityAt: Date.now(),
  workStartedAt: null,
  phase: 'idle',
  firstPrompt: 'brief',
  messages: [
    { id: `${id}-0`, role: 'user', text: 'brief', at: Date.now() },
    { id: `${id}-1`, role: 'assistant', text: 'Done: a report awaits review.', at: Date.now() },
  ],
  subagents: [],
  offset: 0,
  partial: '',
  queued: [],
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  for (const f of Object.values(mux)) f.mockReset()
  mux.listWv.mockResolvedValue([])
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-sessions-'))
  w = new Weevils()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('auto — the task sessions are real sessions of their project', () => {
  it('a repo task runs in its own worktree (fresh branch), shows in the repo project, then ends done', async () => {
    const o = await accepted({ title: 'Harden mygame tests', repo: 'mygame' })
    const id = o.list()[0].id
    o.tick(T0 + IDLE_MS)
    await flush()
    expect(mux.spawnWv).toHaveBeenCalledTimes(1)
    const [, cwd, , , command, sessionId] = mux.spawnWv.mock.calls[0] as [string, string, string, string, string[], string]
    expect(cwd).toBe(path.join(projects, '.auto', 'mygame', id))
    expect(cwd.startsWith(DATA_DIR)).toBe(false)
    expect(command).toContain('--settings')
    // The worktree is there, on its branch; the user's checkout stays on main.
    expect(execFileSync('git', ['-C', cwd, 'branch', '--show-current']).toString().trim()).toMatch(/^auto\/harden-mygame-tests-\w{4}$/)
    expect(git('branch', '--show-current').toString().trim()).toBe('main')

    // Starting: the placeholder is in the repo's project, and the runner sees it.
    const seen = w.sessions(Date.now()).find((s) => s.id === sessionId)
    expect(seen).toMatchObject({ projectId: 'mygame', repo: 'mygame', status: 'working' })
    o.tick(T0 + IDLE_MS + MIN)
    expect(o.list()[0]).toMatchObject({ state: 'running', sessionId })

    // The transcript appears (its cwd is the worktree) and the turn ends.
    vi.setSystemTime(T0 + IDLE_MS + 10 * MIN)
    w.store.byFile.set('/nowhere/x.jsonl', transcript(sessionId, cwd))
    w.bump()
    expect(w.sessions(Date.now()).find((s) => s.id === sessionId)).toMatchObject({ projectId: 'mygame', repo: 'mygame' })
    o.tick(Date.now())
    expect(o.list()[0]).toMatchObject({ state: 'done', lastEvent: 'Done: a report awaits review.' })
  })

  it('a task without a repo is visible too (never under DATA_DIR) and holds the slot: the next one waits', async () => {
    const o = await accepted({ title: 'Watch indie game fairs', repo: null, kind: 'watch' })
    vi.mocked(smart).mockResolvedValueOnce(JSON.stringify([{ title: 'Draft the press kit', why: 'w', repo: null, kind: 'content', prompt: 'Draft a press kit, then stop and summarise.' }]))
    await o.round(T0)
    o.accept(o.list().find((x) => x.state === 'proposed')!.id)
    o.tick(T0 + IDLE_MS)
    await flush()
    const [, cwd, , , , sessionId] = mux.spawnWv.mock.calls[0] as [string, string, string, string, string[], string]
    expect(cwd.startsWith(DATA_DIR)).toBe(false)
    expect(path.relative(projects, cwd).split(path.sep).every((seg) => seg.startsWith('.'))).toBe(true)
    // Past the vanish delay, still followed: the session is in the list.
    for (const at of [T0 + IDLE_MS + 4 * MIN, T0 + IDLE_MS + 9 * MIN]) {
      vi.setSystemTime(at)
      w.bump()
      expect(w.sessions(at).some((s) => s.id === sessionId)).toBe(true)
      o.tick(at)
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(o.list().map((x) => [x.title, x.state])).toEqual([
      ['Watch indie game fairs', 'running'],
      ['Draft the press kit', 'queued'],
    ])
    expect(mux.spawnWv).toHaveBeenCalledTimes(1)
  })
})
