// weevils compare: one before/after a phone can read at a glance (docs/foryou.md). Two pictures → one image with two
// clearly separated frames on a neutral ground, each under a big BEFORE / AFTER tag, cropped and zoomed on what changed
// (stacked when the crops are wide, side by side when they are tall). Two clips → one clip, before then after, the tag on
// each part, opening on a neutral card so For you's play mark never sits over text. The output name ends in
// .compare.png / .compare.mp4: `weevils show` knows a before/after made this way. Uses the same playwright-core as
// `weevils capture` (server/capture.mjs) and ffmpeg for clips.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { GROUND, browser } from './picture.mjs'

export { GROUND, browser }

export const USAGE = 'usage: weevils compare <before.png|.mp4|.mmd> <after.png|.mp4|.mmd> <out.compare.png|.mp4> [--crop x,y,w,h] [--crop-before x,y,w,h] [--crop-after x,y,w,h] [--layout auto|stack|side]'
export const TAGS = { before: { bg: '#111111', fg: '#ffffff' }, after: { bg: '#1fd60a', fg: '#000000' } }

/** "x,y,w,h" in the source's pixels → a box, or undefined. */
export function parseCrop(s) {
  if (!s) return undefined
  const n = String(s).split(',').map(Number)
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v) || v < 0) || !n[2] || !n[3]) throw new Error(`bad crop « ${s} » (x,y,w,h in pixels)`)
  return { x: n[0], y: n[1], w: n[2], h: n[3] }
}

/** A crop must fit in its source: said plainly, with the source's size, before any drawing. */
export function checkCrop(c, size, which) {
  if (c.x + c.w > size.w || c.y + c.h > size.h) throw new Error(`the ${which} crop ${c.x},${c.y},${c.w},${c.h} goes past its ${size.w}×${size.h} source`)
  return c
}

/** Stacked for wide crops, side by side when both are taller than wide (two phone screens read well next to each other). */
export function layoutFor(a, b, asked = 'auto') {
  if (asked === 'stack' || asked === 'side') return asked
  return a.h / a.w > 1.1 && b.h / b.w > 1.1 ? 'side' : 'stack'
}

/** The page that draws the image: each frame shows only its crop, zoomed to the frame's width. */
export function comparePage(frames, layout) {
  const W = layout === 'side' ? 300 : 560
  const tag = (k) => `<div class="tag ${k}">${k === 'before' ? 'BEFORE' : 'AFTER'}</div>` // i18n-ignore: fixed English labels (app UI language)
  const frame = (f) => {
    const s = W / f.crop.w
    return `<figure>${tag(f.kind)}<div class="frame" style="width:${W}px;height:${Math.round(f.crop.h * s)}px"><img src="${f.src}" style="width:${Math.round(f.w * s)}px;left:${-Math.round(f.crop.x * s)}px;top:${-Math.round(f.crop.y * s)}px"></div></figure>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${GROUND};font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:inline-block}
main{display:flex;flex-direction:${layout === 'side' ? 'row' : 'column'};gap:28px;padding:22px}
figure{margin:0}
.tag{display:inline-block;font-size:26px;font-weight:900;letter-spacing:.06em;padding:6px 14px;line-height:1.1}
.tag.before{background:${TAGS.before.bg};color:${TAGS.before.fg}}.tag.after{background:${TAGS.after.bg};color:${TAGS.after.fg}}
.frame{position:relative;overflow:hidden;border:4px solid #111;background:#111}
.frame img{position:absolute;max-width:none;display:block}
</style></head><body><main>${frames.map(frame).join('')}</main></body></html>`
}

const isDiagram = (f) => /\.(mmd|mermaid)$/i.test(f)
const isVideo = (f) => /\.(mp4|webm|mov|m4v)$/i.test(f)
const probe = (f) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split(',').map(Number)
  return { w: out[0], h: out[1] }
}

async function images(before, after, out, o) {
  const b = await browser()
  try {
    const page = await b.newPage({ deviceScaleFactor: 2 })
    const sizes = []
    for (const f of [before, after]) {
      await page.goto(pathToFileURL(f).href)
      sizes.push(await page.evaluate(() => { const i = document.querySelector('img'); return { w: i.naturalWidth, h: i.naturalHeight } }))
    }
    const frames = [before, after].map((f, i) => {
      const crop = checkCrop((i ? o.cropAfter : o.cropBefore) ?? o.crop ?? { x: 0, y: 0, w: sizes[i].w, h: sizes[i].h }, sizes[i], i ? 'after' : 'before')
      return { kind: i ? 'after' : 'before', src: pathToFileURL(f).href, w: sizes[i].w, h: sizes[i].h, crop }
    })
    // A file page next to nothing: the two pictures load from disk, no copy in memory.
    const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wv-compare-')), 'compare.html')
    fs.writeFileSync(html, comparePage(frames, layoutFor(frames[0].crop, frames[1].crop, o.layout)))
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction(() => [...document.images].every((i) => i.complete))
    fs.rmSync(path.dirname(html), { recursive: true, force: true })
    await page.locator('body').screenshot({ path: out })
  } finally {
    await b.close()
  }
}

async function clips(before, after, out, o) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-compare-'))
  try {
    const b = await browser()
    try {
      const page = await b.newPage({ deviceScaleFactor: 2 })
      for (const k of ['before', 'after']) {
        await page.setContent(`<body style="margin:0;display:inline-block;background:transparent"><div style="font:900 26px/1.1 -apple-system,system-ui,sans-serif;letter-spacing:.06em;padding:6px 14px;background:${TAGS[k].bg};color:${TAGS[k].fg}">${k.toUpperCase()}</div></body>`)
        await page.locator('div').screenshot({ path: path.join(tmp, `${k}.png`), omitBackground: true })
      }
    } finally {
      await b.close()
    }
    const W = 720
    const parts = [before, after].map((f, i) => {
      const s = probe(f)
      const c = checkCrop((i ? o.cropAfter : o.cropBefore) ?? o.crop ?? { x: 0, y: 0, w: s.w, h: s.h }, s, i ? 'after' : 'before')
      return { f, c, h: Math.round((c.h * W) / c.w / 2) * 2 }
    })
    const H = Math.max(...parts.map((p) => p.h)) + 120
    const g = GROUND.slice(1)
    const segs = parts.map((p, i) => {
      const seg = path.join(tmp, `${i}.mp4`)
      const vf = `[0:v]crop=${p.c.w}:${p.c.h}:${p.c.x}:${p.c.y},scale=${W}:${p.h},pad=${W + 40}:${H}:20:100:0x${g},setsar=1[v];[v][1:v]overlay=20:20`
      const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', p.f, '-i', path.join(tmp, `${i ? 'after' : 'before'}.png`), '-filter_complex', vf, '-an', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', seg], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error(`ffmpeg failed on ${p.f}`)
      return seg
    })
    // A neutral opening card with only the BEFORE tag in its corner: the poster's middle stays empty for the play mark.
    const card = path.join(tmp, 'card.mp4')
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${g}:s=${W + 40}x${H}:d=0.8:r=30`, '-i', path.join(tmp, 'before.png'), '-filter_complex', '[0:v][1:v]overlay=20:20,setsar=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', card], { stdio: 'inherit' })
    const list = path.join(tmp, 'list.txt')
    fs.writeFileSync(list, [card, ...segs].map((s) => `file '${s}'`).join('\n'))
    const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('ffmpeg could not join the clips')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after, out, ...args] = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
  try {
    if (!before || !after || !out) throw new Error(USAGE)
    if (!/\.compare\.(png|mp4)$/i.test(out)) throw new Error('the output name ends in .compare.png or .compare.mp4')
    if (isDiagram(before) !== isDiagram(after)) throw new Error('two diagrams (.mmd) or two pictures, not one of each')
    if ((!isDiagram(before) && isVideo(before) !== isVideo(after)) || isVideo(before) !== /\.mp4$/i.test(out)) throw new Error('two pictures → .compare.png, two clips → .compare.mp4')
    const o = { crop: parseCrop(opt('crop')), cropBefore: parseCrop(opt('crop-before')), cropAfter: parseCrop(opt('crop-after')), layout: opt('layout') ?? 'auto' }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
    if (isDiagram(before) && isDiagram(after)) {
      // Two backend diagrams (server/diagram.mjs), drawn first, then framed side by side like two screens.
      const { renderDiagram } = await import('./diagram.mjs')
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-compare-'))
      try {
        const [b, a] = await Promise.all([[before, 'before'], [after, 'after']].map(([f, k]) => renderDiagram(path.resolve(f), path.join(tmp, `${k}.png`))))
        await images(b, a, path.resolve(out), { ...o, layout: o.layout === 'auto' ? 'side' : o.layout })
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
      console.log(path.resolve(out))
      process.exit(0)
    }
    await (isVideo(before) ? clips : images)(path.resolve(before), path.resolve(after), path.resolve(out), o)
    console.log(path.resolve(out))
  } catch (e) {
    console.error(`weevils compare: ${e.message}`)
    process.exit(1)
  }
}
