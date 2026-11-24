import fs from 'node:fs'
import { expect, it } from 'vitest'
import { THEMES } from '../src/ui/app-context'
// Themes added by the nightly theme runs (docs/themes.md): every one is held to the same measured bar. The four
// original themes have their own hand-checked notes in src/styles.css (light's star relies on a halo, for instance).
const ADDED = ['desert', 'synthwave', 'botanical', 'vaporwave', 'coastal', 'deco', 'carbon', 'chalkboard'] as const
const css = ['src/styles.css', 'src/ui/h24.css'].map((f) => fs.readFileSync(f, 'utf8')).join('\n')
type Lab = [number, number, number]
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
function lab(value: string): Lab {
  if (value.startsWith('oklch')) {
    const [l, c, h] = value.match(/[\d.]+/g)!.map(Number)
    return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  }
  const hex = value.slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => linear(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function luminance([L, a, b]: Lab) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const [r, g, bl] = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.max(0, Math.min(1, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const ratio = (x: Lab, y: Lab) => {
  const [a, b] = [luminance(x), luminance(y)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
/** Every custom property a theme sets, across its blocks (main block, AutoMark, alert, 24/7 title). */
function vars(theme: string) {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(new RegExp(`:root\\[data-theme='${theme}'\\] \\{([^}]*)\\}`, 'g')))
    for (const v of m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) out[v[1]] = v[2].trim()
  return out
}

it('lists every added theme in the selector', () => {
  for (const theme of ADDED) expect(THEMES).toContain(theme)
})

it.each(ADDED)('%s: text, working star, AutoMark and 24/7 title read on every band and sub-band; no red alert of its own', (theme) => {
  const v = vars(theme)
  const dl = Number(v.dl)
  const bands = ['agent', 'h24', 'devil', 'devil-reply', 'calm', ...Array.from({ length: 16 }, (_, i) => `p${i}`)].flatMap((k) => {
    const base = lab(v[k])
    return [base, [base[0] + dl, base[1] * 1.06, base[2] * 1.06] as Lab]
  })
  for (const bg of bands) {
    expect(ratio(lab(v.ink), bg), `${theme} ink`).toBeGreaterThanOrEqual(6)
    expect(ratio(lab(v.fluo), bg), `${theme} working star`).toBeGreaterThanOrEqual(3)
    expect(ratio(lab(v['auto-fluo']), bg), `${theme} AutoMark`).toBeGreaterThanOrEqual(3)
    expect(ratio(lab(v['automated-ink']), bg), `${theme} 24/7 title`).toBeGreaterThanOrEqual(3)
  }
  // A state is never an alarm (2026-11-26): a paused session or a failure reads in the theme's colours, no red fill.
  expect(v.alert, `${theme} sets no alert colour`).toBeUndefined()
})

it.each(ADDED)('%s: two project slots at least 2 apart stay distinct (For you cards, feed bands)', (theme) => {
  const v = vars(theme)
  const slots = Array.from({ length: 16 }, (_, i) => lab(v[`p${i}`]))
  for (let i = 0; i < 16; i++)
    for (let j = i + 2; j < 16; j++) {
      const d = Math.hypot(...slots[i].map((x, k) => x - slots[j][k]))
      expect(d, `${theme} p${i} / p${j}`).toBeGreaterThanOrEqual(0.05)
    }
})

// A texture lies over the whole window, text included (src/styles.css html::after): faint enough to leave every
// contrast above standing, never a tap target, and only the blend modes that keep text legible.
it.each(THEMES)('%s: its texture, if any, stays a faint matter over the text', (theme) => {
  const v = vars(theme)
  if (!v.texture) return
  expect(Number(v['texture-opacity']), `${theme} texture opacity`).toBeGreaterThan(0)
  expect(Number(v['texture-opacity']), `${theme} texture opacity`).toBeLessThanOrEqual(0.12)
  expect(['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten'], `${theme} texture blend`).toContain(v['texture-blend'] ?? 'normal')
  expect(v.texture, `${theme} texture: CSS images only, nothing fetched`).not.toMatch(/url\(\s*["']?(https?:|\/\/|\.|\/)/)
})
