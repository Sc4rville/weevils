// What a thread shows of a long message weevboss (or another agent) sent into a session: one short spoken line, like
// a manager talking to a colleague. The agent still gets the whole brief; the app opens it on a tap.
// The line comes with the message (`weevils send|new --say "…"`), otherwise a cheap model writes it once, in the app
// locale, and it is kept here by the brief's text (the transcript has no other stable handle on a message).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Message } from '../shared/api.ts'
import { isLongBrief, briefKeyText } from '../shared/brief-say.ts'
import { parseSigned } from './authors.ts'
import { lang, type Lang } from './i18n.ts'
import M from './i18n/brief-says.ts'
import { TitleRetry } from './titles.ts'

interface Entry { say: string; at: number; lang?: Lang; given?: true }
const MAX = 3000
const BATCH = 6

/** The brief as the thread shows it: no signature, no hidden weevils block, spaces collapsed. */
export const briefOf = (text: string) => briefKeyText(parseSigned(text)?.text ?? text)
export const sayKey = (text: string) => crypto.createHash('sha256').update(briefOf(text)).digest('hex').slice(0, 32)
/** A spoken line: one line, no quotes around it, short enough for a phone. */
export const cleanSay = (s: unknown): string => {
  if (typeof s !== 'string') return ''
  const t = s.replace(/\s+/g, ' ').trim().replace(/^["'«“\s]+|["'»”\s]+$/g, '').trim()
  return t.length > 160 ? `${t.slice(0, 159)}…` : t
}

export class BriefSays {
  private entries: Record<string, Entry> = {}
  private wanted = new Map<string, string>()
  private running = false
  private retry = new TitleRetry()
  onChange: () => void = () => {}
  private file: string
  private write: (prompt: string) => Promise<string>
  private now: () => number
  constructor(file: string, write: (prompt: string) => Promise<string> = async () => { throw new Error('no model') }, now = Date.now) { // i18n-ignore: internal, never shown
    this.file = file
    this.write = write
    this.now = now
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d?.version === 1 && d.entries) this.entries = d.entries } catch { /* first start */ }
  }

  private save() {
    const keys = Object.keys(this.entries)
    if (keys.length > MAX) for (const k of keys.sort((a, b) => this.entries[a].at - this.entries[b].at).slice(0, keys.length - MAX)) delete this.entries[k]
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, entries: this.entries }), { mode: 0o600 })
    fs.renameSync(this.file + '.tmp', this.file)
  }

  /** The sender's own line (`--say`): it wins over any generated one. */
  given(text: string, say: unknown) {
    const line = cleanSay(say)
    if (!line || !briefOf(text)) return
    this.entries[sayKey(text)] = { say: line, at: this.now(), given: true }
    this.save()
  }

  /** The line of a brief, if there is one in the app's language (a given line is kept in any language). */
  get(text: string): string | undefined {
    const e = this.entries[sayKey(text)]
    return e && (e.given || !e.lang || e.lang === lang()) ? e.say : undefined
  }

  /** A long brief with no line yet: written in the background, the thread updates when it lands. */
  want(text: string) {
    if (!isLongBrief(briefOf(text)) || this.get(text)) return
    this.wanted.set(sayKey(text), briefOf(text))
    void this.pump()
  }

  /** Messages as the app reads them: each long signed brief carries its spoken line (asked for when missing). */
  attach(messages: Message[]): Message[] {
    let out: Message[] | undefined
    messages.forEach((m, i) => {
      if (m.role !== 'orchestrator' || !isLongBrief(briefOf(m.text))) return
      const say = this.get(m.text)
      if (!say) { this.want(m.text); return }
      ;(out ??= messages.slice())[i] = { ...m, say }
    })
    return out ?? messages
  }

  private async pump() {
    if (this.running || !this.wanted.size || !this.retry.ready(this.now())) return
    this.running = true
    const l = lang()
    const batch = [...this.wanted].slice(0, BATCH)
    try {
      const items = batch.map(([, text], n) => JSON.stringify({ id: String(n), brief: text.length > 1500 ? `${text.slice(0, 1500)}…` : text }))
      const out = await this.write(M[l].prompt(`[${items.join(',')}]`))
      const raw = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { items?: { id?: unknown; say?: unknown }[] }
      let got = 0
      for (const r of raw.items ?? []) {
        const hit = batch[Number(r.id)]
        const say = cleanSay(r.say)
        if (!hit || !say) continue
        if (!this.entries[hit[0]]?.given) this.entries[hit[0]] = { say, at: this.now(), lang: l }
        got++
      }
      for (const [k] of batch) this.wanted.delete(k)
      if (!got) throw new Error('no line') // i18n-ignore: internal, logged only
      this.retry.succeeded()
      this.save()
      this.onChange()
    } catch (e) {
      this.retry.failed(this.now())
      console.log(`[says] ${(e as Error).message.slice(0, 120)}`)
    } finally {
      this.running = false
    }
    if (this.wanted.size && this.retry.ready(this.now())) void this.pump()
  }
}
