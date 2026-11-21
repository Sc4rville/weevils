// The app's theme, one for every device and address of this weevils (the classic app, weevils next): stored in
// DATA_DIR/theme.json (survives a restart), carried by the snapshot (snap.theme), set by POST /api/theme.
// A device without a stored theme keeps its own choice until someone picks one.
import fs from 'node:fs'

/** The themes the app knows (src/ui/app-context.tsx THEMES). Anything else is refused. */
export const THEME_IDS = ['light', 'dark', 'zen', 'graphite', 'desert', 'synthwave'] as const

export class ThemePref {
  private value: string | undefined
  readonly file: string
  constructor(file: string) {
    this.file = file
    try {
      const t = JSON.parse(fs.readFileSync(file, 'utf8'))?.theme
      if ((THEME_IDS as readonly string[]).includes(t)) this.value = t
    } catch { /* no theme picked yet */ }
  }
  get(): string | undefined {
    return this.value
  }
  /** False when the theme is unknown (nothing changes). */
  set(theme: unknown): boolean {
    if (typeof theme !== 'string' || !(THEME_IDS as readonly string[]).includes(theme)) return false
    if (theme === this.value) return true
    this.value = theme
    fs.writeFileSync(this.file, JSON.stringify({ theme, at: Date.now() }) + '\n', { mode: 0o600 })
    return true
  }
}
