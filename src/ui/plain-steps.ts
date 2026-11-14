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

/** One line for the whole group: what was done, in order, at most three phrases. */
export function groupLine(cs: Cluster[], w: Words): string {
  const lines = cs.map((c) => clusterLine(c, w))
  const uniq = lines.filter((l, i) => lines.indexOf(l) === i)
  return uniq.slice(0, 3).join(' → ') + (uniq.length > 3 ? w.more : '')
}

/** Intermediate agent chatter: its first sentence, short. null when it already is short. */
export function brief(text: string, max = 110): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat
  const cut = sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : sentence
  return cut.length < flat.length ? cut : null
}
