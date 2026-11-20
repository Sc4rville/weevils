// ~/.claude.json is Claude Code's file, rewritten by every session: weevils adds a folder's trust to it and never
// loses the rest (account, MCP servers, settings), whatever state it finds the file in.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { trustInClaudeJson, updateJsonFile } from './claude-json.ts'
import { trustDirs } from './core.ts'

const cfg = path.join(os.homedir(), '.claude.json')
const FULL = { oauthAccount: { emailAddress: 'someone@example.com' }, mcpServers: { notes: { command: 'notes-mcp' } }, theme: 'dark', projects: { '/p/old': { allowedTools: ['Bash'] } } }

beforeEach(() => {
  fs.rmSync(cfg, { force: true })
  for (const f of fs.readdirSync(os.homedir())) if (f.includes('.weevils-')) fs.rmSync(path.join(os.homedir(), f), { force: true })
})

describe('trust written into ~/.claude.json', () => {
  it('a file that does not parse (caught halfway through a write) is left exactly as it is', () => {
    for (const half of ['{"oauthAccount": {"emailAddress": "someone@exa', '', '[]', 'null']) {
      fs.writeFileSync(cfg, half, { mode: 0o644 })
      const before = fs.statSync(cfg)
      trustDirs(['/p/new'])
      expect(fs.readFileSync(cfg, 'utf8')).toBe(half)
      expect(fs.statSync(cfg).mtimeMs).toBe(before.mtimeMs)
    }
  })
  it('everything else in the file stays, and so does its mode', () => {
    fs.writeFileSync(cfg, JSON.stringify(FULL), { mode: 0o644 })
    fs.chmodSync(cfg, 0o644)
    expect(trustDirs(['/p/new'])).toBe(true)
    const d = JSON.parse(fs.readFileSync(cfg, 'utf8'))
    expect(d).toEqual({ ...FULL, projects: { ...FULL.projects, '/p/new': { hasTrustDialogAccepted: true } } })
    expect(fs.statSync(cfg).mode & 0o777).toBe(0o644)
    // A folder already trusted: nothing written.
    const at = fs.statSync(cfg).mtimeMs
    expect(trustDirs(['/p/new'])).toBe(false)
    expect(fs.statSync(cfg).mtimeMs).toBe(at)
    // No temporary file left behind.
    expect(fs.readdirSync(os.homedir()).filter((f) => f.includes('.weevils-'))).toEqual([])
  })
  it('a folder already listed keeps its own settings', () => {
    fs.writeFileSync(cfg, JSON.stringify(FULL))
    trustDirs(['/p/old'])
    expect(JSON.parse(fs.readFileSync(cfg, 'utf8')).projects['/p/old']).toEqual({ allowedTools: ['Bash'], hasTrustDialogAccepted: true })
  })
  it('no file yet: created, private', () => {
    expect(trustDirs(['/p/new'])).toBe(true)
    expect(JSON.parse(fs.readFileSync(cfg, 'utf8'))).toEqual({ projects: { '/p/new': { hasTrustDialogAccepted: true } } })
    expect(fs.statSync(cfg).mode & 0o777).toBe(0o600)
  })
  it('a write of Claude\'s between the read and the write is kept', () => {
    fs.writeFileSync(cfg, JSON.stringify(FULL))
    let calls = 0
    updateJsonFile(cfg, (d) => {
      // Claude Code writes its file while weevils is at work.
      if (calls++ === 0) fs.writeFileSync(cfg, JSON.stringify({ ...FULL, numStartups: 42 }))
      d.projects['/p/new'] = { hasTrustDialogAccepted: true }
      return true
    })
    const d = JSON.parse(fs.readFileSync(cfg, 'utf8'))
    expect(d.numStartups).toBe(42)
    expect(d.projects['/p/new']).toEqual({ hasTrustDialogAccepted: true })
  })
  it('a symbolic link stays a link; the file it names is the one updated', () => {
    const real = path.join(os.homedir(), 'dotfiles-claude.json')
    fs.writeFileSync(real, JSON.stringify(FULL))
    fs.symlinkSync(real, cfg)
    expect(trustInClaudeJson(cfg, ['/p/new'])).toBe(true)
    expect(fs.lstatSync(cfg).isSymbolicLink()).toBe(true)
    expect(JSON.parse(fs.readFileSync(real, 'utf8')).projects['/p/new']).toEqual({ hasTrustDialogAccepted: true })
    expect(JSON.parse(fs.readFileSync(real, 'utf8')).oauthAccount).toEqual(FULL.oauthAccount)
  })
})
