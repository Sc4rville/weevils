// The camera's picture (camera.tsx), made by the app itself from its own page: modern-screenshot copies the page into
// an SVG (its styles, fonts, pictures and every scroll position), then the phone's own browser draws that SVG. Never
// the phone's screenshot: nothing lands in the camera roll, and what is sent is exactly what was frozen on the screen.
import { screenHeight } from '../../src/ui/viewport.ts'
import { isMark, type Box } from './camera-geometry.ts'

/** Safari (every browser on an iPhone): it draws the pictures inside an SVG only once that SVG was drawn once. */
const WEBKIT = typeof navigator !== 'undefined' && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent)
/** Past this, the picture is given up (the screen unfreezes and says so): never a frozen screen that waits forever. */
export const SHOOT_MS = 20_000
/** The picture given up past SHOOT_MS (the line then says it took too long). */
export class SlowShot extends Error {}

/** The page drawn again by the browser itself, at the size of the screen; the camera's own layers left out. */
export async function shoot(): Promise<HTMLCanvasElement> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, ko) => { timer = setTimeout(() => ko(new SlowShot('capture too slow')), SHOOT_MS) }) // i18n-ignore
  try {
    return await Promise.race([make(), late])
  } finally {
    clearTimeout(timer)
  }
}

async function make(): Promise<HTMLCanvasElement> {
  const bg = getComputedStyle(document.body).backgroundColor
  // Loaded on the first tap only: the app itself never pays for it.
  const { domToForeignObjectSvg } = await import('modern-screenshot')
  // An empty box's hint (« tell me what to do ») keeps its own faded colour: the copy carries no style sheet, so each
  // one is named and its colour written next to the picture.
  const named: Element[] = []
  const rules: string[] = []
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]').forEach((el, i) => {
    if (el.value || isMark(el)) return
    const ph = getComputedStyle(el, '::placeholder')
    el.setAttribute('data-wv-ph', String(i))
    named.push(el)
    rules.push(`[data-wv-ph="${i}"]::placeholder{color:${ph.color};-webkit-text-fill-color:${ph.color};opacity:${ph.opacity}}`)
  })
  const w = innerWidth
  // Installed on an iPhone, the stage can be a status bar taller than innerHeight (src/ui/viewport.ts).
  const h = screenHeight()
  // Photos off the screen are left out of the copy, at their size (the page keeps its layout): they are not in the
  // picture. The copy waited for each one to load, and Safari never loads a photo of the thread far from the screen
  // (loading="lazy"): 8 s (2026-11-23). And each one loaded was copied into the picture: megabytes for an iPhone to
  // draw on a long thread. Put back just after.
  const parked: [HTMLImageElement, string | null, string | null, string | null][] = []
  document.querySelectorAll('img').forEach((img) => {
    if (isMark(img)) return
    const r = img.getBoundingClientRect()
    if (r.bottom > 0 && r.top < h && r.right > 0 && r.left < w) return
    parked.push([img, img.getAttribute('src'), img.getAttribute('srcset'), img.getAttribute('style')])
    img.style.width = `${r.width}px`
    img.style.height = `${r.height}px`
    img.removeAttribute('srcset')
    // No address at all (never an empty picture in its place: Safari leaves a lazy photo off the screen unloaded,
    // and the copy waited for it, 3 s).
    img.removeAttribute('src')
  })
  let svg: SVGElement
  try {
    svg = await domToForeignObjectSvg(document.body, {
      width: w,
      height: h,
      backgroundColor: bg,
      filter: (n) => !isMark(n),
      // A picture on the screen still loading (a video that never loads its first image, on an iPhone) is waited for
      // 3 s at most; what the page already shows comes from the browser's cache.
      timeout: 3000,
      // The library's own Safari fix draws the picture again once per image on the page, each time 0.1 s later than
      // the last: 19 s on a real weevboss thread, the screen frozen all along (2026-11-23). The few passes below do it.
      features: { restoreScrollPosition: true, fixSvgXmlDecode: false },
      onCreateForeignObjectSvg: (s) => {
        if (!rules.length) return
        const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
        style.textContent = rules.join('\n')
        s.prepend(style)
      },
    })
  } finally {
    named.forEach((el) => el.removeAttribute('data-wv-ph'))
    for (const [img, src, set, style] of parked) {
      if (set !== null) img.setAttribute('srcset', set)
      if (src !== null) img.setAttribute('src', src)
      else img.removeAttribute('src')
      if (style !== null) img.setAttribute('style', style)
      else img.removeAttribute('style')
    }
  }
  return draw(svg, w, h, Math.min(devicePixelRatio || 1, 2), bg)
}

async function draw(svg: SVGElement, w: number, h: number, scale: number, bg: string): Promise<HTMLCanvasElement> {
  const xml = new XMLSerializer().serializeToString(svg).replace(/[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '')
  const img = new Image()
  img.decoding = 'sync'
  const loaded = new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('capture')) }) // i18n-ignore
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  await loaded
  await img.decode?.().catch(() => {})
  const c = document.createElement('canvas')
  c.width = Math.floor(w * scale)
  c.height = Math.floor(h * scale)
  const g = c.getContext('2d', { willReadFrequently: WEBKIT })!
  const paint = () => {
    g.fillStyle = bg
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(img, 0, 0, c.width, c.height)
  }
  paint()
  // Safari fills in the SVG's own pictures (photos, textures, fonts) over the next draws: drawn again until two passes
  // agree, three at least (the first two can both miss them), ten at most (about a second).
  if (WEBKIT) {
    let before = print(g, c)
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 90))
      paint()
      const now = print(g, c)
      if (now === before && i >= 2) break
      before = now
    }
  }
  return c
}

/** A cheap fingerprint of what is drawn: one pixel in 97, summed. */
function print(g: CanvasRenderingContext2D, c: HTMLCanvasElement): number {
  const d = g.getImageData(0, 0, c.width, c.height).data
  let s = 0
  for (let i = 0; i < d.length; i += 4 * 97) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0
  return s
}

/** The part drawn with the finger, cut from the whole picture (in screen pixels; the picture may be twice as fine). */
export function crop(src: HTMLCanvasElement, b: Box | null): HTMLCanvasElement {
  if (!b) return src
  const k = src.width / innerWidth
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(b.w * k))
  out.height = Math.max(1, Math.round(b.h * k))
  out.getContext('2d')!.drawImage(src, Math.round(b.x * k), Math.round(b.y * k), out.width, out.height, 0, 0, out.width, out.height)
  return out
}
