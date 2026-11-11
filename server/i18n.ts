// Server catalogs use an isolated request locale, falling back to installation preferences.
// Explicit device preferences never rewrite another reader’s language.

import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, USER_NAME } from './config.ts'
import C from './i18n/config.ts'
import { isLang, pickLang, type Lang, type Messages, type Msg } from '../shared/i18n.ts'

export { defineMessages, type Lang } from '../shared/i18n.ts'

const PREFS_FILE = path.join(DATA_DIR, 'prefs.json')

/** from: « choice » picked in the app's settings, « browser » the first app's language; absent in files written
 * before 2026-11-10, when any app could switch it (overwritten by the next app that opens). */
interface Prefs {
  lang?: string
  from?: 'choice' | 'browser'
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) as Prefs
  } catch {
    return {}
  }
}

const fromEnv = (): Lang => pickLang([process.env.WEEVILS_LANG ?? '', process.env.LC_ALL ?? '', process.env.LANG ?? ''].filter(Boolean))

let current: Lang = (() => {
  const p = readPrefs().lang
  return isLang(p) ? p : fromEnv()
})()
const listeners = new Set<(l: Lang) => void>()

const requestLocale = new AsyncLocalStorage<Lang>()
export const lang = (): Lang => requestLocale.getStore() ?? current

/** Only the explicit app preference/query can select a request locale, never chat text. */
export function requestLang(req: { headers: Record<string, string | string[] | undefined>; url?: string }): Lang {
  const header = req.headers['x-weevils-locale']
  if (isLang(header)) return header
  const query = new URL(req.url ?? '/', 'http://local').searchParams.get('lang')
  return isLang(query) ? query : lang()
}

/** Called when the app tells its language: chosen, picked in its settings (always applied); otherwise the browser's,
 * applied only while no app has set one. Returns true when it changed. */
export function setLang(l: unknown, chosen = false): boolean {
  if (!isLang(l)) return false
  const prefs = readPrefs()
  if (!chosen && prefs.from && isLang(prefs.lang)) return false
  const from = chosen ? 'choice' : 'browser'
  if (l !== current || prefs.from !== from || prefs.lang !== l)
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(PREFS_FILE, JSON.stringify({ ...prefs, lang: l, from }))
    } catch {
      /* kept in memory */
    }
  if (l === current) return false
  current = l
  for (const f of listeners) f(l)
  return true
}

/** Runs when the language changes (e.g. re-render the orchestrator's prompt). */
export const onLangChange = (f: (l: Lang) => void) => listeners.add(f)

/** Keep the locale across await/timers without mutating shared installation preferences. */
export function withLang<T>(l: unknown, fn: () => T): T {
  return isLang(l) ? requestLocale.run(l, fn) : fn()
}

/** Messages of a catalog in the user's language, read at call time. */
export function tr<T extends Record<string, Msg>>(m: Messages<T>): T {
  return m[lang()] as T
}

/** The user's name (WEEVILS_USER_NAME), else « l'utilisateur » / "the user" in the current language. Read at call time. */
export const user = (): string => USER_NAME || tr(C).theUser
