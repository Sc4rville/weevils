import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ForYouItem, ForYouMedia } from '../shared/foryou.ts'
import type { MediaShelf } from './foryou-media.ts'

// What one person reviewed by hand for their own feed: a verified result that leads its card, captions for known
// media, examples for the formats page, wordings corrected against their source, proposals tied to the request that
// already covers them. It names that person's projects, sessions and files, so it lives in the instance's data,
// <foryou.json>.reviewed.json, never in the product. No file: nothing is reviewed, the feed is shown as recorded.

/** A text in the app's languages ({ en, fr }); a plain string is the same in all of them. */
export type Text = string | Partial<Record<string, string>>

/** One verified result: the card it stands on, the finished file that leads it once its hash checks, and which media
 * are views of the same piece. "final" is render quality, not the person's approval. */
export interface ResultSpec {
  key: string
  /** The feed item the group stands on. */
  anchor: string
  projectId?: string
  sessionId?: string
  title?: Text
  intro?: Text
  /** The finished file, relative to the anchor's working folder, and when it was verified. */
  final?: { file: string; sha256: string; at: number }
  /** The media of this piece: by id, or by a pattern on their file name. Never by a caption's words. */
  media?: { ids?: string[]; names?: string }
  /** Names for the anchor's other media, by file name. */
  otherTitles?: Record<string, Text>
}
export interface EditorialEdit { id: string; kind: string; source: string; text: string }
export interface IntentLink { cardId: string; actionId: string; brief: string; sessionId: string; messageId: string; intentId: string }
export interface Reviewed {
  results: ResultSpec[]
  captions: Record<string, { title: Text; description: Text }>
  /** Media ids the formats page shows first, when they are still in the feed. */
  examples: { result?: string; clip?: string; poster?: string }
  editorial: EditorialEdit[]
  intents: IntentLink[]
}
export const NOTHING_REVIEWED: Reviewed = { results: [], captions: {}, examples: {}, editorial: [], intents: [] }

const str = (v: unknown): v is string => typeof v === 'string' && !!v
const list = <T>(v: unknown, ok: (x: any) => boolean): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && ok(x)) : [])
const loaded = new Map<string, { stamp: string; value: Reviewed; at: number }>()

/** Read again only when the file changed, and looked at no more than once every `every` ms (the feed asks for each
 * item). A missing or broken file reviews nothing. */
export function loadReviewed(file: string, every = 2000): Reviewed {
  const hit = loaded.get(file)
  const now = Date.now()
  if (hit && now - hit.at < every) return hit.value
  let st: fs.Stats | undefined
  try { st = fs.statSync(file, { throwIfNoEntry: false }) } catch { /* unreadable: nothing reviewed */ }
  const stamp = st ? `${st.size}:${st.mtimeMs}` : ''
  if (hit?.stamp === stamp) { hit.at = now; return hit.value }
  let value = NOTHING_REVIEWED
  if (!st) { loaded.set(file, { stamp, value, at: now }); return value }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>
    value = {
      results: list<ResultSpec>(raw.results, (r) => str(r.key) && str(r.anchor)),
      captions: raw.captions && typeof raw.captions === 'object' ? raw.captions : {},
      examples: raw.examples && typeof raw.examples === 'object' ? raw.examples : {},
      editorial: list<EditorialEdit>(raw.editorial, (e) => str(e.id) && str(e.kind) && str(e.source) && str(e.text)),
      intents: list<IntentLink>(raw.intents, (l) => str(l.cardId) && str(l.actionId) && str(l.brief) && str(l.sessionId) && str(l.messageId) && str(l.intentId)),
    }
  } catch { /* broken file: nothing reviewed, the recorded feed stays */ }
  loaded.set(file, { stamp, value, at: now })
  return value
}

export const say = (text: Text | undefined, lang: string): string | undefined =>
  typeof text === 'string' ? text || undefined : text ? text[lang] || text.en || Object.values(text).find(str) : undefined

type Shelf = Pick<MediaShelf, 'get' | 'add' | 'view'>
const verified = new Map<string, { stamp: string; valid: boolean }>()

/** The finished file of a result, only while its bytes are the verified ones. */
export function resultFinal(spec: ResultSpec, shelf: Shelf | null, cwd: string | undefined): ForYouMedia | undefined {
  if (!shelf || !cwd || !spec.final || !str(spec.final.file) || !str(spec.final.sha256)) return
  const file = path.resolve(cwd, spec.final.file)
  if (!file.startsWith(path.resolve(cwd) + path.sep)) return
  try {
    const stat = fs.statSync(file)
    const stamp = `${spec.final.sha256}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    let check = verified.get(file)
    if (check?.stamp !== stamp) {
      check = { stamp, valid: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === spec.final.sha256 }
      verified.set(file, check)
    }
    // A replacement or regression must never silently inherit verified-final status.
    if (check.valid) return shelf.view(shelf.add(file))
  } catch { /* Missing final: keep the card and its source history. */ }
}

/** Only the reviewed piece and exact media updates of it from its source session.
 * No keyword grouping: a caption mentioning the piece is not an update of it.
 * Never mutates source records, IDs, actions, timestamps, read state or media arrays. */
export function groupResult(items: ForYouItem[], spec: ResultSpec, final?: ForYouMedia, lang = 'en'): ForYouItem[] {
  const anchor = items.find(i => i.id === spec.anchor)
  const same = (i: ForYouItem) => (!spec.projectId || i.projectId === spec.projectId) && (!spec.sessionId || i.sessionId === spec.sessionId)
  if (!anchor || !same(anchor)) return items
  const ids = new Set(spec.media?.ids ?? [])
  let names: RegExp | undefined
  try { names = spec.media?.names ? new RegExp(spec.media.names) : undefined } catch { /* a broken pattern matches nothing */ }
  const isPiece = (m: ForYouMedia) => ids.has(m.id) || m.id === final?.id || !!names?.test(m.name)
  const related = items.filter(i => i.kind === 'media' && same(i) && (i.id === anchor.id || (!!i.media?.length && i.media.every(isPiece))))
  const groupedIds = new Set(related.map(i => i.id))
  const history = related.map(i => ({ ...i, resultGroup: undefined, media: (i.media ?? []).filter(isPiece) }))
    .sort((a,b) => b.at - a.at)
  const finalAt = spec.final?.at ?? anchor.at
  const otherTitles = Object.fromEntries(Object.entries(spec.otherTitles ?? {}).flatMap(([name, text]) => { const t = say(text, lang); return t ? [[name, t]] : [] }))
  const result: ForYouItem = { ...anchor, resultGroup: {
    key: spec.key, title: say(spec.title, lang), intro: say(spec.intro, lang), final, finalAt, history,
    otherMedia: (anchor.media ?? []).filter(m => !isPiece(m)),
    otherTitles: Object.keys(otherTitles).length ? otherTitles : undefined,
    newerUpdate: related.some(i => i.id !== anchor.id && i.at > finalAt),
  } }
  return items.flatMap(i => i.id === anchor.id ? [result] : groupedIds.has(i.id) ? [] : [i])
}
