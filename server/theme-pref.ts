// The app's theme, one for every device and address of this weevils (the classic app, weevils next): stored in
// DATA_DIR/theme.json (survives a restart), carried by the snapshot (snap.theme), set by POST /api/theme.
// A device without a stored theme keeps its own choice until someone picks one.
import fs from 'node:fs'

/** A theme id as the app writes them (src/ui/app-context.tsx THEMES): the server keeps any well-formed one, so a new
 *  theme needs no server change and no restart; each client applies only the themes it knows (isTheme). */
export const isThemeId = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9-]{1,23}$/.test(v)

export class ThemePref {
  private value: string | undefined
  readonly file: string
  constructor(file: string) {
    this.file = file
    try {
      const t = JSON.parse(fs.readFileSync(file, 'utf8'))?.theme
      if (isThemeId(t)) this.value = t
    } catch { /* no theme picked yet */ }
  }
  get(): string | undefined {
    return this.value
  }
  /** False when the value is not a theme id (nothing changes). */
  set(theme: unknown): boolean {
    if (!isThemeId(theme)) return false
    if (theme === this.value) return true
    this.value = theme
    fs.writeFileSync(this.file, JSON.stringify({ theme, at: Date.now() }) + '\n', { mode: 0o600 })
    return true
  }
}
