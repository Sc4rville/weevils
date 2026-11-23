// The sync line of the onboarding (docs/spec/07-vault.md « The onboarding »): once GitHub and Claude are connected,
// weevboss's thread shows « 120 of 340 synced » under its words, by itself, until every conversation of this machine is
// in the vault. Read from real state only: the first import's progress file and the vault's own status.
import fs from 'node:fs'
import { DATA_DIR } from './config.ts'
import { backfillMarker, backfillProgress } from './weevbook/backfill.ts'
import { vaultStatus } from './weevbook/vault.ts'
import { vaultHere } from './weevbook/vault-cli.ts'

export interface SyncProgress {
  /** off: no vault on this machine; running: conversations still on their way; done: every one is in the vault. */
  state: 'off' | 'running' | 'done'
  synced: number
  total: number
}

/** Pure (tested): the line from the import's progress, whether it finished, and the vault's count of what waits. */
export function syncState(o: { importing: { done: number; total: number } | null; imported: boolean; vault: { threads: number; pending: number } | null }): SyncProgress {
  if (!o.vault) return { state: 'off', synced: 0, total: 0 }
  const total = o.imported ? o.vault.threads : Math.max(o.importing?.total ?? 0, o.vault.threads)
  const synced = Math.min(total, Math.max(0, o.vault.threads - o.vault.pending))
  return { state: o.imported && o.vault.pending === 0 ? 'done' : 'running', synced, total }
}

let cache: { at: number; v: SyncProgress } | null = null

/** This machine's sync, read at most every 3 seconds (the app asks every few seconds while it runs). */
export async function syncProgress(dataDir = DATA_DIR): Promise<SyncProgress> {
  if (cache && Date.now() - cache.at < 3000) return cache.v
  const o = vaultHere([])
  let v: SyncProgress
  try {
    const status = o ? await vaultStatus({ dir: o.dir, staging: o.staging, remote: o.remote, key: true }) : null
    v = syncState({ importing: backfillProgress(dataDir), imported: fs.existsSync(backfillMarker(dataDir)), vault: status })
  } catch {
    v = { state: 'off', synced: 0, total: 0 }
  }
  cache = { at: Date.now(), v }
  return v
}
