import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquire, hasRoom, slotCount, status, tickets } from './queue.ts'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heavyq-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const calm = () => ({ load: 0.1, cores: 4, memMb: 8000 })
const base = { cwd: '/w', room: calm, tickMs: 10, get dir() { return dir } }

describe('heavy-job queue', () => {
  it('sizes its slots from the cores, or from WEEVILS_HEAVY_SLOTS', () => {
    expect(slotCount({}, 1)).toBe(1)
    expect(slotCount({}, 2)).toBe(1)
    expect(slotCount({}, 4)).toBe(2)
    expect(slotCount({}, 8)).toBe(2)
    expect(slotCount({}, 16)).toBe(4)
    expect(slotCount({}, 64)).toBe(4)
    expect(slotCount({ WEEVILS_HEAVY_SLOTS: '1' }, 16)).toBe(1)
    expect(slotCount({ WEEVILS_HEAVY_SLOTS: 'x' }, 4)).toBe(2)
  })

  it('has room under 1.5 × cores and with 2 GB free', () => {
    expect(hasRoom({ load: 5.9, cores: 4, memMb: 2048 })).toBe(true)
    expect(hasRoom({ load: 6, cores: 4, memMb: 9000 })).toBe(false)
    expect(hasRoom({ load: 1, cores: 4, memMb: 2000 })).toBe(false)
  })

  it('runs at most `slots` jobs at once, first come first served', async () => {
    const a = await acquire({ ...base, cmd: 'a', slots: 2 })
    const b = await acquire({ ...base, cmd: 'b', slots: 2 })
    expect(a && b).toBeTruthy()
    const order: string[] = []
    let waited = 0
    const c = acquire({ ...base, cmd: 'c', slots: 2, onWait: () => waited++ }).then((s) => (order.push('c'), s))
    await new Promise((r) => setTimeout(r, 30))
    const d = acquire({ ...base, cmd: 'd', slots: 2 }).then((s) => (order.push('d'), s))
    await new Promise((r) => setTimeout(r, 60))
    expect(order).toEqual([])
    expect(waited).toBe(1)
    expect(status(dir).running.map((t) => t.cmd)).toEqual(['a', 'b'])
    expect(status(dir).waiting.map((t) => t.cmd)).toEqual(['c', 'd'])
    a!.release()
    const sc = await c
    await new Promise((r) => setTimeout(r, 60))
    expect(order).toEqual(['c'])
    b!.release()
    const sd = await d
    expect(order).toEqual(['c', 'd'])
    sc!.release()
    sd!.release()
    expect(tickets(dir)).toEqual([])
  })

  it('starts at once when nothing heavy runs, whatever the load; waits for room otherwise', async () => {
    const busy = () => ({ load: 30, cores: 4, memMb: 8000 })
    const a = await acquire({ ...base, cmd: 'a', slots: 2, room: busy })
    expect(a).toBeTruthy()
    let got = false
    const b = acquire({ ...base, cmd: 'b', slots: 2, room: busy }).then((s) => ((got = true), s))
    await new Promise((r) => setTimeout(r, 60))
    expect(got).toBe(false)
    a!.release()
    ;(await b)!.release()
  })

  it('drops the tickets of processes that are gone', async () => {
    fs.writeFileSync(path.join(dir, '00000000000001-999999-dead.json'), JSON.stringify({ pid: 2 ** 22 + 12345, at: 1, cmd: 'ghost', cwd: '/', state: 'running' }))
    const a = await acquire({ ...base, cmd: 'a', slots: 1 })
    expect(a).toBeTruthy()
    expect(status(dir).running.map((t) => t.cmd)).toEqual(['a'])
    a!.release()
  })

  it('gives up its place when the job goes elsewhere', async () => {
    const a = await acquire({ ...base, cmd: 'a', slots: 1 })
    const b = await acquire({ ...base, cmd: 'b', slots: 1, everyMs: 20, giveUp: () => true })
    expect(b).toBeNull()
    expect(status(dir).waiting).toEqual([])
    a!.release()
  })
})
