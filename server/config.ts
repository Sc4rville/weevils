import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()
export const PORT = Number(process.env.WEEVILS_PORT ?? 4179)
/** Hooks Claude Code : écoute locale uniquement, jamais exposée par Caddy. */
export const HOOK_PORT = Number(process.env.WEEVILS_HOOK_PORT ?? 4180)
/** Racines des projets de cette machine, séparées par « : » (ex. ~/projects:~/Documents/projects). */
export const PROJECT_ROOTS = (process.env.WEEVILS_PROJECTS ?? path.join(HOME, 'projects')).split(':').filter(Boolean)
export const PROJECTS_DIR = PROJECT_ROOTS[0]
/** Autres weevilsd à fédérer : « pc=http://127.0.0.1:4192 ». */
export const REMOTES = process.env.WEEVILS_REMOTES
export const CLAUDE_DIR = path.join(HOME, '.claude', 'projects')
export const CODEX_DIR = path.join(process.env.CODEX_HOME ?? path.join(HOME, '.codex'), 'sessions')
export const LOGS_DIR = path.join(HOME, 'logs')
export const DATA_DIR = path.join(HOME, '.local', 'share', 'weevils')
export const CONFIG_DIR = path.join(HOME, '.config', 'weevils')
export const DIST_DIR = path.resolve(import.meta.dirname, '..', 'dist')

export const MACHINE = {
  id: process.env.WEEVILS_MACHINE ?? 'vps',
  name: process.env.WEEVILS_MACHINE_NAME ?? 'vps',
  note: process.env.WEEVILS_MACHINE_NOTE ?? 'VPS Hostinger · 4 vCPU · toujours allumé',
}

/** Sessions plus anciennes : ignorées (on ne relit pas tout l'historique). */
export const RECENT_MS = 3 * 24 * 3600_000
/** Sans signe de vie depuis ce délai, une session sans processus connu est considérée terminée. */
export const STALE_MS = 30 * 60_000
