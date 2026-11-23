import { describe, expect, it } from 'vitest'
import { syncState } from './sync-progress.ts'

describe('the onboarding’s sync line', () => {
  it('counts what is on GitHub against what this machine has, and is done only once the import and the push are', () => {
    expect(syncState({ importing: null, imported: false, vault: null })).toEqual({ state: 'off', synced: 0, total: 0 })
    // The import still reads: the machine's count is the total, the vault's count what is there.
    expect(syncState({ importing: { done: 40, total: 340 }, imported: false, vault: { threads: 40, pending: 40 } })).toEqual({ state: 'running', synced: 0, total: 340 })
    expect(syncState({ importing: { done: 340, total: 340 }, imported: false, vault: { threads: 320, pending: 200 } })).toEqual({ state: 'running', synced: 120, total: 340 })
    // Imported: the weevbook's threads are the total (empty sessions never became one).
    expect(syncState({ importing: { done: 340, total: 340 }, imported: true, vault: { threads: 330, pending: 10 } })).toEqual({ state: 'running', synced: 320, total: 330 })
    expect(syncState({ importing: null, imported: true, vault: { threads: 330, pending: 0 } })).toEqual({ state: 'done', synced: 330, total: 330 })
  })
})
