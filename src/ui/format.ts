import type { SessionStatus } from '../../shared/api.ts'
import { getLang, tr } from '../i18n'
import M from '../i18n/format'

/** Durée compacte, façon croquis : 12m, 1h36, 14h01, 2j (2d en anglais). */
export function dur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return tr(M).days(Math.floor(h / 24))
}

/** Durée lisible pour les phrases : « 12 min », « 14 h 01 », « 2 jours ». */
export function durLong(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  const t = tr(M)
  if (m < 1) return t.lessThanMinute
  if (m < 60) return t.minutes(m)
  const h = Math.floor(m / 60)
  if (h < 24) return t.hours(h, String(m % 60).padStart(2, '0'))
  return t.daysLong(Math.floor(h / 24))
}

export function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return tr(M).justNow
  return tr(M).ago(durLong(ms))
}

/** Caractère et libellé de chaque état ; le libellé suit la langue (lu à chaque accès). */
const statusKey = { working: 'working', needs_user: 'needsUser', idle: 'idle', done: 'done' } as const
const statusCh: Record<SessionStatus, string> = { working: '*', needs_user: '!', idle: '_', done: '✓' }
export const status = Object.fromEntries(
  (Object.keys(statusCh) as SessionStatus[]).map((s) => [
    s,
    {
      ch: statusCh[s],
      get label() {
        return tr(M)[statusKey[s]]
      },
    },
  ]),
) as Record<SessionStatus, { readonly ch: string; readonly label: string }>

/** « 1 fichier », « 3 fichiers ». Français : 0 et 1 au singulier ; anglais : seul 1 est au singulier. */
export const plural = (n: number, one: string, many: string) => `${n} ${(getLang() === 'fr' ? n > 1 : n !== 1) ? many : one}`

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

/** Nom d'outil (Claude Code, Codex) → clé du verbe affiché. */
const VERBS: Record<string, keyof (typeof M)['fr']> = {
  read: 'read',
  edit: 'edit',
  multiedit: 'edit',
  write: 'write',
  notebookedit: 'edit',
  bash: 'run',
  grep: 'search',
  glob: 'search',
  agent: 'delegate',
  task: 'delegate',
  webfetch: 'fetch',
  websearch: 'webSearch',
  todowrite: 'plan',
  askuserquestion: 'ask',
  skill: 'skill',
  shell: 'run',
  exec_command: 'run',
  local_shell: 'run',
  apply_patch: 'edit',
  update_plan: 'plan',
  view_image: 'look',
}

/** « Bash · Show hostname » → « lance : Show hostname ». Chemins raccourcis, outils MCP nommés par leur fin. */
export function step(text: string): string {
  const i = text.indexOf(' · ')
  const rawName = i < 0 ? text : text.slice(0, i)
  const detail = i < 0 ? '' : text.slice(i + 3)
  const name = rawName.replace(/^mcp__[^_]+(?:_[^_]+)*__/, '').replace(/^mcp__.*?__/, '')
  const key = Object.hasOwn(VERBS, name.toLowerCase()) ? VERBS[name.toLowerCase()] : undefined
  const verb = key ? (tr(M)[key] as string) : name.replace(/_/g, ' ').toLowerCase()
  const d = detail.replace(/\/home\/[a-z0-9_-]+\//g, '~/')
  return d ? `${verb} · ${d}` : verb
}

/** Ce que l'utilisateur a écrit, sans les balises techniques du collage ni les marqueurs d'images. */
export function userText(text: string): string {
  return text
    .replace(/<\/?pasted_content[^>]*>/g, '')
    .replace(/\[Image #\d+\]/g, '(image)')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
