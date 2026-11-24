// weevboss's next turn, started ahead of its message. Each message stays a stateless turn with a fresh view (the log is
// the memory, server/boss-view.ts), but Claude Code no longer starts when the message arrives: once a turn is over, the
// next one is launched with the same view and flags and waits on its input (server/claude-pump.mjs, one message only).
// Measured on 2026-11-23 on a Mac with the usual settings: ~10 s of the ~16 s a « yo » took was Claude Code starting.
// The process waiting costs memory only (no request is sent before the message). It is replaced when the view, the
// model, the effort or the account change, after SPARE_MAX_AGE_MS, and whenever it is gone; a message that finds no
// usable one starts a fresh process as before. WEEVILS_BOSS_WARM=0 turns it off.

import fs from 'node:fs'
import { BOSS_MCP } from './boss-turns.ts'
import { PUMP_DIR, PUMP_SCRIPT, pumpAlive, pumpState } from './pump.ts'

export const BOSS_WARM = process.env.WEEVILS_BOSS_WARM !== '0'
/** A process waiting longer is replaced (settings, credentials and Claude Code itself may have changed since). */
export const SPARE_MAX_AGE_MS = 2 * 3600_000

export interface Spare {
  /** The session id it was started with: the turn it becomes keeps it. */
  id: string
  /** Its tmux pane. */
  pane: string
  /** turnKey of its flags, plus the account: a message whose turn has another key starts fresh. */
  key: string
  at: number
}

/** The pane command: claude-pump in one-message mode around the turn's own flags (stream-json in and out). */
export function aheadCommand(id: string, args: readonly string[]): string[] {
  fs.mkdirSync(PUMP_DIR, { recursive: true, mode: 0o700 })
  return ['env', ...(BOSS_MCP ? [] : ['ENABLE_CLAUDEAI_MCP_SERVERS=false']), 'WEEVILS_PUMP_ONESHOT=1', process.execPath, PUMP_SCRIPT, PUMP_DIR, id, '-', '--', ...args, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
}

/** Still waiting for its message: its pump runs, has not exited and has not been given one. */
export function spareWaiting(s: Spare | null | undefined): boolean {
  if (!s) return false
  const st = pumpState(s.id)
  return !!st && !st.exited && !st.working && pumpAlive(st.pid)
}
