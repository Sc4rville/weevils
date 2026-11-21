#!/usr/bin/env node
// The public guard. This repository is public: what is personal (a real home folder, a mailbox, a private key, the
// owner's own names, domains and machines) must never reach it. The rule is in CONTRIBUTING.md, « Product or
// personal ». Plain Node, no dependency.
//
//   node scripts/check-public.mjs                      the tracked files of this checkout (npm run lint, CI, the
//                                                      publish gate)
//   node scripts/check-public.mjs --range <A>..<B>     what the commits of a range add: lines, messages, identities
//   node scripts/check-public.mjs --pre-push <remote> <url>
//                                                      git's pre-push hook (ref lines on stdin); only a push to the
//                                                      public repository is checked
//   node scripts/check-public.mjs --audit              where the owner's own markers already are, without failing
//
// What is looked for:
//   home      /home/<name> or /Users/<name> with a name that is not a neutral example (neutralUsers)
//   mail      an address at a mailbox provider whose name is not a neutral example (neutralMailboxes)
//   key       a private key block
//   path      a tracked file that only belongs on a machine (forbiddenPaths)
//   machine   this machine's own home folder, host name and public addresses (read from the machine, written nowhere)
//   marker    the owner's own markers, one regular expression per line in ~/.config/weevils/public-guard.txt
//             (or WEEVILS_PUBLIC_MARKERS=<file>): only on what a push adds, never in the repository
//   identity  a commit whose author or committer e-mail is not a GitHub noreply address (range and push)
//             (identity and marker spare what was written before the guard existed, enforcedSince)
//   history   a push that is not built on the public history (historyRoot)
//   secrets   gitleaks over the pushed commits, when it is installed
//
// The neutral examples, the accepted exceptions and the public repository are in scripts/public-guard.json
// (WEEVILS_PUBLIC_GUARD_CONFIG=<file> reads another one: the tests). A line
// that carries « public-guard:allow » is skipped: use it for a deliberate fake, with the reason next to it.
// Exit code 1 when something was found (--audit: always 0).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CONFIG = JSON.parse(fs.readFileSync(process.env.WEEVILS_PUBLIC_GUARD_CONFIG ?? path.join(HERE, 'public-guard.json'), 'utf8'))
const ZERO = /^0+$/
const MAX_FILE = 2 * 1024 * 1024

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const tryGit = (args, opts) => { try { return git(args, opts) } catch { return null } }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const lower = (list) => new Set((list ?? []).map((s) => s.toLowerCase()))

// ---------------------------------------------------------------------------------------------
// Rules

const NEUTRAL_USERS = lower(CONFIG.neutralUsers)
const NEUTRAL_MAILBOXES = lower(CONFIG.neutralMailboxes)
const PROVIDERS = (CONFIG.mailboxProviders ?? []).map(esc).join('|')
const HOME_RE = /(?<![A-Za-z0-9._~-])(?:\/home|\/Users)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g
const MAIL_RE = new RegExp(`([A-Za-z0-9._%-]+)(?:\\+[A-Za-z0-9._%-]+)?@(?:${PROVIDERS})\\b`, 'gi')
const KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/
const ALLOW_LINE = /public-guard:allow/
const IDENTITY_OK = (CONFIG.identity ?? []).map((s) => new RegExp(s, 'i'))
const SINCE = CONFIG.enforcedSince ? Date.parse(CONFIG.enforcedSince) : 0

/** « dir/** », « *.ext », « name* » and exact paths: enough for the two lists of public-guard.json. */
function glob(pattern) {
  const re = pattern.split('**').map((part) => part.split('*').map(esc).join('[^/]*')).join('.*')
  return new RegExp(`^(?:.*/)?${re}$`)
}
const FORBIDDEN = (CONFIG.forbiddenPaths ?? []).map((p) => ({ p, re: glob(p) }))
const ALLOW = (CONFIG.allow ?? []).map((a) => ({ ...a, re: glob(a.file) }))
const allowed = (rule, file) => ALLOW.some((a) => a.rule === rule && a.re.test(file))
const SKIP = (CONFIG.skip ?? []).map(glob)
const skipped = (file) => SKIP.some((re) => re.test(file))

/** This machine's own traces: its home folder, its host name, its public addresses. Nothing is written down. */
function machineMarkers(env = process.env) {
  const out = []
  const home = env.HOME ?? ''
  const user = /^(?:\/home|\/Users)\/([^/]+)$/.exec(home)?.[1]
  if (user && !NEUTRAL_USERS.has(user.toLowerCase())) out.push({ what: 'this machine’s home folder', home: true, re: new RegExp(`${esc(home)}(?![A-Za-z0-9._-])`) })
  const host = (env.WEEVILS_PUBLIC_GUARD_HOST ?? os.hostname()).split('.')[0]
  if (host.length >= 6 && !/^(?:localhost|ubuntu|debian|raspberrypi|macbook.*|runner.*|buildkit.*|[0-9a-f]{12})$/i.test(host)) {
    out.push({ what: 'this machine’s host name', re: new RegExp(`(?<![A-Za-z0-9-])${esc(host)}(?![A-Za-z0-9-])`, 'i') })
  }
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal) continue
      if (a.family === 'IPv4' && !/^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a.address)) {
        out.push({ what: 'this machine’s public address', re: new RegExp(`(?<![0-9.])${esc(a.address)}(?![0-9])`) })
      }
      if (a.family === 'IPv6' && /^[23]/.test(a.address)) out.push({ what: 'this machine’s public address', re: new RegExp(esc(a.address), 'i') })
    }
  }
  return out
}

/** The owner's own markers, kept outside the repository: one regular expression per line, « # » for a comment. */
function ownerMarkers(env = process.env) {
  const file = env.WEEVILS_PUBLIC_MARKERS ?? path.join(env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? os.homedir(), '.config'), 'weevils', 'public-guard.txt')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    try { out.push({ what: 'one of your own markers', re: new RegExp(line, 'i'), src: line }) } catch { console.error(`public guard: ${file}: not a regular expression, skipped: ${line}`) }
  }
  return out
}

const cut = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s).trim()

/** The problems of one line of a file. `extra`: the machine's and the owner's markers that apply here. */
function checkLine(file, line, extra) {
  if (ALLOW_LINE.test(line)) return []
  const found = []
  if (!allowed('home', file)) {
    for (const m of line.matchAll(HOME_RE)) {
      if (!NEUTRAL_USERS.has(m[1].toLowerCase())) found.push({ rule: 'home', what: `a real home folder (${m[0]}): write /home/user` })
    }
  }
  if (PROVIDERS && !allowed('mail', file)) {
    for (const m of line.matchAll(MAIL_RE)) {
      if (!NEUTRAL_MAILBOXES.has(m[1].toLowerCase())) found.push({ rule: 'mail', what: `a real-looking mailbox (${m[0]}): write user@example.com` })
    }
  }
  if (KEY_RE.test(line) && !allowed('key', file)) found.push({ rule: 'key', what: 'a private key block' })
  for (const m of extra) {
    if (m.home && found.some((f) => f.rule === 'home')) continue
    if (m.re.test(line) && !allowed('marker', file)) found.push({ rule: m.src ? 'marker' : 'machine', what: `${m.what}${m.src ? ` (${m.src})` : ''}` })
  }
  return found
}

const forbiddenPath = (file) => (allowed('path', file) ? undefined : FORBIDDEN.find((f) => f.re.test(file))?.p)

// ---------------------------------------------------------------------------------------------
// The tracked files of a checkout

function checkTree(root, extra) {
  const listed = tryGit(['ls-files', '-z'], { cwd: root })
  if (listed === null) return null
  const problems = []
  for (const file of listed.split('\0').filter(Boolean)) {
    const hit = forbiddenPath(file)
    if (hit) problems.push({ where: file, what: `a file that only belongs on a machine (${hit})` })
    if (skipped(file)) continue
    let buf
    try {
      const full = path.join(root, file)
      const st = fs.lstatSync(full)
      if (!st.isFile() || st.size > MAX_FILE) continue
      buf = fs.readFileSync(full)
    } catch { continue }
    if (buf.subarray(0, 8192).includes(0)) continue
    const lines = buf.toString('utf8').split('\n')
    for (let n = 0; n < lines.length; n++) {
      for (const p of checkLine(file, lines[n], extra)) problems.push({ where: `${file}:${n + 1}`, what: p.what, line: cut(lines[n]) })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// What a range of commits adds

function checkRange(root, revs, extra) {
  const problems = []
  const sep = '\x1e'
  const log = git(['log', '--no-color', '-p', '--unified=0', '--remerge-diff', '--no-renames', `--format=${sep}%H%x1f%ae%x1f%ce%x1f%aI%x1f%cI%x1f%B${sep}`, ...revs], { cwd: root })
  const parts = log.split(sep)
  for (let i = 1; i < parts.length; i += 2) {
    const [sha, authorMail, committerMail, authored, committed, message = ''] = parts[i].split('\x1f')
    const short = sha.slice(0, 8)
    // Work written before the guard existed (enforcedSince) is let through for the two rules it could not know: the
    // noreply identity and the owner's markers. Everything else applies to it too.
    const before = (date) => SINCE && Date.parse(date) < SINCE
    const own = before(authored) ? extra.filter((m) => !m.src) : extra
    for (const [who, mail, date] of [['author', authorMail, authored], ['committer', committerMail, committed]]) {
      if (IDENTITY_OK.length && !before(date) && !IDENTITY_OK.some((re) => re.test(mail))) problems.push({ rule: 'identity', where: `commit ${short}`, what: `the ${who}’s e-mail is not a GitHub noreply address` })
    }
    for (const line of message.split('\n')) {
      for (const p of checkLine('(commit message)', line, own)) problems.push({ where: `commit ${short}, message`, what: p.what, line: cut(line) })
    }
    let file = ''
    for (const line of (parts[i + 1] ?? '').split('\n')) {
      if (line.startsWith('+++ ')) {
        file = line.slice(4).replace(/^b\//, '')
        const hit = file !== '/dev/null' && forbiddenPath(file)
        if (hit) problems.push({ where: `commit ${short}, ${file}`, what: `a file that only belongs on a machine (${hit})` })
        continue
      }
      if (!line.startsWith('+') || line.startsWith('+++') || !file || file === '/dev/null' || skipped(file)) continue
      for (const p of checkLine(file, line.slice(1), own)) problems.push({ where: `commit ${short}, ${file}`, what: p.what, line: cut(line.slice(1)) })
    }
  }
  return problems
}

/** gitleaks over the same commits, when it is installed. Its own findings are printed redacted. */
function checkSecrets(root, revs) {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) return { ran: false, problems: [] }
  const r = spawnSync('gitleaks', ['git', '--no-banner', '--redact', '--log-level', 'error', `--log-opts=${revs.join(' ')}`, '.'], { cwd: root, encoding: 'utf8' })
  if (r.status === 0) return { ran: true, problems: [] }
  const detail = `${r.stdout ?? ''}`.split('\n').filter((l) => /^(?:File|Line|RuleID|Commit):/.test(l.trim())).map((l) => l.trim()).join(' · ')
  return { ran: true, problems: [{ rule: 'secrets', where: 'gitleaks', what: 'something that looks like a secret', line: cut(detail, 400) }] }
}

// ---------------------------------------------------------------------------------------------
// The pre-push hook

const publicRepo = () => new RegExp(`(?:^|[/:@])${esc(CONFIG.publicRepo)}(?:\\.git)?/?$`, 'i')

function publicRemotes(root) {
  const out = []
  for (const line of (tryGit(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd: root }) ?? '').split('\n')) {
    const m = /^remote\.(.+)\.url (.+)$/.exec(line)
    if (m && publicRepo().test(m[2])) out.push(m[1])
  }
  return out
}

function prePush(root, url, stdin, extra) {
  if (!publicRepo().test(url)) return { skipped: true, problems: [] }
  const problems = []
  const remotes = publicRemotes(root)
  const known = remotes.length ? remotes.map((r) => `--remotes=${r}`) : ['--remotes']
  let secretsRan = true
  for (const line of stdin.split('\n')) {
    const [localRef, localSha, , remoteSha] = line.trim().split(/\s+/)
    if (!localSha || ZERO.test(localSha)) continue
    if (tryGit(['rev-parse', '--verify', '-q', `${localSha}^{commit}`], { cwd: root }) === null) continue
    // Built on the public history only: one root commit, the public one.
    if (CONFIG.historyRoot) {
      const roots = git(['rev-list', '--max-parents=0', localSha], { cwd: root }).split('\n').filter(Boolean)
      if (roots.some((r) => r !== CONFIG.historyRoot)) {
        problems.push({ rule: 'history', where: localRef, what: 'not built on the public history: it would publish what the cleaning removed. That work belongs in the private repository' })
        continue
      }
    }
    const haveRemote = remoteSha && !ZERO.test(remoteSha) && tryGit(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: root }) !== null
    const revs = haveRemote ? [localSha, `^${remoteSha}`, '--not', ...known] : [localSha, '--not', ...known]
    problems.push(...checkRange(root, revs, extra))
    const secrets = checkSecrets(root, revs)
    secretsRan &&= secrets.ran
    problems.push(...secrets.problems)
  }
  return { skipped: false, problems, secretsRan }
}

// ---------------------------------------------------------------------------------------------

function report(problems, { title, hint }) {
  if (!problems.length) return 0
  const seen = new Set()
  const lines = []
  for (const p of problems) {
    const key = `${p.where}|${p.what}|${p.line ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`  ${p.where}: ${p.what}${p.line ? `\n      ${p.line}` : ''}`)
  }
  console.error(`public guard: ${title} (${lines.length})`)
  console.error(lines.slice(0, 60).join('\n'))
  if (lines.length > 60) console.error(`  … and ${lines.length - 60} more`)
  console.error(hint)
  return 1
}

const HINT_RULE = 'Rule: the product ships generic defaults; what is personal lives in your config or the private repository (CONTRIBUTING.md, « Product or personal »).'

function main(argv) {
  const root = tryGit(['rev-parse', '--show-toplevel'])?.trim()
  if (!root) { console.log('public guard: not a git checkout, nothing checked'); return 0 }
  const machine = machineMarkers()
  if (argv[0] === '--pre-push') {
    const r = prePush(root, argv[2] ?? argv[1] ?? '', fs.readFileSync(0, 'utf8'), [...machine, ...ownerMarkers()])
    if (r.skipped) return 0
    if (!r.secretsRan) console.error('public guard: gitleaks is not installed, secrets were not looked for here (GitHub’s push protection still applies)')
    const identity = r.problems.some((p) => p.rule === 'identity')
    return report(r.problems, {
      title: `this push to ${CONFIG.publicRepo} is refused, it would publish`,
      hint: `${HINT_RULE}\n${identity ? 'For the e-mail: scripts/install-hooks.sh sets this clone’s identity; then rewrite the commits not pushed yet, for example\n  git rebase -r <base> --exec \'git commit --amend --no-edit --reset-author --date="$(git log -1 --format=%aI)"\'\n' : ''}A false alarm? Reword it, or mark a deliberate fake with « public-guard:allow ». Never push around the guard.`,
    })
  }
  if (argv[0] === '--range') {
    if (!argv[1]) { console.error('usage: check-public.mjs --range <A>..<B>'); return 2 }
    return report(checkRange(root, [argv[1]], [...machine, ...ownerMarkers()]), { title: `${argv[1]} would publish`, hint: HINT_RULE })
  }
  if (argv[0] === '--audit') {
    const own = ownerMarkers()
    if (!own.length) { console.log('public guard: no marker of your own (~/.config/weevils/public-guard.txt)'); return 0 }
    const count = new Map()
    for (const p of checkTree(root, own) ?? []) {
      const m = /^one of your own markers \((.*)\)$/.exec(p.what)
      if (!m) continue
      const file = p.where.replace(/:\d+$/, '')
      const per = count.get(m[1]) ?? count.set(m[1], new Map()).get(m[1])
      per.set(file, (per.get(file) ?? 0) + 1)
    }
    for (const [marker, per] of count) {
      console.log(`${marker}: ${[...per.values()].reduce((a, b) => a + b, 0)} line(s) in ${per.size} file(s)`)
      for (const [file, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${file}`)
    }
    if (!count.size) console.log('public guard: none of your markers is in the tracked files')
    return 0
  }
  const problems = checkTree(root, machine)
  if (problems === null) { console.log('public guard: not a git checkout, nothing checked'); return 0 }
  const code = report(problems, { title: 'personal traces in the tracked files', hint: `${HINT_RULE}\nA neutral example or an accepted exception goes in scripts/public-guard.json, with its reason.` })
  if (!code) console.log('public guard: no personal trace in the tracked files')
  return code
}

process.exitCode = main(process.argv.slice(2))
