// Trying a theme in one tap, and going back in one tap (docs/themes.md, « Trying a theme »). A For you post that
// announces themes offers « Try this theme » (ForYouItem.themes, or a post link that ends with « #theme=<id> »), and
// the app opened on « …/#theme=<id> » applies it at once. The theme the person had is remembered on the device
// until they go back to it, keep the new one, or pick another: « back to my theme » is always one tap away, on the
// post, in the settings' theme list and for a few seconds in a calm line low on the screen.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ForYouItem } from '../../shared/foryou.ts'
import { cleanThemeIds, isThemeLink, themeIds, withoutTheme } from '../../shared/theme-link.ts'
import { useT } from '../i18n'
import BM from '../i18n/bands'
import M from '../i18n/foryou'
import { isTheme, useApp, type Theme } from './app-context'
import './theme-try.css'

const KEY = 'weevils-theme-try'
/** How long the calm line stays after a try. */
const SHOWN_MS = 12_000

export interface ThemeTry {
  /** The person's theme, to go back to. */
  before: Theme
  tried: Theme
  /** When it was tried (the calm line shows for a moment after it). */
  at: number
}

const subs = new Set<() => void>()
let cached: { raw: string | null; value: ThemeTry | null } | null = null

function read(): ThemeTry | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* no storage: this visit only */ }
  if (cached && cached.raw === raw && (raw !== null || cached.value === null)) return cached.value
  let value: ThemeTry | null = null
  try {
    const v = raw ? (JSON.parse(raw) as Partial<ThemeTry>) : null
    if (v && isTheme(v.before) && isTheme(v.tried) && v.before !== v.tried) value = { before: v.before, tried: v.tried, at: Number(v.at) || 0 }
  } catch { /* not ours */ }
  cached = { raw, value }
  return value
}

function write(v: ThemeTry | null) {
  const raw = v ? JSON.stringify(v) : null
  try {
    if (raw) localStorage.setItem(KEY, raw)
    else localStorage.removeItem(KEY)
  } catch { /* no storage */ }
  cached = { raw, value: v }
  for (const f of subs) f()
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

/** What a try does to the remembered theme (pure, tested): the first theme left is the one to go back to. */
export function tried(now: ThemeTry | null, current: Theme, next: Theme, at: number): ThemeTry | null {
  const before = now && now.tried === current ? now.before : current
  return before === next ? null : { before, tried: next, at }
}

/** The themes a post offers that this app knows: its own list, or a post link that only says « try this theme ». */
export function postThemes(item: Pick<ForYouItem, 'themes' | 'link'>): Theme[] {
  const ids = item.themes?.length ? cleanThemeIds(item.themes) : item.link && isThemeLink(item.link.url) ? themeIds(item.link.url) : []
  return ids.filter(isTheme)
}

/** A post offers a theme this app has never heard of: the app is older than the server's build. */
export function postThemesUnknown(item: Pick<ForYouItem, 'themes' | 'link'>): boolean {
  const ids = item.themes?.length ? cleanThemeIds(item.themes) : item.link && isThemeLink(item.link.url) ? themeIds(item.link.url) : []
  return ids.some((t) => !isTheme(t))
}

/** The post's link is only « try this theme »: shown as the try links, never as an address. */
export const isTryLink = (item: Pick<ForYouItem, 'link'>): boolean => !!item.link && isThemeLink(item.link.url)

/** Set by the app that can load a newer build of itself (next/src/fresh.ts): called when a theme it does not know
 *  is asked for, the one sure sign this page is older than what the server now serves. */
export const staleApp: { check: (() => void) | null } = { check: null }

export function useThemeTry() {
  const { theme, setTheme } = useApp()
  const stored = useSyncExternalStore(subscribe, read, () => null)
  // A try holds while the app wears the tried theme: a pick elsewhere (the selector, another device) ends it.
  const trying = stored && stored.tried === theme ? stored : null
  useEffect(() => {
    if (!stored || stored.tried === theme) return
    // Left a moment: the theme set by the try reaches this render a beat after the record.
    const id = setTimeout(() => { if (read() === stored) write(null) }, 6000)
    return () => clearTimeout(id)
  }, [stored, theme])
  const tryTheme = useCallback((next: Theme) => {
    if (next === theme) return
    write(tried(read(), theme, next, Date.now()))
    setTheme(next)
  }, [theme, setTheme])
  const back = useCallback(() => {
    const now = read()
    if (!now || now.tried !== theme) return
    write(null)
    setTheme(now.before)
  }, [theme, setTheme])
  /** The person picked a theme themselves: it is theirs now, nothing to go back to. */
  const pick = useCallback((next: Theme) => {
    write(null)
    if (next !== theme) setTheme(next)
  }, [theme, setTheme])
  return { theme, trying, tryTheme, back, pick }
}

/** Under a theme post: « Try this theme » (one link per theme when it announces several); once tried, the way back. */
export function ThemeTryLinks({ themes }: { themes: Theme[] }) {
  const t = useT(M)
  const names = useT(BM)
  const { theme, trying, tryTheme, back } = useThemeTry()
  if (!themes.length) return null
  return (
    <p className="in fy-post-link fy-theme-try">
      {themes.map((id) => {
        const on = theme === id
        if (on && trying) {
          return (
            <span key={id} className="fy-theme-on">
              <span className="fy-theme-now">{t.themeTrying(names.themeName(id))}</span>
              <a className="living lk-preview" href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); back() }}>{t.themeBack}</a>
            </span>
          )
        }
        if (on) return <span key={id} className="fy-theme-now">{t.themeIsYours(names.themeName(id))}</span>
        return (
          <a key={id} className="living lk-preview" href={`#theme=${id}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); tryTheme(id) }}>
            {themes.length > 1 ? t.themeTryNamed(names.themeName(id)) : t.themeTry}
          </a>
        )
      })}
    </p>
  )
}

/**
 * Mounted once by each app: applies « #theme=<id> » when the app opens on it (or the address changes to it), then
 * takes it out of the address so a reload never tries again; and shows, for a moment after a try, the calm line
 * « <theme> · back to my theme » low on the screen.
 */
export function ThemeTryLayer() {
  const t = useT(M)
  const names = useT(BM)
  const { trying, tryTheme, back } = useThemeTry()
  useEffect(() => {
    const apply = () => {
      const ids = themeIds(location.hash)
      if (!ids.length) return
      const known = ids.find(isTheme)
      // A theme this page does not know: a newer build has it. The address is kept, the fresh page applies it.
      if (!known) return void staleApp.check?.()
      history.replaceState(history.state, '', location.pathname + location.search + withoutTheme(location.hash))
      tryTheme(known)
    }
    apply()
    addEventListener('hashchange', apply)
    return () => removeEventListener('hashchange', apply)
  }, [tryTheme])
  const [now, setNow] = useState(() => Date.now())
  const until = trying ? trying.at + SHOWN_MS : 0
  useEffect(() => {
    if (!until || until <= Date.now()) return
    setNow(Date.now())
    const id = setTimeout(() => setNow(Date.now()), until - Date.now() + 50)
    return () => clearTimeout(id)
  }, [until])
  if (!trying || now >= until) return null
  return (
    <div className="theme-try-line" role="status">
      <span className="theme-try-name">{t.themeTrying(names.themeName(trying.tried))}</span>
      <a className="living lk-preview" href="#" onClick={(e) => { e.preventDefault(); back() }}>{t.themeBack}</a>
    </div>
  )
}
