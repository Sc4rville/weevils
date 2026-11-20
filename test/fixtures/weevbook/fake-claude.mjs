#!/usr/bin/env node
// A provider CLI for tests (server/weevbook/hub.e2e.test.ts): `fake-claude.mjs --resume <session> <request>`, run in
// a project folder with HOME set, does what Claude Code would for one short turn. It appends to
// $HOME/.claude/projects/<folder slug>/<session>.jsonl the request, one Write of a file (FAKE_EDIT=path=content, also
// written on disk), its result, and an answer that ends the turn.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const session = args[args.indexOf('--resume') + 1]
const request = args.at(-1)
const cwd = process.cwd()
const file = path.join(process.env.HOME, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${session}.jsonl`)
const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
let parent = before.length ? (JSON.parse(before.at(-1)).uuid ?? null) : null
let n = 0
const stamp = Date.now().toString(16).padStart(12, '0').slice(-12)
const uuid = () => `00000000-0000-4000-9${String(++n).padStart(3, '0')}-${stamp}`
const line = (type, message) => {
  const u = uuid()
  const o = { parentUuid: parent, isSidechain: false, userType: 'external', cwd, sessionId: session, version: '2.1.4', gitBranch: 'main', type, message, uuid: u, timestamp: new Date().toISOString() }
  parent = u
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, `${JSON.stringify(o)}\n`)
}
const edit = process.env.FAKE_EDIT ?? 'src/cart.ts=export const cart = (n) => `${n} €`\n'
const target = edit.slice(0, edit.indexOf('='))
const content = edit.slice(edit.indexOf('=') + 1)
line('user', { role: 'user', content: request })
line('assistant', { id: `msg_${stamp}a`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: `toolu_${stamp}a`, name: 'Write', input: { file_path: path.join(cwd, target), content } }], stop_reason: 'tool_use' })
fs.mkdirSync(path.dirname(path.join(cwd, target)), { recursive: true })
fs.writeFileSync(path.join(cwd, target), content)
line('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${stamp}a`, content: 'written' }] })
line('assistant', { id: `msg_${stamp}b`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Done: the cart shows the currency too.' }], stop_reason: 'end_turn' })
