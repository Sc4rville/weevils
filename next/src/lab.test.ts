import { describe, expect, it } from 'vitest'
import { changedSince, labBusy } from './lab.tsx'

describe('the lab switch', () => {
  const item = (status: 'waiting' | 'working' | 'done' | 'undone', id = 'a') => ({ id, at: 1, text: 'x', status })
  it('reloads when a change was played again, undone, or the instance put back to blank', () => {
    expect(changedSince(null, { on: true, items: [item('done')] })).toBe(false)
    expect(changedSince({ on: true, items: [item('working')] }, { on: true, items: [item('done')] })).toBe(true)
    expect(changedSince({ on: true, items: [item('done')] }, { on: true, items: [item('done')] })).toBe(false)
    expect(changedSince({ on: true, items: [item('done')] }, { on: true, items: [item('undone')] })).toBe(true)
    expect(changedSince({ on: true, items: [] }, { on: true, items: [], reset: 5 })).toBe(true)
  })
  it('pulses while a change is on its way', () => {
    expect(labBusy({ on: true, items: [item('working')] })).toBe(true)
    expect(labBusy({ on: true, items: [item('done')] })).toBe(false)
    expect(labBusy({ on: true, items: [], keep: { status: 'testing', at: 1 } })).toBe(true)
  })
})
