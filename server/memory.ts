// What weevils remembers about the user: goals, wishes, projects, tastes. Fed by the answers given to the flying weevils
// (server/weevil.ts) and edited by hand in the app (memory page, bottom of the machines band).
//
// Stored in ~/.config/weevils/memory.json (mode 600): outside every repo, never committed, never sent anywhere but to
// the model that writes the weevils' questions, the h24 proposals (server/optimizers.ts) and weevboss's context.
// The questions already asked live in the same file, so a question is never asked twice.

import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import type { MemoryItem } from '../shared/api.ts'
import { CONFIG_DIR } from './config.ts'
import { tr } from './i18n.ts'
import M from './i18n/memory.ts'

/** Generous caps: the whole memory goes into prompts. */
const MAX_ITEMS = 300
const MAX_TEXT = 400
const MAX_ASKED = 400

/** A question carried by a flying weevil, and what became of it. */
export interface Asked {
  id: string
  text: string
  at: number
  /** shown: flew by without being caught; answered: someone answered at least once. */
  state: 'pending' | 'shown' | 'answered'
  /** How many times it flew by without being caught. */
  misses?: number
}

interface Stored {
  items: MemoryItem[]
  asked: Asked[]
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL, params: string[]) => Promise<void> | void
type Json = (res: http.ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: http.IncomingMessage) => Promise<any>

const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)

export class Memory {
  readonly file: string
  private s: Stored
  private listeners = new Set<() => void>()

  constructor(file = path.join(CONFIG_DIR, 'memory.json')) {
    this.file = file
    this.s = (() => {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Stored>
        return { items: Array.isArray(raw.items) ? raw.items : [], asked: Array.isArray(raw.asked) ? raw.asked : [] }
      } catch {
        return { items: [], asked: [] }
      }
    })()
  }

  /** Called after every change (snapshot count, weevboss's context, h24 proposals). */
  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ items: this.s.items.slice(-MAX_ITEMS), asked: this.s.asked.slice(-MAX_ASKED) }, null, 1), { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error(`[mémoire] écriture : ${(e as Error).message}`)
    }
    for (const fn of this.listeners) fn()
  }

  // ---------------------------------------------------------------- souvenirs

  /** Newest first. */
  list(): MemoryItem[] {
    return [...this.s.items].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get count() {
    return this.s.items.length
  }

  get(id: string) {
    return this.s.items.find((m) => m.id === id)
  }

  add(text: string, from: { source?: MemoryItem['source']; q?: string; a?: string } = {}): MemoryItem {
    const t = clean(text)
    if (!t) throw new Error(tr(M).empty)
    const now = Date.now()
    const item: MemoryItem = { id: crypto.randomBytes(5).toString('hex'), text: t, source: from.source ?? 'manual', at: now, updatedAt: now }
    if (from.q) item.q = clean(from.q)
    if (from.a) item.a = String(from.a).trim().slice(0, 1200)
    this.s.items.push(item)
    this.save()
    return item
  }

  /** Text changed by hand (source becomes manual) or rewritten by the model from a newer answer (source kept). */
  update(id: string, text: string, from?: { q?: string; a?: string }): MemoryItem {
    const item = this.get(id)
    if (!item) throw new Error(tr(M).notFound)
    const t = clean(text)
    if (!t) throw new Error(tr(M).empty)
    item.text = t
    item.updatedAt = Date.now()
    if (from) {
      if (from.q) item.q = clean(from.q)
      if (from.a) item.a = String(from.a).trim().slice(0, 1200)
    } else item.source = 'manual'
    this.save()
    return item
  }

  remove(id: string) {
    const n = this.s.items.length
    this.s.items = this.s.items.filter((m) => m.id !== id)
    if (this.s.items.length !== n) this.save()
  }

  /** The memory as prompt lines, newest first: « - [id] text ». Empty string when nothing is known yet. */
  asText(max = 120): string {
    return this.list()
      .slice(0, max)
      .map((m) => `- [${m.id}] ${m.text}`)
      .join('\n')
  }

  // ---------------------------------------------------------------- questions des weevils

  asked(): Asked[] {
    return this.s.asked
  }

  /** Records a new question (pending until it flies by or gets an answer). */
  ask(text: string): Asked {
    const q: Asked = { id: crypto.randomBytes(5).toString('hex'), text: clean(text), at: Date.now(), state: 'pending' }
    this.s.asked.push(q)
    this.save()
    return q
  }

  question(id: string) {
    return this.s.asked.find((q) => q.id === id)
  }

  markAsked(id: string, state: 'shown' | 'answered') {
    const q = this.question(id)
    if (!q) return
    if (state === 'shown') q.misses = (q.misses ?? 0) + 1
    if (q.state !== 'answered') q.state = state
    this.save()
  }

  /** Every question already asked, newest first, as prompt lines (so the model never asks the same thing twice). */
  askedText(max = 80): string {
    return [...this.s.asked]
      .reverse()
      .slice(0, max)
      .map((q) => `- ${q.text}${q.state === 'answered' ? '' : tr(M).noAnswer}`)
      .join('\n')
  }
}

/**
 * GET /api/memory → { items } · POST /api/memory { text } → { item } · PUT /api/memory/:id { text } → { item } ·
 * DELETE /api/memory/:id → { ok }
 */
export function memoryRoutes(m: Memory, json: Json, readBody: ReadBody): [string, RegExp, Handler][] {
  return [
    ['GET', /^\/api\/memory$/, (_req, res) => json(res, 200, { items: m.list() })],
    ['POST', /^\/api\/memory$/, async (req, res) => {
      const body = await readBody(req)
      if (!clean(body.text)) return json(res, 400, { error: tr(M).empty })
      json(res, 200, { item: m.add(body.text) })
    }],
    ['PUT', /^\/api\/memory\/([\w-]+)$/, async (req, res, _u, [id]) => {
      const body = await readBody(req)
      if (!m.get(id)) return json(res, 404, { error: tr(M).notFound })
      if (!clean(body.text)) return json(res, 400, { error: tr(M).empty })
      json(res, 200, { item: m.update(id, body.text) })
    }],
    ['DELETE', /^\/api\/memory\/([\w-]+)$/, (_req, res, _u, [id]) => {
      m.remove(id)
      json(res, 200, { ok: true })
    }],
  ]
}
