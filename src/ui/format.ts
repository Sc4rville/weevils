import type { SessionStatus } from '../../shared/api.ts'

/** Durée compacte, façon croquis : 12m, 1h36, 14h01, 2j. */
export function dur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}j`
}

/** Durée lisible pour les phrases : « 12 min », « 14 h 01 », « 2 jours ». */
export function durLong(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 1) return 'moins d’une minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`
  const d = Math.floor(h / 24)
  return `${d} jour${d > 1 ? 's' : ''}`
}

export function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'à l’instant'
  return `il y a ${durLong(ms)}`
}

export const status: Record<SessionStatus, { ch: string; label: string }> = {
  working: { ch: '*', label: 'travaille' },
  needs_user: { ch: '!', label: 'à toi' },
  idle: { ch: '_', label: 'disponible' },
  done: { ch: '✓', label: 'terminée' },
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Texte d'agent simplifié : on enlève la mise en forme markdown qui n'apporte rien sur le téléphone. */
export function plain(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '· ')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Découpe un texte en prose et blocs de code (``` … ```), pour replier le code. */
export function segments(text: string): { kind: 'text' | 'code'; body: string }[] {
  const out: { kind: 'text' | 'code'; body: string }[] = []
  const re = /```[^\n]*\n([\s\S]*?)```/g
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ kind: 'text', body: text.slice(last, i) })
    out.push({ kind: 'code', body: m[1].replace(/\s+$/, '') })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', body: text.slice(last) })
  return out.filter((s) => s.body.trim())
}

const VERBS: Record<string, string> = {
  read: 'lit',
  edit: 'modifie',
  multiedit: 'modifie',
  write: 'écrit',
  notebookedit: 'modifie',
  bash: 'lance',
  grep: 'cherche',
  glob: 'cherche',
  agent: 'délègue',
  task: 'délègue',
  webfetch: 'consulte',
  websearch: 'cherche sur le web',
  todowrite: 'planifie',
  askuserquestion: 'demande',
  skill: 'ouvre le skill',
  shell: 'lance',
  exec_command: 'lance',
  local_shell: 'lance',
  apply_patch: 'modifie',
  update_plan: 'planifie',
  view_image: 'regarde',
}

/** « Bash · Show hostname » → « lance : Show hostname ». Chemins raccourcis, outils MCP nommés par leur fin. */
export function step(text: string): string {
  const i = text.indexOf(' · ')
  const rawName = i < 0 ? text : text.slice(0, i)
  const detail = i < 0 ? '' : text.slice(i + 3)
  const name = rawName.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '').replace(/^mcp__.*?__/, '')
  const verb = VERBS[name.toLowerCase()] ?? name.replace(/_/g, ' ').toLowerCase()
  const d = detail.replace(/\/home\/[a-z0-9_-]+\//g, '~/')
  return d ? `${verb} · ${d}` : verb
}

/** Ce que Scarville a écrit, sans les balises techniques du collage ni les marqueurs d'images. */
export function userText(text: string): string {
  return text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/\[Image #\d+\]/g, '(image)')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
