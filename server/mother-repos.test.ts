// Your factory's Projects (docs/next-interaction.md): one band per product, its mother repo; clones and worktrees of
// the same remote, its « <product>-<part> » repos and an automation's folders never get a band of their own.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { isAutomationFolder, motherRepos, originOf } from './projects.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mothers-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const repo = (name: string, url?: string) => {
  const git = path.join(root, name, '.git')
  fs.mkdirSync(git, { recursive: true })
  fs.writeFileSync(path.join(git, 'config'), `[core]\n\tbare = false\n${url ? `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n` : ''}[branch "main"]\n\tremote = origin\n`)
}
const worktree = (name: string, of: string) => {
  const gd = path.join(root, of, '.git', 'worktrees', name)
  fs.mkdirSync(gd, { recursive: true })
  fs.writeFileSync(path.join(gd, 'commondir'), '../..\n')
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, '.git'), `gitdir: ${gd}\n`)
}
const folders = (names: string[]) => names.map((name) => ({ name, dir: path.join(root, name) }))

repo('game', 'https://github.com/someone/game.git')
repo('game-v3-drop-fin', 'https://github.com/someone/game.git') // a second clone of the same remote
repo('game-trailer', 'git@github.com:someone/game.git') // a third, over ssh
worktree('game-gpu', 'game')
repo('auto-2061533ece', 'https://github.com/someone/auto-2061533ece.git')
repo('auto-20c9ca36c9')
repo('shop-site', 'https://github.com/someone/shop-site.git')
repo('notes', 'https://github.com/someone/notes.git')
repo('notes-content', 'https://github.com/someone/notes-content.git') // a part of the product: its own remote
repo('ants') // a git repo with no remote yet
fs.mkdirSync(path.join(root, 'scratch'), { recursive: true }) // not a repo

it('a worktree reads its main repo’s remote; clones over https and ssh are the same repo', () => {
  expect(originOf(path.join(root, 'game-gpu'))).toBe('someone/game')
  expect(originOf(path.join(root, 'game-trailer'))).toBe('someone/game')
  expect(originOf(path.join(root, 'ants'))).toBe('')
  expect(originOf(path.join(root, 'scratch'))).toBeUndefined()
  expect(isAutomationFolder('auto-2061533ece')).toBe(true)
  expect(isAutomationFolder('automations')).toBe(false)
})

it('only the mother repos come out: one band per product, its folders folded into it', () => {
  const all = fs.readdirSync(root)
  const m = motherRepos(folders(all))
  expect(m.map((x) => x.name)).toEqual(['ants', 'game', 'notes', 'shop'])
  expect(m.find((x) => x.id === 'game')!.repos).toEqual(['game', 'game-gpu', 'game-trailer', 'game-v3-drop-fin'])
  expect(m.find((x) => x.id === 'notes')!.repos).toEqual(['notes', 'notes-content'])
  expect(m.find((x) => x.id === 'shop')!.repos).toEqual(['shop-site'])
  expect(m.flatMap((x) => x.repos).some((r) => r.startsWith('auto-'))).toBe(false)
})

it('several clones of one remote plus automation folders: exactly one band', () => {
  const m = motherRepos(folders(['game-v3-drop-fin', 'game-trailer', 'game-gpu', 'auto-2061533ece', 'auto-20c9ca36c9']))
  expect(m).toEqual([{ id: 'game', name: 'game', repos: ['game-gpu', 'game-trailer', 'game-v3-drop-fin'] }])
})
