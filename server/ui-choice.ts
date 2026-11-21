// Which interface a browser gets: weevils next by default, the classic app as a fallback (docs/next-interaction.md).
// « ?ui=classic » or « ?ui=next » picks one and the browser keeps it (a cookie); WEEVILS_UI=classic makes the classic app
// this install's default. Without next built, the classic app, whatever was asked.
export type Ui = 'next' | 'classic'
export const UI_COOKIE = 'weevils-ui'

const isUi = (v: string | null | undefined): v is Ui => v === 'next' || v === 'classic'

export function uiChoice(o: { cookie?: string; query?: string | null; nextBuilt: boolean; fallback?: string }): { ui: Ui; set?: Ui } {
  const asked = isUi(o.query) ? o.query : undefined
  const kept = new RegExp(`(?:^|;\\s*)${UI_COOKIE}=(next|classic)`).exec(o.cookie ?? '')?.[1] as Ui | undefined
  const ui: Ui = asked ?? kept ?? (o.fallback === 'classic' ? 'classic' : 'next')
  return { ui: ui === 'next' && !o.nextBuilt ? 'classic' : ui, ...(asked ? { set: asked } : {}) }
}

/** The folders a file is looked for in, the chosen interface's first. Both builds hash their assets, so a file of one
 *  never shadows the other's; the service worker always comes from the classic build (it carries its build stamp). */
export function uiDirs(ui: Ui, dirs: { classic: string; next: string }, pathname: string): string[] {
  if (pathname === '/sw.js') return [dirs.classic, dirs.next]
  return ui === 'next' ? [dirs.next, dirs.classic] : [dirs.classic, dirs.next]
}
