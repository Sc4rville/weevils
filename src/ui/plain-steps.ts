import type { Message } from '../../shared/api.ts'

/** What an action is, in a few plain categories. Never exposes a tool name, a path or a command. */
export type Kind = 'read' | 'search' | 'edit' | 'write' | 'test' | 'build' | 'git' | 'install' | 'run' | 'web' | 'delegate' | 'plan' | 'ask' | 'skill' | 'look' | 'wait' | 'message' | 'other'

const TOOL: Record<string, Kind> = {
  read: 'read', grep: 'search', glob: 'search', edit: 'edit', multiedit: 'edit', notebookedit: 'edit', apply_patch: 'edit', write: 'write',
  agent: 'delegate', task: 'delegate', webfetch: 'web', websearch: 'web', todowrite: 'plan', update_plan: 'plan', askuserquestion: 'ask',
  skill: 'skill', view_image: 'look',
}
const CODEX: Record<string, Kind> = {
  test: 'test', build: 'build', read: 'read', search: 'search', edit: 'edit', git: 'git', wait: 'wait', web: 'web', image: 'look', message: 'message', question: 'ask', // i18n-ignore
}

function shell(cmd: string): Kind {
  if (/\b(vitest|jest|pytest|mocha|playwright test|(npm|pnpm|yarn|bun) (run )?test|cargo test|go test|rspec)\b/i.test(cmd)) return 'test'
  if (/\b(vite build|tsc\b|webpack|esbuild|(npm|pnpm|yarn|bun) run build|cargo build|go build|make\b|gradle|docker build)\b/i.test(cmd)) return 'build'
  if (/\b(npm|pnpm|yarn|bun|pip|pip3|apt|apt-get|brew|cargo) (install|add|ci)\b/i.test(cmd)) return 'install'
  if (/(^|[;&|]\s*)git\s/.test(cmd)) return 'git'
  return 'run'
}

export function kindOf(m: Message): Kind {
  const d = m.toolDetails
  const first = d?.kinds?.[0]
  if (first && first !== 'command' && first !== 'tool' && CODEX[first]) return CODEX[first]
  const text = m.text ?? ''
  const i = text.indexOf(' · ')
  const name = (i < 0 ? text : text.slice(0, i)).replace(/^mcp__.*__/, '').toLowerCase()
  if (name === 'bash' || name === 'shell' || name === 'exec_command' || name === 'local_shell') return shell(d?.commands?.[0] ?? (i < 0 ? '' : text.slice(i + 3)))
  if (TOOL[name]) return TOOL[name]
  if (first === 'command' || d?.commands?.length) return shell(d?.commands?.[0] ?? '')
  return 'other'
}

const GENERIC = new Set(['index', 'main', 'app', 'mod', 'lib', 'utils', 'util', 'types', 'test', 'spec', 'readme'])
/** « src/ui/CheckoutForm.tsx » → { name: 'checkout form', type: 'code' }. Words only: no directory, no extension. */
export function subjectOf(m: Message): { name: string; type: 'code' | 'doc' | 'settings' } | null {
  const text = m.text ?? ''
  const i = text.indexOf(' · ')
  const path = i < 0 ? '' : text.slice(i + 3).trim()
  if (!/^[~/.\w-][^\s]*[/.][\w-]+$/.test(path)) return null
  const parts = path.split('/').filter(Boolean)
  const file = parts.at(-1) ?? ''
  const dot = file.lastIndexOf('.')
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
  let base = dot > 0 ? file.slice(0, dot) : file
  if (GENERIC.has(base.toLowerCase()) && parts.length > 1) base = parts.at(-2) ?? base
  const name = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase()
  if (!name || name.length > 28) return null
  const type = /^(md|mdx|txt|rst)$/.test(ext) ? 'doc' : /^(json|ya?ml|toml|ini|env|lock)$/.test(ext) ? 'settings' : 'code'
  return { name, type }
}

export type Cluster = { kind: Kind; steps: Message[] }
/** Consecutive micro-actions of the same kind serve the same goal: one line. */
export function clusters(steps: Message[]): Cluster[] {
  const out: Cluster[] = []
  for (const s of steps) {
    const k = kindOf(s)
    const last = out.at(-1)
    if (last && last.kind === k) last.steps.push(s)
    else out.push({ kind: k, steps: [s] })
  }
  return out
}

type Words = { [K in Kind]?: unknown } & Record<string, any>
/** The visible line for a cluster, in the app locale. `w` = the plain-steps messages. */
export function clusterLine(c: Cluster, w: Words): string {
  const n = c.steps.length
  const subject = (type: 'code' | 'doc' | 'settings', name: string) => (w[type] as (n: string) => string)(name)
  const one = (kind: 'read' | 'edit' | 'write') => {
    const s = n === 1 ? subjectOf(c.steps[0]) : null
    return (w[kind] as (s: string) => string)(s ? subject(s.type, s.name) : '')
  }
  switch (c.kind) {
    case 'read': return n === 1 ? one('read') : `${w.readMany}${w.count(n)}`
    case 'edit': return n === 1 ? one('edit') : `${w.editMany}${w.count(n)}`
    case 'write': return n === 1 ? one('write') : `${w.writeMany}${w.count(n)}`
    default: return String(w[c.kind] ?? w.other)
  }
}

/** One short line for the whole group: at most two ideas, in order, no counts (they fit a phone). */
export function groupLine(cs: Cluster[], w: Words): string {
  const idea = (k: Kind): string => (k === 'read' || k === 'search' ? String(w.readMany) : k === 'edit' || k === 'write' ? String(w.editMany) : String(w[k] ?? w.other))
  const ideas = cs.map((c) => (c.kind === 'run' ? String(w.ranCommands) : idea(c.kind))).filter((l, i, all) => all.indexOf(l) === i).slice(0, 2)
  return ideas.map((l, i) => (i ? l.charAt(0).toLowerCase() + l.slice(1) : l)).join(', ')
}

/** Intermediate agent chatter: its first sentence, short. null when it already is short. */
export function brief(text: string, max = 110): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat
  const cut = sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : sentence
  return cut.length < flat.length ? cut : null
}

/** Words of the "doing right now" text that would expose a path or a command: those never reach the header. */
const TECHNICAL = /[\/\\`$~|]|&&|(^|\s)--?\w|\b(npm|npx|pnpm|git|cd|sudo|bash|grep|node)\s/i

export type Live = { text: string; state: 'working' | 'waiting' | 'calm' }
/** The mini-macro: one short live phrase (6 words max) for the session header. `w` = plain-steps messages, `h` = header messages. */
export function liveNote(
  s: { status: string; now?: string; turnWorking?: boolean; background?: number },
  last: Message | undefined,
  w: Words,
  h: { waiting: string; stopped: string; done: string; idle: string },
): Live {
  if (s.status === 'needs_user') return { text: h.waiting, state: 'waiting' }
  if (s.status === 'interrupted') return { text: h.stopped, state: 'calm' }
  if (s.status !== 'working') return { text: s.status === 'idle' ? h.idle : h.done, state: 'calm' }
  const now = (s.now ?? '').replace(/\s+/g, ' ').trim()
  if (now && !TECHNICAL.test(now)) {
    const words = now.split(' ')
    return { text: words.length > 6 ? `${words.slice(0, 6).join(' ').replace(/[,;:·–-]+$/, '')}…` : now, state: 'working' }
  }
  if (last?.role === 'event') return { text: clusterLine({ kind: kindOf(last), steps: [last] }, w).replace(/ ·.*$/, ''), state: 'working' }
  return { text: String(w.other), state: 'working' }
}

// ---------------------------------------------------------------------------------------------------------------------
// One action's title in the list under a step: what it is for, in a few words (« Search src/api.ts for "auto" »,
// « Read src/api.ts lines 100-125 », « Run the tests »). Deterministic, from the recorded call: the agent's own
// description when it gave one, else its tool and arguments. The literal command stays one tap further.

/** « /home/me/projects/weevils/src/ui/api.ts » → « src/ui/api.ts »: the project folder and anything above it go. */
export function shortPath(p: string): string {
  const s = p.trim().replace(/^["']|["']$/g, '').replace(/^(?:~|\/home\/[^/]+|\/Users\/[^/]+|\/root)\/(?:projects|code|src|dev)\/[^/]+\/?/, '').replace(/^\.\//, '')
  if (!s) return '.'
  const parts = s.split('/').filter(Boolean)
  return s.startsWith('/') || s.startsWith('~') ? parts.slice(-2).join('/') : parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}
const cut = (s: string, n = 36) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const pattern = (p: string) => cut(p.replace(/\\([|().[\]{}*+?])/g, '$1').replace(/^\^|\$$/g, ''))
const host = (u: string) => { try { const x = new URL(u); return x.host + (x.pathname.length > 1 ? cut(x.pathname, 24) : '') } catch { return cut(u, 40) } }

/** Shell words, quotes understood (no expansion). */
function words(s: string): string[] {
  const out: string[] = []
  let cur = '', q = '', any = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"' && /["\\$`]/.test(s[i + 1] ?? '')) cur += s[++i]; else cur += c; continue }
    if (c === '"' || c === "'") { q = c; any = true; continue }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; any = true; continue }
    if (/\s/.test(c)) { if (cur || any) out.push(cur); cur = ''; any = false; continue }
    cur += c
  }
  if (cur || any) out.push(cur)
  return out
}
/** The commands of a line, split on ; && || | and newlines outside quotes. */
function segments(cmd: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = []
  let cur = '', q = '', piped = false
  const push = (nextPiped: boolean) => { if (cur.trim()) out.push({ text: cur.trim(), piped }); cur = ''; piped = nextPiped }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (q) { if (c === q) q = ''; else if (c === '\\') { cur += c + (cmd[++i] ?? ''); continue } cur += c; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '\\') { cur += c + (cmd[++i] ?? ''); continue }
    if (c === ';' || c === '\n') { push(false); continue }
    if ((c === '&' || c === '|') && cmd[i + 1] === c) { i++; push(false); continue }
    if (c === '|') { push(true); continue }
    cur += c
  }
  push(false)
  return out
}
const SKIP = /^(cd|export|set|source|\.|sleep|true|unset|pushd|popd|mkdir|clear)$/
const WRAP = /^(sudo|heavy|nice|nohup|time|exec|env|command)$/

type Titles = Record<string, any>
function shellTitle(cmd: string, w: Titles): string | null {
  // An older event kept only the command's first 90 characters (« … »): its cut last part says nothing reliable.
  const all = segments(cmd)
  for (const seg of /…$/.test(cmd.trim()) ? all.slice(0, -1) : all) {
    if (seg.piped) continue
    // « $(which expose) » is the program « expose »; any other substitution stays one word.
    let a = words(seg.text.replace(/\$\((?:which|command -v|type -p)\s+([\w.-]+)\)/g, '$1').replace(/\$\([^)]*\)/g, '…'))
    while (a.length && (/^\w+=/.test(a[0]) || WRAP.test(a[0]) || (a[0] === 'timeout' && /^\d/.test(a[1] ?? '')))) a = a[0] === 'timeout' ? a.slice(2) : a.slice(1)
    if (a[0] === 'npx') a = a.slice(1)
    const [c0 = '', ...rest] = a
    const c = c0.split('/').at(-1) ?? c0
    if (!c || SKIP.test(c)) continue
    const args = rest.filter((x) => !x.startsWith('-'))
    const joined = rest.join(' ')
    if (/^(grep|egrep|rg|ag|ack)$/.test(c)) {
      const e = rest.indexOf('-e')
      const p = e >= 0 ? rest[e + 1] : args[0]
      const where = (e >= 0 ? args : args.slice(1)).filter((x) => x !== p)
      return p ? w.aSearch(pattern(p), where.length === 1 && where[0] !== '.' ? shortPath(where[0]) : undefined) : null
    }
    if (c === 'sed' && /-n/.test(joined)) {
      const range = /(\d+)\s*,\s*(\d+)\s*p/.exec(joined)
      const file = args.filter((x) => !/^\d+\s*,?\s*\d*\s*p$/.test(x)).at(-1)
      if (file) return w.aRead(shortPath(file), range ? `${range[1]}-${range[2]}` : undefined)
    }
    if (/^(cat|head|tail|less|more|wc|bat|nl)$/.test(c) && args.length) return w.aRead(shortPath(args.filter((x) => !/^\d+$/.test(x)).at(-1) ?? args[0]))
    if (/^(ls|tree|du)$/.test(c)) return w.aList(shortPath(args.at(-1) ?? '.'))
    if (c === 'find' || c === 'fd') {
      const n = rest.indexOf('-name') >= 0 ? rest[rest.indexOf('-name') + 1] : rest.indexOf('-iname') >= 0 ? rest[rest.indexOf('-iname') + 1] : c === 'fd' ? args[0] : undefined
      return n ? w.aFind(pattern(n)) : w.aList(shortPath(args[0] ?? '.'))
    }
    if (c === 'git') {
      const sub = rest.find((x, i) => !x.startsWith('-') && rest[i - 1] !== '-C') ?? ''
      return w.aGit(sub)
    }
    if (/^(vitest|jest|pytest|mocha|rspec)$/.test(c) || (c === 'playwright' && args[0] === 'test') || (/^(cargo|go)$/.test(c) && args[0] === 'test')) return w.aTests
    if (c === 'tsc') return w.aTypes
    if (/^(npm|pnpm|yarn|bun)$/.test(c)) {
      const [s0 = '', s1 = ''] = args
      if (/^(test|t)$/.test(s0) || (s0 === 'run' && /^test/.test(s1))) return w.aTests
      if (/^(install|i|ci|add)$/.test(s0)) return w.aInstall
      if (s0 === 'run' && /^build/.test(s1)) return w.aBuild
      if (s0 === 'run' && /typecheck|tsc/.test(s1)) return w.aTypes
      return w.aRun(`${c} ${s0 === 'run' ? s1 : s0}`.trim())
    }
    if (/^(pip|pip3|apt|apt-get|brew)$/.test(c) && /^(install|add)$/.test(args[0] ?? '')) return w.aInstall
    if (/^(curl|wget|http)$/.test(c)) { const u = args.find((x) => /^https?:|^\/|^localhost|^127\./.test(x)); return u ? w.aCall(host(u)) : w.aRun(c) }
    if (/^(node|python|python3|bash|sh|tsx|ts-node|deno|ruby)$/.test(c) && args[0] && !/^-/.test(args[0])) return w.aRun(shortPath(args[0]).split('/').at(-1)!)
    if (/^(weevils|docker|systemctl|journalctl|gh|tmux|zellij|ssh)$/.test(c)) return w.aRun(cut(`${c} ${args.slice(0, c === 'gh' ? 2 : 1).join(' ')}`.trim(), 30))
    return w.aRun(cut(c, 24))
  }
  return null
}

export function actionTitle(m: Message, w: Titles): string {
  const d = m.toolDetails
  const text = m.text ?? ''
  const i = text.indexOf(' · ')
  const tool = (d?.calls?.[0]?.name ?? (i < 0 ? text : text.slice(0, i))).replace(/^mcp__.*__/, '')
  const said = d?.calls?.[0]?.description?.trim()
  if (said) return cut(said.replace(/[.。]$/, ''), 90)
  const a = d?.args ?? {}
  const rest = i < 0 ? '' : text.slice(i + 3).trim()
  switch (tool.toLowerCase()) {
    case 'read': return w.aRead(shortPath(a.file ?? rest), a.lines)
    case 'edit': case 'multiedit': case 'notebookedit': return w.aEdit(shortPath(a.file ?? rest))
    case 'write': return w.aWrite(shortPath(a.file ?? rest))
    case 'grep': return w.aSearch(pattern(a.pattern ?? rest), a.path ? shortPath(a.path) : undefined)
    case 'glob': return w.aFind(pattern(a.pattern ?? rest))
    case 'websearch': return w.aWeb(cut(a.query ?? rest))
    case 'webfetch': return w.aOpen(host(a.url ?? rest))
    case 'todowrite': case 'update_plan': return w.aPlan
    case 'askuserquestion': return w.aAsk
    case 'view_image': return w.aLook
    case 'skill': return rest ? w.aSkill(cut(rest, 30)) : String(w.skill)
    case 'agent': case 'task': return rest ? cut(rest, 90) : String(w.delegate)
  }
  const cmd = d?.commands?.[0] ?? (/^(bash|shell|exec_command|local_shell)$/i.test(tool) ? rest : '')
  const fromShell = cmd ? shellTitle(cmd, w) : null
  return fromShell ?? clusterLine({ kind: kindOf(m), steps: [m] }, w)
}
