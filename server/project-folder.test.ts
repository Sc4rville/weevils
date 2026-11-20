import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { newProjectFolder } from './project-folder.ts'

it('makes one folder under the projects folder, with git, and nothing for a name that is a path', () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'projects-')), 'projects')
  const r = newProjectFolder(root, 'trip-planner')
  expect(r).toEqual({ dir: path.join(root, 'trip-planner'), existed: false })
  expect(fs.existsSync(path.join(root, 'trip-planner', '.git'))).toBe(true)
  expect(newProjectFolder(root, 'trip-planner').existed).toBe(true)
  for (const bad of ['../x', 'a/b', '.hidden', 'Trip', '', 'a..b', 'x'.repeat(65), '~']) expect(() => newProjectFolder(root, bad), bad).toThrow()
  expect(fs.readdirSync(root)).toEqual(['trip-planner'])
})
