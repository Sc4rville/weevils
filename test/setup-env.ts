// Chargé avant chaque fichier de test (setupFiles de vite.config.ts), avant ses imports : config.ts lit HOME et les
// WEEVILS_* au chargement. Les tests ne lisent ni n'écrivent jamais la vraie config du développeur (~/.config/weevils,
// ~/.local/share/weevils, ~/.claude.json, ~/.codex) : un HOME jetable par fichier, la langue fixée, pas d'orchestrateur.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-test-home-'))
Object.assign(process.env, {
  HOME: home,
  WEEVILS_CONFIG: '/dev/null',
  WEEVILS_MACHINE: 'test',
  WEEVILS_ORCHESTRATOR: '0',
  WEEVILS_LANG: 'en',
})
delete process.env.CODEX_HOME
delete process.env.WEEVILS_PROJECTS
