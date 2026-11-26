// "For you" media shelf: the only images and videos the stream can show. A file gets here on purpose
// (`weevils show <file>`, or a path cited in the message that ends a turn), never by scanning folders; the bytes
// route serves registered ids only, so no path ever comes from a request.

import { execFile, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { tr } from './i18n.ts'
import M from './i18n/foryou-media.ts'
import type { ForYouMedia } from '../shared/foryou.ts'
import { isMockup, type Mockup } from '../shared/mockup.ts'

export type MediaType = 'image' | 'video'

export interface ShelfEntry {
  id: string
  /** Real path (symlinks resolved) at registration. */
  path: string
  type: MediaType
  bytes: number
  mtime: number
  name: string
  /** Last registration: the cap drops the oldest. */
  at: number
  /** Pixel size, read from the file's header at registration (the app sizes its mockup before the bytes arrive);
   *  0 × 0 when the header does not say. */
  w?: number
  h?: number
  /** The mockup asked for with `weevils show --mockup` (shared/mockup.ts); otherwise the app picks one. */
  mockup?: Mockup
  /** A clip recorded smaller than its frame (a browser recorder at a higher pixel density pads the rest in flat grey):
   *  the part that holds the picture, from the top-left corner, in pixels. The app shows that part only. */
  area?: { w: number; h: number }
  /** The file's mtime when `area` was looked for (looked for once per version of the file). */
  areaOf?: number
}

/** Sampled frame width for the padding check: enough to find an edge, cheap to read. */
const PAD_SAMPLE_W = 200

/**
 * The picture's part of a padded frame (rgb24, w × h), as fractions of the frame, or null when the frame is not padded.
 * Padded means: the same flat neutral grey fills the right and the bottom, and the picture keeps the frame's shape in
 * the top-left corner (both sides cut by the same factor, as a recorder at 2× or 3× pixel density does). Anything
 * else, a dark app with an empty bottom included, is left as it is.
 */
export function paddedArea(rgb: Uint8Array, w: number, h: number): { fw: number; fh: number } | null {
  if (w < 8 || h < 8 || rgb.length < w * h * 3) return null
  const at = (x: number, y: number) => (y * w + x) * 3
  const b = at(w - 1, h - 1)
  const [r, g, bl] = [rgb[b], rgb[b + 1], rgb[b + 2]]
  if (Math.abs(r - g) > 4 || Math.abs(g - bl) > 4 || r < 40 || r > 215) return null
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y)
      if (Math.abs(rgb[i] - r) > 10 || Math.abs(rgb[i + 1] - g) > 10 || Math.abs(rgb[i + 2] - bl) > 10) {
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const fw = (maxX + 1) / w
  const fh = (maxY + 1) / h
  if (fw < 0.2 || fh < 0.2 || fw > 0.9 || fh > 0.9 || Math.abs(fw - fh) > 0.04) return null
  // Snap to the density it comes from (1/2, 1/3, 2/3…): a picture whose own edge is the same grey stays whole.
  const f = Math.max(fw, fh)
  for (const d of [2, 3, 4, 1.5]) if (Math.abs(f - 1 / d) < 0.04) return { fw: 1 / d, fh: 1 / d }
  return { fw: f, fh: f }
}

/** Why a file was refused: `reason` is the catalog key (the message is already in the server's language). */
export type MediaReason = 'missing' | 'notFile' | 'outside' | 'badType' | 'badHeader' | 'tooBig' | 'badMockup'
export class MediaRefused extends Error {
  reason: MediaReason
  constructor(reason: MediaReason, message: string) {
    super(message)
    this.name = 'MediaRefused'
    this.reason = reason
  }
}

const EXT: Record<string, { type: MediaType; mime: string }> = {
  png: { type: 'image', mime: 'image/png' },
  jpg: { type: 'image', mime: 'image/jpeg' },
  jpeg: { type: 'image', mime: 'image/jpeg' },
  gif: { type: 'image', mime: 'image/gif' },
  webp: { type: 'image', mime: 'image/webp' },
  avif: { type: 'image', mime: 'image/avif' },
  mp4: { type: 'video', mime: 'video/mp4' },
  m4v: { type: 'video', mime: 'video/mp4' },
  webm: { type: 'video', mime: 'video/webm' },
  mov: { type: 'video', mime: 'video/quicktime' },
}
const EXTS = Object.keys(EXT).join('|')

export const MAX_ENTRIES = 600
export const CAPS: Record<MediaType, number> = { image: 25 * 1024 * 1024, video: 400 * 1024 * 1024 }
/** Bytes read to recognise a file. */
const HEAD = 64

const extOf = (p: string) => path.extname(p).slice(1).toLowerCase()

/** Content type of a media file name (by extension); undefined when it is neither an image nor a video we take. */
export const mimeOf = (p: string): string | undefined => EXT[extOf(p)]?.mime

/** The header that names the file (« inline »: shown in place; « attachment »: saved), with its real extension and an
 * ASCII fallback for old clients. A name made only of punctuation becomes « weevils-<id> ». */
export function disposition(name: string, id: string, attachment: boolean): string {
  const ext = extOf(name)
  const stem = name.slice(0, ext ? -(ext.length + 1) : undefined).normalize('NFC').replace(/[\u0000-\u001f\u007f"\\/]+/g, ' ').replace(/\s+/g, ' ').trim()
  const clean = `${/[\p{L}\p{N}]/u.test(stem) ? stem : `weevils-${id}`}${ext ? `.${ext}` : ''}`
  const ascii = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]+/g, '_').replace(/[%;]/g, '_')
  return `${attachment ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

/** What the first bytes of a file are, whatever its name says. null: nothing we show. */
export function sniff(b: Uint8Array): MediaType | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  const at = (s: string, o = 0) => buf.length >= o + s.length && buf.toString('latin1', o, o + s.length) === s
  if (at('\x89PNG\r\n\x1a\n')) return 'image'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image'
  if (at('GIF87a') || at('GIF89a')) return 'image'
  if (at('RIFF') && at('WEBP', 8)) return 'image'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video' // EBML (webm)
  if (at('ftyp', 4)) {
    // ISO media: the brands (major at 8, compatible ones from 16) tell a still image (avif) from a film.
    const size = Math.min(buf.length, Math.max(16, buf.readUInt32BE(0)))
    const brands = [buf.toString('latin1', 8, 12)]
    for (let o = 16; o + 4 <= size; o += 4) brands.push(buf.toString('latin1', o, o + 4))
    return brands.some((x) => x === 'avif' || x === 'avis') ? 'image' : 'video'
  }
  // Old QuickTime files start straight with an atom, without « ftyp ».
  if (['moov', 'mdat', 'wide', 'free', 'skip'].some((a) => at(a, 4))) return 'video'
  return null
}

/** Bytes read to find a still's size: a JPEG's frame header can come after its metadata. */
const SIZE_HEAD = 256 * 1024

/** Width and height of a PNG, GIF, WebP or JPEG from its first bytes; null when they do not say (AVIF, a cut file). */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  const at = (s: string, o = 0) => buf.length >= o + s.length && buf.toString('latin1', o, o + s.length) === s
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w < 100000 && h < 100000 ? { w, h } : null)
  if (at('\x89PNG\r\n\x1a\n') && at('IHDR', 12) && buf.length >= 24) return ok(buf.readUInt32BE(16), buf.readUInt32BE(20))
  if ((at('GIF87a') || at('GIF89a')) && buf.length >= 10) return ok(buf.readUInt16LE(6), buf.readUInt16LE(8))
  if (at('RIFF') && at('WEBP', 8) && buf.length >= 30) {
    if (at('VP8 ', 12)) return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff)
    if (at('VP8L', 12)) {
      const v = buf.readUInt32LE(21)
      return ok((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1)
    }
    if (at('VP8X', 12)) return ok(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1)
    return null
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) return null
      const marker = buf[o + 1]
      if (marker === 0xff) { o++; continue }
      const len = buf.readUInt16BE(o + 2)
      // A frame header (SOF0…SOF15, not DHT/JPG/DAC): height then width.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5))
      o += 2 + len
    }
  }
  return null
}

/** Width and height of an MP4 / MOV clip, from the header of its first picture track (moov › trak › tkhd), turned
 * when the track is rotated (a phone held upright); null for a WebM or a file that does not say. Reads box headers only. */
export function videoSize(fd: number, size: number): { w: number; h: number } | null {
  const head = Buffer.alloc(16)
  const box = (at: number): { type: string; start: number; end: number } | null => {
    if (at + 8 > size || fs.readSync(fd, head, 0, 16, at) < 8) return null
    let len = head.readUInt32BE(0), start = at + 8
    if (len === 1) { len = Number(head.readBigUInt64BE(8)); start = at + 16 } else if (len === 0) len = size - at
    return len >= start - at ? { type: head.toString('latin1', 4, 8), start, end: Math.min(size, at + len) } : null
  }
  const kids = function* (from: number, to: number) {
    for (let at = from, n = 0; at < to && n < 4096; n++) {
      const b = box(at)
      if (!b) return
      yield b
      at = b.end
    }
  }
  for (const top of kids(0, size)) {
    if (top.type !== 'moov') continue
    for (const trak of kids(top.start, top.end)) {
      if (trak.type !== 'trak') continue
      for (const t of kids(trak.start, trak.end)) {
        if (t.type !== 'tkhd') continue
        const body = Buffer.alloc(Math.min(96, t.end - t.start))
        fs.readSync(fd, body, 0, body.length, t.start)
        const v1 = body[0] === 1
        const m = v1 ? 52 : 40 // the matrix; width and height follow it, in 16.16
        if (body.length < m + 44) break
        const w = Math.round(body.readUInt32BE(m + 36) / 65536), h = Math.round(body.readUInt32BE(m + 40) / 65536)
        if (!(w > 0 && h > 0)) break // a sound track
        const turned = body.readInt32BE(m) === 0 && body.readInt32BE(m + 4) !== 0
        return turned ? { w: h, h: w } : { w, h }
      }
    }
    return null
  }
  return null
}

/**
 * One byte range of a file of `size` bytes, from a Range header. null: no usable range (absent, another unit,
 * several ranges, malformed) → the whole file with 200, as HTTP allows. 'unsatisfiable' → 416.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header)
  if (!m || (!m[1] && !m[2])) return null
  if (!m[1]) {
    // « -n »: the last n bytes.
    const n = Number(m[2])
    if (!n || !size) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (m[2] && end < start)) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/** Folders an agent's own machinery lives in: nothing cited from there is a result to show. */
const hidden = (seg: string) => seg === 'node_modules' || (seg.startsWith('.') && seg !== '.' && seg !== '..')

// A path-looking word ending with a media extension, or the same between backticks / quotes / link parentheses
// (where it may hold spaces).
const BARE = new RegExp(`[^\\s\`"'«»“”‘’<>()\\[\\]{}|*,;]+\\.(?:${EXTS})(?![\\w/]|[.-]\\w)`, 'gi') // i18n-ignore : motif de recherche (guillemets français), jamais affiché
const QUOTED = new RegExp(`(?:\`|"|“|«\\s?|\\]\\(<?)([^\`"“”«»\\n()<>]{1,400}?\\.(?:${EXTS}))(?=\\s?[\`"”»)>]|\\s+"[^"\\n]*"\\))`, 'gi') // i18n-ignore : motif de recherche (guillemets français), jamais affiché

/** Paths of images and videos cited in prose, in order of appearance, as written (not checked). */
export function citedPaths(text: string): string[] {
  const hits: { i: number; p: string }[] = []
  for (const m of text.matchAll(QUOTED)) {
    const p = m[1].trim()
    // Words between two quotes that merely end with a file name are prose, not a path with spaces.
    if (/\s/.test(p) && !m[0].startsWith('`') && !p.split(/\s/)[0].includes('/')) continue
    hits.push({ i: m.index + m[0].indexOf(p), p })
  }
  for (const m of text.matchAll(BARE)) {
    // Already inside a quoted hit (a path with spaces): keep the whole one.
    if (hits.some((h) => m.index >= h.i && m.index < h.i + h.p.length && h.p.length > m[0].length)) continue
    hits.push({ i: m.index, p: m[0] })
  }
  const out: string[] = []
  for (const h of hits.sort((a, b) => a.i - b.i)) {
    // « file=/x/a.png », « rendu:/x/a.png »: keep the path.
    if (h.p.includes('://')) continue
    const p = h.p.replace(/^[^/~]*[=:](?=[~/])/, '')
    if (out.includes(p)) continue
    out.push(p)
  }
  return out
}

let ffmpeg: boolean | undefined
/** ffmpeg is there to draw a clip's poster (asked once). */
export function canDrawPosters(): boolean {
  if (ffmpeg === undefined) {
    try {
      ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0
    } catch {
      ffmpeg = false
    }
  }
  return ffmpeg
}

export class MediaShelf {
  private file: string
  private roots: string[]
  private caps: Record<MediaType, number>
  private entries = new Map<string, ShelfEntry>()

  /** `caps` (bytes per type) only exists for the tests. */
  constructor(opts: { file: string; roots: string[]; caps?: Partial<Record<MediaType, number>> }) {
    this.file = opts.file
    this.roots = opts.roots.filter(Boolean).map((r) => path.resolve(r))
    this.caps = { ...CAPS, ...opts.caps }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { entries?: ShelfEntry[] }
      for (const e of raw.entries ?? []) {
        if (e && typeof e.id === 'string' && typeof e.path === 'string' && (e.type === 'image' || e.type === 'video')) this.entries.set(e.id, e)
      }
    } catch {
      // No shelf yet, or unreadable: start empty.
    }
  }

  /** Roots as they really are on disk (a root can be a symlink, or not exist yet). */
  private realRoots(): string[] {
    const out: string[] = []
    for (const r of this.roots) {
      try {
        out.push(fs.realpathSync(r))
      } catch {
        // Not there (no inbox yet).
      }
    }
    return out
  }

  private inside(real: string, roots: string[]): boolean {
    return roots.some((r) => real.startsWith(r.endsWith(path.sep) ? r : r + path.sep))
  }

  private absolute(p: string, cwd?: string): string | null {
    const s = p.trim()
    if (!s || s.includes('\0')) return null
    if (s === '~' || s.startsWith('~/')) return path.join(os.homedir(), s.slice(1))
    if (path.isAbsolute(s)) return path.resolve(s)
    return cwd && path.isAbsolute(cwd) ? path.resolve(cwd, s) : null
  }

  /** The first bytes of a file say what `type` promises. */
  private looksLike(file: string, type: MediaType): boolean {
    let fd: number | undefined
    try {
      fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(HEAD)
      const n = fs.readSync(fd, buf, 0, HEAD, 0)
      return sniff(buf.subarray(0, n)) === type
    } catch {
      return false
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  /** A media's pixel size, from its headers; null for a format that does not say it early (AVIF, WebM). */
  private sizeOf(file: string, type: MediaType): { w: number; h: number } | null {
    let fd: number | undefined
    try {
      fd = fs.openSync(file, 'r')
      if (type === 'video') return videoSize(fd, fs.fstatSync(fd).size)
      const buf = Buffer.alloc(SIZE_HEAD)
      const n = fs.readSync(fd, buf, 0, SIZE_HEAD, 0)
      return imageSize(buf.subarray(0, n))
    } catch {
      return null
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ entries: [...this.entries.values()] }), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch {
      // Disk full or read-only: the shelf stays in memory.
    }
  }

  /** `mockup`: the one asked for by `weevils show --mockup`; an unknown name is refused, none keeps the app's pick. */
  add(p: string, cwd?: string, mockup?: unknown): ShelfEntry {
    const t = tr(M)
    const abs = this.absolute(p, cwd)
    if (!abs) throw new MediaRefused('missing', t.missing)
    let real: string
    let st: fs.Stats
    try {
      real = fs.realpathSync(abs)
      st = fs.statSync(real)
    } catch {
      throw new MediaRefused('missing', t.missing)
    }
    // The jail is checked on the real path: a link inside a project that points elsewhere is elsewhere.
    if (!this.inside(real, this.realRoots())) throw new MediaRefused('outside', t.outside)
    if (!st.isFile()) throw new MediaRefused('notFile', t.notFile)
    const ext = extOf(real)
    const kind = EXT[ext]
    if (!kind) throw new MediaRefused('badType', t.badType)
    const cap = this.caps[kind.type]
    if (st.size > cap) throw new MediaRefused('tooBig', t.tooBig(Math.max(1, Math.floor(cap / (1024 * 1024)))))
    if (!this.looksLike(real, kind.type)) throw new MediaRefused('badHeader', t.badHeader(ext))
    if (mockup !== undefined && mockup !== '' && !isMockup(mockup)) throw new MediaRefused('badMockup', t.badMockup)

    const id = crypto.createHash('sha256').update(real).digest('hex').slice(0, 16)
    const size = this.sizeOf(real, kind.type)
    // Shown again without --mockup: the earlier choice for this file stays.
    const chosen = isMockup(mockup) ? mockup : this.entries.get(id)?.mockup
    const entry: ShelfEntry = { id, path: real, type: kind.type, bytes: st.size, mtime: Math.round(st.mtimeMs), name: path.basename(real), at: Date.now(), ...(size ?? { w: 0, h: 0 }), ...(chosen ? { mockup: chosen } : {}) }
    this.entries.delete(id)
    this.entries.set(id, entry)
    if (this.entries.size > MAX_ENTRIES) {
      const old = [...this.entries.values()].sort((a, b) => a.at - b.at).slice(0, this.entries.size - MAX_ENTRIES)
      for (const e of old) this.entries.delete(e.id)
    }
    this.save()
    if (entry.type === 'video') void this.measure(entry)
    return entry
  }

  private measuring = new Map<string, Promise<void>>()

  /** Looks once (per version of the clip) for a recorder's grey padding (paddedArea); the app then shows the picture
   *  part only, and the poster is cut to it. Never throws: no ffmpeg, an unreadable clip, the clip stays as it is. */
  measure(e: ShelfEntry): Promise<void> {
    if (e.type !== 'video' || e.areaOf === e.mtime || !canDrawPosters() || !e.w || !e.h) return Promise.resolve()
    const key = `${e.id}-${e.mtime}`
    const busy = this.measuring.get(key)
    if (busy) return busy
    const sh = Math.max(8, Math.round((PAD_SAMPLE_W * e.h) / e.w / 2) * 2)
    const frame = (seek: string[]) => new Promise<Buffer | null>((done) => {
      execFile('ffmpeg', ['-loglevel', 'error', ...seek, '-i', e.path, '-frames:v', '1', '-vf', `scale=${PAD_SAMPLE_W}:${sh}:flags=neighbor,format=rgb24`, '-f', 'rawvideo', '-'],
        { timeout: 20_000, encoding: 'buffer', maxBuffer: PAD_SAMPLE_W * sh * 3 + 1024 }, (err, out) => done(!err && out.length >= PAD_SAMPLE_W * sh * 3 ? out : null))
    })
    const job = (async () => {
      const buf = (await frame(['-ss', '1'])) ?? (await frame([]))
      const pad = buf ? paddedArea(buf, PAD_SAMPLE_W, sh) : null
      const cur = this.entries.get(e.id)
      if (!cur || cur.mtime !== e.mtime) return
      if (pad) cur.area = { w: Math.round(cur.w! * pad.fw), h: Math.round(cur.h! * pad.fh) }
      else delete cur.area
      cur.areaOf = e.mtime
      this.save()
    })().catch(() => {}).finally(() => this.measuring.delete(key))
    this.measuring.set(key, job)
    return job
  }

  /** A cited path is refused when it goes through a hidden folder below a root (.run, .work, .git, node_modules). */
  private hiddenBelowRoot(abs: string, roots: string[]): boolean {
    // Roots themselves may sit under a dot folder (~/.local/share/weevils): only what is below counts.
    const below = roots.filter((r) => abs.startsWith(r + path.sep)).sort((a, b) => a.length - b.length)[0]
    return below !== undefined && abs.slice(below.length).split(path.sep).some(hidden)
  }

  fromText(text: string, cwd: string | undefined, max = 4): ShelfEntry[] {
    const out: ShelfEntry[] = []
    try {
      const real = this.realRoots()
      const roots = [...new Set([...this.roots, ...real])]
      // Bounded: a message listing a hundred frames costs forty stats, not a hundred.
      for (const cited of citedPaths(String(text ?? '')).slice(0, 40)) {
        if (out.length >= max) break
        for (const candidate of cited.includes('%') ? [cited, decoded(cited)] : [cited]) {
          const abs = this.absolute(candidate, cwd)
          if (!abs) continue
          try {
            if (this.hiddenBelowRoot(abs, roots) || this.hiddenBelowRoot(fs.realpathSync(abs), real)) break
            const e = this.add(abs)
            if (!out.some((o) => o.id === e.id)) out.push(e)
            break
          } catch {
            // Not there, not ours, not a media: not cited for the stream.
          }
        }
      }
    } catch {
      // Never breaks the turn that ends.
    }
    return out
  }

  get(id: string): ShelfEntry | null {
    const e = this.entries.get(id)
    if (!e) return null
    try {
      // Still the same real file (a link swapped in its place would leave the jail), still that kind of media.
      const st = fs.statSync(e.path)
      if (!st.isFile() || fs.realpathSync(e.path) !== e.path || st.size > this.caps[e.type]) throw new Error()
      const mtime = Math.round(st.mtimeMs)
      if (st.size !== e.bytes || mtime !== e.mtime) {
        if (!this.looksLike(e.path, e.type)) throw new Error()
        e.bytes = st.size
        e.mtime = mtime
        Object.assign(e, this.sizeOf(e.path, e.type) ?? { w: 0, h: 0 })
        this.save()
      } else if (e.w === undefined) {
        // Registered before sizes were kept: read once (0 × 0: its header does not say, never read again).
        Object.assign(e, this.sizeOf(e.path, e.type) ?? { w: 0, h: 0 })
        this.save()
      }
      return e
    } catch {
      this.entries.delete(id)
      this.save()
      return null
    }
  }

  /** Every entry whose file is still there, newest first (the gone ones are dropped). */
  list(): ShelfEntry[] {
    return [...this.entries.keys()]
      .map((id) => this.get(id))
      .filter((e): e is ShelfEntry => !!e)
      .sort((a, b) => b.at - a.at)
  }

  view(e: ShelfEntry): ForYouMedia {
    const url = '/api/foryou/media/' + e.id
    // A clip registered before the padding check, or changed since: looked at now, shown whole until then.
    if (e.type === 'video' && e.areaOf !== e.mtime) void this.measure(e)
    const area = e.area && e.areaOf === e.mtime && e.w && e.h ? { area: e.area } : {}
    return { id: e.id, type: e.type, url, name: e.name, bytes: e.bytes, ...(e.w && e.h ? { w: e.w, h: e.h } : {}), ...area, ...(e.mockup ? { mockup: e.mockup } : {}), ...(e.type === 'video' && canDrawPosters() ? { poster: url + '/poster' } : {}) }
  }

  private drawing = new Map<string, Promise<string | null>>()

  /** A clip's first frame as a JPEG, drawn once by ffmpeg into <shelf dir>/foryou-posters and drawn again when the clip
   *  changes; null when it cannot be (no ffmpeg, not a clip, a file ffmpeg cannot read). */
  poster(id: string): Promise<string | null> {
    const e = this.get(id)
    if (!e || e.type !== 'video' || !canDrawPosters()) return Promise.resolve(null)
    // The padding check first: the poster shows the picture part only, as the clip does.
    if (e.areaOf !== e.mtime) return this.measure(e).then(() => (this.entries.get(id)?.areaOf === e.mtime ? this.poster(id) : this.drawPoster(e)))
    return this.drawPoster(e)
  }

  private drawPoster(e: ShelfEntry): Promise<string | null> {
    const dir = path.join(path.dirname(this.file), 'foryou-posters')
    const area = e.area && e.areaOf === e.mtime ? e.area : undefined
    const out = path.join(dir, `${e.id}-${e.mtime}${area ? `-${area.w}x${area.h}` : ''}.jpg`)
    if (fs.existsSync(out)) return Promise.resolve(out)
    const busy = this.drawing.get(out)
    if (busy) return busy
    const draw = (seek: string[]) => new Promise<boolean>((done) => {
      const tmp = `${out}.${process.pid}.tmp.jpg`
      execFile('ffmpeg', ['-loglevel', 'error', '-y', ...seek, '-i', e.path, '-frames:v', '1', '-vf', `${area ? `crop=${area.w}:${area.h}:0:0,` : ''}scale='min(720,iw)':-2`, '-q:v', '4', tmp], { timeout: 20_000 }, (err) => {
        try {
          if (!err && fs.statSync(tmp).size > 0) {
            fs.renameSync(tmp, out)
            return done(true)
          }
        } catch {}
        fs.rmSync(tmp, { force: true })
        done(false)
      })
    })
    const job = (async () => {
      try {
        fs.mkdirSync(dir, { recursive: true })
        // The older frames of this clip go.
        for (const f of fs.readdirSync(dir)) if (f.startsWith(e.id + '-') && path.join(dir, f) !== out) fs.rmSync(path.join(dir, f), { force: true })
      } catch {
        return null
      }
      // One second in (past a fade from black or a loading screen), else the very first frame (a shorter clip).
      return (await draw(['-ss', '1'])) || (await draw([])) ? out : null
    })().finally(() => this.drawing.delete(out))
    this.drawing.set(out, job)
    return job
  }

  async servePoster(res: ServerResponse, id: string): Promise<void> {
    const file = await this.poster(id)
    if (!file) return void res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: tr(M).gone }))
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' })
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
  }

  /** download: « Content-Disposition: attachment » (a save, where no share sheet exists); otherwise inline, named too. */
  serve(req: IncomingMessage, res: ServerResponse, id: string, download = false): void {
    const gone = () => {
      if (res.headersSent) return void res.destroy()
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: tr(M).gone }))
    }
    const e = this.get(id)
    if (!e) return gone()
    let fd: number
    let size: number
    try {
      // Size and bytes from the same open file: the length announced is the length sent.
      fd = fs.openSync(e.path, 'r')
      const st = fs.fstatSync(fd)
      if (!st.isFile()) {
        fs.closeSync(fd)
        return gone()
      }
      size = st.size
    } catch {
      return gone()
    }
    const headers: Record<string, string | number> = {
      'content-type': mimeOf(e.path) ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-disposition': disposition(e.name, e.id, download),
    }
    const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, size)
    if (range === 'unsatisfiable') {
      fs.closeSync(fd)
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': 0 }).end()
      return
    }
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    headers['content-length'] = end - start + 1
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD' || end < start) {
      fs.closeSync(fd)
      res.end()
      return
    }
    const stream = fs.createReadStream('', { fd, start, end, autoClose: true })
    // Headers are gone already: a read error can only cut the response short.
    stream.on('error', () => res.destroy())
    // The player went away (seek, page closed): stop reading.
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  }
}

function decoded(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
