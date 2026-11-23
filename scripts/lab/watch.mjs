#!/usr/bin/env node
// The onboarding lab's host side (docs/onboarding-lab.md; started by scripts/lab.sh). It reads the remarks the lab
// instance writes into the lab folder (server/lab.ts), has an agent change the onboarding in the lab worktree, checks
// and builds it, commits it on the lab branch, restarts the instance (its code is that worktree) and says so in
// results/: the instance then plays the step again and the app reloads. It also does undo (a revert), keep (the full
// checks, then the lab branch fast-forwards main) and start over (a blank instance, the same device still signed in).
//
//   node scripts/lab/watch.mjs --worktree <dir> --lab <dir> --name <container> --port <port> [--remote public] [--model opus]
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const tree = path.resolve(arg('worktree'))
const lab = path.resolve(arg('lab'))
const name = arg('name', 'weevils-lab')
const port = arg('port', '4187')
const remote = arg('remote', 'public')
const model = arg('model', 'opus')
const fresh = path.join(tree, 'scripts', 'fresh.sh')
for (const d of ['remarks', 'results', 'requests', 'requests/done']) fs.mkdirSync(path.join(lab, d), { recursive: true })

const log = (s) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`)
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (f, v) => {
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(v))
  fs.renameSync(`${f}.tmp`, f)
}
const result = (id, v) => writeJson(path.join(lab, 'results', `${id}.json`), { ...v, at: Date.now() })

/** A command in the worktree: its exit code and the end of what it printed. */
function run(cmd, args, o = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: tree, env: { ...process.env, ...o.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => (out = (out + d).slice(-200_000)))
    p.stderr.on('data', (d) => (out = (out + d).slice(-200_000)))
    const timer = o.timeoutMs ? setTimeout(() => p.kill(), o.timeoutMs) : null
    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, out })
    })
    p.on('error', (e) => resolve({ code: 1, out: String(e) }))
  })
}
const git = (...a) => spawnSync('git', a, { cwd: tree, encoding: 'utf8' })
const changed = () => git('status', '--porcelain').stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''))

const RULES = `You are changing weevils' onboarding: what a newcomer sees and reads on their first launch, in weevboss's thread.
The person who builds weevils is playing a newcomer on a blank instance and made a remark about what they see. Make the
smallest change that answers it, in this worktree, for every weevils user (never their name or anything personal).
Where things are: weevboss's onboarding words in server/i18n/setup.ts (French and English, always both, same meaning);
the steps in server/setup.ts (welcome, greeting, offlineReply, watchSync, act); answers before the person's own Claude
in server/guest-brain.ts; the screens in next/src (chat.tsx) and src/ui/setup.tsx; the spec in docs/spec/07-vault.md.
House rules: no buttons, an action is a coloured link inside a sentence; no useless text; plain words for someone who
is not technical; English in code comments. Update the tests that pin what you changed (often server/setup-welcome.test.ts)
and run them with \`npx vitest run <files>\`, and \`npx tsc --noEmit -p server\` (or \`-p next\`) for what you touched.
Do not commit, do not touch git, do not start or restart anything.
End your answer with one line: CHANGE: <what changed, in one short plain sentence, in the language of the remark>.`

async function agent(prompt) {
  const r = await run('claude', ['-p', '--model', model, '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(npx vitest:*)', 'Bash(npx tsc:*)', 'Bash(npm run i18n:check)', 'Bash(git diff:*)', 'Bash(git status:*)',
    '--', prompt], { timeoutMs: 20 * 60_000 })
  const line = r.out.split('\n').reverse().find((l) => /^\s*\**CHANGE:?\**/i.test(l))
  return { ok: r.code === 0, change: line ? line.replace(/^\s*\**CHANGE:?\**\s*/i, '').trim() : '', out: r.out }
}

/** The checks a change must pass before it is shown: types, words in both languages, the tests near what changed. */
async function check(files) {
  for (const [c, a] of [['npx', ['tsc', '--noEmit', '-p', 'server']], ['npx', ['tsc', '--noEmit', '-p', 'next']], ['npx', ['tsc', '--noEmit']], ['npm', ['run', '-s', 'i18n:check']]]) {
    const r = await run(c, a, { timeoutMs: 5 * 60_000 })
    if (r.code) return `${c} ${a.join(' ')}:\n${r.out.slice(-3000)}`
  }
  const code = files.filter((f) => /\.(ts|tsx)$/.test(f))
  if (code.length) {
    const r = await run('npx', ['vitest', 'related', '--run', ...code], { timeoutMs: 10 * 60_000 })
    if (r.code) return `npx vitest related:\n${r.out.slice(-4000)}`
  }
  return ''
}

async function build() {
  for (const a of [['vite', 'build'], ['vite', 'build', '-c', 'next/vite.config.ts']]) {
    const r = await run('npx', a, { timeoutMs: 10 * 60_000 })
    if (r.code) return r.out.slice(-2000)
  }
  return ''
}

/** The instance runs the worktree's code: a restart loads it (its data stays). */
async function restart() {
  spawnSync('docker', ['restart', name], { stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${port}/api/me`], { encoding: 'utf8' })
    if (r.stdout && r.stdout !== '000') return true
    await new Promise((ok) => setTimeout(ok, 500))
  }
  return false
}

const discard = () => {
  git('checkout', '--', '.')
  git('clean', '-fdq', '--', 'server', 'next', 'src', 'shared', 'docs')
}

async function remark(r) {
  log(`remark ${r.id}: ${r.text.slice(0, 80)}`)
  result(r.id, { status: 'working' })
  const pictures = (r.photos ?? []).map((p) => path.join(lab, 'remarks', p))
  const prompt = `${RULES}

What the screen showed (oldest first):
${(r.context ?? []).join('\n') || '(nothing yet)'}
${pictures.length ? `\nPictures they sent with it (read them): ${pictures.join(', ')}\n` : ''}
Their remark: ${r.text}`
  let a = await agent(prompt)
  let files = changed()
  if (!files.length) return result(r.id, { status: 'failed', change: a.change || 'nothing changed' })
  let failed = await check(files)
  if (failed) {
    log(`checks failed, one more try`)
    a = await agent(`${RULES}\n\nYou just made this change for the remark « ${r.text} », and a check failed. Fix it, keep the change.\n\n${failed}`)
    files = changed()
    failed = await check(files)
  }
  if (failed) {
    discard()
    return result(r.id, { status: 'failed', change: `checks failed: ${failed.split('\n')[0]}` })
  }
  const broke = await build()
  if (broke) {
    discard()
    return result(r.id, { status: 'failed', change: `build failed` })
  }
  git('add', '-A', '--', ...new Set(files.map((f) => f.split('/')[0])))
  const c = git('commit', '-q', '-m', `onboarding lab: ${a.change || r.text}`.slice(0, 300))
  if (c.status) {
    discard()
    return result(r.id, { status: 'failed', change: `commit refused: ${(c.stderr || c.stdout).split('\n')[0]}` })
  }
  const commit = git('rev-parse', 'HEAD').stdout.trim()
  await restart()
  result(r.id, { status: 'built', change: a.change || '', commit })
  log(`built ${r.id} (${commit.slice(0, 8)}): ${a.change}`)
}

async function undo(id) {
  const res = readJson(path.join(lab, 'results', `${id}.json`))
  if (!res?.commit || res.status !== 'built') return
  const r = git('revert', '--no-edit', res.commit)
  if (r.status) {
    git('revert', '--abort')
    return result(id, { ...res, status: 'built', change: `${res.change} (undo failed: a later change depends on it)` })
  }
  await build()
  await restart()
  result(id, { ...res, status: 'undone', revert: git('rev-parse', 'HEAD').stdout.trim() })
  log(`undone ${id}`)
}

async function keep() {
  const f = path.join(lab, 'results', 'keep.json')
  writeJson(f, { status: 'testing', at: Date.now() })
  const fail = (why) => (writeJson(f, { status: 'failed', why: why.slice(0, 300), at: Date.now() }), log(`keep failed: ${why.split('\n')[0]}`))
  if (git('fetch', '-q', remote, 'main').status) return fail(`fetch ${remote} failed`)
  if (git('rebase', '-q', `${remote}/main`).status) {
    git('rebase', '--abort')
    return fail('main moved in a way that conflicts with these changes')
  }
  for (const [c, a] of [['npm', ['run', '-s', 'lint']], ['npx', ['vitest', 'run']]]) {
    const r = await run(c, a, { timeoutMs: 30 * 60_000 })
    if (r.code) return fail(`${c} ${a.join(' ')} failed: ${r.out.split('\n').filter((l) => /FAIL|error/i.test(l)).slice(0, 3).join(' · ')}`)
  }
  const p = git('push', '-q', remote, 'HEAD:main')
  if (p.status) return fail(`push refused: ${(p.stderr || p.stdout).split('\n')[0]}`)
  writeJson(f, { status: 'landed', at: Date.now() })
  log('kept on main')
}

/** A blank instance again, from the worktree's code; this device stays signed in (its token is carried over). */
async function reset() {
  const tmp = fs.mkdtempSync('/tmp/weevils-lab-')
  spawnSync('docker', ['cp', `${name}:/home/me/.local/share/weevils/tokens.json`, tmp], { stdio: 'ignore' })
  spawnSync(fresh, ['reset'], { cwd: tree, env: { ...process.env, FRESH_NAME: name }, stdio: 'ignore' })
  if (fs.existsSync(path.join(tmp, 'tokens.json'))) {
    spawnSync('docker', ['cp', path.join(tmp, 'tokens.json'), `${name}:/home/me/.local/share/weevils/tokens.json`], { stdio: 'ignore' })
    spawnSync('docker', ['exec', '-u', '0', name, 'chown', 'me:me', '/home/me/.local/share/weevils/tokens.json'], { stdio: 'ignore' })
    await restart()
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  writeJson(path.join(lab, 'results', 'reset.json'), { at: Date.now() })
  log('blank again')
}

async function next() {
  const req = fs.readdirSync(path.join(lab, 'requests')).filter((f) => f.endsWith('.json')).sort()[0]
  if (req) {
    const q = readJson(path.join(lab, 'requests', req))
    fs.renameSync(path.join(lab, 'requests', req), path.join(lab, 'requests', 'done', req))
    if (q?.kind === 'undo' && q.id) await undo(q.id)
    else if (q?.kind === 'keep') await keep()
    else if (q?.kind === 'reset') await reset()
    return true
  }
  const remarks = fs.readdirSync(path.join(lab, 'remarks')).filter((f) => f.endsWith('.json')).sort()
  const todo = remarks.find((f) => !fs.existsSync(path.join(lab, 'results', f)))
  if (todo) {
    const r = readJson(path.join(lab, 'remarks', todo))
    if (r) await remark(r)
    return true
  }
  return false
}

// A remark cut short by a stop of this watcher is taken again from the start.
for (const f of fs.readdirSync(path.join(lab, 'results'))) if (readJson(path.join(lab, 'results', f))?.status === 'working') fs.rmSync(path.join(lab, 'results', f))
log(`watching ${lab} → ${tree} (${name}, port ${port})`)
for (;;) {
  const busy = await next().catch((e) => (log(`error: ${e?.stack ?? e}`), false))
  if (!busy) await new Promise((ok) => setTimeout(ok, 1500))
}
