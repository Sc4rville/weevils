// `weevils project new <name>`: the folder of a new project under the projects folder, with git. The one part of
// starting a project weevboss's own turn may do even when agents ask first (it is narrow: one new folder, one name,
// nothing outside the projects folder). The rest (the GitHub repo, the code) is a session's job, which asks the user.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** A project name as repos are named: lowercase, digits, dashes, dots and underscores, no path. */
export const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function newProjectFolder(root: string, name: string): { dir: string; existed: boolean } {
  // i18n-ignore : never shown, the route answers with its own message
  if (!PROJECT_NAME.test(name) || name.includes('..')) throw new Error('bad name')
  const dir = path.join(root, name)
  if (fs.existsSync(dir)) return { dir, existed: true }
  fs.mkdirSync(dir, { recursive: true })
  // Without git on the machine the folder is still made: the session that works in it installs what it needs.
  spawnSync('git', ['init', '-q', dir], { stdio: 'ignore', timeout: 15_000 })
  return { dir, existed: false }
}
