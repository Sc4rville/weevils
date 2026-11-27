// A theme to try, as a link: « #theme=<id> » (several: « #theme=<id>,<id> ») at the end of this weevils' address, or
// alone. The app opened on it applies the theme at once and offers to go back (src/ui/theme-try.tsx); a For you post
// that carries it offers « Try this theme » (docs/themes.md). Given with `weevils show / post --link '#theme=<id>'`
// or `weevils link <post id> '#theme=<id>'`; the server keeps the ids on the post (ForYouItem.themes), never as its
// direct link, and shows the post only once the running app has those themes (server/live-themes.ts).

const IDS = /^[a-z][a-z0-9-]{0,39}$/
const MAX = 8

/** The theme ids a hash or an address asks for, in order, each once; none when it is not a theme link. */
export function themeIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const at = raw.indexOf('#')
  if (at < 0) return []
  const m = /(?:^|&)theme=([^&]*)/.exec(raw.slice(at + 1))
  if (!m) return []
  let list: string
  try { list = decodeURIComponent(m[1]) } catch { return [] }
  return [...new Set(list.split(',').map((s) => s.trim()).filter((s) => IDS.test(s)))].slice(0, MAX)
}

/** A link that says nothing but « try these themes »: a bare hash, or an address whose hash is only that. */
export function isThemeLink(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const at = raw.indexOf('#')
  return at >= 0 && /^theme=[^&]+$/.test(raw.slice(at + 1)) && themeIds(raw).length > 0
}

/** Well-formed theme ids out of anything stored or received. */
export function cleanThemeIds(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((s): s is string => typeof s === 'string' && IDS.test(s)))].slice(0, MAX) : []
}

export const themeHash = (ids: string[]): string => `#theme=${ids.join(',')}`

/** The same address without its theme request (the app removes it once applied, so a reload never applies it twice). */
export function withoutTheme(hash: string): string {
  const rest = hash.replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('theme='))
  return rest.length ? `#${rest.join('&')}` : ''
}
