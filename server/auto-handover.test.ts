// A session an automation run started (Optimizers.autoSession), written to (core.ts sendOne): the person's own message
// takes it over (the jailed process closed, the same conversation resumed as an ordinary session, a hidden note telling
// the agent); anyone else reaches it only inside its jail, and a closed one is never resumed outside it. tmux is fake.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tool } from '../shared/api.ts'

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
vi.mock('./fast.ts', () => ({ setCartesiaVoice() {} }))
// The question judge (Haiku) is replaced: a candidate question is confirmed as is, after a tick.
vi.mock('./asks-judge.ts', () => ({ judgeAsk: async (i: { said: string }) => i.said }))
vi.mock('./titles.ts', async (orig) => ({ ...(await orig<typeof import('./titles.ts')>()), llmTitles: async () => [] }))

const { Weevils } = await import('./core.ts')
const { DATA_DIR, HOME } = await import('./config.ts')
const { tr } = await import('./i18n.ts')
const CO = (await import('./i18n/core.ts')).default
const { projectClaude } = await import('./agent-launch.ts')
type Transcript = import('./transcripts.ts').Transcript

const NOW = Date.parse('2026-11-09T12:00:00Z')
const MIN = 60_000
const PANE = 'wv-demo-abc123'
const cwd = path.join(HOME, 'projects', 'demo')
fs.mkdirSync(cwd, { recursive: true })
/** A project session's commands: the bare one plus the plain-voice rule (server/agent-launch.ts). */
const CLAUDE = projectClaude()

let w: InstanceType<typeof Weevils>

function transcript(over: Partial<Transcript> = {}): Transcript {
  const id = over.id ?? 's1'
  return {
    id,
    tool: 'claude',
    file: `/nowhere/${id}.jsonl`,
    cwd,
    openedAt: NOW - 2 * MIN,
    lastActivityAt: NOW - MIN,
    workStartedAt: null,
    phase: 'idle',
    firstPrompt: 'earlier',
    messages: [{ id: `${id}-m0`, role: 'user', text: 'earlier', at: NOW - MIN }],
    subagents: [],
    offset: 0,
    partial: '',
    queued: [],
    ...over,
  }
}
const add = (t: Transcript) => (w.store.byFile.set(t.file, t), t)
const pane = (over: Partial<(typeof w.panes)[number]> = {}) => ({ name: PANE, tool: 'claude' as Tool, sessionId: 's1', title: 't', cwd, createdAt: NOW - MIN, ...over })

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  for (const f of Object.values(mux)) f.mockReset()
  mux.capture.mockResolvedValue('')
  mux.listWv.mockResolvedValue([])
  // Rien ne passe d'un test à l'autre par state.json (hooks, titres) ni ~/.claude.json.
  fs.rmSync(path.join(DATA_DIR, 'state.json'), { force: true })
  w = new Weevils()
  fs.rmSync(path.join(HOME, '.claude.json'), { force: true })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})


/** The automation runner as core.ts sees it: s1 is a run's session until the person takes it over. */
function runner() {
  const handed = new Set<string>()
  const r = { list: () => [], machine: () => undefined, roundBusy: false, owns: () => false, autoSession: (id: string) => (id === 's1' && !handed.has(id) ? { id: 'auto1' } : undefined), handOver: vi.fn((id: string) => void handed.add(id)) }
  ;(w as unknown as { optimizers: unknown }).optimizers = r
  return r
}
const flat = (cmd: unknown) => (cmd as string[]).join(' ')

describe('a session an automation started, written to', () => {
  it('by the person, its process gone: resumed as an ordinary session (no jail, no automation rules), same conversation, the agent told; the run hands it over', async () => {
    const r = runner()
    add(transcript({ lastActivityAt: NOW - 40 * MIN }))
    expect(await w.send('s1', 'merge it into main', undefined, undefined, 'user')).toEqual({ id: 's1' })
    const [, where, tool, title, command, id] = mux.spawnWv.mock.calls[0] as [unknown, string, string, string, string[], string]
    expect([where, tool, title, id]).toEqual([cwd, 'claude', 'earlier', 's1'])
    expect(command.slice(0, CLAUDE.length + 2)).toEqual([...CLAUDE, '--resume', 's1'])
    expect(flat(command)).not.toMatch(/bwrap|--settings|WEEVILS_SCOPE|--strict-mcp-config/)
    const text = command.at(-1)!
    expect(text.startsWith('merge it into main')).toBe(true)
    expect(text).toContain(tr(CO).autoHandover)
    expect(r.handOver).toHaveBeenCalledWith('s1')
    // Ordinary from now on: the next message, from anyone, is a plain one.
    mux.spawnWv.mockClear()
    w.panes = []
    await w.send('s1', 'and the docs', 'weevboss')
    expect((mux.spawnWv.mock.calls[0][4] as string[]).at(-1)).toBe('[from:weevboss] and the docs')
  })

  it('by the person while its jailed process still runs: that process is closed, the conversation resumes outside the jail', async () => {
    const r = runner()
    add(transcript())
    w.panes = [pane()]
    await w.send('s1', 'ship it', undefined, undefined, 'user')
    expect(mux.killWv.mock.calls).toEqual([[PANE]])
    expect(mux.sendText).not.toHaveBeenCalled()
    expect((mux.spawnWv.mock.calls[0][4] as string[]).slice(0, CLAUDE.length + 2)).toEqual([...CLAUDE, '--resume', 's1'])
    expect(r.handOver).toHaveBeenCalledWith('s1')
  })

  it('by anyone else, its process gone: refused in plain words, never resumed outside the jail', async () => {
    const r = runner()
    add(transcript({ lastActivityAt: NOW - 40 * MIN }))
    await expect(w.send('s1', 'merge it', 'weevboss')).rejects.toThrow(tr(CO).autoNeedsYou)
    await expect(w.send('s1', 'merge it', 'agent')).rejects.toThrow(tr(CO).autoNeedsYou)
    expect(mux.spawnWv).not.toHaveBeenCalled()
    expect(r.handOver).not.toHaveBeenCalled()
  })

  it('by anyone else while its jailed process runs: the message goes into that process, nothing restarts', async () => {
    const r = runner()
    add(transcript())
    w.panes = [pane()]
    const sent = w.send('s1', 'note this', 'weevboss').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    await sent
    expect(mux.sendText.mock.calls.some(([name, text]) => name === PANE && text.includes('note this'))).toBe(true)
    expect(mux.killWv).not.toHaveBeenCalled()
    expect(mux.spawnWv).not.toHaveBeenCalled()
    expect(r.handOver).not.toHaveBeenCalled()
  })

  it('an ordinary session is untouched by all this', async () => {
    runner()
    add(transcript({ id: 's2', file: '/nowhere/s2.jsonl', lastActivityAt: NOW - 40 * MIN }))
    await w.send('s2', 'again', 'weevboss')
    expect((mux.spawnWv.mock.calls[0][4] as string[]).slice(0, CLAUDE.length + 2)).toEqual([...CLAUDE, '--resume', 's2'])
  })
})
