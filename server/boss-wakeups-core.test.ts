import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../shared/api.ts'

const fast = vi.hoisted(() => ({ haiku: vi.fn(async () => '{"useful":true}') }))
vi.mock('./fast.ts', async (orig) => ({ ...await orig<typeof import('./fast.ts')>(), claudeHaiku: fast.haiku }))
vi.mock('./setup.ts', async (orig) => ({ ...await orig<typeof import('./setup.ts')>(), claudeLogged: () => true }))
vi.mock('./provider.ts', async (orig) => ({ ...await orig<typeof import('./provider.ts')>(), preferredTool: () => 'claude' }))
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
process.env.WEEVILS_ORCHESTRATOR = '1'
// These tests count launches: the turn started ahead (server/boss-warm.ts) has its own tests (boss-warm-core.test.ts).
process.env.WEEVILS_BOSS_WARM = '0'
const { Weevils } = await import('./core.ts')
const { BOSS_DIR } = await import('./boss-turns.ts')
const { QUIET_MS, SILENT_OUTCOME } = await import('./boss-wakeups.ts')
const NOW = Date.UTC(2026, 10, 17, 12)
const working = (): Session => ({ id: 'worker', machineId: 'test', projectId: 'demo', cwd: '/demo', status: 'working', lastActivityAt: NOW, subagents: [], queued: 0, background: 0, controllable: true, repo: 'demo', tool: 'claude', title: 'Preview', openedAt: NOW, workStartedAt: null, origin: 'weevils', live: true, hasScreen: true, messageCount: 1 } as Session)
let w: any, sessions: Session[], launch: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  fs.rmSync(BOSS_DIR, { recursive: true, force: true })
  delete process.env.WEEVILS_BOSS_PROACTIVE; delete process.env.WEEVILS_SPEED_MODE
  fast.haiku.mockReset().mockResolvedValue('{"useful":true}')
  w = new Weevils()
  sessions = [working()]
  vi.spyOn(w, 'sessions').mockImplementation(() => sessions)
  vi.spyOn(w, 'claudeBossPane').mockReturnValue(undefined)
  vi.spyOn(w, 'bossWorking').mockReturnValue(false)
  vi.spyOn(w, 'ledgerTick').mockResolvedValue(undefined)
  vi.spyOn(w.bossTurns, 'prewarm').mockResolvedValue(undefined)
  vi.spyOn(w.bossTurns, 'prepare').mockImplementation(async (...args: unknown[]) => ({ id: (args[0] as any).id, command: ['claude'], stableTokens: 0, recentTokens: 0, rebuilt: false }))
  // The worker was dispatched by weevboss: its stops can wake it.
  const view = w.ledger.view.bind(w.ledger)
  vi.spyOn(w.ledger, 'view').mockImplementation(() => ({ ...view(), asks: [{ id: 'r1', status: 'dispatched', progressAt: Date.now(), text: 'Preview', dispatches: [{ session: 'worker', at: NOW }] }] }))
  launch = vi.spyOn(w, 'spawn').mockResolvedValue('isolated-fake-pane') as any
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
const stop = async () => {
  await w.pumpTurns()
  sessions = [{ ...sessions[0], status: 'idle', lastActivityAt: NOW + 5000, lastMessage: 'The preview works.' }]
  vi.setSystemTime(NOW + 5000)
  await w.pumpTurns()
  vi.setSystemTime(NOW + 5000 + QUIET_MS)
}

describe('event-only core turns', () => {
  it('launches once with no captured user request, and reserves identity before an uncertain spawn', async () => {
    await stop()
    launch.mockRejectedValueOnce(new Error('launch acknowledgement lost'))
    await w.pumpTurns()
    expect(fast.haiku).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(w.bossTurns.queue).toHaveLength(0)
    expect(w.ledger.pending).toHaveLength(0)
    const id = launch.mock.calls[0][4]
    expect(w.bossTurns.isTurn(id)).toBe(true)
    await w.pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1)
    const state = JSON.parse(fs.readFileSync(path.join(BOSS_DIR, 'wakeups.json'), 'utf8'))
    expect(state.claims[0]).toMatchObject({ proactive: true, events: [{ session: 'worker' }] })
  })
  it.each(['pause', 'veille'])('does no triage or launch in %s, and respects live disable', async (mode) => {
    await stop()
    process.env.WEEVILS_SPEED_MODE = mode
    await w.pumpTurns()
    expect(fast.haiku).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    process.env.WEEVILS_SPEED_MODE = 'cruise'
    process.env.WEEVILS_BOSS_PROACTIVE = '0'
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
  })
  it('folds pending events into a waiting user turn without triage or another request', async () => {
    await stop()
    w.bossTurns.enqueue('Show my preview', 'user-capture')
    const fold = vi.spyOn(w.bossTurns, 'foldEvents')
    await w.pumpTurns()
    expect(fast.haiku).not.toHaveBeenCalled()
    expect(fold.mock.calls[0][0]).toMatchObject([{ kind: 'completion', session: 'worker' }])
    expect(launch).toHaveBeenCalledTimes(1)
    expect(w.bossTurns.queue).toHaveLength(0)
  })
  it('gives a user arriving during triage the next slot', async () => {
    await stop()
    fast.haiku.mockImplementationOnce(async () => { w.bossTurns.enqueue('My new request', 'capture'); return '{"useful":true}' })
    await w.pumpTurns()
    expect(w.bossTurns.prepare.mock.calls[0][0].ledger).toBeDefined()
    expect(launch).toHaveBeenCalledTimes(1)
    const metrics = fs.readFileSync(path.join(BOSS_DIR, 'metrics.jsonl'), 'utf8')
    expect(JSON.parse(metrics.trim()).proactive).toBe(false)
  })
  it('gives a user arriving during preparation priority before spawning', async () => {
    await stop()
    w.bossTurns.prepare.mockImplementationOnce(async (o: any) => { w.bossTurns.enqueue('My new request', 'capture'); return { id: o.id, command: ['claude'], stableTokens: 0, recentTokens: 0, rebuilt: false } })
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
    expect(w.bossTurns.queue[0]).toMatchObject({ text: 'My new request', cid: 'capture', events: [{ kind: 'completion' }] })
    await w.pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1)
  })
  it('stays silent for cheap negative triage and retains a failed pre-launch triage', async () => {
    await stop()
    fast.haiku.mockResolvedValueOnce('{"useful":false}')
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
    expect(w.wakeups.pending).toHaveLength(0)
    sessions = [{ ...sessions[0], lastActivityAt: NOW + 900_000, lastMessage: 'Another result' }]
    vi.setSystemTime(NOW + 900_000)
    await w.pumpTurns()
    vi.setSystemTime(NOW + 900_000 + QUIET_MS)
    fast.haiku.mockRejectedValueOnce(new Error('quota'))
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
    expect(w.wakeups.pending).toHaveLength(1)
    await w.pumpTurns()
    expect(fast.haiku).toHaveBeenCalledTimes(2)
  })
  it('does not change provider, close an old boss pane, or overlap an existing turn', async () => {
    await stop()
    w.relay = { executionTool: () => 'codex' }
    await w.pumpTurns()
    expect(fast.haiku).not.toHaveBeenCalled()
    w.relay = undefined
    w.claudeBossPane.mockReturnValue({ name: 'existing', sessionId: 'older-conversation' })
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
    w.claudeBossPane.mockReturnValue(undefined)
    w.bossWorking.mockReturnValue(true)
    await w.pumpTurns()
    expect(launch).not.toHaveBeenCalled()
  })
  it('honors a persisted quota episode before provider-health initialization after restart', async () => {
    await stop()
    w.relay = { episode: () => ({ kind: 'near', source: 'quota' }), executionTool: () => 'claude', providerReady: () => true }
    await w.pumpTurns()
    expect(fast.haiku).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(w.wakeups.pending).toHaveLength(1)
  })
  it('guards canonical sends, preserves source identity, and never repeats a resumption', async () => {
    const cwd = path.join(process.env.HOME!, 'projects', 'safe-worker')
    fs.mkdirSync(cwd, { recursive: true })
    const cut = { ...working(), cwd, live: false, status: 'interrupted', noticeId: 'cut-safe', interrupted: { reason: 'died', at: NOW } } as Session
    vi.spyOn(w, 'snapshot').mockReturnValue({ sessions: [cut], projects: [] })
    await w.send('worker', 'Continue authorized work and inspect surviving jobs first.', 'codex', 'project-codex', undefined, true)
    expect(launch).toHaveBeenCalledTimes(1)
    const command = launch.mock.calls[0][3] as string[]
    expect(command.join(' ')).toContain('project-codex')
    expect(command.join(' ')).toContain('Continue authorized work')
    await expect(w.send('worker', 'Repeat', 'codex', 'project-codex', undefined, true)).rejects.toThrow('cannot safely resume')
    expect(launch).toHaveBeenCalledTimes(1)
  })
  it('refuses to resume a scheduler-owned run through a full-access project session', async () => {
    const cwd = path.join(process.env.HOME!, 'projects', 'scheduler-worker')
    fs.mkdirSync(cwd, { recursive: true })
    const cut = { ...working(), cwd, live: false, status: 'interrupted', interrupted: { reason: 'died', at: NOW } } as Session
    vi.spyOn(w, 'snapshot').mockReturnValue({ sessions: [cut], projects: [] })
    w.optimizers = { autoSession: () => false, recapAutos: () => [{ sessionId: 'worker', state: 'running', runs: [] }] }
    await expect(w.send('worker', 'Continue', 'codex', 'project-codex', undefined, true)).rejects.toThrow('cannot safely resume')
    expect(launch).not.toHaveBeenCalled()
  })
  it('hides a silent assistant outcome from the normal thread without changing user words', () => {
    vi.spyOn(w, 'bossTranscripts').mockReturnValue([{ tool: 'claude', messages: [
      { id: 's', role: 'assistant', at: NOW, text: `Source is a test fixture.\n\n${SILENT_OUTCOME}` },
      { id: 'u', role: 'user', at: NOW + 1, text: SILENT_OUTCOME },
    ] }])
    const messages = w.orchestratorMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
  })
  it('pushes a proactive turn that spoke up to the phone, once, and keeps a silent one off it', async () => {
    await stop()
    await w.pumpTurns()
    const id = launch.mock.calls[0][4]
    const send = vi.fn(async (_p: any) => undefined)
    w.push = { enabled: true, send }
    const say = (text: string) => vi.spyOn(w.store, 'get').mockImplementation(((x: string) => x === id ? { id, messages: [{ role: 'assistant', text, at: NOW }] } : undefined) as any)
    vi.spyOn(w, 'toSession').mockReturnValue({ status: 'idle' })
    say('**First version** of the new interface is up: [next](https://next.example.com)')
    vi.setSystemTime(NOW + 5000 + QUIET_MS + 6000)
    await w.pumpTurns()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ title: 'weevboss', url: '/#boss', body: expect.stringContaining('First version') })
    vi.setSystemTime(NOW + 5000 + QUIET_MS + 12000)
    await w.pumpTurns()
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('asks itself what waits on the person and finds a merge button nobody pressed', async () => {
    w.foryou = { waitingOnUser: () => [{ key: 'fy:b:1', summary: "For you · Tonight's cleanup removed seven bits of dead code [buttons: Merge the cleanup, Prune 109 dead branches]" }] }
    await w.pumpTurns()
    vi.setSystemTime(NOW + QUIET_MS + 1)
    await w.pumpTurns()
    expect(fast.haiku).toHaveBeenCalledTimes(1)
    expect(String((fast.haiku.mock.calls[0] as unknown[])[0])).toContain('[new] For you')
    expect(launch).toHaveBeenCalledTimes(1)
    const prepared = (w.bossTurns.prepare as any).mock.calls[0][0]
    expect(prepared.waiting[0].summary).toContain('Merge the cleanup')
  })
})
