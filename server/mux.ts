// Pilotage des sessions tmux « wv-* » : tmux est le registre (options @wv_*), weevils ne fait que lire et écrire.
// Une session wv-* = un agent (claude ou codex) dans un dossier. Lancées par weevils ou par le lanceur `wv`.

import { execFile } from 'node:child_process'
import type { Tool } from '../shared/api.ts'

function tmux(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { cwd, timeout: 8000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.toString().trim() || err.message))
      else resolve(stdout.toString())
    })
  })
}

export interface WvSession {
  /** Nom tmux, sert aussi d'identifiant provisoire. */
  name: string
  tool: Tool
  /** Identifiant de la session Claude/Codex, connu d'avance pour Claude, relié après coup pour Codex. */
  sessionId?: string
  title: string
  cwd: string
  createdAt: number
}

const SEP = '\u001f'

export async function listWv(): Promise<WvSession[]> {
  let out = ''
  try {
    out = await tmux(['list-sessions', '-F', ['#{session_name}', '#{@wv_tool}', '#{@wv_session_id}', '#{@wv_title}', '#{@wv_cwd}', '#{pane_current_path}', '#{session_created}'].join(SEP)])
  } catch {
    return [] // pas de serveur tmux = aucune session
  }
  return out
    .split('\n')
    .filter((l) => l.startsWith('wv-'))
    .map((l) => {
      const [name, tool, sessionId, title, cwd, current, created] = l.split(SEP)
      return {
        name,
        tool: tool === 'codex' ? 'codex' : 'claude',
        sessionId: sessionId || undefined,
        title: title || 'nouvelle session',
        cwd: cwd || current,
        createdAt: Number(created) * 1000,
      } satisfies WvSession
    })
}

export async function spawnWv(name: string, cwd: string, tool: Tool, title: string, command: string[], sessionId?: string) {
  // Plusieurs arguments : tmux lance la commande directement, sans shell (pas d'injection possible).
  await tmux(['new-session', '-d', '-s', name, '-x', '120', '-y', '40', '-c', cwd, ...command], cwd)
  await setOpt(name, '@wv_tool', tool)
  await setOpt(name, '@wv_title', title)
  await setOpt(name, '@wv_cwd', cwd)
  if (sessionId) await setOpt(name, '@wv_session_id', sessionId)
}

export const setOpt = (name: string, key: string, value: string) => tmux(['set-option', '-t', `=${name}:`, key, value]).then(() => undefined)

/** Écrit un message puis Entrée. Les retours à la ligne enverraient trop tôt : on les aplatit. */
export async function sendText(name: string, text: string): Promise<void> {
  const flat = text.replace(/\s*\n\s*/g, ' ').trim()
  await tmux(['send-keys', '-t', `=${name}:`, '-l', flat])
  await new Promise((r) => setTimeout(r, 150))
  await tmux(['send-keys', '-t', `=${name}:`, 'Enter'])
}

const KEYS: Record<string, string> = {
  enter: 'Enter',
  esc: 'Escape',
  tab: 'Tab',
  'shift-tab': 'BTab',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
}

/** Touches autorisées : flèches, Entrée, Échap, Tab, chiffres 1–9, y/n. Rien d'autre. */
export async function sendKey(name: string, key: string): Promise<void> {
  if (KEYS[key]) return void (await tmux(['send-keys', '-t', `=${name}:`, KEYS[key]]))
  if (/^[1-9yn]$/.test(key)) return void (await tmux(['send-keys', '-t', `=${name}:`, '-l', key]))
  throw new Error(`touche refusée : ${key}`)
}

export async function capture(name: string): Promise<string> {
  const out = await tmux(['capture-pane', '-p', '-J', '-t', `=${name}:`])
  return out.replace(/\s+$/g, '')
}

/**
 * Repère une vraie question à l'écran (permission, confiance, menu de choix) et renvoie la phrase à montrer.
 * Exigeant exprès : il faut le pied de dialogue (« Enter to confirm · Esc to cancel », « (y/n) »…) dans les
 * dernières lignes. Un mot comme « approve » ou « do you want » dans le fil normal ne suffit plus : ça créait
 * des faux « à toi » dès qu'un fichier ou une réponse contenait ces mots.
 */
export function attentionFromScreen(text: string): string | undefined {
  const lines = text
    .split('\n')
    .slice(-30)
    .map((l) => l.replace(/[│╭╮╰╯─┃━]/g, '').trim())
  const footer = /(enter to (confirm|continue|select|submit)|enter continue|esc (to cancel|to go back|back|cancel)|\(y\/n\)|\by\/n\b|tab to toggle|↑\/↓ to (navigate|select))/i
  const option = /^[❯›>]\s*(\d+[.)]\s*)?\S|^\d+[.)]\s+\S|^[❯›>]?\s*(yes|no)\b/i
  const tail = lines.length - 1
  const at = lines.findLastIndex((l) => footer.test(l))
  if (at < 0 || tail - at > 12) return undefined
  // Un dialogue a des options : au moins une ligne d'option entre la question et le pied.
  const from = Math.max(0, at - 16)
  if (!lines.slice(from, at).some((l) => option.test(l))) return undefined
  const skip = (l: string) => !l || option.test(l) || footer.test(l) || /\+\d+ lines|ctrl\+[a-z]|\(esc\)|^[·…\-=_ ]+$/i.test(l)
  // La question elle-même : la ligne la plus proche au-dessus du pied qui contient « ? », coupée après.
  for (let i = at; i >= from; i--) {
    const q = lines[i].indexOf('?')
    if (q > 3 && !option.test(lines[i])) return lines[i].slice(0, q + 1).slice(0, 180)
  }
  const line = lines.slice(from, at).find((l) => !skip(l) && l.length > 12)
  return (line ?? 'un choix t’attend').slice(0, 180)
}
