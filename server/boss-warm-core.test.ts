// weevboss's turn started ahead (server/boss-warm.ts) inside weevilsd: started between messages, taken by the next
// message from the user, replaced when the flags changed, never by a wake-up.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pump = vi.hoisted(() => ({ call: vi.fn(async () => ({})), alive: true }))
vi.mock('./pump.ts', async (orig) => ({ ...await orig<typeof import('./pump.ts')>(), pumpCall: pump.call, pumpAlive: () => pump.alive }))
vi.mock('./setup.ts', async (orig) => ({ ...await orig<typeof import('./setup.ts')>(), claudeLogged: () => true }))
vi.mock('./provider.ts', async (orig) => ({ ...await orig<typeof import('./provider.ts')>(), preferredTool: () => 'claude' }))
vi.mock('./voicepipe.ts', () => ({ keepWarm() {}, warmCues() {} }))
process.env.WEEVILS_ORCHESTRATOR = '1'
process.env.WEEVILS_BOSS_PROACTIVE = '0'
const { Weevils } = await import('./core.ts')
const { BOSS_DIR } = await import('./boss-turns.ts')
const { PUMP_DIR } = await import('./pump.ts')

let w: any, launch: ReturnType<typeof vi.fn>
const waiting = (id: string) => {
  fs.mkdirSync(PUMP_DIR, { recursive: true })
  fs.writeFileSync(path.join(PUMP_DIR, `${id}.json`), JSON.stringify({ pid: 1, sessionId: id, ready: true, working: false, queued: 0, question: null, exited: null, at: Date.now() }))
}
/** pumpTurns starts the turn ahead without waiting for it. */
const pumpTurns = async () => { await w.pumpTurns(); for (let i = 0; i < 20 && w.spareStarting; i++) await new Promise((r) => setTimeout(r, 10)) }
const metrics = () => fs.readFileSync(path.join(BOSS_DIR, 'metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

beforeEach(() => {
  fs.rmSync(BOSS_DIR, { recursive: true, force: true })
  pump.call.mockClear(); pump.alive = true
  w = new Weevils()
  vi.spyOn(w, 'sessions').mockImplementation(() => [])
  vi.spyOn(w, 'claudeBossPane').mockReturnValue(undefined)
  vi.spyOn(w, 'bossWorking').mockReturnValue(false)
  vi.spyOn(w, 'ledgerTick').mockResolvedValue(undefined)
  vi.spyOn(w.bossTurns, 'prewarm').mockResolvedValue(undefined)
  launch = vi.spyOn(w, 'spawn').mockImplementation(async (...a: unknown[]) => `wv-pane-${String(a[4]).slice(0, 6)}`) as any
})
afterEach(() => vi.restoreAllMocks())

describe("weevboss's turn started ahead, in weevilsd", () => {
  it('starts between messages, and the next message from the user goes into it', async () => {
    await pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1)
    const [, , , command, id] = launch.mock.calls[0]
    expect(command).toContain('WEEVILS_PUMP_ONESHOT=1')
    expect(command).toContain('--input-format')
    waiting(id)
    await pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1) // one is enough

    w.bossTurns.enqueue('yo')
    await pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1) // no fresh process
    expect(pump.call).toHaveBeenCalledWith(id, expect.objectContaining({ op: 'send', text: expect.stringMatching(/^yo ⟦weevils — right now/) }), 5000)
    expect(w.orchestratorId).toBe(id)
    expect(w.bossTurns.isTurn(id)).toBe(true)
    expect(metrics().at(-1)).toMatchObject({ id, start: 'ahead' })
  })

  it('a model or effort change closes it; the message then starts fresh under the same id', async () => {
    await pumpTurns()
    const id = launch.mock.calls[0][4]
    waiting(id)
    w.bossTurns.choose('opus', 'low')
    w.bossTurns.enqueue('what is running?')
    await pumpTurns()
    expect(pump.call).not.toHaveBeenCalled()
    expect(launch).toHaveBeenCalledTimes(2)
    const [, , , command, again] = launch.mock.calls[1]
    expect(again).toBe(id)
    expect(command).toContain('weevboss-turn') // the ordinary one-shot command
    expect(metrics().at(-1).start).toMatch(/^fresh: view, model or effort changed/)
  })

  it('a process that is gone is replaced, and one that dies young waits before the next', async () => {
    await pumpTurns()
    const id = launch.mock.calls[0][4]
    fs.mkdirSync(PUMP_DIR, { recursive: true })
    fs.writeFileSync(path.join(PUMP_DIR, `${id}.json`), JSON.stringify({ pid: 1, sessionId: id, ready: false, working: false, exited: { code: 1, at: Date.now() }, at: Date.now() }))
    await pumpTurns()
    expect(w.spare).toBeNull()
    await pumpTurns()
    expect(launch).toHaveBeenCalledTimes(1) // backing off
    w.bossTurns.enqueue('yo')
    await pumpTurns()
    expect(launch).toHaveBeenCalledTimes(2)
    expect(launch.mock.calls[1][3]).toContain('weevboss-turn') // the message never waits for one
  })
})
