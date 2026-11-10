// « For you »: the stream next to weevboss (docs/foryou.md, contract in shared/foryou.ts). Main machine only.
//
// Two sorts of items:
// - recorded (kept in DATA_DIR/foryou.json, mode 600, capped): what a session just did, asks or why it stopped (one
//   item per session, replaced by its next turn), the mails of outside authors, weevboss's posts (« weevils post »),
//   the files an agent shows (« weevils show »), and later what the curator generates (add());
// - live (computed at each read, never stored): alerts — a usage window nearly full, a saturated machine or a full
//   disk, a failed auto task, a machine offline — and the one « proposals » item (auto tasks waiting for a yes, tips
//   that carry an action). They leave with their cause; only their seen / dismissed state is kept, by id.
//
// The snapshot carries { rev, unseen } only (mark()); the app reads the stream with GET /api/foryou when rev changes.
// A tap on a button or a card removes the item (or the card): an action is done once.

import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import type { InterruptReason, Message, Session, SessionDetail, Snapshot } from '../shared/api.ts'
import type { ForYouAction, ForYouCard, ForYouFeed, ForYouGauge, ForYouItem, ForYouKind, ForYouMark, ForYouMedia, ForYouPulse, ForYouTone } from '../shared/foryou.ts'
import { isLang } from '../shared/i18n.ts'
import type { Level, UsageInfo } from '../shared/infra.ts'
import { DATA_DIR, MACHINE } from './config.ts'
import type { MediaShelf } from './foryou-media.ts'
import { isLocal, trustedFrom } from './http.ts'
import { lang, tr, withLang, type Lang } from './i18n.ts'
import CM from './i18n/core.ts'
import M from './i18n/foryou.ts'
import { actOn, personalTips, type Found, type TipInput } from './tips.ts'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

// ---------------------------------------------------------------- limits

export const MAX_ITEMS = 400
export const KEEP_MS = 14 * 24 * 3600_000
/** What GET /api/foryou returns at most. */
export const MAX_FEED = 60
export const TEXT_MAX = 600
export const POST_MAX = 1200
export const MAIL_LINE_MAX = 140
export const MAIL_BODY_MAX = 12_000
export const MAX_ACTIONS = 3
/** Files shown by the same session within this delay join one item, up to MAX_MEDIA. */
export const MEDIA_JOIN_MS = 2 * 60_000
export const MAX_MEDIA = 6
/** Files cited in the message that ends a turn: at most this many. */
export const CITED_MAX = 4
export const MAX_CARDS = 4
/** A usage window at this percentage or more is an alert. */
export const USAGE_ALERT = 85
export const DISK_ALERT = 90
/** A machine is said saturated after this many measures in a row at the critical level (one peak is not an alert). */
export const HOT_SAMPLES = 2
/** A machine offline for less than this is a hiccup of the tunnel. */
export const OFFLINE_AFTER_MS = 2 * 60_000
export const FAILED_KEEP_MS = 24 * 3600_000
/** Usage and machine measures: refreshed in the background, this often while the app looks at the stream, else rarely. */
export const REFRESH_MS = 5 * 60_000
export const REFRESH_IDLE_MS = 30 * 60_000
/** The app « looks » for this long after its last GET /api/foryou (also read by the curator). */
export const WANTED_MS = 30 * 60_000
/** The state of a live item whose cause left is forgotten after this (a new episode is a new item). */
export const LIVE_FORGET_MS = 6 * 3600_000
/** The transcript may trail the end of the turn by a scan: the result is read again after this. */
export const REFINE_MS = 4000

// ---------------------------------------------------------------- order and pace (plan §2.3)

/** Weight of each sort of item: what needs the user first, then what was delivered, then what can wait. */
export const WEIGHT = { alert: 10, question: 8, cut: 7, mail: 5, result: 4, boss: 3.5, proposals: 3, media: 2.5, improve: 2, insight: 1.5, milestone: 1.5, stat: 1.5 } as const
/** Freshness halves every six hours. */
export const HALF_LIFE_MS = 6 * 3600_000
/** A question or a cut is still current while its item is shown: no decay for a day. */
export const PIN_MS = 24 * 3600_000
/** An item already seen counts for this share of its score: unseen first, but a fresh seen item beats a stale unseen one. */
export const SEEN_FACTOR = 0.35
/** An unseen media younger than this opens the stream (after the alerts). */
export const FRESH_MEDIA_MS = 2 * 3600_000
/** The proposals sit at this index of the stream below the alerts: third place. */
export const PROPOSALS_SLOT = 2
/** One insight, milestone or stat after this many other items. */
export const DEEP_GAP = 4

const isDeep = (i: ForYouItem) => i.kind === 'insight' || i.kind === 'milestone' || i.kind === 'stat'
const waits = (i: ForYouItem) => i.kind === 'session' && (i.tone === 'question' || i.tone === 'alert')

/** Score of an item: weight × freshness, lowered once seen. */
export function score(i: ForYouItem, now: number): number {
  const w = i.kind === 'session' ? (i.tone === 'question' ? WEIGHT.question : i.tone === 'alert' ? WEIGHT.cut : WEIGHT.result) : WEIGHT[i.kind]
  const age = Math.max(0, now - i.at)
  const fresh = i.kind === 'alert' || (waits(i) && age < PIN_MS) ? 1 : 0.5 ** (age / HALF_LIFE_MS)
  return w * fresh * (i.seen ? SEEN_FACTOR : 1)
}

const pairs = (list: ForYouItem[]) => list.reduce((n, x, i) => n + (i > 0 && list[i - 1].kind === x.kind ? 1 : 0), 0)

/**
 * The body of the stream (everything but the alerts), best score first, paced: never two items of the same kind in a
 * row when another order avoids it (a kind that fills more than half of what is left goes now), the proposals at
 * their slot, an insight or a milestone only every DEEP_GAP items.
 */
function pace(sorted: ForYouItem[], lead?: ForYouItem): ForYouItem[] {
  let proposals = sorted.find((i) => i.kind === 'proposals')
  const rest = sorted.filter((i) => i !== proposals)
  const out: ForYouItem[] = []
  let sinceDeep = 0
  const take = (x: ForYouItem) => {
    rest.splice(rest.indexOf(x), 1)
    out.push(x)
    sinceDeep = isDeep(x) ? 0 : sinceDeep + 1
  }
  if (lead) take(lead)
  while (rest.length || proposals) {
    if (proposals && (out.length === PROPOSALS_SLOT || !rest.length)) {
      out.push(proposals)
      proposals = undefined
      sinceDeep++
      continue
    }
    const prev = out[out.length - 1]?.kind
    const plain = rest.filter((x) => !isDeep(x))
    const due = sinceDeep >= DEEP_GAP || !plain.length
    const open = due ? rest : plain
    const differ = open.filter((x) => x.kind !== prev)
    if (!differ.length) {
      take(open[0])
      continue
    }
    const counts = new Map<ForYouKind, number>()
    for (const x of open) counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1)
    const crowded = [...counts].find(([k, n]) => n * 2 > open.length && k !== prev)?.[0]
    const deep = due ? differ.find(isDeep) : undefined
    take(crowded ? open.find((x) => x.kind === crowded)! : (deep ?? differ[0]))
  }
  return out
}

/**
 * The order of the stream. Pure and deterministic: alerts on top, then a fresh unseen media when there is one (unless
 * leading with it would put two items of a kind side by side that another order keeps apart), then the rest by score,
 * paced (see pace()). Equal scores: newest first, then by id.
 */
export function arrange(items: ForYouItem[], now: number): ForYouItem[] {
  const scored = items.map((item) => ({ item, s: score(item, now) }))
  scored.sort((a, b) => b.s - a.s || b.item.at - a.item.at || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
  const sorted = scored.map((x) => x.item)
  const head = sorted.filter((i) => i.kind === 'alert')
  const body = sorted.filter((i) => i.kind !== 'alert')
  const lead = body.find((i) => i.kind === 'media' && !i.seen && now - i.at < FRESH_MEDIA_MS)
  const plain = pace(body)
  if (!lead) return [...head, ...plain]
  const led = pace(body, lead)
  return [...head, ...(pairs(led) <= pairs(plain) ? led : plain)]
}

// ---------------------------------------------------------------- texts

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** What Claude Code writes at the top of a compacted conversation, and its note before replayed commands: not the agent's words. */
const PREAMBLE = /^\s*(?:This session is being continued from a previous conversation|Caveat: The messages below were generated by the user)/i

/** The last thing the agent said in a thread, whole (compaction preambles skipped), or undefined. */
export function lastWords(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const text = m.text.trim()
    if (text && !PREAMBLE.test(text)) return text
  }
  return undefined
}

const GREETING = /^(?:hi|hello|hey|dear|bonjour|bonsoir|salut|coucou|hola)\b[^.!?]{0,40}[,!.]?$/i

/** First line of a mail that says something: not a greeting, not a quote, not a separator. */
export function firstLine(text: string, max = MAIL_LINE_MAX): string {
  const lines = text.split(/\r?\n/).map(collapse).filter((l) => /\p{L}/u.test(l) && !l.startsWith('>'))
  return clip(lines.find((l) => !GREETING.test(l)) ?? lines[0] ?? '', max)
}

// ---------------------------------------------------------------- what the stream needs from the rest

/** The part of Weevils (server/core.ts) the stream uses; a plain object in the tests. */
export interface ForYouHost {
  snapshot(): Snapshot
  bump(): void
  detailAny(id: string): Promise<SessionDetail | undefined>
  send(id: string, text: string, from?: string): Promise<{ id: string }>
  sendMain(text: string, brief?: string): Promise<{ id: string }>
  resume(id: string): Promise<{ id: string }>
  close(id: string): Promise<unknown>
  orchestratorId: string | null
  store?: { get(id: string): { firstPrompt?: string; headless?: boolean; originator?: string } | undefined }
}

/** One machine as the alerts need it. disk: used share in %, when known. */
export interface MachineState {
  id: string
  name: string
  level: Level
  disk?: number
}

/** The mail bridge's way out (MailBridge.write), absent when the bridge is not configured. false: nothing was sent. */
export interface MailOut {
  write(o: { to: string; subject: string; text: string; inReplyTo: string; author: string; target: string }): Promise<boolean>
}

/** What MailBridge.dispatch tells the stream (BridgeDeps.mailed). target: « weevboss » or a session id. */
export interface MailIn {
  author: string
  subject: string
  text: string
  target: string
  mid: string
  address: string
}

/** The curator (server/foryou-curator.ts, a later step) plugs in here: the longer answer behind « more ». */
export interface ForYouCurator {
  more(item: ForYouItem): Promise<string>
}

export interface ForYouDeps {
  /** Default DATA_DIR/foryou.json. */
  file?: string
  now?: () => number
  /** The registered media (server/foryou-media.ts); without it « weevils show » is refused. */
  shelf?: Pick<MediaShelf, 'add' | 'fromText' | 'get' | 'view' | 'serve'> | null
  /** Sessions under this folder are weevils' own (default DATA_DIR). */
  dataDir?: string
  /** Id of this machine (default MACHINE.id): only its sessions have their files here. */
  machineId?: string
  /** core.ts isTestBrief: a brief that starts with [test] never enters the stream. */
  isTestBrief?: (prompt?: string) => boolean
  /** The auto band (accept / refuse of a proposed task): the methods the /api/optimizers routes call. */
  optimizers?: () => { accept(id: string): boolean; refuse(id: string): boolean } | null
  /** What the personal tips are computed from (the same input as GET /api/tips), built without waiting. */
  tips?: (snap: Snapshot, now: number) => TipInput | null
  /** usage.ts quotas(): asked in the background, never on the way of a request. */
  quotas?: () => Promise<UsageInfo>
  /** Level and disk of each machine: asked in the background too. */
  machines?: () => Promise<MachineState[]>
  mail?: () => MailOut | null
  /** The voice a speaker's words are read in (ForYouItem.voice), undefined when this server cannot speak. */
  voiceOf?: (who: string) => string | undefined
  /** Runs fn after ms (default: an unref'd timer). */
  later?: (fn: () => void, ms: number) => void
}

// ---------------------------------------------------------------- the store

/** A recorded item. Everything the app may read is copied field by field in view(): the rest never leaves. */
interface Stored {
  id: string
  kind: ForYouKind
  tone: ForYouTone
  at: number
  who: string
  projectId?: string
  sessionId?: string
  tool?: Session['tool']
  title?: string
  text: string
  body?: string
  reply?: ForYouItem['reply']
  open?: ForYouItem['open']
  more?: boolean
  moreText?: string
  gauges?: ForYouGauge[]
  seen?: boolean
  /** Dismissed or acted on: kept (a session's next turn revives its item), never shown. */
  gone?: boolean
  /** Generated items: the language they were written in (hidden when the app reads another one). */
  lang?: Lang
  /** When it was written (a cut is the same episode while the session did nothing since). */
  rec?: number
  /** session, tone alert: why it was cut (put in words at read time, in the reader's language). */
  cut?: InterruptReason
  /** Ids on the media shelf. */
  mediaIds?: string[]
  /** media: where the caller stood (files of one place join one item). */
  cwd?: string
  /** Buttons: the brief goes to weevboss on a tap. */
  actions?: { id: string; label: string; brief: string }[]
  /** mail: what a reply needs. The address stays here. */
  mail?: { address: string; mid: string; subject: string; target: string }
}

interface LiveState {
  /** First seen (the item's date when its cause has none). */
  at: number
  /** Last read where the cause was there. */
  last: number
  seen?: boolean
  gone?: boolean
  /** proposals: the cards it had, to notice a new one. */
  cards?: string[]
}

interface State {
  /** Bumped at every visible change. */
  rev: number
  items: Stored[]
  live: Record<string, LiveState>
  /** Cards already accepted or refused: id → when. They never come back. */
  cards: Record<string, number>
  /** What was visible at the last read (ids), to notice that a live item came or left. */
  sig: string
  /** Turns delivered today. */
  delivered: { day: string; n: number }
}

/** What the curator may add: a generated item, in the language it was written in. */
export interface NewItem {
  /** Stable id to replace an earlier item of the same subject (else a new one). */
  id?: string
  kind: 'boss' | 'improve' | 'insight' | 'milestone' | 'stat'
  tone?: ForYouTone
  who?: string
  projectId?: string
  title?: string
  text: string
  more?: boolean
  gauges?: ForYouGauge[]
  open?: ForYouItem['open']
  actions?: { label: string; brief: string }[]
  lang?: Lang
}

const day = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
const newId = (prefix: string) => `${prefix}:${crypto.randomBytes(6).toString('hex')}`

export class ForYou {
  readonly w: ForYouHost
  readonly file: string
  /** Last time the app asked for the stream (0: never since the start). */
  lastWanted = 0
  /** Set by the curator when it exists. */
  curator: ForYouCurator | null = null
  private deps: ForYouDeps
  private s: State
  private now: () => number
  private dataDir: string
  private machineId: string
  /** changed() already counted a revision: the next read does not count the same change again. */
  private dirty = false
  private usage: UsageInfo | null = null
  private machines: MachineState[] = []
  /** Measures in a row at the critical level, per machine. */
  private hot = new Map<string, number>()
  private offSince = new Map<string, number>()
  private refreshedAt = 0
  private refreshing = false

  constructor(w: ForYouHost, deps: ForYouDeps = {}) {
    this.w = w
    this.deps = deps
    this.file = deps.file ?? path.join(DATA_DIR, 'foryou.json')
    this.now = deps.now ?? Date.now
    this.dataDir = deps.dataDir ?? DATA_DIR
    this.machineId = deps.machineId ?? MACHINE.id
    this.s = (() => {
      const empty: State = { rev: 0, items: [], live: {}, cards: {}, sig: '', delivered: { day: '', n: 0 } }
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<State>
        const items = (Array.isArray(raw.items) ? raw.items : []).filter((i) => i && typeof i.id === 'string' && typeof i.kind === 'string' && typeof i.text === 'string' && typeof i.at === 'number')
        const obj = <T>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {})
        return {
          rev: Number(raw.rev) || 0,
          items,
          live: obj<LiveState>(raw.live),
          cards: obj<number>(raw.cards),
          sig: typeof raw.sig === 'string' ? raw.sig : '',
          delivered: raw.delivered && typeof raw.delivered.day === 'string' ? { day: raw.delivered.day, n: Number(raw.delivered.n) || 0 } : empty.delivered,
        }
      } catch {
        return empty
      }
    })()
  }

  get shelf() {
    return this.deps.shelf ?? null
  }

  // ---------------------------------------------------------------- writing

  private save() {
    const now = this.now()
    this.s.items = this.s.items.filter((i) => now - i.at < KEEP_MS)
    if (this.s.items.length > MAX_ITEMS) this.s.items = [...this.s.items].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS)
    for (const [id, at] of Object.entries(this.s.cards)) if (now - at > 6 * KEEP_MS) delete this.s.cards[id]
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      // Mail bodies and results live here: readable by the user only.
      fs.writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error(`[foryou] écriture : ${(e as Error).message}`)
    }
  }

  /** Something visible changed: a new revision, saved, and the snapshot rebuilt (not from inside its own build). */
  private changed(bump = true) {
    this.s.rev++
    this.dirty = true
    this.save()
    if (bump) this.w.bump()
  }

  private put(item: Stored) {
    const i = this.s.items.findIndex((x) => x.id === item.id)
    if (i >= 0) this.s.items[i] = item
    else this.s.items.push(item)
  }

  private get(id: string) {
    return this.s.items.find((i) => i.id === id)
  }

  /** An item the user can still act on: recorded and not dismissed, or live. */
  has(id: string): boolean {
    const i = this.get(id)
    return i ? !i.gone : id in this.s.live
  }

  // ---------------------------------------------------------------- sessions

  /** A session of work the user follows: not a test, not a one-shot call of a script, not weevils' own, not weevboss. */
  eligible(s: Session): boolean {
    if (s.origin === 'headless' || s.id === this.w.orchestratorId) return false
    if (s.cwd && (s.cwd === this.dataDir || s.cwd.startsWith(this.dataDir + path.sep))) return false
    const t = this.w.store?.get(s.id)
    if (t?.headless || t?.originator === 'codex_exec') return false
    const test = this.deps.isTestBrief ?? ((p?: string) => !!p && /^\s*\[test\]/.test(p))
    // A session of another machine has no transcript here: its title still starts with the brief.
    return !test(t?.firstPrompt) && !test(s.title)
  }

  private sessionItem(s: Session, over: Pick<Stored, 'tone' | 'text' | 'at'> & Partial<Stored>): Stored {
    return { id: `s:${s.id}`, kind: 'session', who: 'session', projectId: s.projectId, sessionId: s.id, tool: s.tool, title: s.title, reply: 'session', open: { page: 'session', id: s.id }, rec: this.now(), ...over }
  }

  /**
   * Called by core.ts where it already sees a session change: a turn that ended (result), a session that starts
   * waiting (question), a cut (cut). One item per session: the newest replaces the previous one, unseen again.
   */
  sessionTurn(s: Session, what: 'result' | 'question' | 'cut') {
    if (!this.eligible(s)) return
    if (what === 'result') {
      void this.result(s, true).catch((e) => console.error(`[foryou] ${s.id.slice(0, 8)} : ${(e as Error).message}`))
      // The transcript is read every 1.5 s: the last words of the turn may not be there yet.
      const later = this.deps.later ?? ((fn, ms) => void setTimeout(fn, ms).unref?.())
      later(() => void this.result(s, false).catch(() => undefined), REFINE_MS)
    } else if (this.waiting(s, what, true)) this.changed()
  }

  /** Records a question or a cut unless the item already says it. true when written. */
  private waiting(s: Session, what: 'question' | 'cut', fromCore = false): boolean {
    const cur = this.get(`s:${s.id}`)
    const now = this.now()
    if (what === 'question') {
      const text = clip(collapse(s.attention ?? ''), TEXT_MAX)
      if (cur?.tone === 'question' && cur.text === text) return false
      this.put(this.sessionItem(s, { tone: 'question', text, at: fromCore ? now : Math.min(now, s.lastActivityAt || now) }))
      return true
    }
    // The same episode while the session did nothing since it was written (its time may have been refined).
    if (cur?.tone === 'alert' && s.lastActivityAt <= (cur.rec ?? cur.at) + 30_000) return false
    this.put(this.sessionItem(s, { tone: 'alert', text: '', cut: s.interrupted?.reason ?? 'died', at: Math.min(now, s.interrupted?.at ?? now) }))
    return true
  }

  /** The words that end the turn (the transcript, here or on the session's machine), and the files they cite. */
  private async result(s: Session, first: boolean) {
    const cur0 = this.get(`s:${s.id}`)
    // Read again later: only to complete the result written a moment ago.
    if (!first && cur0?.tone !== 'result') return
    const detail = await this.w.detailAny(s.id).catch(() => undefined)
    const raw = (detail && lastWords(detail.messages)) ?? ''
    const text = clip(collapse(raw || (first ? (s.lastMessage ?? '') : '')), TEXT_MAX)
    if (!text) return
    const local = s.machineId === this.machineId
    const mediaIds = raw && local && this.shelf ? this.shelf.fromText(raw, s.cwd || undefined, CITED_MAX).map((e) => e.id) : []
    const cur = this.get(`s:${s.id}`)
    const same = cur?.tone === 'result' && cur.text === text && (cur.mediaIds ?? []).join() === mediaIds.join()
    if (same) return
    if (!first) {
      // Same turn, better words: the item keeps its place and its seen state.
      if (cur?.tone !== 'result') return
      cur.text = text
      if (mediaIds.length) cur.mediaIds = mediaIds
      else delete cur.mediaIds
      return this.changed()
    }
    const now = this.now()
    this.put(this.sessionItem(s, { tone: 'result', text, at: now, ...(mediaIds.length ? { mediaIds } : {}) }))
    const d = day(now)
    this.s.delivered = { day: d, n: this.s.delivered.day === d ? this.s.delivered.n + 1 : 1 }
    this.changed()
  }

  // ---------------------------------------------------------------- mail, posts, media, generated

  /** A mail of an outside author, at dispatch (BridgeDeps.mailed). The user's own mails are not news to them. */
  mail(m: MailIn) {
    if (!m.author || !m.text.trim()) return
    const id = `m:${crypto.createHash('sha1').update(m.mid).digest('hex').slice(0, 12)}`
    const boss = m.target === 'weevboss' || !m.target
    const s = boss ? undefined : this.w.snapshot().sessions.find((x) => x.id === m.target)
    const mail = { address: m.address, mid: m.mid, subject: m.subject, target: m.target || 'weevboss' }
    const cur = this.get(id)
    if (cur) {
      // Dispatch tells again once the session exists: same mail, its target now known.
      cur.mail = mail
      cur.sessionId = s?.id
      cur.projectId = s?.projectId
      cur.open = boss ? { page: 'boss' } : { page: 'session', id: m.target }
      return this.changed()
    }
    this.put({
      id,
      kind: 'mail',
      tone: 'neutral',
      at: this.now(),
      who: m.author,
      title: clip(collapse(m.subject), 160) || undefined,
      text: firstLine(m.text),
      body: m.text.trim().slice(0, MAIL_BODY_MAX),
      sessionId: s?.id,
      projectId: s?.projectId,
      open: boss ? { page: 'boss' } : { page: 'session', id: m.target },
      mail,
    })
    this.changed()
  }

  private buttons(actions: unknown): Stored['actions'] {
    const list = (Array.isArray(actions) ? actions : [])
      .map((a) => ({ label: clip(collapse(String((a as { label?: unknown })?.label ?? '')), 48), brief: String((a as { brief?: unknown })?.brief ?? '').trim().slice(0, 4000) }))
      .filter((a) => a.label && a.brief)
      .slice(0, MAX_ACTIONS)
      .map((a, i) => ({ id: `a${i + 1}`, ...a }))
    return list.length ? list : undefined
  }

  /** « weevils post »: a word in the stream, from weevboss unless another author signs it, with up to three buttons. */
  post(text: unknown, actions?: unknown, from?: string): ForYouItem {
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) throw new Error(tr(M).emptyText)
    const item: Stored = { id: newId('b'), kind: 'boss', tone: 'neutral', at: this.now(), who: from || 'weevboss', text: clip(body, POST_MAX), actions: this.buttons(actions), reply: 'boss', open: { page: 'boss' } }
    this.put(item)
    this.changed()
    return this.view(item, this.w.snapshot())!
  }

  /**
   * « weevils show »: a file an agent wants the user to see. Its session is the most recently active one working in
   * (or above) the caller's folder; files shown by the same session within two minutes join one item.
   */
  addMedia(o: { path: unknown; caption?: unknown; cwd?: unknown; from?: string }): ForYouItem {
    if (!this.shelf) throw new Error(tr(M).noMedia)
    const cwd = typeof o.cwd === 'string' && o.cwd ? path.resolve(o.cwd) : undefined
    const entry = this.shelf.add(String(o.path ?? ''), cwd)
    const caption = clip(collapse(typeof o.caption === 'string' ? o.caption : ''), 200)
    const snap = this.w.snapshot()
    const s = cwd
      ? snap.sessions
          .filter((x) => x.machineId === this.machineId && x.cwd && (cwd === x.cwd || cwd.startsWith(x.cwd + path.sep)) && this.eligible(x))
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
      : undefined
    const now = this.now()
    const open = this.s.items.find((i) => i.kind === 'media' && !i.gone && now - i.at < MEDIA_JOIN_MS && (i.mediaIds?.length ?? 0) < MAX_MEDIA && (s ? i.sessionId === s.id : !i.sessionId && i.cwd === cwd))
    if (open) {
      if (!open.mediaIds!.includes(entry.id)) open.mediaIds!.push(entry.id)
      if (caption) open.title = caption
      open.at = now
      delete open.seen
      this.changed()
      return this.view(open, snap)!
    }
    // No session: weevboss showing something from its own folder, else weevils itself.
    const own = !s && !!cwd && (cwd === this.dataDir || cwd.startsWith(this.dataDir + path.sep))
    const boss = !s && (own || o.from === 'weevboss')
    const item: Stored = {
      id: newId('v'),
      kind: 'media',
      tone: s ? 'result' : 'neutral',
      at: now,
      who: s ? 'session' : boss ? 'weevboss' : (o.from ?? 'weevils'),
      title: caption || undefined,
      text: '',
      mediaIds: [entry.id],
      cwd,
      ...(s ? { projectId: s.projectId, sessionId: s.id, tool: s.tool, reply: 'session' as const, open: { page: 'session' as const, id: s.id } } : boss ? { reply: 'boss' as const, open: { page: 'boss' as const } } : {}),
    }
    this.put(item)
    this.changed()
    return this.view(item, snap)!
  }

  /** The seam for generated items (the curator): written as given, replacing an item of the same id. */
  add(n: NewItem): ForYouItem | null {
    const text = clip(n.text.trim(), POST_MAX)
    if (!text) return null
    const boss = n.kind === 'boss'
    const item: Stored = {
      id: n.id ?? newId(n.kind[0]),
      kind: n.kind,
      tone: n.tone ?? (n.kind === 'improve' || n.kind === 'milestone' ? 'magic' : 'neutral'),
      at: this.now(),
      who: n.who ?? (boss ? 'weevboss' : 'weevils'),
      projectId: n.projectId,
      title: n.title ? clip(collapse(n.title), 160) : undefined,
      text,
      more: n.more || undefined,
      gauges: n.gauges?.length ? n.gauges : undefined,
      actions: this.buttons(n.actions),
      lang: n.lang,
      ...(boss || n.kind === 'improve' ? { reply: 'boss' as const, open: { page: 'boss' as const } } : {}),
      ...(n.open ? { open: n.open } : {}),
    }
    this.put(item)
    this.changed()
    return this.view(item, this.w.snapshot())
  }

  /** Recorded items of these kinds, newest first, as the app would read them (for the curator: what was already said). */
  recent(kinds: ForYouKind[], max = 40): ForYouItem[] {
    const snap = this.w.snapshot()
    return [...this.s.items]
      .filter((i) => kinds.includes(i.kind))
      .sort((a, b) => b.at - a.at)
      .slice(0, max)
      .map((i) => this.view({ ...i, gone: false }, snap, true))
      .filter((i): i is ForYouItem => !!i)
  }

  /** The app looked at the stream in the last half hour. */
  wanted(now = this.now()): boolean {
    return this.lastWanted > 0 && now - this.lastWanted < WANTED_MS
  }

  // ---------------------------------------------------------------- reading: recorded items

  /** What the app may read of a recorded item, or null when it has nothing to show right now. */
  private view(i: Stored, snap: Snapshot, any = false): ForYouItem | null {
    if (i.gone) return null
    const out: ForYouItem = { id: i.id, kind: i.kind, tone: i.tone, at: i.at, who: i.who, text: i.text }
    if (i.projectId) out.projectId = i.projectId
    if (i.sessionId) out.sessionId = i.sessionId
    if (i.tool) out.tool = i.tool
    if (i.title) out.title = i.title
    if (i.body) out.body = i.body
    if (i.open) out.open = i.open
    if (i.reply) out.reply = i.reply
    if (i.more) out.more = true
    if (i.moreText) out.moreText = i.moreText
    if (i.gauges?.length) out.gauges = i.gauges
    // Words of weevboss or of an outside author can be listened to, each in its own voice.
    const voice = (i.kind === 'boss' || i.kind === 'mail') && i.text ? this.deps.voiceOf?.(i.who) : undefined
    if (voice) out.voice = voice
    if (i.seen) out.seen = true
    if (i.actions?.length) out.actions = i.actions.map(({ id, label }): ForYouAction => ({ id, label }))
    if (i.mediaIds?.length && this.shelf) {
      const media = i.mediaIds.map((id) => this.shelf!.get(id)).filter((e) => !!e).map((e): ForYouMedia => this.shelf!.view(e!))
      if (media.length) out.media = media
    }
    if (i.kind === 'media' && !out.media) return null
    if (i.kind === 'mail') {
      // Without a bridge to send through, nothing to reply with.
      if (i.mail?.address && this.deps.mail?.()) out.reply = 'mail'
      else delete out.reply
    }
    if (i.kind === 'session') {
      const cur = snap.sessions.find((s) => s.id === i.sessionId)
      if (cur) out.title = cur.title
      const t = tr(M)
      if (i.tone === 'question') {
        // Answered since (or gone from the list): no longer a question.
        if (!any && cur?.status !== 'needs_user') return null
        out.text = i.text || t.waiting
      } else if (i.tone === 'alert') {
        if (!any && cur?.status !== 'interrupted') return null
        out.text = t.cut(tr(CM).cutWhy(i.cut ?? 'died'))
        out.actions = [{ id: 'resume', label: t.resume }]
      }
    }
    return out
  }

  // ---------------------------------------------------------------- reading: live items

  /** Usage and machine measures, asked in the background: a read never waits for them. */
  private refresh(now: number, snap: Snapshot) {
    if (this.refreshing || !(this.deps.quotas || this.deps.machines)) return
    if (now - this.refreshedAt < (this.wanted(now) ? REFRESH_MS : REFRESH_IDLE_MS)) return
    this.refreshing = true
    this.refreshedAt = now
    const before = this.systemAlerts(snap, now).map((a) => a.id).join()
    void Promise.all([
      this.deps.quotas?.().then((u) => void (this.usage = u)).catch(() => undefined),
      this.deps.machines?.().then((list) => {
        this.machines = list
        const hot = new Map<string, number>()
        for (const m of list) if (m.level === 'crit') hot.set(m.id, (this.hot.get(m.id) ?? 0) + 1)
        this.hot = hot
      }).catch(() => undefined),
    ]).finally(() => {
      this.refreshing = false
      // The next snapshot's mark() counts the revision.
      if (this.systemAlerts(this.w.snapshot(), this.now()).map((a) => a.id).join() !== before) this.w.bump()
    })
  }

  /** Alerts that come from the system (not from a session): each with the place where it is solved. */
  private systemAlerts(snap: Snapshot, now: number): ForYouItem[] {
    const t = tr(M)
    const out: ForYouItem[] = []
    const raise = (id: string, text: string, open: ForYouItem['open'], at?: number) => out.push({ id: `alert:${id}`, kind: 'alert', tone: 'alert', at: at ?? 0, who: 'weevils', text, open, live: true })
    for (const tool of ['claude', 'codex'] as const) {
      const q = this.usage?.[tool]
      const top = q?.ok ? [...q.windows].sort((a, b) => b.percent - a.percent)[0] : undefined
      if (!top || top.percent < USAGE_ALERT) continue
      const name = top.kind === 'session' ? t.window_session : top.kind === 'week' ? t.window_week : t.window_model(top.label ?? '')
      // The window's reset is in the id: the next window is another alert.
      raise(`usage:${tool}:${top.kind}:${top.label ?? ''}:${top.resetsAt ?? 0}`, t.usage(tool === 'claude' ? 'Claude' : 'Codex', name.trim(), Math.round(top.percent)), { page: 'usage' })
    }
    for (const m of this.machines) {
      if ((this.hot.get(m.id) ?? 0) >= HOT_SAMPLES) raise(`machine:${m.id}`, t.saturated(m.name), { page: 'machine' })
      if (m.disk !== undefined && m.disk >= DISK_ALERT) raise(`disk:${m.id}`, t.diskFull(m.name, Math.round(m.disk)), { page: 'machine' })
    }
    for (const m of snap.machines) {
      const since = this.offSince.get(m.id)
      if (!m.online && since !== undefined && now - since >= OFFLINE_AFTER_MS) raise(`offline:${m.id}`, t.offline(m.name), { page: 'machine' }, since)
    }
    for (const o of snap.optimizers ?? []) {
      if (o.state === 'failed' && o.endedAt && now - o.endedAt < FAILED_KEEP_MS) raise(`auto:${o.id}`, t.autoFailed(o.title, o.lastEvent ?? ''), { page: 'auto', id: o.id }, o.endedAt)
    }
    return out
  }

  /** Tips whose accept runs on the server or goes to weevboss; the ones that open a page of the app stay in the app. */
  private tips(snap: Snapshot, now: number): Found[] {
    const input = this.deps.tips?.(snap, now)
    if (!input) return []
    try {
      return personalTips(input).filter((f) => f.action?.kind === 'server' || f.action?.kind === 'boss')
    } catch {
      return []
    }
  }

  /** The cards waiting for a yes or a no: proposed auto tasks first, then tips; never one already answered. */
  private cards(snap: Snapshot, now: number): ForYouCard[] {
    const auto = (snap.optimizers ?? []).filter((o) => o.state === 'proposed').map((o): ForYouCard => ({ id: `o:${o.id}`, title: o.title, why: o.why, source: 'optimizer', kind: o.kind }))
    const tips = this.tips(snap, now).map((f): ForYouCard => ({ id: `t:${f.id}`, title: f.text, why: '', source: 'tip', kind: f.rule, ...(f.accept ? { accept: f.accept } : {}) }))
    return [...auto, ...tips].filter((c) => !(c.id in this.s.cards)).slice(0, MAX_CARDS)
  }

  /** Alerts and proposals of this instant, with their kept state (seen, dismissed, first seen). */
  private live(snap: Snapshot, now: number): ForYouItem[] {
    for (const m of snap.machines) {
      if (m.online) this.offSince.delete(m.id)
      else if (!this.offSince.has(m.id)) this.offSince.set(m.id, now)
    }
    const items = this.systemAlerts(snap, now)
    const cards = this.cards(snap, now)
    if (cards.length) items.push({ id: 'proposals', kind: 'proposals', tone: 'neutral', at: 0, who: 'weevils', text: tr(M).proposals(cards.length), cards, live: true })
    const out: ForYouItem[] = []
    for (const i of items) {
      const st = (this.s.live[i.id] ??= { at: now, last: now })
      st.last = now
      if (i.cards) {
        const ids = i.cards.map((c) => c.id)
        // A new card: the band is news again, even dismissed.
        if (st.cards && ids.some((id) => !st.cards!.includes(id))) {
          st.at = now
          delete st.seen
          delete st.gone
        }
        st.cards = ids
      }
      if (st.gone) continue
      out.push({ ...i, at: i.cards ? st.at : i.at || st.at, ...(st.seen ? { seen: true } : {}) })
    }
    for (const [id, st] of Object.entries(this.s.live)) if (now - st.last > LIVE_FORGET_MS) delete this.s.live[id]
    return out
  }

  // ---------------------------------------------------------------- reading: the whole

  /**
   * Everything visible now, before the language filter. Also: a session that waits or was cut without an item saying
   * so gets one (after a restart, core's first pass is silent), and the revision moves when the visible set changed.
   */
  private all(snap: Snapshot, now: number, inBuild: boolean): { item: ForYouItem; lang?: Lang }[] {
    let wrote = false
    for (const s of snap.sessions) {
      if (s.status !== 'needs_user' && s.status !== 'interrupted') continue
      if (this.eligible(s) && this.waiting(s, s.status === 'needs_user' ? 'question' : 'cut')) wrote = true
    }
    if (wrote) this.changed(false)
    const out: { item: ForYouItem; lang?: Lang }[] = []
    for (const i of this.s.items) {
      const item = this.view(i, snap)
      if (item) out.push({ item, lang: i.lang })
    }
    for (const item of this.live(snap, now)) out.push({ item })
    const sig = out.map((x) => `${x.item.id}${x.item.cards ? `[${x.item.cards.map((c) => c.id).join()}]` : ''}`).sort().join('|')
    let moved = wrote
    if (sig !== this.s.sig) {
      this.s.sig = sig
      // A change already counted by changed() is the same change.
      if (!this.dirty) this.s.rev++
      this.save()
      moved = true
    }
    // Found while answering the app, not while building the snapshot: the snapshot's mark has to follow.
    if (moved && !inBuild) this.w.bump()
    this.dirty = false
    return out
  }

  private pulse(snap: Snapshot, now: number): ForYouPulse {
    const mine = snap.sessions.filter((s) => this.eligible(s))
    return {
      working: mine.filter((s) => s.status === 'working').length,
      waiting: mine.filter((s) => s.status === 'needs_user' || s.status === 'interrupted').length,
      delivered: this.s.delivered.day === day(now) ? this.s.delivered.n : 0,
      auto: (snap.optimizers ?? []).filter((o) => o.state === 'running' || o.state === 'queued').length,
    }
  }

  /** GET /api/foryou: the stream in the app's language, ordered and paced, and the factory line. */
  feed(now = this.now(), l?: unknown): ForYouFeed {
    this.lastWanted = now
    const snap = this.w.snapshot()
    this.refresh(now, snap)
    return withLang(l, () => {
      const cur = lang()
      const items = this.all(snap, now, false).filter((x) => !x.lang || x.lang === cur).map((x) => x.item)
      return { rev: this.s.rev, items: arrange(items, now).slice(0, MAX_FEED), pulse: this.pulse(snap, now) }
    })
  }

  /**
   * For the snapshot, called by Weevils.snapshot() with the snapshot it is building (never ask the host for it here):
   * the revision and how many items were never under the user's eyes.
   */
  mark(snap: Snapshot): ForYouMark {
    const now = this.now()
    this.refresh(now, snap)
    const cur = lang()
    const unseen = this.all(snap, now, true).filter((x) => !x.item.seen && (!x.lang || x.lang === cur)).length
    return { rev: this.s.rev, unseen }
  }

  // ---------------------------------------------------------------- what the user does

  /** Seen on a device: seen everywhere. */
  seen(ids: unknown): void {
    let any = false
    for (const id of Array.isArray(ids) ? ids.map(String) : []) {
      const i = this.get(id)
      const st = this.s.live[id]
      if (i && !i.seen) any = i.seen = true
      else if (!i && st && !st.seen) any = st.seen = true
    }
    if (any) this.changed()
  }

  dismiss(id: string): boolean {
    const i = this.get(id)
    const st = this.s.live[id]
    if (i) i.gone = true
    else if (st) st.gone = true
    else return false
    this.changed()
    return true
  }

  /**
   * A button or a card. proposals: accept / refuse one card (the auto task through the auto band, a tip run here or
   * sent to weevboss), remembered so it never comes back. A button under a post: its brief goes to weevboss behind a
   * short visible message, and the item leaves. « resume » on a cut session: resumed, and the item leaves.
   */
  async act(id: string, action: string, card?: string, l?: unknown): Promise<void> {
    const t = withLang(l, () => tr(M))
    if (id === 'proposals') {
      const snap = this.w.snapshot()
      const now = this.now()
      const c = withLang(l, () => this.cards(snap, now)).find((x) => x.id === card)
      if (!c || (action !== 'accept' && action !== 'refuse')) throw new Error(c ? t.noAction : t.cardGone)
      const raw = c.id.slice(2)
      if (c.source === 'optimizer') {
        const o = this.deps.optimizers?.()
        if (!(action === 'accept' ? o?.accept(raw) : o?.refuse(raw))) throw new Error(t.cardGone)
      } else if (action === 'accept') {
        const input = this.deps.tips?.(snap, now)
        const f = input && withLang(l, () => personalTips(input)).find((x) => x.id === raw)
        if (!input || !f?.action) throw new Error(t.cardGone)
        if (f.action.kind === 'boss') await this.w.sendMain(f.action.text)
        else await withLang(l, () => actOn(raw, input, { close: (sid) => this.w.close(sid) }))
      }
      this.s.cards[c.id] = this.now()
      return this.changed()
    }
    const i = this.get(id)
    if (!i || i.gone) throw new Error(t.notFound)
    if (i.kind === 'session' && action === 'resume' && i.sessionId) await this.w.resume(i.sessionId)
    else {
      const a = i.actions?.find((x) => x.id === action)
      if (!a) throw new Error(t.noAction)
      await this.w.sendMain(t.go(a.label), t.actBrief(clip(collapse(i.text), 300), a.brief))
    }
    i.gone = true
    this.changed()
  }

  /** Words typed under an item: to its session, to weevboss (with the post as a hidden note), or by mail to its author. */
  async reply(id: string, text: unknown, l?: unknown): Promise<void> {
    const t = withLang(l, () => tr(M))
    const body = typeof text === 'string' ? text.trim() : ''
    if (!body) throw new Error(t.emptyText)
    const i = this.get(id)
    if (!i || i.gone) throw new Error(t.notFound)
    if (i.kind === 'mail') {
      const out = this.deps.mail?.()
      if (!out || !i.mail?.address) throw new Error(t.mailOff)
      const sent = await out.write({ to: i.mail.address, subject: i.mail.subject, text: body, inReplyTo: i.mail.mid, author: i.who, target: i.mail.target })
      if (!sent) throw new Error(t.noReply)
    } else if (i.reply === 'session' && i.sessionId) await this.w.send(i.sessionId, body)
    else if (i.reply === 'boss') await this.w.sendMain(body, t.replyBrief(clip(collapse(i.text || i.title || ''), 400)))
    else throw new Error(t.noReply)
    if (!i.seen) {
      i.seen = true
      this.changed()
    }
  }

  /** « Learn more »: the longer answer, kept in the item. Written by the curator; until it exists, only what is kept. */
  async more(id: string, l?: unknown): Promise<string> {
    const t = withLang(l, () => tr(M))
    const i = this.get(id)
    if (!i || i.gone) throw new Error(t.notFound)
    if (i.moreText) return i.moreText
    const item = i.more && this.curator ? this.view(i, this.w.snapshot(), true) : null
    if (!item) throw new Error(t.noMore)
    const text = (await this.curator!.more(item)).trim()
    if (!text) throw new Error(t.noMore)
    i.moreText = text.slice(0, MAIL_BODY_MAX)
    this.changed()
    return i.moreText
  }
}

// ---------------------------------------------------------------- routes

/**
 * GET /api/foryou[?lang=] → ForYouFeed · POST /api/foryou/seen { ids } · POST /api/foryou/:id/dismiss ·
 * POST /api/foryou/:id/act { action, card? } · POST /api/foryou/:id/reply { text } · POST /api/foryou/:id/more → { text } ·
 * POST /api/foryou/post { text, actions?, from? } and POST /api/foryou/media { path, caption?, cwd?, from? }: from this
 * machine only (weevils post / show) · GET /api/foryou/media/:id → the bytes (the router already checked the cookie).
 */
export function foryouRoutes(fy: ForYou, json: Json, readBody: ReadBody): [string, RegExp, Handler][] {
  const id = (raw: string) => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  const langOf = (url: URL) => (isLang(url.searchParams.get('lang')) ? url.searchParams.get('lang') : undefined)
  /** A refusal is a 400 with its short reason; an item that is not there, a 404. */
  const run = async (res: http.ServerResponse, known: boolean, fn: () => Promise<unknown> | unknown) => {
    if (!known) return json(res, 404, { error: tr(M).notFound })
    try {
      json(res, 200, (await fn()) ?? { ok: true })
    } catch (e) {
      json(res, 400, { error: (e as Error).message })
    }
  }
  const exists = (itemId: string) => fy.has(itemId)
  return [
    ['GET', /^\/api\/foryou$/, (_req, res, url) => json(res, 200, fy.feed(undefined, langOf(url)))],
    ['POST', /^\/api\/foryou\/seen$/, async (req, res) => {
      fy.seen((await readBody(req))?.ids)
      json(res, 200, { ok: true })
    }],
    // weevboss and the sessions of this machine (weevils post / show): never the phone, whatever « from » it claims.
    ['POST', /^\/api\/foryou\/post$/, async (req, res) => {
      const b = await readBody(req)
      if (!isLocal(req)) return json(res, 403, { error: tr(M).localOnly })
      await run(res, true, () => ({ item: fy.post(b?.text, b?.actions, trustedFrom(req, b)) }))
    }],
    ['POST', /^\/api\/foryou\/media$/, async (req, res) => {
      const b = await readBody(req)
      if (!isLocal(req)) return json(res, 403, { error: tr(M).localOnly })
      await run(res, true, () => ({ item: fy.addMedia({ path: b?.path, caption: b?.caption, cwd: b?.cwd, from: trustedFrom(req, b) }) }))
    }],
    // GET and HEAD (a player may ask for the size first): the router matches the method exactly.
    ...(['GET', 'HEAD'] as const).map((method): [string, RegExp, Handler] => [method, /^\/api\/foryou\/media\/([\w-]+)$/, (req, res, _u, [mid]) => {
      if (!fy.shelf) return json(res, 404, { error: tr(M).noMedia })
      fy.shelf.serve(req, res, mid)
    }]),
    ['POST', /^\/api\/foryou\/([^/]+)\/dismiss$/, (_req, res, _u, [raw]) => {
      const ok = fy.dismiss(id(raw))
      json(res, ok ? 200 : 404, ok ? { ok } : { error: tr(M).notFound })
    }],
    ['POST', /^\/api\/foryou\/([^/]+)\/act$/, async (req, res, url, [raw]) => {
      const b = await readBody(req)
      await run(res, exists(id(raw)), () => fy.act(id(raw), String(b?.action ?? ''), typeof b?.card === 'string' ? b.card : undefined, langOf(url)))
    }],
    ['POST', /^\/api\/foryou\/([^/]+)\/reply$/, async (req, res, url, [raw]) => {
      const b = await readBody(req)
      await run(res, exists(id(raw)), () => fy.reply(id(raw), b?.text, langOf(url)))
    }],
    ['POST', /^\/api\/foryou\/([^/]+)\/more$/, async (_req, res, url, [raw]) => {
      await run(res, exists(id(raw)), async () => ({ text: await fy.more(id(raw), langOf(url)) }))
    }],
  ]
}
