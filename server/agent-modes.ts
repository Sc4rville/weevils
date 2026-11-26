// A session's own permission choice, set from its page: « Autonomous » or « Ask me » for this session only, whatever the
// global one (Your factory > Intelligence > Agents, server/ask-follow.ts). Kept in weevils' data folder as a small map
// session id → mode; a session absent from it follows the global choice. Read at each launch (server/core.ts): a
// fresh start, a --resume, and the auto-answer of a permission dialog still on its screen.
import fs from 'node:fs'
import path from 'node:path'
import type { AgentMode, AgentsChoice } from '../shared/api.ts'
import { DATA_DIR } from './config.ts'
import { askPermissions, runsAsRoot } from './agent-launch.ts'

/** Sessions kept at most: the oldest choices go first (a session that old is long over). */
const KEEP = 500

export const isAgentMode = (v: unknown): v is AgentMode => v === 'auto' || v === 'ask'

/** Whether a session asks: as root always (Claude Code refuses otherwise), else its own choice, else the global one. */
export function effectiveAsk(mode: AgentMode | undefined, global: boolean, root: boolean): boolean {
  if (root) return true
  return mode ? mode === 'ask' : global
}

/** The global choice as the app shows it: asking or not, and locked to asking as root. */
export function agentsChoice(env: NodeJS.ProcessEnv = process.env, root: boolean = runsAsRoot()): AgentsChoice {
  return root ? { ask: true, locked: 'root' } : { ask: askPermissions(env, false) }
}

export class SessionModes {
  private map: Record<string, AgentMode> = {}
  private file: string

  constructor(file: string = path.join(DATA_DIR, 'agent-modes.json')) {
    this.file = file
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (isAgentMode(v)) this.map[k] = v
    } catch {
      // none yet, or unreadable: every session follows the global choice
    }
  }

  get(id: string | undefined): AgentMode | undefined {
    return id ? this.map[id] : undefined
  }

  /** Sets (or, null, forgets) a session's choice. True when it changed. */
  set(id: string, mode: AgentMode | null): boolean {
    if ((this.map[id] ?? null) === mode) return false
    delete this.map[id]
    if (mode) this.map[id] = mode
    const keys = Object.keys(this.map)
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete this.map[k]
    this.save()
    return true
  }

  /** A session's id became another (a Codex pane linked to its transcript): its choice follows it. */
  move(from: string, to: string) {
    const m = this.map[from]
    if (!m || from === to) return
    delete this.map[from]
    this.map[to] = m
    this.save()
  }

  /** One session at least runs on its own: Claude Code's warning about that stays skipped. */
  anyAuto(): boolean {
    return Object.values(this.map).includes('auto')
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.map) + '\n', { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
}
