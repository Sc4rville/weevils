import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TEMPO_MODES, legacyOf, type Figure, type TempoMode } from '../shared/tempo.ts'
import { capacityOf, clampTo, dueStarts, modesOf, splitOf, TempoStore, type MachineInput, type RepoQueue } from './tempo.ts'

const NOW = Date.UTC(2026, 10, 21, 12)
const H = 3600_000
const fig = (value: number, confidence: Figure['confidence'] = 'measured'): Figure => ({ value, lo: value * 0.9, hi: value * 1.1, confidence, source: 'test', at: NOW })
// Yann's setup, measured: one Max 20x (about $1,600 a week), Opus at about $13 an agent-hour, a 4-core / 15 GB VPS.
const vps: MachineInput = { cores: 4, memGb: 15, diskFreeGb: 70, at: NOW, host: { plan: 'KVM 4', nextPlan: 'KVM 8', nextVcpu: 8, nextRamGb: 32, nextPrice: 73.99, currency: 'USD' } }
const cap = (o: Partial<Parameters<typeof capacityOf>[0]> = {}) =>
  capacityOf({ weekUsd: fig(1600), accounts: 1, usdPerAgentHour: fig(13), tokensPerAgentHour: fig(6e6), machine: vps, claude: { weekPct: 30, weekResets: NOW + 4 * 24 * H, at: NOW }, now: NOW, ...o })

describe('capacity and the seven modes', () => {
  it('opens Pause to Max for one big plan on a 4-core VPS, locks Fleet and Swarm and says what opens them', () => {
    const c = cap()
    expect(Math.round(c.agentHoursPerDay!.value)).toBe(18)
    expect(c.machine.agents.value).toBe(6)
    const m = modesOf(c, vps)
    expect(m.filter((x) => x.unlocked).map((x) => x.id)).toEqual(['pause', 'standby', 'cruise', 'turbo', 'max'])
    const fleet = m.find((x) => x.id === 'fleet')!
    expect(fleet.missing).toEqual(['intelligence', 'machine'])
    expect(fleet.unlock).toMatchObject({ subscriptions: 2, cores: 8, ramGb: 15, hostPlan: 'KVM 8' })
  })
  it('a small plan opens fewer modes; a second account opens more', () => {
    expect(modesOf(cap({ weekUsd: fig(300) }), vps).filter((x) => x.unlocked).map((x) => x.id)).toEqual(['pause', 'standby', 'cruise'])
    const two = modesOf(cap({ accounts: 2, machine: { ...vps, cores: 8, memGb: 32 } }), vps)
    expect(two.find((x) => x.id === 'fleet')!.unlocked).toBe(true)
  })
  it('the band: Cruise holds to the daily share, Turbo may run ahead, Max uses what it says', () => {
    const m = modesOf(cap(), vps)
    const pct = (id: TempoMode) => m.find((x) => x.id === id)!.band.pctIntelligence!.value
    expect(pct('cruise')).toBeLessThanOrEqual(100)
    expect(pct('turbo')).toBeGreaterThan(100)
    expect(pct('turbo')).toBeLessThanOrEqual(140)
    expect(pct('max')).toBeGreaterThan(pct('turbo'))
    expect(m.find((x) => x.id === 'standby')!.band.tokensPerDay.value).toBe(4 * 6e6)
  })
  it('without a quota reading only the machine counts, and the figures say default', () => {
    const c = cap({ weekUsd: null, usdPerAgentHour: fig(13, 'default') })
    expect(c.agentHoursPerDay).toBeNull()
    const m = modesOf(c, vps)
    expect(m.find((x) => x.id === 'max')!.unlocked).toBe(true)
    expect(m.find((x) => x.id === 'max')!.band.pctIntelligence).toBeNull()
  })
  it('the pace: how far over the week line, and a hard limit only when every tank is stopped', () => {
    const c = cap({ claude: { weekPct: 60, weekResets: NOW + 4 * 24 * H, at: NOW } })
    expect(c.pace.elapsedPct).toBe(43)
    expect(c.pace.over).toBe(17)
    expect(cap({ claude: { weekPct: 100, weekResets: NOW + H, at: NOW } }).pace.hardLimit).toBe(true)
    expect(cap({ claude: { weekPct: 100, weekResets: NOW + H, at: NOW }, codex: { weekPct: 20, at: NOW } }).pace.hardLimit).toBe(false)
  })
  it('a chosen mode that is no longer open falls to the highest open one', () => {
    const m = modesOf(cap(), vps)
    expect(clampTo('swarm', m)).toBe('max')
    expect(clampTo('cruise', m)).toBe('cruise')
  })
})

describe('the global ceiling, split fairly', () => {
  it('two repos asking for more than the ceiling share it equally', () => {
    expect(splitOf('turbo', [{ id: 'a', mode: 'turbo' }, { id: 'b', mode: 'max' }])).toEqual({ a: 2, b: 2 })
  })
  it('a repo on a low mode keeps to it; the rest goes to the others', () => {
    expect(splitOf('max', [{ id: 'a', mode: 'standby' }, { id: 'b', mode: 'max' }, { id: 'c', mode: 'turbo' }])).toEqual({ a: 1, b: 3, c: 2 })
  })
  it('no repo goes above the global mode, and global Pause gives nobody anything', () => {
    expect(splitOf('cruise', [{ id: 'a', mode: 'swarm' }])).toEqual({ a: 2 })
    expect(splitOf('pause', [{ id: 'a', mode: 'max' }])).toEqual({ a: 0 })
  })
})

describe('the one rule: every mode but Pause takes requests', () => {
  // A week simulated minute by minute: 20 requests in one repo, the budget far over its pace and a full 5-hour
  // window. Each start runs 30 minutes. Every mode but Pause must start all 20, oldest first, none waiting past its limit.
  const LIMIT: Record<TempoMode, number> = { pause: Infinity, standby: 4 * H, cruise: H, turbo: 0, max: 0, fleet: 0, swarm: 0 }
  const simulate = (mode: TempoMode, over: number, hardLimit = false, minutes = 7 * 24 * 60) => {
    const queued = Array.from({ length: 20 }, (_, i) => ({ ask: `r${i}`, since: NOW - (20 - i) * 60_000 }))
    const running: { ask: string; until: number }[] = []
    const started: { ask: string; at: number; waited: number }[] = []
    let freeSince: number | null = NOW
    for (let t = NOW; t < NOW + minutes * 60_000; t += 60_000) {
      for (let i = running.length - 1; i >= 0; i--) if (running[i].until <= t) running.splice(i, 1)
      if (!running.length && freeSince == null) freeSince = t
      const repos: RepoQueue[] = [{ id: 'w', mode, queued, running: running.length, freeSince }]
      const split = splitOf(mode, repos)
      for (const s of dueStarts({ global: mode, repos, split, over, hardLimit, now: t })) {
        const i = queued.findIndex((q) => q.ask === s.ask)
        const [q] = queued.splice(i, 1)
        started.push({ ask: q.ask, at: t, waited: t - Math.max(q.since, freeSince ?? t) })
        running.push({ ask: q.ask, until: t + 30 * 60_000 })
        freeSince = null
      }
    }
    return { started, left: queued.length }
  }
  for (const mode of TEMPO_MODES.filter((m) => m !== 'pause')) {
    it(`${mode}: all 20 start, oldest first, within ${LIMIT[mode] / H} h of the repo being free, even 40 points over the pace`, () => {
      const r = simulate(mode, 40)
      expect(r.left).toBe(0)
      expect(r.started.map((s) => s.ask)).toEqual(Array.from({ length: 20 }, (_, i) => `r${i}`))
      for (const s of r.started) expect(s.waited).toBeLessThanOrEqual(LIMIT[mode])
    })
  }
  it('pause: nothing starts, all 20 stay', () => {
    expect(simulate('pause', -50)).toEqual({ started: [], left: 20 })
  })
  it('every tank at its real limit: nothing starts; the minute it lifts, the queue moves by itself', () => {
    expect(simulate('max', 0, true, 60).started).toEqual([])
    const repos: RepoQueue[] = [{ id: 'w', mode: 'standby', queued: [{ ask: 'r0', since: NOW - 10 * H }], running: 0, freeSince: NOW - 10 * H }]
    expect(dueStarts({ global: 'standby', repos, split: splitOf('standby', repos), over: 50, hardLimit: false, now: NOW })).toEqual([{ repo: 'w', ask: 'r0', tier: 'light', why: 'floor' }])
  })
  it('under its pace a mode fills its share at once, with its own tier', () => {
    const repos: RepoQueue[] = [{ id: 'w', mode: 'turbo', queued: [1, 2, 3, 4, 5].map((i) => ({ ask: `r${i}`, since: NOW - i })), running: 1, freeSince: null }]
    const s = dueStarts({ global: 'max', repos, split: splitOf('max', repos), over: -3, hardLimit: false, now: NOW })
    expect(s.map((x) => x.ask)).toEqual(['r5', 'r4', 'r3'])
    expect(s.every((x) => x.tier === 'usual' && x.why === 'pace')).toBe(true)
  })
})

describe('the store', () => {
  it('a repo runs at Cruise until set, never above the ceiling; the older word sets the ceiling; it survives a restart', () => {
    expect(new TempoStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-')), {}).modeOf(null)).toBe('max')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-'))
    const s = new TempoStore(dir, { WEEVILS_SPEED_MODE: 'veille' })
    expect(s.modeOf(null)).toBe('standby')
    expect(s.modeOf('weevils')).toBe('standby')
    s.set('turbo', 'weevils', NOW)
    s.set('max', null, NOW)
    const again = new TempoStore(dir, {})
    expect(again.modeOf('weevils')).toBe('turbo')
    expect(again.modeOf('other')).toBe('cruise')
    again.set('standby', null, NOW)
    expect(again.modeOf('weevils')).toBe('standby')
    again.set('max', null, NOW)
    again.follow('weevils')
    expect(new TempoStore(dir, {}).modeOf('weevils')).toBe('cruise')
    expect(legacyOf('standby')).toBe('veille')
    expect(legacyOf('swarm')).toBe('max')
  })
})
