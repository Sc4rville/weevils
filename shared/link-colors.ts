// The colours of living links (docs/LINKS.md): each kind keeps its two hues, and each theme gets the shade of them
// that reads on every background a link can sit on there, at WCAG AA (4.5:1) or better. Computed, not hand-picked:
// a theme's grounds are listed below from src/styles.css, and for each hue the most vivid shade that clears all of
// them is chosen. The app injects the result as CSS (src/ui/living-link.tsx); the pages weevils builds use the
// page-light / page-dark rows (server/pages.ts). Tested in shared/link-colors.test.ts. No dependency.
import type { PageKind } from './pages.ts'

export type Rgb = [number, number, number] // sRGB, 0..1
type Lch = [number, number, number] // OKLCH: lightness 0..1, chroma, hue in degrees

/** The two hues of each kind (the gradient runs from the first to the second). */
export const LINK_HUES: Record<PageKind, [number, number]> = {
  opportunities: [150, 115],
  library: [300, 335],
  preview: [215, 250],
  report: [70, 40],
  render: [15, 350],
}

const APP_THEMES = ['light', 'dark', 'zen', 'graphite', 'desert', 'synthwave', 'botanical', 'vaporwave', 'coastal', 'deco'] as const
export type LinkTheme = (typeof APP_THEMES)[number] | `${(typeof APP_THEMES)[number]}-bubble` | 'page-light' | 'page-dark'
export const LINK_THEMES: LinkTheme[] = [...APP_THEMES, ...APP_THEMES.map((t) => `${t}-bubble` as const), 'page-light', 'page-dark']

// ---------------------------------------------------------------- colour maths (OKLab, sRGB, WCAG)

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** OKLCH to sRGB, unclamped (a channel outside 0..1 means out of gamut). */
export function oklchToRgb([l, c, h]: Lch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ]
}

export function rgbToOklch([r, g, b]: Rgb): Lch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)
const clamp = (rgb: Rgb): Rgb => rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb

export const hexToRgb = (hex: string): Rgb => {
  const x = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255) as Rgb
}
export const rgbToHex = (rgb: Rgb) => `#${clamp(rgb).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`

const luminance = (rgb: Rgb) => {
  const [r, g, b] = clamp(rgb).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG 2 contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** The CSS `oklch(from <base> calc(l + d) calc(c * k) h)` of the app's bubbles, in gamut. */
const shift = (base: Rgb, dl: number, k: number): Rgb => {
  const [l, c, h] = rgbToOklch(base)
  return clamp(oklchToRgb([l + dl, c * k, h]))
}

// ---------------------------------------------------------------- the grounds of each theme (src/styles.css)

const ok = (l: number, c: number, h: number) => clamp(oklchToRgb([l, c, h]))
const palette = (l: number, c: number) => Array.from({ length: 16 }, (_, i) => ok(l, c, 5 + 22.5 * i))
/** The nightly themes' slots (src/styles.css): one hue arc from h0 to h1, lightness cycling over ls. */
const arc = (h0: number, h1: number, ls: number[], c: number) => Array.from({ length: 16 }, (_, i) => ok(ls[i % ls.length], c, (((h0 + ((h1 - h0) * i) / 15) % 360) + 360) % 360))
/** Each app theme's weevboss band (--agent) and its --dl. */
const AGENT: Record<(typeof APP_THEMES)[number], { agent: Rgb; dl: number }> = {
  light: { agent: hexToRgb('#b39bff'), dl: -0.075 },
  dark: { agent: hexToRgb('#5522b5'), dl: 0.07 },
  zen: { agent: ok(0.83, 0.03, 315), dl: -0.06 },
  graphite: { agent: ok(0.82, 0, 0), dl: -0.045 },
  desert: { agent: hexToRgb('#d9a07e'), dl: -0.06 },
  synthwave: { agent: hexToRgb('#1e0b3a'), dl: 0.06 },
  botanical: { agent: hexToRgb('#a6d2a7'), dl: -0.06 },
  vaporwave: { agent: hexToRgb('#0d3343'), dl: 0.06 },
  coastal: { agent: hexToRgb('#9fd0e8'), dl: -0.06 },
  deco: { agent: ok(0.2, 0.028, 85), dl: 0.06 },
}
/** Every background a living link can sit on: in a theme, the page, the weevboss band, the project bands (--p0…--p15),
 *  the h24, devil and calm bands; in a « -bubble » row, weevboss's message inside a session thread (.msg.orch: its band
 *  shifted by 1.8 × --dl), a mid-tone that gets its own shade. */
function grounds(theme: LinkTheme): Rgb[] {
  if (theme.endsWith('-bubble')) {
    const { agent, dl } = AGENT[theme.replace('-bubble', '') as keyof typeof AGENT]
    return [shift(agent, dl * 1.8, 1.1)]
  }
  switch (theme) {
    case 'light':
      return [hexToRgb('#ffffff'), AGENT.light.agent, ...palette(0.8, 0.14), hexToRgb('#ffc64c'), hexToRgb('#ff9a3c'), hexToRgb('#7fe0a0'), ok(0.91, 0.045, 165)]
    case 'dark':
      return [hexToRgb('#000000'), AGENT.dark.agent, ...palette(0.44, 0.13), hexToRgb('#744900'), hexToRgb('#a8470a'), hexToRgb('#1d6b3f'), ok(0.3, 0.04, 165)]
    case 'zen':
      return [AGENT.zen.agent, ...palette(0.84, 0.05), ok(0.89, 0.04, 85), ok(0.78, 0.075, 50), ok(0.86, 0.05, 150), ok(0.9, 0.025, 165)]
    case 'graphite':
      return [AGENT.graphite.agent, ...Array.from({ length: 16 }, (_, i) => ok(0.97 - 0.011 * i, 0, 0)), ok(0.88, 0, 0), ok(0.77, 0, 0), ok(0.93, 0, 0), ok(0.94, 0, 0)]
    case 'desert':
      return [AGENT.desert.agent, ...arc(150, -30, [0.92, 0.87, 0.82, 0.77], 0.065), ok(0.86, 0.04, 140), ok(0.8, 0.07, 20), ok(0.89, 0.035, 70), ok(0.96, 0.016, 80)]
    case 'synthwave':
      return [AGENT.synthwave.agent, ...arc(300, 445, [0.22, 0.28, 0.34, 0.4], 0.12), ok(0.32, 0.13, 335), ok(0.32, 0.1, 20), ok(0.3, 0.08, 280), ok(0.17, 0.05, 295)]
    case 'botanical':
      return [AGENT.botanical.agent, ...arc(100, 240, [0.92, 0.86, 0.8, 0.74], 0.085), ok(0.89, 0.045, 350), ok(0.82, 0.07, 30), ok(0.9, 0.04, 100), ok(0.97, 0.016, 105)]
    case 'vaporwave':
      return [AGENT.vaporwave.agent, ...arc(180, 360, [0.22, 0.28, 0.34, 0.4], 0.075), ok(0.34, 0.08, 340), ok(0.33, 0.08, 15), ok(0.3, 0.06, 290), ok(0.18, 0.04, 275)]
    case 'coastal':
      return [AGENT.coastal.agent, ...arc(150, 310, [0.86, 0.815, 0.77, 0.725], 0.07), ok(0.9, 0.045, 80), ok(0.82, 0.075, 35), ok(0.92, 0.03, 190), ok(0.965, 0.02, 225)]
    case 'deco':
      return [AGENT.deco.agent, ...arc(175, 35, [0.22, 0.28, 0.34, 0.4], 0.085), ok(0.3, 0.07, 165), ok(0.3, 0.09, 20), ok(0.28, 0.04, 85), ok(0.15, 0.022, 85)]
    case 'page-light':
      return [hexToRgb('#ffffff')]
    default:
      return [hexToRgb('#000000')]
  }
}
export const LINK_GROUNDS: Record<LinkTheme, Rgb[]> = Object.fromEntries(LINK_THEMES.map((t) => [t, grounds(t)])) as Record<LinkTheme, Rgb[]>
/** Rows whose grounds are dark: their links are lighter than the grounds, the others darker. */
const LIGHT_TEXT = new Set<LinkTheme>(['dark', 'dark-bubble', 'synthwave', 'synthwave-bubble', 'vaporwave', 'vaporwave-bubble', 'deco', 'deco-bubble', 'page-dark'])

// ---------------------------------------------------------------- the shade of each hue

/** What every link must clear (a margin above 4.5:1 for browser gamut mapping and gradient interpolation). */
export const LINK_MIN_CONTRAST = 4.8
const MAX_CHROMA = 0.2

/** The most vivid in-gamut colour of hue h at lightness l, chroma at most max. */
function vivid(l: number, h: number, max = MAX_CHROMA): Rgb {
  let lo = 0
  let hi = max
  if (inGamut(oklchToRgb([l, hi, h]))) return oklchToRgb([l, hi, h])
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToRgb([l, mid, h]))) lo = mid
    else hi = mid
  }
  return clamp(oklchToRgb([l, lo, h]))
}

/** The shade of hue h for a theme: from a vivid lightness (0.52 on light grounds, 0.72 on dark ones), moving away from the grounds that clears every ground. When no
 *  shade of the hue can (a mid-tone ground on a dark theme), the hue fades towards the text colour until it does. */
export function linkShade(theme: LinkTheme, h: number, chroma = MAX_CHROMA): Rgb {
  const gs = LINK_GROUNDS[theme]
  const passes = (c: Rgb) => gs.every((g) => contrast(c, g) >= LINK_MIN_CONTRAST)
  const light = LIGHT_TEXT.has(theme)
  for (let i = 0; i <= 100; i++) {
    const l = light ? 0.72 + i * 0.003 : 0.52 - i * 0.004
    const c = vivid(l, h, chroma)
    if (passes(rgbFromHex(c))) return rgbFromHex(c)
  }
  return light ? [1, 1, 1] : [0, 0, 0]
}
const rgbFromHex = (c: Rgb) => hexToRgb(rgbToHex(c))

/** The two colours of each kind in each theme, as hex. */
export function linkColors(theme: LinkTheme): Record<PageKind, [string, string]> {
  return Object.fromEntries(Object.entries(LINK_HUES).map(([k, [a, b]]) => [k, [rgbToHex(linkShade(theme, a)), rgbToHex(linkShade(theme, b))]])) as Record<PageKind, [string, string]>
}

/** Bold words in a reply (« **…** » from weevboss or a session): a gradient of their own, never a link's. Links are
 *  two close shades of one hue, vivid, drifting; bold runs from violet to teal, softer (chroma at most BOLD_CHROMA)
 *  and still, so it reads as emphasis, not as something to tap. Same grounds, same AA bar as the links. */
export const BOLD_HUES: [number, number] = [290, 190]
export const BOLD_CHROMA = 0.12
export function boldColors(theme: LinkTheme): [string, string] {
  return [rgbToHex(linkShade(theme, BOLD_HUES[0], BOLD_CHROMA)), rgbToHex(linkShade(theme, BOLD_HUES[1], BOLD_CHROMA))]
}

/** The app's rules: `[data-theme=…] .living.lk-<kind>` gets its two colours (light is also the default theme), and
 *  inside weevboss's message bubble its own. An outside author's bubble (.msg.orch.ext) has a colour of its own,
 *  unknown here: links there take the text colour, which that bubble is made to carry. */
export function linkCss(): string {
  const out: string[] = []
  for (const theme of APP_THEMES) {
    const root = theme === 'light' ? ':root' : `:root[data-theme='${theme}']`
    for (const [k, [a, b]] of Object.entries(linkColors(theme))) out.push(`${root} .living.lk-${k}{--lk-a:${a};--lk-b:${b}}`)
    for (const [k, [a, b]] of Object.entries(linkColors(`${theme}-bubble`))) out.push(`${root} .msg.orch .living.lk-${k}{--lk-a:${a};--lk-b:${b}}`)
    const [ba, bb] = boldColors(theme)
    const [oa, ob] = boldColors(`${theme}-bubble`)
    out.push(`${root} .msg .md{--bd-a:${ba};--bd-b:${bb}}`, `${root} .msg.orch .md{--bd-a:${oa};--bd-b:${ob}}`)
  }
  out.push(':root .msg.orch.ext .living,:root[data-theme] .msg.orch.ext .living{--lk-a:var(--ink);--lk-b:var(--ink)}')
  return out.join('\n')
}
